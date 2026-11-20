import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MT_MODELS, checkPair, defaultMtModelId, detectLanguage, findMtModel, langCodeFor,
} from './mt-models.js'

const SERVER = fileURLToPath(new URL('./mt-server.js', import.meta.url))
// Resolves from this file's directory, which is exactly the resolution scope the
// mt-server child uses for `@huggingface/transformers`.
const require = createRequire(import.meta.url)
const MT_DEP = '@huggingface/transformers'

/**
 * Owns the translation child process: model download/load progress, one queued
 * request at a time, and clean teardown. A crash inside ONNX Runtime only ends
 * this child, and the next request respawns it.
 */
export function createLocalMt({ dataRoot, config, packageDir, log, modelOf }) {
  const cacheDir = join(dataRoot, 'models', 'mt')
  const configured = typeof config?.mtModel === 'string' && config.mtModel !== '' ? config.mtModel : null
  const hosts = Array.isArray(config?.mtHosts) && config.mtHosts.length > 0
    ? config.mtHosts
    : ['https://hf-mirror.com', 'https://huggingface.co']

  /** Current model id: the setting, then the config, then the shipped default. */
  function currentModelId() {
    const chosen = modelOf?.()
    if (typeof chosen === 'string' && chosen !== '') return chosen
    return configured ?? defaultMtModelId()
  }

  let modelId = currentModelId()

  let child = null
  let state = 'idle' // idle | loading | ready | failed
  let error = null
  let hostIndex = 0
  let disposed = false
  let seq = 0
  let stdoutBuffer = ''
  let lastUsed = Date.now()
  let missingDeps = false
  let installing = false
  let installProgress = null
  // Set while a model is being fetched from scratch, so a cancel can throw the
  // half-written weights away instead of leaving a cache the loader chokes on.
  let freshDownload = null
  const pending = new Map()
  const files = new Map()
  const waiters = new Set()

  /**
   * Where the weights live. transformers.js writes `<cacheDir>/<org>/<name>/`,
   * while the Hugging Face hub cache uses `models--org--name`; accept both so a
   * pre-populated download is never offered again.
   */
  function modelDirs(id) {
    const [org, name] = id.split('/')
    return [
      join(cacheDir, org ?? id, name ?? ''),
      join(cacheDir, `models--${id.replace('/', '--')}`),
    ]
  }

  function hasWeights(dir, depth = 0) {
    if (depth > 4) return false
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.onnx')) return true
      if (entry.isDirectory() && hasWeights(join(dir, entry.name), depth + 1)) return true
    }
    return false
  }

  /** Whether one catalog model already sits fully in the local cache. */
  function isDownloaded(id) {
    return modelDirs(id).some((dir) => hasWeights(dir))
  }


  /** Whether the built-in translation dependency can be resolved right now. */
  function depsInstalled() {
    try {
      require.resolve(MT_DEP)
      return true
    } catch {
      return false
    }
  }

  // The model holds roughly 600 MB of RAM; give it back when nothing uses it.
  const idleTimer = setInterval(() => {
    if (state !== 'ready' || child === null || pending.size > 0) return
    if (Date.now() - lastUsed < 10 * 60 * 1000) return
    log('mt: releasing idle translation process')
    const current = child
    child = null
    state = 'idle'
    try { current.kill() } catch { /* already gone */ }
  }, 60 * 1000)
  idleTimer.unref?.()

  function progress() {
    let loaded = 0
    let total = 0
    for (const entry of files.values()) {
      loaded += entry.loaded
      total += entry.total
    }
    return { loaded, total, files: files.size }
  }

  function describe() {
    return {
      model: modelId,
      label: findMtModel(modelId)?.label ?? modelId,
      state,
      error,
      host: hosts[hostIndex],
      progress: progress(),
      cacheDir,
      depsInstalled: depsInstalled(),
      missingDeps,
      installing,
      installProgress,
      // The catalog travels with every state payload so the panel can offer the
      // models and show which ones are already on disk.
      models: MT_MODELS.map((entry) => ({
        id: entry.id,
        label: entry.label,
        detail: entry.detail,
        sizeMb: entry.sizeMb,
        license: entry.license,
        family: entry.family,
        downloaded: isDownloaded(entry.id),
      })),
    }
  }

  /**
   * Switch the active offline model. Any loaded process is dropped first, so the
   * next translation loads (and, if needed, downloads) the new weights.
   */
  function setModel(id) {
    if (typeof id !== 'string' || id === '' || !findMtModel(id)) return { ok: false, error: '未知的离线模型' }
    if (id === modelId) return { ok: true, note: '模型未变化' }
    const current = child
    if (current !== null) {
      child = null
      try { current.kill() } catch { /* already gone */ }
    }
    modelId = id
    state = 'idle'
    error = null
    missingDeps = false
    files.clear()
    log(`mt: model switched to ${id}`)
    return { ok: true }
  }

  /** Explicit "download and load" for one catalog model. */
  function download(id) {
    const switched = setModel(id)
    if (switched.ok === false) return switched
    return prepare()
  }

  function notify() {
    for (const waiter of waiters) waiter()
  }

  function fail(message, { missing = false } = {}) {
    if (state === 'failed' && error === message && missingDeps === missing) return
    state = 'failed'
    error = message
    missingDeps = missing
    log(`mt: ${message}`)
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(message))
      pending.delete(id)
    }
    notify()
  }

  function handleLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.type === 'ready') {
      state = 'ready'
      error = null
      freshDownload = null
      lastUsed = Date.now()
      log('mt: ready')
      notify()
      return
    }
    if (message.type === 'fatal') {
      fail(message.error ?? '内置翻译模型加载失败', { missing: message.code === 'missing-deps' })
      return
    }
    if (message.type === 'progress') {
      const payload = message.payload ?? {}
      const name = payload.file ?? 'model'
      if (payload.status === 'progress' || payload.status === 'download') {
        files.set(name, { loaded: payload.loaded ?? 0, total: payload.total ?? 0 })
      } else if (payload.status === 'done') {
        const entry = files.get(name)
        if (entry !== undefined && entry.total > 0) entry.loaded = entry.total
      }
      return
    }
    if (message.type === 'result' || message.type === 'error') {
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.type === 'result') entry.resolve(String(message.text ?? ''))
      else entry.reject(new Error(message.error ?? '翻译失败'))
    }
  }

  function ensureChild() {
    if (disposed) throw new Error('插件已卸载')
    if (child !== null) return child
    if (state === 'ready') return null
    if (missingDeps || !depsInstalled()) {
      fail('内置离线翻译的依赖（@huggingface/transformers）未安装', { missing: true })
      throw new Error('内置翻译依赖未安装')
    }
    mkdirSync(cacheDir, { recursive: true })
    state = 'loading'
    error = null
    if (!isDownloaded(modelId)) freshDownload = modelId
    log(`mt: starting translation process for ${modelId} (${hosts[hostIndex]})`)
    child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MT_CACHE_DIR: cacheDir,
        MT_REMOTE_HOST: hosts[hostIndex],
        MT_MODEL: modelId,
        MT_FAMILY: findMtModel(modelId)?.family ?? 'm2m100',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk
      let index
      while ((index = stdoutBuffer.indexOf('\n')) >= 0) {
        const line = stdoutBuffer.slice(0, index).trim()
        stdoutBuffer = stdoutBuffer.slice(index + 1)
        if (line !== '') handleLine(line)
      }
    })

    child.stderr.setEncoding('utf8')
    let stderrSeen = 0
    child.stderr.on('data', (chunk) => {
      if (stderrSeen > 4000) return
      stderrSeen += chunk.length
      const text = String(chunk).trim()
      if (text !== '') log(`mt stderr: ${text.slice(0, 400)}`)
    })

    child.on('error', (spawnError) => {
      child = null
      fail(`翻译进程启动失败：${spawnError.message}`)
    })

    child.on('exit', (code, signal) => {
      child = null
      if (disposed) return
      if (state !== 'failed') {
        fail(`翻译进程退出（code ${code}${signal ? `, ${signal}` : ''}）`)
      }
      // Try the next download source once the process died before readiness.
      if (state === 'failed' && hosts.length > 1) hostIndex = (hostIndex + 1) % hosts.length
    })

    return child
  }

  /** Start the process without waiting; safe to call repeatedly. */
  function prepare() {
    try {
      // The setting may have changed since the last call; switching drops the
      // loaded process so the next readiness comes from the new weights.
      const chosen = currentModelId()
      if (chosen !== modelId) setModel(chosen)
      if (state === 'ready') return { ok: true }
      ensureChild()
      return { ok: true }
    } catch (failure) {
      return { ok: false, error: failure.message }
    }
  }

  /**
   * Install the built-in translation dependency on the user's explicit request.
   * The dependency is intentionally NOT a package dependency, so installing the
   * plugin stays light; it lands here only when someone picks the built-in or
   * offline engine.
   */
  async function installDeps() {
    if (depsInstalled()) {
      missingDeps = false
      state = 'idle'
      error = null
      return { ok: true, note: '依赖已就绪' }
    }
    if (installing) return { ok: false, error: '正在下载内置翻译依赖，请稍候。' }
    if (packageDir === null) {
      return { ok: false, error: '无法定位插件目录，请手动在插件目录执行 npm install @huggingface/transformers。' }
    }
    installing = true
    installProgress = { phase: 'installing', message: `正在下载 ${MT_DEP}…` }
    try {
      await runInstall()
      missingDeps = false
      installProgress = { phase: 'done' }
      state = 'idle'
      error = null
      hostIndex = 0
      return { ok: true, note: '依赖已安装，正在加载内置翻译模型…' }
    } catch (failure) {
      installProgress = null
      return { ok: false, error: `依赖下载失败：${failure.message}` }
    } finally {
      installing = false
    }
  }

  function runInstall() {
    return new Promise((resolve, reject) => {
      const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      // Use the Alibaba npm mirror so the dependency installs on a domestic
      // network; it is the same package as npmjs.org, only reachable from China.
      const args = ['install', '--no-save', '--no-audit', '--no-fund', '--no-package-lock',
        '--registry', 'https://registry.npmmirror.com', `${MT_DEP}@^3.0.0`]
      log(`mt: installing ${MT_DEP} into ${packageDir} (npmmirror)`)
      const child = spawn(command, args, {
        cwd: packageDir,
        windowsHide: true,
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let tail = ''
      const capture = (chunk) => {
        const text = String(chunk).trim()
        if (text !== '') {
          tail = text.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? text
          installProgress = { phase: 'installing', message: tail.slice(0, 120) }
        }
      }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', capture)
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', capture)
      child.on('error', (spawnError) => reject(new Error(spawnError.message)))
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`npm 退出码 ${code}${tail ? `（${tail.slice(0, 160)}）` : ''}`))
      })
    })
  }

  async function waitReady(timeoutMs = 20 * 60 * 1000) {
    if (state === 'ready') return
    if (state === 'failed') {
      // A previous failure may be transient (network, crash): retry once.
      if (child !== null) {
        try { child.kill() } catch { /* already gone */ }
        child = null
      }
      state = 'idle'
      error = null
    }
    if (child === null) ensureChild()
    if (state === 'ready') return
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check)
        reject(new Error('内置翻译模型准备超时'))
      }, timeoutMs)
      const check = () => {
        if (state === 'ready') {
          clearTimeout(timer)
          waiters.delete(check)
          resolve()
        } else if (state === 'failed') {
          clearTimeout(timer)
          waiters.delete(check)
          reject(new Error(error ?? '内置翻译模型不可用'))
        }
      }
      waiters.add(check)
    })
  }

  /**
   * Translate one line. Waits for the model (first use downloads it), then
   * queues behind earlier lines because the child handles one at a time.
   */
  async function translate(text, { sourceLanguage, targetLanguage, timeoutMs = 180000 } = {}) {
    const model = findMtModel(modelId) ?? findMtModel(defaultMtModelId())
    const target = langCodeFor(model, targetLanguage)
    if (target === undefined) throw new Error(`${model.label} 不支持目标语言：${targetLanguage}`)
    const detected = detectLanguage(text, sourceLanguage)
    const pairProblem = checkPair(model, detected, targetLanguage)
    if (pairProblem !== null) throw new Error(pairProblem)
    await waitReady()
    if (child === null) throw new Error('翻译进程不可用')
    const source = langCodeFor(model, detected)
    if (source === undefined) throw new Error(`${model.label} 无法识别源语言：${detected}`)
    if (source === target) return text
    lastUsed = Date.now()
    const id = ++seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('本地翻译超时'))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ type: 'translate', id, text, src: source, tgt: target })}\n`)
    })
  }

  /**
   * Abort a download/load in progress. A first-time download is discarded (the
   * process is killed, then its half-written directory is removed) so the next
   * attempt starts clean; a model that was already cached is simply unloaded.
   */
  function cancel() {
    const current = child
    const target = freshDownload
    freshDownload = null
    if (current === null && state === 'idle') return { ok: true, note: '没有正在进行的下载' }
    child = null
    state = 'idle'
    error = null
    missingDeps = false
    files.clear()
    if (current !== null) {
      try { current.kill() } catch { /* already gone */ }
    }
    if (target !== null) {
      // Give the child a moment to exit before deleting what it was writing.
      setTimeout(() => {
        for (const dir of modelDirs(target)) {
          try { rmSync(dir, { recursive: true, force: true }) } catch (failure) { log(`mt: cleanup failed: ${failure.message}`) }
        }
        log(`mt: discarded partial download of ${target}`)
      }, 1500).unref?.()
    }
    log(`mt: cancelled ${modelId}`)
    notify()
    return { ok: true }
  }

  async function dispose() {
    disposed = true
    clearInterval(idleTimer)
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('插件已卸载'))
      pending.delete(id)
    }
    const current = child
    child = null
    state = 'idle'
    if (current !== null) {
      try { current.kill() } catch (failure) { log(`mt: kill failed: ${failure.message}`) }
    }
  }

  return {
    describe, prepare, translate, waitReady, installDeps, depsInstalled, dispose,
    setModel, download, cancel, isDownloaded,
    get model() { return modelId },
  }

}
