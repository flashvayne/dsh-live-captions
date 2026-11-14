import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startCapture } from './capture.js'
import { createAsr } from './asr.js'
import { createLlm, languageName } from './llm.js'
import { createLocalMt } from './local-mt.js'
import { normalizeGain, readCanonicalHeader, rms } from './wav.js'

const SOURCES = new Set(['both', 'speaker', 'mic'])
const MAX_ENTRIES = 600
/** Default desktop-lyrics box: big enough for several lines of subtitles. */
const DEFAULT_LYRIC_WIDTH = 560
const DEFAULT_LYRIC_HEIGHT = 220
/** Below this RMS the segment is room noise; sending it only risks hallucinations. */
const SILENCE_RMS = 0.005

const DEFAULTS = {
  source: 'both',
  sourceLanguage: 'auto',
  targetLanguage: 'zh',
  translate: true,
  translateEngine: 'cloud',
  offlineMode: false,
  localBaseUrl: 'http://127.0.0.1:11434/v1',
  localModel: '',
  localApiKey: '',
  segmentSeconds: 4,
  minSegmentSeconds: 1.2,
  keepAudio: false,
  // Desktop-lyrics box: size, transparency, position and lock.
  lyricFontSize: 22,
  lyricOpacity: 0.92,
  lyricX: null,
  lyricY: null,
  lyricW: DEFAULT_LYRIC_WIDTH,
  lyricH: DEFAULT_LYRIC_HEIGHT,
  lyricLocked: false,
  lyricShowSource: true,
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
  constructor({ ctx, config, dataRoot, log }) {
    this.ctx = ctx
    this.config = config
    this.dataRoot = dataRoot
    this.log = log
    this.settingsFile = join(dataRoot, 'settings.json')

    this.settings = { ...DEFAULTS }
    for (const key of Object.keys(DEFAULTS)) {
      if (config?.[key] !== undefined && config[key] !== null) this.settings[key] = config[key]
    }
    this.loadSettings()

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
    this.minutes = { generating: false, text: '', path: null, generatedAt: null, error: null }
    this.minutesPromise = null
    this.disposed = false

    this.asr = createAsr({ ctx, config: { providerId: config.providerId }, log })
    this.mt = createLocalMt({ dataRoot, config, log })
    this.llm = createLlm({ ctx, config, log, settings: () => this.settings, mt: this.mt })
  }

  // ---------------------------------------------------------------- settings

  loadSettings() {
    try {
      if (existsSync(this.settingsFile)) {
        const stored = JSON.parse(readFileSync(this.settingsFile, 'utf8'))
        for (const key of Object.keys(DEFAULTS)) {
          if (stored[key] !== undefined && stored[key] !== null) this.settings[key] = stored[key]
        }
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
    // Any settings call refreshes the built-in model, including a no-op one:
    // the panel may send the same value to trigger a retry after a failure.
    if (this.settings.offlineMode === true || this.settings.translateEngine === 'builtin'
      || patch.offlineMode === true || patch.translateEngine === 'builtin') {
      this.mt.prepare()
    }
    const next = { ...this.settings }
    if (typeof patch.source === 'string' && SOURCES.has(patch.source)) next.source = patch.source
    if (typeof patch.sourceLanguage === 'string' && patch.sourceLanguage !== '') next.sourceLanguage = patch.sourceLanguage
    if (typeof patch.targetLanguage === 'string' && patch.targetLanguage !== '') next.targetLanguage = patch.targetLanguage
    if (typeof patch.translate === 'boolean') next.translate = patch.translate
    if (patch.translateEngine === 'cloud' || patch.translateEngine === 'local' || patch.translateEngine === 'builtin') {
      next.translateEngine = patch.translateEngine
    }
    if (typeof patch.offlineMode === 'boolean') next.offlineMode = patch.offlineMode
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
    if (Number.isFinite(patch.lyricW)) next.lyricW = Math.max(260, Math.round(patch.lyricW))
    if (Number.isFinite(patch.lyricH)) next.lyricH = Math.max(90, Math.round(patch.lyricH))
    if (Number.isFinite(patch.recordsX)) next.recordsX = Math.round(patch.recordsX)
    if (Number.isFinite(patch.recordsY)) next.recordsY = Math.round(patch.recordsY)
    if (Number.isFinite(patch.recordsW)) next.recordsW = Math.max(300, Math.round(patch.recordsW))
    if (Number.isFinite(patch.recordsH)) next.recordsH = Math.max(220, Math.round(patch.recordsH))
    if (patch.lyricReset === true) {
      next.lyricX = null
      next.lyricY = null
      next.lyricW = DEFAULT_LYRIC_WIDTH
      next.lyricH = DEFAULT_LYRIC_HEIGHT
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

  /** Whether a line already reads in the subtitle language, so a model call adds nothing. */
  matchesTarget(text) {
    const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) ?? []).length
    const letters = (text.match(/[A-Za-z]/g) ?? []).length
    const visible = cjk + letters
    if (visible === 0) return true
    const target = this.settings.targetLanguage
    if (target === 'zh' || target === 'yue') return cjk / visible >= 0.35
    if (target === 'en') return cjk === 0 && letters / visible >= 0.6
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
        offlineMode: this.settings.offlineMode === true,
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
        recordsX: this.settings.recordsX,
        recordsY: this.settings.recordsY,
        recordsW: this.settings.recordsW,
        recordsH: this.settings.recordsH,
      },
      engine: this.llm.describeEngine(),
      mt: this.mt.describe(),
      offline: this.settings.offlineMode === true,
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

  start() {
    if (this.disposed) throw new Error('插件已卸载')
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
    if (this.settings.offlineMode === true || this.settings.translateEngine === 'builtin') {
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
    this.log(`session ${this.session?.id} capturing ${this.settings.source}`)
  }

  openSession() {
    const id = stamp()
    const directory = join(this.dataRoot, 'sessions', id)
    mkdirSync(join(directory, 'segments'), { recursive: true })
    this.session = { id, directory, startedAt: Date.now(), transcriptFile: join(directory, 'transcript.jsonl') }
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
      if (untranslated.length > 3 && this.llm.engineKind() === 'cloud') {
        // Backlog: one batched call catches up faster than line-by-line.
        attempted = untranslated.slice(0, 8)
        const translated = await this.llm.translate(
          attempted.map((entry) => ({ seq: entry.seq, text: entry.text })),
          this.settings.targetLanguage,
          { context: this.contextFor(attempted[0]), signal: this.abort?.signal },
        )
        for (const entry of attempted) {
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
    }
    if (countOnly) {
      return { count: rows.length, firstTime: rows[0]?.time ?? null, lastTime: rows.at(-1)?.time ?? null }
    }
    return { id: sessionId, entries: rows }
  }

  /** Awaitable generation used by the agent tool. */
  async generateMinutes({ title } = {}) {
    if (this.settings.offlineMode === true) {
      throw new Error('离线模式下会议纪要不可用：纪要需要云端模型总结，请先关闭「一键离线」。')
    }
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

  clear() {
    this.entries = []
    this.seq = 0
    this.cursorMs = 0
    this.segments = 0
    this.translationError = null
    this.warnings = []
    this.minutes = { generating: false, text: '', path: null, generatedAt: null, error: null }
    this.bump()
    return this.state()
  }
}
