import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startCapture } from './capture.js'
import { createAsr } from './asr.js'
import { createLlm, languageName } from './llm.js'
import { createLocalMt } from './local-mt.js'
import { MT_MODELS, defaultMtModelId, findMtModel } from './mt-models.js'
import { normalizeGain, readCanonicalHeader, rms } from './wav.js'

const SOURCES = new Set(['both', 'speaker', 'mic'])
const MAX_ENTRIES = 600
/** Below this RMS the segment is room noise; sending it only risks hallucinations. */
const SILENCE_RMS = 0.005
const MT_MODEL_IDS = new Set(MT_MODELS.map((entry) => entry.id))

const DEFAULTS = {
  source: 'both',
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  translate: true,
  translateEngine: 'cloud',
  // Cloud translation route; empty strings follow the profile's default model.
  cloudProvider: '',
  cloudModel: '',
  // Offline translation model, chosen from the shipped catalog.
  builtinModel: defaultMtModelId(),
  // Optional HTTP proxy for offline-model downloads, e.g. http://127.0.0.1:7890.
  mtProxy: '',
  localBaseUrl: 'http://127.0.0.1:11434/v1',
  localModel: '',
  localApiKey: '',
  segmentSeconds: 4,
  minSegmentSeconds: 1.2,
  keepAudio: false,
  // Desktop-lyrics box: transparency, position, size and lock. A null size
  // means "fit the current viewport", which the client resolves per screen.
  lyricFontSize: 22,
  lyricOpacity: 0.92,
  lyricX: null,
  lyricY: null,
  lyricW: null,
  lyricH: null,
  lyricLocked: false,
  lyricShowSource: true,
  lyricVisible: true,
  // Records pop-up geometry.
  recordsX: null,
  recordsY: null,
  recordsW: null,
  recordsH: null,
  providerId: undefined,
  provider: undefined,
  model: undefined,
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function stamp(ms = Date.now()) {
  const date = new Date(ms)
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * Session id is unique to the millisecond: two meetings started within the same
 * second must not share a directory, or the second would silently overwrite the
 * first one's transcript.
 */
function sessionId(ms = Date.now()) {
  return `${stamp(ms)}-${String(ms % 1000).padStart(3, '0')}`
}

function clock(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds / 1000))
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

/** Wall-clock stamp (时:分:秒) for a point inside a session. */
function timeOfDay(startedAt, offsetMs) {
  const date = new Date(startedAt + Math.max(0, offsetMs))
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Owns the whole live-subtitle lifecycle: model readiness, the native capture
 * process, sequential recognition, batched translation and meeting minutes.
 * Both the Web UI and the agent tool drive this single object.
 */
export class MeetingController {
  constructor({ ctx, config, dataRoot, packageDir, sttDataRoot, log }) {
    this.ctx = ctx
    this.config = config
    this.dataRoot = dataRoot
    this.packageDir = packageDir ?? null
    this.log = log
    this.settingsFile = join(dataRoot, 'settings.json')

    this.settings = { ...DEFAULTS }
    for (const key of Object.keys(DEFAULTS)) {
      if (config?.[key] !== undefined && config[key] !== null) this.settings[key] = config[key]
    }
    this.loadSettings()
    // Older versions stored the removed "一键离线" toggle. `loadSettings` only
    // keeps known keys, so rewrite the file once to stop it from resurrecting.
    if (this.settingsWereCleaned) this.saveSettings()

    this.status = 'idle'
    this.error = null
    this.rev = 0
    this.entries = []
    this.seq = 0
    this.cursorMs = 0
    this.session = null
    this.segments = 0
    this.capture = null
    this.queue = []
    this.pumping = false
    this.abort = null
    this.translationTimer = null
    this.translating = false
    this.translationDirty = false
    this.translationError = null
    this.warnings = []
    this.noAudioTimer = null
    this.minutes = { generating: false, text: '', path: null, generatedAt: null, error: null }
    this.minutesPromise = null
    this.disposed = false
    // The always-on-top overlay window (its own PowerShell/WPF process) reports
    // its availability through the state payload; attached after construction.
    this.overlayDescribe = null

    this.asr = createAsr({ ctx, config: { providerId: config.providerId }, packageDir: this.packageDir, sttDataRoot, log })
    this.mt = createLocalMt({
      dataRoot, config, packageDir: this.packageDir, log,
      modelOf: () => this.settings.builtinModel,
    })
    this.llm = createLlm({ ctx, config, log, settings: () => this.settings, mt: this.mt })
  }

  // ---------------------------------------------------------------- settings

  loadSettings() {
    this.settingsWereCleaned = false
    try {
      if (existsSync(this.settingsFile)) {
        const stored = JSON.parse(readFileSync(this.settingsFile, 'utf8'))
        for (const key of Object.keys(DEFAULTS)) {
          if (stored[key] !== undefined && stored[key] !== null) this.settings[key] = stored[key]
        }
        this.settingsWereCleaned = 'offlineMode' in stored || 'offlinePrevEngine' in stored
      }
    } catch (error) {
      this.log(`settings: could not read ${this.settingsFile}: ${error.message}`)
    }
  }

  saveSettings() {
    try {
      mkdirSync(this.dataRoot, { recursive: true })
      writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2))
    } catch (error) {
      this.log(`settings: could not write ${this.settingsFile}: ${error.message}`)
    }
  }

  updateSettings(patch) {
    const next = { ...this.settings }
    if (typeof patch.source === 'string' && SOURCES.has(patch.source)) next.source = patch.source
    if (typeof patch.sourceLanguage === 'string' && patch.sourceLanguage !== '') next.sourceLanguage = patch.sourceLanguage
    if (typeof patch.targetLanguage === 'string' && patch.targetLanguage !== '') next.targetLanguage = patch.targetLanguage
    if (typeof patch.translate === 'boolean') next.translate = patch.translate
    if (patch.translateEngine === 'cloud' || patch.translateEngine === 'local' || patch.translateEngine === 'builtin') {
      next.translateEngine = patch.translateEngine
    }
    if (typeof patch.offlineMode === 'boolean') {
      // Accepted from older clients only; ignored. The engine dropdown is the
      // single place that picks where translation runs.
    }
    // Cloud route: an empty pair means "follow the profile's default model".
    if (typeof patch.cloudProvider === 'string') next.cloudProvider = patch.cloudProvider.trim()
    if (typeof patch.cloudModel === 'string') next.cloudModel = patch.cloudModel.trim()
    if (next.cloudProvider === '' || next.cloudModel === '') {
      next.cloudProvider = ''
      next.cloudModel = ''
    }
    if (typeof patch.builtinModel === 'string' && MT_MODEL_IDS.has(patch.builtinModel)) {
      next.builtinModel = patch.builtinModel
    }
    if (typeof patch.mtProxy === 'string') {
      const value = patch.mtProxy.trim()
      if (value === '' || /^https?:\/\/[^\s]+$/i.test(value)) {
        next.mtProxy = value
        this.mt.setProxy(value)
      }
    }
    if (typeof patch.localBaseUrl === 'string') {
      const value = patch.localBaseUrl.trim().replace(/\/+$/, '')
      if (value === '' || /^https?:\/\/[^\s]+$/i.test(value)) next.localBaseUrl = value === '' ? 'http://127.0.0.1:11434/v1' : value
    }
    if (typeof patch.localModel === 'string') next.localModel = patch.localModel.trim()
    if (typeof patch.localApiKey === 'string') next.localApiKey = patch.localApiKey.trim()
    if (Number.isInteger(patch.segmentSeconds)) next.segmentSeconds = Math.min(10, Math.max(2, patch.segmentSeconds))
    if (Number.isFinite(patch.lyricFontSize)) next.lyricFontSize = Math.min(34, Math.max(14, Math.round(patch.lyricFontSize)))
    if (Number.isFinite(patch.lyricOpacity)) next.lyricOpacity = Math.min(1, Math.max(0.3, Number(patch.lyricOpacity)))
    if (Number.isFinite(patch.lyricX)) next.lyricX = Math.round(patch.lyricX)
    if (Number.isFinite(patch.lyricY)) next.lyricY = Math.round(patch.lyricY)
    if (typeof patch.lyricLocked === 'boolean') next.lyricLocked = patch.lyricLocked
    if (typeof patch.lyricShowSource === 'boolean') next.lyricShowSource = patch.lyricShowSource
    if (typeof patch.lyricVisible === 'boolean') next.lyricVisible = patch.lyricVisible
    if (patch.lyricW === null) next.lyricW = null
    else if (Number.isFinite(patch.lyricW)) next.lyricW = Math.max(320, Math.round(patch.lyricW))
    if (patch.lyricH === null) next.lyricH = null
    else if (Number.isFinite(patch.lyricH)) next.lyricH = Math.max(140, Math.round(patch.lyricH))
    if (Number.isFinite(patch.recordsX)) next.recordsX = Math.round(patch.recordsX)
    if (Number.isFinite(patch.recordsY)) next.recordsY = Math.round(patch.recordsY)
    if (Number.isFinite(patch.recordsW)) next.recordsW = Math.max(300, Math.round(patch.recordsW))
    if (Number.isFinite(patch.recordsH)) next.recordsH = Math.max(220, Math.round(patch.recordsH))
    if (patch.lyricReset === true) {
      next.lyricX = null
      next.lyricY = null
      next.lyricW = null
      next.lyricH = null
    }
    // Eagerly (re)start the built-in model when a translation-relevant field
    // changes — including a no-op retry after a failure — but never on pure
    // geometry changes (dragging the lyric box must not trigger a download).
    const translationTouch = ['translateEngine', 'translate', 'targetLanguage',
      'sourceLanguage', 'localBaseUrl', 'localModel', 'localApiKey', 'builtinModel'].some((key) =>
      Object.prototype.hasOwnProperty.call(patch, key))
    if (next.builtinModel !== this.settings.builtinModel) {
      this.mt.setModel(next.builtinModel)
    }
    // Load the offline model when it is already on disk, but never start a
    // multi-hundred-megabyte download just because the engine dropdown changed:
    // the panel's download button is the explicit opt-in for that.
    if (next.translateEngine === 'builtin' && translationTouch && this.mt.isDownloaded(next.builtinModel)) {
      this.mt.prepare()
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.settings)
    if (!changed) return this.settings
    const sourceChanged = next.source !== this.settings.source
    this.settings = next
    this.saveSettings()
    this.bump()
    if (sourceChanged && this.status === 'running' && this.capture !== null) {
      void this.restartCapture()
    }
    return this.settings
  }

  // ------------------------------------------------------------------- state

  bump() {
    this.rev += 1
  }

  retranslatableLanguage() {
    return this.settings.sourceLanguage !== 'auto' && this.settings.sourceLanguage === this.settings.targetLanguage
  }

  /**
   * Whether a line already reads in the subtitle language, so a model call adds
   * nothing. Deliberately conservative: it is applied only when the source
   * language is "auto" (an explicit source language is trusted, and the
   * same-language case is handled earlier by `retranslatableLanguage`). We skip
   * only the one unambiguous case — Han text going into a Chinese subtitle —
   * because guessing further is what silently dropped real translations, e.g.
   * "Latin letters ⇒ already English" made Spanish/French/German → English show
   * the original, and zero-letter text (Cyrillic/Kana/Hangul) was treated as
   * already-any-language.
   */
  matchesTarget(text) {
    if (this.settings.sourceLanguage !== 'auto') return false
    const target = this.settings.targetLanguage
    if (target === 'zh' || target === 'yue') {
      const han = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length
      const letters = (text.match(/[A-Za-z]/g) ?? []).length
      const visible = han + letters
      return visible > 0 && han / visible >= 0.35
    }
    return false
  }

  view(entry) {
    return {
      seq: entry.seq,
      startMs: entry.startMs,
      endMs: entry.endMs,
      at: entry.time ?? (this.session === null ? clock(entry.startMs) : timeOfDay(this.session.startedAt, entry.startMs)),
      text: entry.text,
      translation: entry.translation ?? entry.partialTranslation ?? null,
      live: entry.translation === null && entry.partialTranslation != null,
      translationFailed: entry.translationFailed === true,
      lang: entry.lang,
    }
  }

  state(since = 0) {
    const entries = this.entries
      .filter((entry) => entry.seq > since)
      .slice(-120)
      .map((entry) => this.view(entry))
    // The newest lines are repeated on every poll so a streamed translation
    // reaches a client that already has that sequence number.
    const recent = this.entries.slice(-8).map((entry) => this.view(entry))
    return {
      rev: this.rev,
      status: this.status,
      error: this.error,
      settings: {
        source: this.settings.source,
        sourceLanguage: this.settings.sourceLanguage,
        targetLanguage: this.settings.targetLanguage,
        translate: this.settings.translate,
        translateEngine: this.settings.translateEngine,
        cloudProvider: this.settings.cloudProvider,
        cloudModel: this.settings.cloudModel,
        builtinModel: this.settings.builtinModel,
        mtProxy: this.settings.mtProxy,
        localBaseUrl: this.settings.localBaseUrl,
        localModel: this.settings.localModel,
        localApiKeySet: this.settings.localApiKey !== '',
        segmentSeconds: this.settings.segmentSeconds,
        lyricFontSize: this.settings.lyricFontSize,
        lyricOpacity: this.settings.lyricOpacity,
        lyricX: this.settings.lyricX,
        lyricY: this.settings.lyricY,
        lyricW: this.settings.lyricW,
        lyricH: this.settings.lyricH,
        lyricLocked: this.settings.lyricLocked,
        lyricShowSource: this.settings.lyricShowSource,
        lyricVisible: this.settings.lyricVisible,
        recordsX: this.settings.recordsX,
        recordsY: this.settings.recordsY,
        recordsW: this.settings.recordsW,
        recordsH: this.settings.recordsH,
      },
      engine: this.llm.describeEngine(),
      mt: this.mt.describe(),
      overlay: this.overlayDescribe === null ? { supported: false, open: false } : this.overlayDescribe(),
      asr: this.asr.describe(),
      session: this.session === null
        ? null
        : {
            id: this.session.id,
            startedAt: this.session.startedAt,
            elapsedMs: Date.now() - this.session.startedAt,
            segments: this.segments,
            entries: this.entries.length,
          },
      entries,
      recent,
      totalEntries: this.entries.length,
      translationError: this.translationError,
      warnings: this.warnings.slice(-5),
      minutes: {
        generating: this.minutes.generating,
        generatedAt: this.minutes.generatedAt,
        path: this.minutes.path,
        error: this.minutes.error,
        text: this.minutes.text,
      },
      targetLabel: languageName(this.settings.targetLanguage),
    }
  }

  // ------------------------------------------------------------- lifecycle

  prepare() {
    try {
      const id = this.asr.prepare()
      this.error = null
      this.bump()
      return { ok: true, providerId: id }
    } catch (error) {
      this.error = error.message
      return { ok: false, error: error.message }
    }
  }

  /** Install the built-in translation dependency on the user's explicit request. */
  async installMtDeps() {
    const result = await this.mt.installDeps()
    this.bump()
    return result
  }

  /** Cloud routes the model picker offers. */
  async listCloudModels() {
    const cloud = await this.llm.listCloudModels()
    return {
      ...cloud,
      pinned: { provider: this.settings.cloudProvider, model: this.settings.cloudModel },
      active: this.llm.describeEngine(),
    }
  }

  /** Offline catalog with per-model download state. */
  offlineModels() {
    const status = this.mt.describe()
    return { active: status.model, models: status.models }
  }

  /**
   * Download (and load) one offline model on request. The state payload already
   * reports progress, so this only has to kick the child off.
   */
  downloadOfflineModel(id) {
    const chosen = typeof id === 'string' && id !== '' ? id : this.settings.builtinModel
    // The panel button always means "start this download from a clean state".
    const result = this.mt.download(chosen, { restart: true })
    if (result.ok !== false) {
      // Remember the download so the panel highlights the same model afterwards.
      this.updateSettings({ builtinModel: chosen })
    } else {
      this.bump()
    }
    return { ...result, model: chosen }
  }

  /** Abort an in-flight offline model download. */
  cancelOfflineModel() {
    const result = this.mt.cancel()
    this.bump()
    return result
  }

  start() {
    if (this.disposed) throw new Error('插件已卸载')
    if (process.platform !== 'win32') {
      // Capture is a PowerShell WASAPI helper: there is no macOS/Linux path yet,
      // and failing here is clearer than a capture process that never starts.
      return {
        ok: false,
        error: `实时字幕目前只支持 Windows 的 WASAPI 环回采集，当前系统（${process.platform}）无法采集系统声音。`,
      }
    }
    if (this.status === 'running' || this.status === 'preparing' || this.status === 'starting') {
      return { ok: true, status: this.status, note: '已在运行' }
    }
    this.error = null
    this.status = 'preparing'
    this.abort = new AbortController()
    this.bump()
    void this.begin(this.abort).catch((error) => {
      if (this.abort?.signal.aborted) {
        this.log('start aborted by the user')
        if (this.status === 'preparing' || this.status === 'starting') {
          this.status = 'idle'
          this.bump()
        }
        return
      }
      this.log(`start failed: ${error.stack ?? error.message}`)
      this.error = error.message
      this.status = 'error'
      this.bump()
    })
    return { ok: true, status: this.status }
  }

  async begin(abort) {
    const signal = abort.signal
    await this.asr.ensureReady({ signal, onProgress: () => this.bump() })
    if (signal.aborted) return
    if (this.settings.translateEngine === 'builtin') {
      this.mt.prepare()
    }
    this.status = 'starting'
    this.bump()
    this.openSession()
    await this.startCapture(signal)
    // Load the recogniser in parallel with the first seconds of audio so the
    // first line does not wait for the model.
    void this.asr.warmup()
    this.status = 'running'
    this.bump()
    this.armNoAudioHint()
    this.log(`session ${this.session?.id} capturing ${this.settings.source}`)
  }

  /**
   * A first-run safety net: if the capture is running but nothing audible has
   * been recognised after a while, the most common cause is a wrong audio
   * source, a muted system, or a missing microphone permission. A gentle
   * warning in the panel points there instead of leaving a silent, empty box.
   */
  armNoAudioHint() {
    if (this.noAudioTimer !== null) clearTimeout(this.noAudioTimer)
    this.noAudioTimer = setTimeout(() => {
      this.noAudioTimer = null
      if (this.status === 'running' && this.segments === 0 && !this.disposed) {
        this.warnings.push('还没检测到声音。请检查系统音量、麦克风权限，或换个「音频来源」。')
        if (this.warnings.length > 5) this.warnings.shift()
        this.bump()
      }
    }, 20000)
  }

  openSession() {
    const id = sessionId()
    const directory = join(this.dataRoot, 'sessions', id)
    mkdirSync(join(directory, 'segments'), { recursive: true })
    const transcriptFile = join(directory, 'transcript.jsonl')
    // A fresh session always starts from an empty transcript, even if an id
    // happened to collide with an older one.
    writeFileSync(transcriptFile, '')
    this.session = { id, directory, startedAt: Date.now(), transcriptFile }
    this.entries = []
    this.seq = 0
    this.cursorMs = 0
    this.segments = 0
    this.queue = []
    this.translationError = null
    this.warnings = []
    this.minutes = { generating: false, text: '', path: null, generatedAt: null, error: null }
    writeFileSync(join(directory, 'meta.json'), JSON.stringify({
      id,
      startedAt: new Date().toISOString(),
      source: this.settings.source,
      sourceLanguage: this.settings.sourceLanguage,
      targetLanguage: this.settings.targetLanguage,
    }, null, 2))
    this.bump()
  }

  async startCapture(signal) {
    const directory = join(this.session.directory, 'segments')
    this.capture = startCapture({
      outDir: directory,
      segmentSeconds: this.settings.segmentSeconds,
      minSegmentSeconds: this.settings.minSegmentSeconds,
      source: this.settings.source,
      log: this.log,
      onSegment: (file) => {
        this.queue.push(file)
        void this.pump()
      },
      onStatus: (status) => {
        if (this.disposed) return
        if (status.phase === 'error') {
          this.error = status.error
          this.status = 'error'
          this.bump()
        } else if (status.phase === 'exited' && this.status !== 'stopping' && this.status !== 'idle') {
          this.error = status.error ?? '音频采集进程意外退出，请重新开始。'
          this.status = 'error'
          this.bump()
        }
      },
      onWarning: (message) => {
        this.warnings.push(message)
        if (this.warnings.length > 5) this.warnings.shift()
        this.bump()
      },
    })
    if (signal.aborted) await this.stopCapture()
  }

  async restartCapture() {
    if (this.disposed) return
    this.log('restarting capture for a new source')
    await this.stopCapture()
    if (this.session === null) return
    await this.startCapture(this.abort?.signal ?? new AbortController().signal)
  }

  async stopCapture() {
    const capture = this.capture
    this.capture = null
    if (capture !== null) {
      try {
        await capture.stop()
      } catch (error) {
        this.log(`stop capture failed: ${error.message}`)
      }
    }
  }

  async stop() {
    if (this.disposed) return { ok: false, error: '插件已卸载' }
    if (this.status === 'idle') return { ok: true, status: 'idle', note: '未在运行' }
    this.status = 'stopping'
    this.bump()
    await this.stopCapture()
    // Let the last queued segments finish while their cancellation signal is
    // still live; only then cancel preparation or in-flight recognition.
    const deadline = Date.now() + 8000
    while ((this.queue.length > 0 || this.pumping) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (this.translationTimer !== null) {
      clearTimeout(this.translationTimer)
      this.translationTimer = null
    }
    if (this.noAudioTimer !== null) {
      clearTimeout(this.noAudioTimer)
      this.noAudioTimer = null
    }
    await this.flushTranslations()
    if (this.abort !== null) this.abort.abort()
    this.status = 'idle'
    this.error = null
    this.bump()
    return { ok: true, status: 'idle' }
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.abort !== null) this.abort.abort()
    if (this.translationTimer !== null) clearTimeout(this.translationTimer)
    this.translationTimer = null
    if (this.noAudioTimer !== null) clearTimeout(this.noAudioTimer)
    this.noAudioTimer = null
    await this.stopCapture()
    await this.mt.dispose()
  }

  // ------------------------------------------------------------ recognition

  async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queue.length > 0) {
        const file = this.queue.shift()
        try {
          await this.recognize(file)
        } catch (error) {
          if (!this.disposed) this.log(`segment ${file}: ${error.message}`)
        }
      }
    } finally {
      this.pumping = false
    }
  }

  async recognize(file) {
    try {
      await this.recognizeSegment(file)
    } finally {
      // A one-hour meeting is roughly 1.2 GB of 16 kHz segments, so the audio is
      // dropped after the attempt unless the profile asks to keep it.
      if (this.settings.keepAudio !== true) {
        try { rmSync(file, { force: true }) } catch (error) { this.log(`segment cleanup failed: ${error.message}`) }
      }
    }
  }

  async recognizeSegment(file) {
    if (this.session === null) return
    const buffer = await readFile(file)
    if (buffer.length < 2 * 3200) return
    const header = readCanonicalHeader(buffer)
    if (header === null) {
      this.log(`segment ${file}: unexpected WAV layout, skipping`)
      return
    }
    const level = rms(buffer, header)
    if (level < SILENCE_RMS) return

    const audio = normalizeGain(buffer)
    const seconds = header.dataBytes / (header.sampleRate * 2)
    const signal = this.abort?.signal ?? new AbortController().signal
    const startedAt = Date.now()
    const result = await this.asr.transcribe(audio, this.settings.sourceLanguage, signal)
    const text = result.text.trim()
    this.log(`asr: ${seconds.toFixed(2)}s audio in ${Date.now() - startedAt}ms`)
    if (text === '') return
    // Recognisers sometimes return only punctuation for noise; those are not subtitles.
    if (!/[\p{L}\p{N}]/u.test(text)) return

    const startMs = this.cursorMs
    const endMs = startMs + seconds * 1000
    this.cursorMs = endMs
    this.seq += 1
    this.segments += 1
    if (this.noAudioTimer !== null) {
      clearTimeout(this.noAudioTimer)
      this.noAudioTimer = null
    }
    const time = timeOfDay(this.session.startedAt, startMs)
    const entry = {
      seq: this.seq,
      startMs,
      endMs,
      time,
      text,
      translation: null,
      lang: this.settings.sourceLanguage,
      translationFailed: false,
    }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    this.appendRecord({
      type: 'segment',
      seq: entry.seq,
      at: new Date().toISOString(),
      time,
      startMs,
      seconds,
      text,
    })
    this.bump()
    if (this.settings.translate) this.scheduleTranslation()
  }

  /** Append one transcript record; the reader merges `segment` and `translation`. */
  appendRecord(record) {
    if (this.session === null) return
    try {
      appendFileSync(this.session.transcriptFile, `${JSON.stringify(record)}\n`)
    } catch (error) {
      this.log(`transcript append failed: ${error.message}`)
    }
  }

  // ------------------------------------------------------------ translation

  scheduleTranslation(delay = 0) {
    if (this.translating) {
      this.translationDirty = true
      return
    }
    if (this.translationTimer !== null) return
    this.translationTimer = setTimeout(() => {
      this.translationTimer = null
      void this.flushTranslations()
    }, delay)
  }

  /** Previous two lines, used only as context for terminology continuity. */
  contextFor(entry) {
    return this.entries
      .filter((other) => other.seq < entry.seq)
      .slice(-2)
      .map((other) => other.text)
      .join(' ')
  }

  async flushTranslations() {
    if (this.translating || !this.settings.translate) return
    const pending = this.entries.filter((entry) => entry.translation === null && entry.translationFailed !== true)
    if (pending.length === 0) return
    if (this.retranslatableLanguage()) {
      for (const entry of pending) entry.translation = entry.text
      this.bump()
      return
    }
    this.translating = true
    this.translationDirty = false
    let attempted = []
    try {
      // Lines already in the subtitle language need no model call at all, which
      // is the common case for a Chinese meeting with Chinese subtitles.
      for (const entry of pending) {
        if (this.matchesTarget(entry.text)) entry.translation = entry.text
      }
      const untranslated = pending.filter((entry) => entry.translation === null)
      if (untranslated.length === 0) {
        this.translationError = null
        return
      }
      if (untranslated.length >= 2 && this.llm.engineKind() === 'cloud') {
        // Two or more lines in flight fit in one streamed call: each subtitle
        // lands as soon as its own marker completes, instead of one round trip
        // (and one model warm-up) per line.
        attempted = untranslated.slice(0, 6)
        const startedAt = Date.now()
        const request = {
          context: this.contextFor(attempted[0]),
          signal: this.abort?.signal,
          onLine: (seq, text) => {
            const entry = this.entries.find((item) => item.seq === seq)
            if (entry === undefined || entry.translation === text) return
            entry.translation = text
            entry.partialTranslation = null
            this.appendRecord({ type: 'translation', seq: entry.seq, time: entry.time, text })
            this.bump()
          },
        }
        const translated = typeof this.llm.translateStreaming === 'function'
          ? await this.llm.translateStreaming(
            attempted.map((entry) => ({ seq: entry.seq, text: entry.text })),
            this.settings.targetLanguage,
            request,
          )
          : await this.llm.translate(
            attempted.map((entry) => ({ seq: entry.seq, text: entry.text })),
            this.settings.targetLanguage,
            request,
          )
        this.log(`translate batch ${attempted.length}: ${Date.now() - startedAt}ms`)
        for (const entry of attempted) {
          if (entry.translation !== null) continue
          const value = translated.get(entry.seq)
          if (value === undefined) entry.translationFailed = true
          else {
            entry.translation = value
            this.appendRecord({ type: 'translation', seq: entry.seq, time: entry.time, text: value })
          }
        }
      } else {
        // Normal path: stream this one line so the caption fills in live.
        const entry = untranslated[0]
        attempted = [entry]
        const startedAt = Date.now()
        const text = await this.llm.translateOne(entry.text, this.settings.targetLanguage, {
          context: this.contextFor(entry),
          signal: this.abort?.signal,
          onDelta: (partial) => {
            entry.partialTranslation = partial
            this.bump()
          },
        })
        this.log(`translate ${entry.seq}: ${Date.now() - startedAt}ms`)
        entry.translation = text !== '' ? text : null
        entry.partialTranslation = null
        if (entry.translation === null) entry.translationFailed = true
        else this.appendRecord({ type: 'translation', seq: entry.seq, time: entry.time, text: entry.translation })
      }
      this.translationError = null
    } catch (error) {
      if (this.abort?.signal.aborted !== true) this.log(`translation failed: ${error.message}`)
      this.translationError = error.message
      for (const entry of attempted) {
        // Keep whatever streamed through rather than dropping a readable line.
        if (entry.translation === null && entry.partialTranslation) {
          entry.translation = entry.partialTranslation
          entry.partialTranslation = null
        } else if (entry.translation === null) {
          entry.translationFailed = true
        }
      }
    } finally {
      this.translating = false
      this.bump()
    }
    if (this.translationDirty || this.entries.some((entry) => entry.translation === null && entry.translationFailed !== true)) {
      this.scheduleTranslation(0)
    }
  }

  // ---------------------------------------------------------------- minutes

  transcriptText() {
    return this.entries
      .map((entry) => `[${entry.time ?? clock(entry.startMs)}] ${entry.text}`)
      .join('\n')
  }

  /**
   * The whole job of "generate minutes" as one prompt: base instructions plus the
   * recorded transcript, ready to paste into a fresh session so the summary is
   * produced by a normal conversation instead of a hidden side call.
   */
  minutesPrompt({ title } = {}) {
    const transcript = this.transcriptText()
    const lines = this.entries.length
    const heading = typeof title === 'string' && title.trim() !== '' ? title.trim() : '本次会议'
    const clip = transcript.length > 120000 ? `${transcript.slice(0, 120000)}\n…（转写过长，已截断）` : transcript
    const first = this.entries[0]?.time ?? ''
    const last = this.entries[this.entries.length - 1]?.time ?? ''
    const prompt = [
      `请把下面这份实时字幕转写整理成会议纪要。会议标题：${heading}。`,
      '',
      '要求：',
      '- 只用转写里出现的信息，不要编造；无法确定的内容标注「待确认」。',
      '- 修正明显的识别错别字、去掉口头语和重复，但不要改变原意。',
      '- 输出 Markdown，结构固定为：## 会议概要 / ## 主要议题 / ## 关键结论 / ## 待办事项 / ## 风险与待确认。',
      '- 待办事项用表格：负责人 | 事项 | 截止时间；没有明确负责人或时间就写「待确认」。',
      '- 结尾附一行「转写范围」，写明时间码起止与条数。',
      '',
      `转写（共 ${lines} 条${first !== '' ? `，${first}–${last}` : ''}）：`,
      clip,
    ].join('\n')
    return { prompt, lines, chars: transcript.length, title: heading }
  }

  // -------------------------------------------------------------- records

  /** Session directories on disk, newest first, with a title line. */
  listSessions() {
    const root = join(this.dataRoot, 'sessions')
    if (!existsSync(root)) return []
    const sessions = []
    for (const name of readdirSync(root)) {
      const directory = join(root, name)
      let meta = null
      try {
        meta = JSON.parse(readFileSync(join(directory, 'meta.json'), 'utf8'))
      } catch {
        meta = { id: name }
      }
      const records = this.readRecords(name, { countOnly: true })
      sessions.push({
        id: name,
        startedAt: meta.startedAt ?? null,
        source: meta.source ?? 'both',
        sourceLanguage: meta.sourceLanguage ?? 'auto',
        targetLanguage: meta.targetLanguage ?? 'zh',
        entries: records.count,
        firstTime: records.firstTime ?? null,
        lastTime: records.lastTime ?? null,
        durationMs: records.durationMs ?? null,
        endedAt: records.durationMs != null && meta.startedAt
          ? new Date(new Date(meta.startedAt).getTime() + records.durationMs).toISOString()
          : null,
      })
    }
    sessions.sort((a, b) => String(b.id).localeCompare(String(a.id)))
    return sessions.slice(0, 60)
  }

  /**
   * Merge one session's `segment` and `translation` records into readable rows.
   * Older files without `type` are treated as segments.
   */
  readRecords(sessionId, { countOnly = false } = {}) {
    const file = join(this.dataRoot, 'sessions', sessionId, 'transcript.jsonl')
    if (!existsSync(file)) return countOnly ? { count: 0 } : { id: sessionId, entries: [] }
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch (error) {
      this.log(`records: cannot read ${file}: ${error.message}`)
      return countOnly ? { count: 0 } : { id: sessionId, entries: [], error: error.message }
    }
    const rows = []
    const bySeq = new Map()
    let firstAt = null
    let lastAt = null
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim() === '') continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record.type === 'translation') {
        const row = bySeq.get(record.seq)
        if (row !== undefined) row.translation = record.text ?? null
        continue
      }
      if (typeof record.text !== 'string') continue
      const time = typeof record.time === 'string'
        ? record.time
        : (typeof record.at === 'string' && record.at.length >= 19
            ? `${record.at.slice(11, 19)}`
            : '')
      const row = { seq: record.seq ?? rows.length + 1, time, text: record.text, translation: null }
      rows.push(row)
      bySeq.set(row.seq, row)
      // Session length is measured from the records themselves: the wall-clock
      // `at` stamps bracket the meeting even when it outlived a Host restart.
      const at = typeof record.at === 'string' ? Date.parse(record.at) : NaN
      if (Number.isFinite(at)) {
        if (firstAt === null || at < firstAt) firstAt = at
        if (lastAt === null || at > lastAt) lastAt = at
      }
    }
    if (countOnly) {
      return { count: rows.length, firstTime: rows[0]?.time ?? null, lastTime: rows.at(-1)?.time ?? null, durationMs: firstAt === null || lastAt === null ? null : Math.max(0, lastAt - firstAt) }
    }
    return { id: sessionId, entries: rows }
  }

  /**
   * Delete one recorded session. The live session is truncated rather than
   * removed (its directory is still being written to); past sessions lose their
   * whole directory — transcript, segments and meta.
   */
  deleteSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, error: '缺少会话 id' }
    if (this.session !== null && sessionId === this.session.id) {
      this.clear()
      return { ok: true, note: '已清空当前会话的记录' }
    }
    const known = this.listSessions().some((entry) => entry.id === sessionId)
    if (!known) return { ok: false, error: '未找到这个会话' }
    try {
      rmSync(join(this.dataRoot, 'sessions', sessionId), { recursive: true, force: true })
      this.log(`records: deleted session ${sessionId}`)
      this.bump()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: `删除失败：${error.message}` }
    }
  }

  /** Awaitable generation used by the agent tool. */
  async generateMinutes({ title } = {}) {
    if (this.minutesPromise !== null) return this.minutesPromise
    if (this.entries.length === 0) throw new Error('还没有可总结的转写内容。')
    const transcript = this.transcriptText()
    this.minutes = { ...this.minutes, generating: true, error: null }
    this.bump()
    this.minutesPromise = (async () => {
      try {
        const text = await this.llm.minutes(transcript, { title })
        const file = join(this.dataRoot, 'minutes', `${this.session?.id ?? stamp()}-minutes.md`)
        mkdirSync(join(this.dataRoot, 'minutes'), { recursive: true })
        const body = [
          `# 会议纪要 ${new Date().toLocaleString('zh-CN')}`,
          '',
          `- 音频来源：${this.settings.source === 'both' ? '系统声音 + 麦克风' : this.settings.source === 'speaker' ? '系统声音' : '麦克风'}`,
          `- 源语言：${this.settings.sourceLanguage}`,
          `- 目标语言：${languageName(this.settings.targetLanguage)}`,
          `- 转写条数：${this.entries.length}`,
          '',
          text,
          '',
          '---',
          '## 原始转写',
          '',
          '```text',
          transcript,
          '```',
          '',
        ].join('\n')
        writeFileSync(file, body)
        this.minutes = {
          generating: false,
          text,
          path: file,
          generatedAt: Date.now(),
          error: null,
        }
        this.log(`minutes written to ${file}`)
        return { text, path: file }
      } catch (error) {
        this.minutes = { ...this.minutes, generating: false, error: error.message }
        throw error
      } finally {
        this.minutesPromise = null
        this.bump()
      }
    })()
    return this.minutesPromise
  }

  /**
   * Clear the current session's transcript — the live list and the on-disk
   * record file, so the "记录" page stays consistent with the panel.
   * `seq` and `cursorMs` are deliberately kept monotonic: they are the session
   * clock and the merge key, so resetting either would make wall-clock times
   * jump backwards and would let a late translation overwrite a new segment.
   */
  clear() {
    this.entries = []
    this.segments = 0
    this.translationError = null
    this.warnings = []
    this.minutes = { generating: false, text: '', path: null, generatedAt: null, error: null }
    if (this.session !== null) {
      try {
        writeFileSync(this.session.transcriptFile, '')
      } catch (error) {
        this.log(`clear: could not truncate transcript: ${error.message}`)
      }
    }
    this.bump()
    return this.state()
  }
}
