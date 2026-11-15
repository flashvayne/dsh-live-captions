window.__ModuleLoader__.load({
  id: '@local/meeting-captions',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React
    const h = React.createElement

    const NS = 'meeting-captions'
    const API = '/meeting-captions/api'

    const DICT = {
      en: {
        'title': 'Live captions',
        'subtitle': 'Speaker + microphone to subtitles and minutes',
        'start': 'Start',
        'stop': 'Stop',
        'prepare': 'Download model',
        'downloadModel': 'Download model (≈240 MB)',
        'firstRunHint': 'The recognition model ships with the plugin and is prepared on this machine; nothing is downloaded. Audio is recognised locally and never uploaded.',
        'preparing': 'Preparing model',
        'minutes': 'Minutes',
        'generating': 'Writing minutes…',
        'clear': 'Clear',
        'confirmClear': 'Confirm clear?',
        'copy': 'Copy',
        'copied': 'Copied',
        'close': 'Close',
        'open': 'Open live captions',
        'source': 'Audio source',
        'source.both': 'System audio + mic',
        'source.speaker': 'System audio',
        'source.mic': 'Microphone',
        'spoken': 'Source language',
        'target': 'Target language',
        'tagSource': 'Source',
        'tagTarget': 'Translation',
        'records': 'Records',
        'moreSettings': 'More options',
        'recordsTitle': 'Caption records',
        'recordsEmpty': 'No records yet.',
        'recordsPick': 'Session',
        'copyAll': 'Copy all',
        'fontSize': 'Size',
        'opacity': 'Opacity',
        'lock': 'Lock',
        'unlock': 'Unlock',
        'resetPos': 'Reset position',
        'lockedHint': 'Locked: click-through, unlock from the panel.',
        'dragHint': 'Drag to move',
        'resize': 'Resize',
        'backToLive': 'Back to live',
        'lang.auto': 'Auto detect',
        'lang.zh': 'Chinese',
        'lang.en': 'English',
        'lang.yue': 'Cantonese',
        'lang.ja': 'Japanese',
        'lang.ko': 'Korean',
        'lang.es': 'Spanish',
        'lang.fr': 'French',
        'lang.de': 'German',
        'lang.ru': 'Russian',
        'lang.pt': 'Portuguese',
        'translate': 'Translate',
        'engine': 'Translation engine',
        'engine.cloud': 'Cloud model',
        'engine.builtin': 'Built-in offline model',
        'engine.local': 'Local server',
        'offline': 'Offline mode',
        'offlineOn': 'Offline mode: recognition and translation both stay on this machine. Meeting minutes need the cloud model and are unavailable.',
        'mtPreparing': 'Preparing the built-in translation model',
        'mtFailed': 'Built-in model unavailable',
        'retry': 'Retry',
        'downloadDeps': 'Download dependency',
        'minutesUnavailable': 'Offline mode: minutes unavailable',
        'localUrl': 'Endpoint',
        'localModel': 'Model',
        'localHint': 'Ollama: http://127.0.0.1:11434/v1 · LM Studio: http://127.0.0.1:1234/v1',
        'engineLocalNote': 'You start this server yourself (Ollama/LM Studio/vLLM); the plugin ships no model weights. Subtitles only — minutes still use the cloud model.',
        'listening': 'Listening…',
        'noCaptions': 'Captions appear here as people speak.',
        'transcript': 'Transcript',
        'emptyTranscript': 'Nothing recognised yet.',
        'status.idle': 'Idle',
        'status.preparing': 'Preparing model',
        'status.starting': 'Starting capture',
        'status.running': 'Capturing',
        'status.stopping': 'Stopping',
        'status.error': 'Error',
        'minutesEmpty': 'Generate a summary when the meeting ends.',
        'minutesPath': 'File',
        'segments': 'segments',
        'lines': 'lines',
        'translationFailed': 'Translation failed',
      },
      zh: {
        'title': '实时字幕',
        'subtitle': '系统声音与麦克风实时转写、翻译并生成纪要',
        'start': '开始',
        'stop': '停止',
        'prepare': '下载识别模型',
        'downloadModel': '下载识别模型（约 240 MB）',
        'firstRunHint': '识别模型已随插件打包，首次点「开始」会在本机准备好，无需联网下载；语音在本机识别，音频不会上传。',
        'preparing': '正在准备模型',
        'minutes': '生成纪要',
        'generating': '正在生成纪要…',
        'clear': '清空',
        'confirmClear': '确认清空？',
        'copy': '复制',
        'copied': '已复制',
        'close': '关闭',
        'open': '打开实时字幕',
        'source': '音频来源',
        'source.both': '系统声音 + 麦克风',
        'source.speaker': '系统声音',
        'source.mic': '麦克风',
        'spoken': '源语言',
        'target': '目标语言',
        'tagSource': '原文',
        'tagTarget': '译文',
        'records': '记录',
        'moreSettings': '更多设置',
        'recordsTitle': '字幕记录',
        'recordsEmpty': '还没有记录。',
        'recordsPick': '会话',
        'copyAll': '复制全部',
        'fontSize': '字号',
        'opacity': '透明度',
        'lock': '锁定',
        'unlock': '解锁',
        'resetPos': '重置位置',
        'lockedHint': '已锁定：可点击穿透，在面板里解锁。',
        'dragHint': '拖动可移动',
        'resize': '调整大小',
        'backToLive': '回到最新',
        'lang.auto': '自动识别',
        'lang.zh': '中文',
        'lang.en': '英文',
        'lang.yue': '粤语',
        'lang.ja': '日文',
        'lang.ko': '韩文',
        'lang.es': '西班牙文',
        'lang.fr': '法文',
        'lang.de': '德文',
        'lang.ru': '俄文',
        'lang.pt': '葡萄牙文',
        'translate': '翻译字幕',
        'engine': '翻译引擎',
        'engine.cloud': '云端默认模型',
        'engine.builtin': '内置离线模型',
        'engine.local': '本地推理服务',
        'offline': '一键离线',
        'offlineOn': '离线模式：识别和翻译都在本机完成；会议纪要需要云端模型，此时不可用。',
        'mtPreparing': '正在准备内置翻译模型',
        'mtFailed': '内置模型不可用',
        'retry': '重试',
        'downloadDeps': '下载依赖',
        'minutesUnavailable': '离线模式：纪要不可用',
        'localUrl': '服务地址',
        'localModel': '模型名',
        'localHint': 'Ollama：http://127.0.0.1:11434/v1 · LM Studio：http://127.0.0.1:1234/v1',
        'engineLocalNote': '需要你自己启动这个服务（Ollama/LM Studio/vLLM），插件不自带模型权重；只负责字幕翻译，纪要仍用云端。',
        'listening': '正在聆听…',
        'noCaptions': '有人说话时字幕会显示在这里。',
        'transcript': '转写记录',
        'emptyTranscript': '还没有识别到内容。',
        'status.idle': '未运行',
        'status.preparing': '准备模型中',
        'status.starting': '正在启动',
        'status.running': '正在采集',
        'status.stopping': '正在停止',
        'status.error': '出错',
        'minutesEmpty': '会议结束后可以一键生成纪要。',
        'minutesPath': '文件',
        'segments': '段音频',
        'lines': '条字幕',
        'translationFailed': '翻译失败',
      },
    }

    const TARGET_LANGUAGES = ['zh', 'en', 'ja', 'ko', 'yue', 'es', 'fr', 'de', 'ru', 'pt']
    const SOURCE_LANGUAGES = ['auto', 'zh', 'en', 'yue', 'ja', 'ko']

    function localeId(ctx) {
      try {
        const snapshot = ctx.locale.getLocale()
        const id = snapshot?.active ?? snapshot?.id ?? snapshot?.locale ?? 'en'
        return String(id).toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    function useLanguage(ctx) {
      const [id, setId] = useState(() => localeId(ctx))
      useEffect(() => {
        const update = () => setId(localeId(ctx))
        update()
        let dispose = () => {}
        try {
          dispose = ctx.locale.subscribe(update) ?? (() => {})
        } catch {
          // locale service unavailable: keep the initial id
        }
        return () => { try { dispose() } catch { /* ignore */ } }
      }, [ctx])
      return id
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    function statusColor(status) {
      if (status === 'running') return 'var(--dsw-alias-state-success-primary)'
      if (status === 'error') return 'var(--dsw-alias-state-error-primary)'
      if (status === 'preparing' || status === 'starting') return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-state-idle-primary)'
    }

    const styles = `
.mc-root{position:fixed;inset:0;pointer-events:none;font-family:inherit}
.mc-line{display:flex;align-items:baseline;gap:8px;text-align:left;max-width:100%}
.mc-line-text{min-width:0;overflow-wrap:anywhere}
.mc-line-source{font-size:16px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.mc-line-target{font-size:19px;line-height:1.45;font-weight:600;color:var(--dsw-alias-label-primary)}
.mc-lyric{position:fixed;z-index:5;min-width:260px;max-width:min(880px,86vw);pointer-events:auto;
  display:flex;flex-direction:column;gap:6px;padding:10px 14px;border-radius:12px;overflow:hidden;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);
  box-shadow:0 10px 28px rgba(0,0,0,.18);cursor:grab;user-select:none}
.mc-lyric:active{cursor:grabbing}
.mc-lyric-locked{pointer-events:none;cursor:default;border-style:dashed}
.mc-lyric-tools{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding-bottom:6px;
  border-bottom:1px solid var(--dsw-alias-border-l1);pointer-events:auto;flex:0 0 auto}
.mc-lyric-tool{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;
  min-width:26px;height:24px;padding:0 6px;border-radius:6px;border:1px solid transparent;
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.mc-lyric-tool:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}
.mc-lyric-tool:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mc-lyric-body{display:flex;flex-direction:column;gap:12px;min-height:0;flex:1 1 auto;
  overflow-y:auto;overflow-x:hidden;padding-right:4px;overscroll-behavior:contain}
.mc-lyric-entry{display:flex;flex-direction:column;gap:3px;padding-bottom:8px;
  border-bottom:1px dashed var(--dsw-alias-border-l1)}
.mc-lyric-entry:last-child{border-bottom:0;padding-bottom:0}
.mc-lyric .mc-line-source{font-size:calc(var(--mc-lyric-size,22px) * 0.72);line-height:1.4;
  color:var(--dsw-alias-label-secondary);opacity:.85}
.mc-lyric .mc-line-target{font-size:var(--mc-lyric-size,22px);line-height:1.45;font-weight:600;
  color:var(--dsw-alias-label-primary)}
.mc-lyric-resize{position:absolute;right:1px;bottom:1px;width:14px;height:14px;cursor:nwse-resize;
  pointer-events:auto;border-bottom-right-radius:12px;background:
  linear-gradient(135deg,transparent 46%,var(--dsw-alias-border-l2) 46%,var(--dsw-alias-border-l2) 58%,transparent 58%)}
.mc-lyric-badge{position:absolute;left:8px;top:-9px;font-size:10px;line-height:1.6;padding:0 6px;border-radius:999px;
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);pointer-events:auto;cursor:pointer}
.mc-record-window{position:fixed;z-index:30;display:flex;flex-direction:column;min-width:320px;min-height:240px;
  border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);box-shadow:0 18px 48px rgba(0,0,0,.28);pointer-events:auto;overflow:hidden}
.mc-records-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);
  cursor:grab;flex:0 0 auto}
.mc-records-head:active{cursor:grabbing}
.mc-records-title{font-size:14px;font-weight:600;flex:0 0 auto}
.mc-records-list{flex:1 1 auto;overflow:auto;padding:8px 14px 14px;display:flex;flex-direction:column;gap:8px;min-height:0}
.mc-window-resize{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;pointer-events:auto;
  background:linear-gradient(135deg,transparent 46%,var(--dsw-alias-border-l2) 46%,var(--dsw-alias-border-l2) 58%,transparent 58%)}
.mc-record{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mc-record-time{flex:0 0 68px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.mc-record-texts{display:flex;flex-direction:column;gap:3px;min-width:0}
.mc-record-src{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.mc-record-tr{font-size:13.5px;line-height:1.5;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.mc-records-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}
.mc-dock{position:absolute;right:18px;bottom:18px;display:flex;flex-direction:column;align-items:flex-end;gap:10px}
.mc-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px;
  border-radius:19px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);
  color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.14)}
.mc-pill:hover{border-color:var(--dsw-alias-border-l2)}
.mc-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.mc-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}
.mc-panel{pointer-events:auto;width:392px;max-height:min(68vh,600px);display:flex;flex-direction:column;
  border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.18)}
.mc-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.mc-head-title{font-size:14px;font-weight:600;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc-icon-btn{pointer-events:auto;border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  cursor:pointer;font-size:16px;line-height:1;padding:4px 6px;border-radius:6px}
.mc-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.mc-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mc-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px;overflow:auto}
.mc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mc-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.mc-primary-btn{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-label-primary);
  background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);font-size:13px;cursor:pointer;font-weight:500}
.mc-primary-btn:hover:not([disabled]){opacity:.88}
.mc-primary-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.mc-primary-btn[disabled]{opacity:.55;cursor:not-allowed}
.mc-ghost-btn{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);
  background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
.mc-ghost-btn:hover:not([disabled]){border-color:var(--dsw-alias-border-l2)}
.mc-ghost-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.mc-ghost-btn[disabled]{opacity:.5;cursor:not-allowed}
.mc-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);flex:1 1 0;min-width:0}
.mc-select{pointer-events:auto;height:30px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 6px;width:100%}
.mc-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mc-input{pointer-events:auto;height:30px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 8px;
  width:100%;box-sizing:border-box}
.mc-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.mc-progress{height:5px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.mc-progress > span{display:block;height:100%;background:var(--dsw-alias-brand-primary);transition:width .3s}
.mc-hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;overflow-wrap:anywhere}
.mc-error{font-size:12px;color:var(--dsw-alias-state-error-primary);line-height:1.5;overflow-wrap:anywhere}
.mc-warn{font-size:12px;color:var(--dsw-alias-state-warn-primary);line-height:1.5;overflow-wrap:anywhere}
.mc-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;gap:8px;align-items:center;justify-content:space-between}
.mc-list{display:flex;flex-direction:column;gap:8px;max-height:220px;overflow:auto;padding-right:2px}
.mc-item{display:flex;flex-direction:column;gap:2px;border-left:2px solid var(--dsw-alias-border-l1);padding-left:8px}
.mc-item-translated{border-left-color:var(--dsw-alias-brand-primary)}
.mc-item-time{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.mc-item-text{font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.mc-item-tr{font-size:13.5px;line-height:1.45;color:var(--dsw-alias-label-primary)}
.mc-item-live{opacity:.72}
.mc-minutes{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12.5px;line-height:1.55;
  margin:0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);max-height:240px;overflow:auto;
  color:var(--dsw-alias-label-primary)}
.mc-empty{font-size:12px;color:var(--dsw-alias-label-secondary)}
.mc-primary-btn-lg{height:42px;width:100%;font-size:15px;font-weight:600;border-radius:10px}
.mc-disclosure{pointer-events:auto;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;
  height:34px;margin-top:2px;border:0;border-top:1px solid var(--dsw-alias-border-l1);border-radius:0;
  background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;cursor:pointer;user-select:none}
.mc-disclosure:hover{color:var(--dsw-alias-label-primary)}
.mc-advanced{display:flex;flex-direction:column;gap:10px;padding-top:4px}
@media (max-width:1100px){
  .mc-dock{bottom:184px}
}
@media (max-width:720px){
  .mc-lyric{max-width:88vw;min-width:240px}
  .mc-panel{width:min(92vw,392px);max-height:min(58vh,480px)}
  .mc-primary-btn,.mc-ghost-btn{flex:1 1 auto}
  .mc-records{inset:2vh 2vw}
}
`

    function TextField(props) {
      const { value, placeholder, onCommit, ariaLabel } = props
      const [draft, setDraft] = useState(value ?? '')
      useEffect(() => {
        setDraft(value ?? '')
      }, [value])
      return h('input', {
        className: 'mc-input',
        type: 'text',
        value: draft,
        placeholder,
        'aria-label': ariaLabel,
        onChange: (event) => setDraft(event.target.value),
        onBlur: () => {
          const next = draft.trim()
          if (next !== (value ?? '')) onCommit(next)
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(value ?? '')
        },
      })
    }

    function Overlay(props) {
      const { ctx } = props
      const lang = useLanguage(ctx)
      const dict = DICT[lang] ?? DICT.en
      const t = useCallback((key) => dict[key] ?? DICT.en[key] ?? key, [dict])

      const [state, setState] = useState(null)
      const [entries, setEntries] = useState([])
      const [open, setOpen] = useState(false)
      const [recordsOpen, setRecordsOpen] = useState(false)
      const [showAdvanced, setShowAdvanced] = useState(false)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState('')
      const [copied, setCopied] = useState(false)
      const [clearArmed, setClearArmed] = useState(false)
      const clearArmRef = useRef(null)
      const sinceRef = useRef(0)
      const sessionRef = useRef(null)
      const aliveRef = useRef(true)
      const listRef = useRef(null)

      // Keep the transcript pinned to the newest line unless the reader scrolled up.
      useEffect(() => {
        const list = listRef.current
        if (list === null || entries.length === 0) return
        const distance = list.scrollHeight - list.scrollTop - list.clientHeight
        if (distance < 96) list.scrollTop = list.scrollHeight
      }, [entries.length])

      // Escape closes the records pop-up first, then the panel; only one of the
      // two responds so the other stays open underneath.
      useEffect(() => {
        if (!open && !recordsOpen) return undefined
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          if (recordsOpen) setRecordsOpen(false)
          else setOpen(false)
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [open, recordsOpen])

      const applyState = useCallback((next) => {
        if (!next) return
        const sessionId = next.session?.id ?? null
        if (sessionRef.current !== sessionId) {
          sessionRef.current = sessionId
          sinceRef.current = 0
          setEntries([])
        }
        const fresh = Array.isArray(next.entries) ? next.entries : []
        const touched = Array.isArray(next.recent) ? next.recent : []
        if (fresh.length > 0 || touched.length > 0) {
          if (fresh.length > 0) {
            const maxSeq = fresh.reduce((top, entry) => Math.max(top, entry.seq), 0)
            sinceRef.current = Math.max(sinceRef.current, maxSeq)
          }
          setEntries((previous) => {
            const merged = new Map(previous.map((entry) => [entry.seq, entry]))
            for (const entry of fresh) merged.set(entry.seq, entry)
            for (const entry of touched) merged.set(entry.seq, { ...merged.get(entry.seq), ...entry })
            return [...merged.values()].sort((a, b) => a.seq - b.seq).slice(-300)
          })
        }
        setState(next)
      }, [])

      const reset = useCallback(() => {
        sinceRef.current = 0
        sessionRef.current = null
        setEntries([])
      }, [])

      useEffect(() => {
        aliveRef.current = true
        let timer = null
        const tick = async () => {
          if (!aliveRef.current) return
          let delay = 1200
          try {
            const response = await fetch(`${API}/state?since=${sinceRef.current}`, { headers: { accept: 'application/json' } })
            if (response.ok) {
              const payload = await response.json()
              if (aliveRef.current && payload?.ok) {
                applyState(payload.state)
                if (payload.state?.status === 'running') delay = 400
                else if (payload.state?.status === 'preparing' || payload.state?.status === 'starting') delay = 1200
                else delay = 4000
              }
            } else {
              delay = 5000
            }
          } catch {
            delay = 5000
          }
          if (aliveRef.current) timer = setTimeout(tick, delay)
        }
        void tick()
        return () => {
          aliveRef.current = false
          if (timer !== null) clearTimeout(timer)
        }
      }, [applyState])

      const command = useCallback(async (body) => {
        setBusy(body.action)
        setNotice('')
        try {
          const response = await fetch(`${API}/command`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, since: sinceRef.current }),
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || payload?.ok === false) {
            setNotice(payload?.error ?? `请求失败（${response.status}）`)
          } else {
            if (body.action === 'clear') reset()
            if (payload.state) applyState(payload.state)
          }
          return payload
        } catch (error) {
          setNotice(String(error?.message ?? error))
          return null
        } finally {
          setBusy('')
        }
      }, [applyState, reset])

      const copyMinutes = useCallback(async () => {
        const text = state?.minutes?.text ?? ''
        if (text === '') return
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          setNotice(t('copy'))
        }
      }, [state, t])

      // Desktop-lyrics box state: drag position, size, scroll follow, records window.
      const [lyricPos, setLyricPos] = useState(null)
      const [lyricSize, setLyricSize] = useState(null)
      const [pinned, setPinned] = useState(true)
      const [recordsData, setRecordsData] = useState(null)
      const [recordsGeom, setRecordsGeom] = useState(null)
      const lyricRef = useRef(null)
      const lyricBodyRef = useRef(null)
      const pinnedRef = useRef(true)
      const dragRef = useRef(null)
      const resizeRef = useRef(null)
      const recordsMoveRef = useRef(null)
      const recordsGrowRef = useRef(null)

      const save = useCallback((patch) => command({ action: 'settings', settings: patch }), [command])

      const loadRecords = useCallback(async (sessionId) => {
        try {
          const query = typeof sessionId === 'string' && sessionId !== '' ? `?session=${encodeURIComponent(sessionId)}` : ''
          const response = await fetch(`${API}/records${query}`, { headers: { accept: 'application/json' } })
          const payload = await response.json().catch(() => null)
          if (payload?.ok) setRecordsData(payload)
        } catch (error) {
          setNotice(String(error?.message ?? error))
        }
      }, [])

      const copyRecords = useCallback(async () => {
        const rows = recordsData?.records?.entries ?? []
        const text = rows
          .map((row) => `[${row.time || '--:--:--'}] ${row.text}${row.translation && row.translation !== row.text ? `\n          ${row.translation}` : ''}`)
          .join('\n')
        if (text === '') return
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          setNotice(t('copy'))
        }
      }, [recordsData, t])

      const beginDrag = (event) => {
        if (event.button !== 0) return
        if (event.target?.closest?.('button, select, input, textarea, a, .mc-lyric-tools, .mc-lyric-resize')) return
        const rect = event.currentTarget.getBoundingClientRect()
        dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not supported */ }
        event.preventDefault()
      }

      const moveDrag = (event) => {
        const drag = dragRef.current
        if (drag === null) return
        const width = event.currentTarget?.offsetWidth ?? 320
        const maxX = (window.innerWidth ?? 1200) - width - 8
        const maxY = (window.innerHeight ?? 800) - 72
        const x = Math.max(8, Math.min(maxX, event.clientX - drag.dx))
        const y = Math.max(8, Math.min(maxY, event.clientY - drag.dy))
        drag.x = x
        drag.y = y
        setLyricPos({ x, y })
      }

      const endDrag = () => {
        const drag = dragRef.current
        dragRef.current = null
        if (drag !== null && typeof drag.x === 'number') save({ lyricX: drag.x, lyricY: drag.y })
      }

      const beginLyricResize = (event) => {
        event.stopPropagation()
        const box = lyricRef.current
        if (box === null) return
        const rect = box.getBoundingClientRect()
        resizeRef.current = { startX: event.clientX, startY: event.clientY, w0: rect.width, h0: rect.height, w: rect.width, h: rect.height }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not supported */ }
        event.preventDefault()
      }

      const moveLyricResize = (event) => {
        const resize = resizeRef.current
        if (resize === null) return
        const maxW = (window.innerWidth ?? 1200) - 16
        const maxH = (window.innerHeight ?? 800) - 16
        const w = Math.max(260, Math.min(maxW, resize.w0 + (event.clientX - resize.startX)))
        const h = Math.max(70, Math.min(maxH, resize.h0 + (event.clientY - resize.startY)))
        resize.w = w
        resize.h = h
        setLyricSize({ w, h })
      }

      const endLyricResize = () => {
        const resize = resizeRef.current
        resizeRef.current = null
        if (resize !== null) save({ lyricW: Math.round(resize.w), lyricH: Math.round(resize.h) })
      }

      /** Follow the newest line unless the reader scrolled up inside the box. */
      const onLyricScroll = () => {
        const body = lyricBodyRef.current
        if (body === null) return
        const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 24
        pinnedRef.current = atBottom
        setPinned(atBottom)
      }

      const scrollToLatest = () => {
        const body = lyricBodyRef.current
        if (body === null) return
        pinnedRef.current = true
        setPinned(true)
        body.scrollTop = body.scrollHeight
      }

      const recordsGeometry = () => recordsGeom ?? {
        x: typeof settings.recordsX === 'number' ? settings.recordsX : Math.max(16, Math.round((window.innerWidth ?? 1200) / 2 - 210)),
        y: typeof settings.recordsY === 'number' ? settings.recordsY : Math.max(16, Math.round((window.innerHeight ?? 800) / 2 - 230)),
        w: typeof settings.recordsW === 'number' ? settings.recordsW : 420,
        h: typeof settings.recordsH === 'number' ? settings.recordsH : 460,
      }

      const beginRecordsMove = (event) => {
        if (event.button !== 0) return
        // Never start a drag from a control: pointer capture on the header would
        // swallow the button's click, which is exactly how close stopped working.
        if (event.target?.closest?.('button, select, input, textarea, a, .mc-records-list, .mc-window-resize, .mc-records-foot')) return
        const geometry = recordsGeometry()
        recordsMoveRef.current = { dx: event.clientX - geometry.x, dy: event.clientY - geometry.y }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not supported */ }
        event.preventDefault()
      }

      const moveRecordsMove = (event) => {
        const drag = recordsMoveRef.current
        if (drag === null) return
        const geometry = recordsGeometry()
        const x = Math.max(8, Math.min((window.innerWidth ?? 1200) - 140, event.clientX - drag.dx))
        const y = Math.max(8, Math.min((window.innerHeight ?? 800) - 60, event.clientY - drag.dy))
        setRecordsGeom({ ...geometry, x, y })
      }

      const endRecordsMove = () => {
        const drag = recordsMoveRef.current
        recordsMoveRef.current = null
        if (drag === null) return
        const geometry = recordsGeometry()
        save({ recordsX: Math.round(geometry.x), recordsY: Math.round(geometry.y) })
      }

      const beginRecordsResize = (event) => {
        event.stopPropagation()
        const geometry = recordsGeometry()
        recordsGrowRef.current = { startX: event.clientX, startY: event.clientY, w0: geometry.w, h0: geometry.h, w: geometry.w, h: geometry.h }
        try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not supported */ }
        event.preventDefault()
      }

      const moveRecordsResize = (event) => {
        const resize = recordsGrowRef.current
        if (resize === null) return
        const geometry = recordsGeometry()
        const w = Math.max(320, Math.min((window.innerWidth ?? 1200) - geometry.x - 8, resize.w0 + (event.clientX - resize.startX)))
        const h = Math.max(240, Math.min((window.innerHeight ?? 800) - geometry.y - 8, resize.h0 + (event.clientY - resize.startY)))
        resize.w = w
        resize.h = h
        setRecordsGeom({ ...geometry, w, h })
      }

      const endRecordsResize = () => {
        const resize = recordsGrowRef.current
        recordsGrowRef.current = null
        if (resize !== null) save({ recordsW: Math.round(resize.w), recordsH: Math.round(resize.h) })
      }

      const status = state?.status ?? 'idle'
      const running = status === 'running' || status === 'starting'
      const preparing = status === 'preparing'
      const asr = state?.asr ?? { available: false, phase: 'unavailable' }
      const modelReady = asr.phase === 'ready' || asr.phase === 'standby'
      const asrBusy = ['downloading', 'loading', 'waking', 'checking', 'cancelling'].includes(asr.phase)
      const latest = entries.length > 0 ? entries[entries.length - 1] : null
      const settings = state?.settings ?? { source: 'both', sourceLanguage: 'auto', targetLanguage: 'zh', translate: true }
      const minutes = state?.minutes ?? { generating: false, text: '', path: null, error: null }
      const mt = state?.mt ?? { state: 'idle', progress: {}, model: '', error: null }
      const mtPercent = mt.progress && mt.progress.total > 0
        ? Math.min(100, Math.round((mt.progress.loaded / mt.progress.total) * 100))
        : null

      const progress = asr.progress ?? {}
      const percent = progress.totalBytes ? Math.min(100, Math.round((progress.completedBytes / progress.totalBytes) * 100)) : null

      // A stored position or size may come from another monitor, so both windows
      // are clamped fully inside the current viewport — otherwise a title bar
      // (and its close button) can end up off-screen.
      const viewportW = window.innerWidth ?? 1200
      const viewportH = window.innerHeight ?? 800
      const clampX = (value, width) => Math.max(8, Math.min(viewportW - width - 8, value))
      const clampY = (value, height) => Math.max(8, Math.min(viewportH - height - 8, value))
      const lyricX = lyricPos === null ? settings.lyricX : lyricPos.x
      const lyricY = lyricPos === null ? settings.lyricY : lyricPos.y
      const lyricW = Math.min(lyricSize === null ? (settings.lyricW ?? 560) : lyricSize.w, viewportW - 16)
      const lyricH = Math.min(lyricSize === null ? (settings.lyricH ?? 220) : lyricSize.h, viewportH - 16)
      const lyricLocked = settings.lyricLocked === true
      const lyricStyle = {
        '--mc-lyric-size': `${settings.lyricFontSize ?? 22}px`,
        opacity: settings.lyricOpacity ?? 0.92,
        width: `${lyricW}px`,
        height: `${lyricH}px`,
        ...(typeof lyricX !== 'number' || typeof lyricY !== 'number'
          ? { left: '50%', bottom: '172px', transform: 'translateX(-50%)' }
          : { left: `${clampX(lyricX, lyricW)}px`, top: `${clampY(lyricY, lyricH)}px` }),
      }
      const recordsStyle = (() => {
        const geometry = recordsGeometry()
        const width = Math.min(geometry.w, viewportW - 24)
        const height = Math.min(geometry.h, viewportH - 24)
        return {
          left: `${clampX(geometry.x, width)}px`,
          top: `${clampY(geometry.y, height)}px`,
          width: `${width}px`,
          height: `${height}px`,
        }
      })()

      // Keep the viewport pinned to the newest line while the reader stays at the bottom.
      useEffect(() => {
        const body = lyricBodyRef.current
        if (body === null || !pinnedRef.current) return
        body.scrollTop = body.scrollHeight
      }, [entries.length, entries.length > 0 ? entries[entries.length - 1].translation : null])

      return h('div', { className: 'mc-root' }, [
        h('style', { key: 'style' }, styles),

        running ? h('div', {
          ref: lyricRef,
          className: `mc-lyric${lyricLocked ? ' mc-lyric-locked' : ''}`,
          key: 'lyric',
          style: lyricStyle,
          role: 'status',
          'aria-live': 'polite',
          title: lyricLocked ? t('lockedHint') : t('dragHint'),
          onPointerDown: lyricLocked ? undefined : beginDrag,
          onPointerMove: lyricLocked ? undefined : moveDrag,
          onPointerUp: lyricLocked ? undefined : endDrag,
        }, [
          !lyricLocked && !pinned
            ? h('button', {
                className: 'mc-lyric-badge', key: 'history', type: 'button',
                onClick: scrollToLatest, title: t('backToLive'),
              }, `↓ ${t('backToLive')}`)
            : null,
          lyricLocked ? null : h('div', { className: 'mc-lyric-tools', key: 'tools' }, [
            h('button', {
              className: 'mc-lyric-tool', key: 'font-down', type: 'button',
              title: t('fontSize'), 'aria-label': `${t('fontSize')} -`,
              onClick: () => save({ lyricFontSize: (settings.lyricFontSize ?? 22) - 2 }),
            }, 'A−'),
            h('button', {
              className: 'mc-lyric-tool', key: 'font-up', type: 'button',
              title: t('fontSize'), 'aria-label': `${t('fontSize')} +`,
              onClick: () => save({ lyricFontSize: (settings.lyricFontSize ?? 22) + 2 }),
            }, 'A+'),
            h('button', {
              className: 'mc-lyric-tool', key: 'opacity-down', type: 'button',
              title: t('opacity'), 'aria-label': `${t('opacity')} -`,
              onClick: () => save({ lyricOpacity: (settings.lyricOpacity ?? 0.92) - 0.08 }),
            }, '◐−'),
            h('button', {
              className: 'mc-lyric-tool', key: 'opacity-up', type: 'button',
              title: t('opacity'), 'aria-label': `${t('opacity')} +`,
              onClick: () => save({ lyricOpacity: (settings.lyricOpacity ?? 0.92) + 0.08 }),
            }, '◐+'),
            h('button', {
              className: 'mc-lyric-tool', key: 'toggle-source', type: 'button',
              title: t('tagSource'), 'aria-pressed': settings.lyricShowSource !== false,
              onClick: () => save({ lyricShowSource: settings.lyricShowSource === false }),
            }, settings.lyricShowSource === false ? '原文✕' : '原文✓'),
            h('button', {
              className: 'mc-lyric-tool', key: 'lock', type: 'button',
              title: t('lock'), 'aria-label': t('lock'),
              onClick: () => save({ lyricLocked: true }),
            }, '🔒'),
            h('button', {
              className: 'mc-lyric-tool', key: 'reset-pos', type: 'button',
              title: t('resetPos'), 'aria-label': t('resetPos'),
              onClick: () => { setLyricPos(null); setLyricSize(null); save({ lyricReset: true }) },
            }, '⟲'),
          ]),
          h('div', {
            className: 'mc-lyric-body', key: 'body',
            ref: lyricBodyRef, onScroll: onLyricScroll,
          },
            entries.length === 0
              ? h('div', { className: 'mc-line mc-line-source', key: 'listening' }, t('listening'))
              : entries.slice(-60).map((entry) => h('div', { className: 'mc-lyric-entry', key: entry.seq }, [
                  settings.lyricShowSource === false
                    ? null
                    : h('div', { className: 'mc-line mc-line-source', key: 'source' },
                        h('span', { className: 'mc-line-text', key: 'text' }, entry.text)),
                  settings.translate === false || (entry.translation !== null && entry.translation === entry.text)
                    ? null
                    : h('div', { className: 'mc-line mc-line-target', key: 'target' },
                        h('span', { className: 'mc-line-text', key: 'text' }, entry.translation ?? '…')),
                ]))),
          lyricLocked ? null : h('div', {
            className: 'mc-lyric-resize', key: 'resize', title: t('resize'),
            onPointerDown: beginLyricResize,
            onPointerMove: moveLyricResize,
            onPointerUp: endLyricResize,
          }),
        ]) : null,

        recordsOpen ? h('section', {
          className: 'mc-record-window', key: 'records', role: 'dialog', 'aria-label': t('recordsTitle'),
          style: recordsStyle,
        }, [
          h('header', {
            className: 'mc-records-head', key: 'head',
            onPointerDown: beginRecordsMove,
            onPointerMove: moveRecordsMove,
            onPointerUp: endRecordsMove,
          }, [
            h('span', { className: 'mc-records-title', key: 'title' }, t('recordsTitle')),
            h('select', {
              className: 'mc-select', key: 'pick',
              style: { flex: '1 1 auto', minWidth: '90px' },
              value: recordsData?.sessionId ?? '',
              'aria-label': t('recordsPick'),
              onChange: (event) => { void loadRecords(event.target.value) },
            }, (recordsData?.sessions ?? []).map((session) => h('option', { key: session.id, value: session.id },
              `${session.id}${session.entries ? ` · ${session.entries}` : ''}`))),
            h('button', {
              className: 'mc-icon-btn', key: 'close', type: 'button',
              onClick: () => setRecordsOpen(false), 'aria-label': t('close'), title: t('close'),
            }, '×'),
          ]),
          h('div', { className: 'mc-records-list', key: 'list' },
            (recordsData?.records?.entries ?? []).length === 0
              ? h('div', { className: 'mc-empty', key: 'empty' }, t('recordsEmpty'))
              : recordsData.records.entries.map((row) => h('div', { className: 'mc-record', key: row.seq }, [
                  h('span', { className: 'mc-record-time', key: 'time' }, row.time || '--:--:--'),
                  h('div', { className: 'mc-record-texts', key: 'texts' }, [
                    h('span', { className: 'mc-record-src', key: 'src' }, row.text),
                    row.translation && row.translation !== row.text
                      ? h('span', { className: 'mc-record-tr', key: 'tr' }, row.translation)
                      : null,
                  ]),
                ]))),
          h('div', { className: 'mc-records-foot', key: 'foot' }, [
            h('span', { className: 'mc-hint', key: 'count' },
              `${(recordsData?.records?.entries ?? []).length} ${t('lines')}`),
            h('button', {
              className: 'mc-ghost-btn', key: 'copy', type: 'button',
              disabled: (recordsData?.records?.entries ?? []).length === 0,
              onClick: copyRecords,
            }, copied ? t('copied') : t('copyAll')),
          ]),
          h('div', {
            className: 'mc-window-resize', key: 'resize', title: t('resize'),
            onPointerDown: beginRecordsResize,
            onPointerMove: moveRecordsResize,
            onPointerUp: endRecordsResize,
          }),
        ]) : null,

        h('div', { className: 'mc-dock', key: 'dock' }, [
          open ? h('section', {
            className: 'mc-panel',
            key: 'panel',
            role: 'dialog',
            'aria-label': t('title'),
          }, [
            h('header', { className: 'mc-head', key: 'head' }, [
              h('span', { className: 'mc-dot', key: 'dot', style: { background: statusColor(status) } }),
              h('span', { className: 'mc-head-title', key: 'title' }, t('title')),
              h('button', {
                className: 'mc-icon-btn', key: 'close', type: 'button',
                onClick: () => setOpen(false), 'aria-label': t('close'), title: t('close'),
              }, '×'),
            ]),

            h('div', { className: 'mc-body', key: 'body' }, [

              // One clear primary action.
              running || preparing
                ? h('button', {
                    className: 'mc-primary-btn mc-primary-btn-lg', key: 'stop', type: 'button',
                    disabled: busy !== '',
                    onClick: () => command({ action: 'stop' }),
                  }, t('stop'))
                : h('button', {
                    className: 'mc-primary-btn mc-primary-btn-lg', key: 'start', type: 'button',
                    disabled: busy !== '' || !asr.available,
                    onClick: () => command({ action: 'start' }),
                  }, t('start')),

              h('div', { className: 'mc-status', key: 'status' },
                `${asrBusy && !running ? t('preparing') : t(`status.${status}`)}${asr.message ? ` · ${asr.message}` : ''}`),

              // Core settings the user keeps on hand: source, source language,
              // target language, and the translate switch.
              h('div', { className: 'mc-row', key: 'essential' }, [
                h('label', { className: 'mc-field', key: 'source' }, [
                  h('span', { key: 'label' }, t('source')),
                  h('select', {
                    className: 'mc-select', key: 'select', value: settings.source,
                    onChange: (event) => command({ action: 'settings', settings: { source: event.target.value } }),
                  }, [
                    h('option', { key: 'both', value: 'both' }, t('source.both')),
                    h('option', { key: 'speaker', value: 'speaker' }, t('source.speaker')),
                    h('option', { key: 'mic', value: 'mic' }, t('source.mic')),
                  ]),
                ]),
                h('label', { className: 'mc-field', key: 'spoken' }, [
                  h('span', { key: 'label' }, t('spoken')),
                  h('select', {
                    className: 'mc-select', key: 'select', value: settings.sourceLanguage,
                    onChange: (event) => command({ action: 'settings', settings: { sourceLanguage: event.target.value } }),
                  }, SOURCE_LANGUAGES.map((value) => h('option', { key: value, value }, t(`lang.${value}`)))),
                ]),
              ]),
              h('div', { className: 'mc-row', key: 'essential2' }, [
                h('label', { className: 'mc-field', key: 'target' }, [
                  h('span', { key: 'label' }, t('target')),
                  h('select', {
                    className: 'mc-select', key: 'select', value: settings.targetLanguage,
                    onChange: (event) => command({ action: 'settings', settings: { targetLanguage: event.target.value } }),
                  }, TARGET_LANGUAGES.map((value) => h('option', { key: value, value }, t(`lang.${value}`)))),
                ]),
                h('label', { className: 'mc-field', key: 'translate', style: { flex: '0 0 auto', flexDirection: 'row', alignItems: 'center', gap: '6px' } }, [
                  h('span', { key: 'label' }, t('translate')),
                  h('input', {
                    key: 'checkbox', type: 'checkbox', checked: settings.translate !== false,
                    onChange: (event) => command({ action: 'settings', settings: { translate: event.target.checked } }),
                  }),
                ]),
              ]),

              // Secondary actions.
              h('div', { className: 'mc-row', key: 'secondary' }, [
                h('button', {
                  className: 'mc-ghost-btn', key: 'minutes', type: 'button',
                  disabled: busy !== '' || minutes.generating || (state?.totalEntries ?? 0) === 0 || settings.offlineMode === true,
                  title: settings.offlineMode === true ? t('minutesUnavailable') : undefined,
                  onClick: () => command({ action: 'minutes' }),
                }, minutes.generating ? t('generating') : t('minutes')),
                h('button', {
                  className: 'mc-ghost-btn', key: 'records-popup', type: 'button',
                  title: t('recordsTitle'), 'aria-label': t('recordsTitle'),
                  onClick: () => { setRecordsOpen((value) => !value); if (!recordsOpen) void loadRecords() },
                }, `⧉ ${t('records')}`),
              ]),

              // Alerts that block usage stay visible.
              asr.available === false
                ? h('div', { className: 'mc-error', key: 'asr-missing', role: 'alert' }, asr.message ?? '')
                : null,
              notice ? h('div', { className: 'mc-error', key: 'notice', role: 'alert' }, notice) : null,
              state?.translationError ? h('div', { className: 'mc-error', key: 'tr-error' }, `${t('translationFailed')}: ${state.translationError}`) : null,
              (state?.warnings ?? []).map((warning, index) =>
                h('div', { className: 'mc-warn', key: `warn-${index}` }, warning)),

              // Live transcript.
              h('div', { className: 'mc-section-title', key: 'tr-title' }, [
                h('span', { key: 'left' }, `${t('transcript')}${state?.totalEntries ? ` · ${state.totalEntries} ${t('lines')}` : ''}`),
                state?.session
                  ? h('span', { key: 'segments', style: { fontVariantNumeric: 'tabular-nums' } }, `${state.session.segments} ${t('segments')}`)
                  : null,
              ]),
              entries.length === 0
                ? h('div', { className: 'mc-empty', key: 'empty' }, running ? t('listening') : t('emptyTranscript'))
                : h('div', { className: 'mc-list', key: 'list', ref: listRef }, entries.slice(-40).map((entry) =>
                    h('div', { className: `mc-item${entry.translation ? ' mc-item-translated' : ''}`, key: entry.seq }, [
                      h('span', { className: 'mc-item-time', key: 'time' }, entry.at),
                      h('span', { className: 'mc-item-text', key: 'text' }, entry.text),
                      entry.translation ? h('span', {
                        className: `mc-item-tr${entry.live ? ' mc-item-live' : ''}`,
                        key: 'tr',
                      }, entry.translation) : null,
                      entry.translationFailed ? h('span', { className: 'mc-item-time', key: 'fail' }, t('translationFailed')) : null,
                    ]))),

              // Meeting minutes, only when there is a result.
              minutes.text
                ? h('div', { key: 'minutes' }, [
                    h('div', { className: 'mc-section-title', key: 'minutes-title' }, [
                      h('span', { key: 'left' }, t('minutes')),
                      h('button', { className: 'mc-icon-btn', key: 'copy', type: 'button', onClick: copyMinutes, title: t('copy') }, copied ? t('copied') : t('copy')),
                    ]),
                    h('pre', { className: 'mc-minutes', key: 'text' }, minutes.text),
                  ])
                : null,
              minutes.error ? h('div', { className: 'mc-error', key: 'minutes-error' }, minutes.error) : null,
              minutes.path ? h('div', { className: 'mc-hint', key: 'minutes-path', title: minutes.path }, `${t('minutesPath')}: ${minutes.path}`) : null,

              // Everything else hides behind a single disclosure.
              h('button', {
                className: 'mc-disclosure', key: 'disclosure', type: 'button',
                'aria-expanded': showAdvanced,
                onClick: () => setShowAdvanced((value) => !value),
              }, `${showAdvanced ? '▾' : '▸'} ${t('moreSettings')}`),

              showAdvanced
                ? h('div', { className: 'mc-advanced', key: 'advanced' }, [

                    h('div', { className: 'mc-row', key: 'engine-row' }, [
                      h('label', { className: 'mc-field', key: 'engine-select' }, [
                        h('span', { key: 'label' }, t('engine')),
                        h('select', {
                          className: 'mc-select', key: 'select',
                          value: settings.offlineMode === true
                            ? 'builtin'
                            : settings.translateEngine === 'local'
                              ? 'local'
                              : settings.translateEngine === 'builtin' ? 'builtin' : 'cloud',
                          disabled: settings.offlineMode === true,
                          onChange: (event) => command({ action: 'settings', settings: { translateEngine: event.target.value } }),
                        }, [
                          h('option', { key: 'cloud', value: 'cloud' }, t('engine.cloud')),
                          h('option', { key: 'builtin', value: 'builtin' }, t('engine.builtin')),
                          h('option', { key: 'local', value: 'local' }, t('engine.local')),
                        ]),
                      ]),
                      h('label', {
                        className: 'mc-field', key: 'offline',
                        style: { flex: '0 0 auto', flexDirection: 'row', alignItems: 'center', gap: '6px' },
                      }, [
                        h('input', {
                          key: 'checkbox', type: 'checkbox', checked: settings.offlineMode === true,
                          onChange: (event) => command({
                            action: 'settings',
                            settings: event.target.checked
                              ? { offlineMode: true, translateEngine: 'builtin' }
                              : { offlineMode: false },
                          }),
                        }),
                        h('span', { key: 'label' }, t('offline')),
                      ]),
                    ]),
                    settings.offlineMode === true
                      ? h('div', { className: 'mc-hint', key: 'offline-hint' }, t('offlineOn'))
                      : null,

                    settings.translateEngine === 'local'
                      ? h('div', { className: 'mc-row', key: 'local-fields' }, [
                          h('label', { className: 'mc-field', key: 'local-url' }, [
                            h('span', { key: 'label' }, t('localUrl')),
                            h(TextField, {
                              key: 'input', value: settings.localBaseUrl ?? '',
                              placeholder: 'http://127.0.0.1:11434/v1',
                              ariaLabel: t('localUrl'),
                              onCommit: (value) => command({ action: 'settings', settings: { localBaseUrl: value } }),
                            }),
                          ]),
                          h('label', { className: 'mc-field', key: 'local-model' }, [
                            h('span', { key: 'label' }, t('localModel')),
                            h(TextField, {
                              key: 'input', value: settings.localModel ?? '',
                              placeholder: 'qwen2.5:7b',
                              ariaLabel: t('localModel'),
                              onCommit: (value) => command({ action: 'settings', settings: { localModel: value } }),
                            }),
                          ]),
                        ])
                      : null,
                    settings.translateEngine === 'local'
                      ? h('div', { className: 'mc-hint', key: 'local-hint' }, t('localHint'))
                      : null,
                    settings.translateEngine === 'local'
                      ? h('div', { className: 'mc-hint', key: 'local-note' }, t('engineLocalNote'))
                      : null,

                    h('div', { className: 'mc-row', key: 'lyric-tools' }, [
                      h('button', {
                        className: 'mc-ghost-btn', key: 'lyric-lock', type: 'button',
                        onClick: () => save({ lyricLocked: !lyricLocked }),
                      }, lyricLocked ? t('unlock') : t('lock')),
                      h('button', {
                        className: 'mc-ghost-btn', key: 'lyric-reset', type: 'button',
                        onClick: () => { setLyricPos(null); setLyricSize(null); save({ lyricReset: true }) },
                      }, t('resetPos')),
                    ]),
                    lyricLocked ? h('div', { className: 'mc-hint', key: 'locked-hint' }, t('lockedHint')) : null,

                    !modelReady && !asrBusy && asr.available
                      ? h('div', { className: 'mc-hint', key: 'first-run' }, t('firstRunHint'))
                      : null,
                    asrBusy && percent !== null
                      ? h('div', {
                          className: 'mc-progress', key: 'progress',
                          role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent,
                        }, h('span', { style: { width: `${percent}%` } }))
                      : null,
                    asrBusy && percent === null
                      ? h('div', { className: 'mc-hint', key: 'hint' }, `${t('preparing')} · ${formatBytes(progress.completedBytes)}`)
                      : null,

                    (settings.offlineMode === true || settings.translateEngine === 'builtin') && mt.state !== 'ready'
                      ? h('div', { className: 'mc-row', key: 'mt-status' }, [
                          h('div', { className: 'mc-hint', key: 'hint' },
                            mt.installing
                              ? (mt.installProgress?.message ?? t('mtPreparing'))
                              : mt.state === 'failed'
                                ? `${t('mtFailed')}：${mt.error ?? ''}`
                                : `${t('mtPreparing')}${mtPercent === null ? '' : ` ${mtPercent}%`}`),
                          mt.missingDeps && !mt.installing
                            ? h('button', {
                                className: 'mc-ghost-btn', key: 'mt-install', type: 'button',
                                onClick: () => command({ action: 'install_mt_deps' }),
                              }, t('downloadDeps'))
                            : null,
                          mt.state === 'failed' && !mt.missingDeps && !mt.installing
                            ? h('button', {
                                className: 'mc-ghost-btn', key: 'mt-retry', type: 'button',
                                onClick: () => save({ translateEngine: 'builtin' }),
                              }, t('retry'))
                            : null,
                        ])
                      : null,
                    (settings.offlineMode === true || settings.translateEngine === 'builtin') && mt.state !== 'ready' && mtPercent !== null
                      ? h('div', {
                          className: 'mc-progress', key: 'mt-progress',
                          role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': mtPercent,
                        }, h('span', { style: { width: `${mtPercent}%` } }))
                      : null,

                    state?.engine?.label
                      ? h('div', { className: 'mc-hint', key: 'engine-label' }, state.engine.label)
                      : null,

                    h('button', {
                      className: 'mc-ghost-btn', key: 'clear', type: 'button',
                      disabled: busy !== '' || entries.length === 0,
                      onClick: () => {
                        if (!clearArmed) {
                          setClearArmed(true)
                          clearTimeout(clearArmRef.current)
                          clearArmRef.current = setTimeout(() => setClearArmed(false), 4000)
                          return
                        }
                        clearTimeout(clearArmRef.current)
                        clearArmRef.current = null
                        setClearArmed(false)
                        void command({ action: 'clear' })
                      },
                    }, clearArmed ? t('confirmClear') : t('clear')),
                  ])
                : null,
            ]),
          ]) : null,

          h('button', {
            className: 'mc-pill', key: 'pill', type: 'button',
            onClick: () => setOpen((value) => !value),
            'aria-expanded': open,
            'aria-label': t('open'),
            title: t('open'),
          }, [
            h('span', { className: 'mc-dot', key: 'dot', style: { background: statusColor(status) } }),
            h('span', { key: 'label' }, t('title')),
          ]),
        ]),
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register(NS, DICT), 'meeting-captions: locale')
        } catch (error) {
          console.warn('[meeting-captions] locale registration failed', error)
        }
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'meeting-captions',
          order: 40,
          label: () => (localeId(ctx) === 'zh' ? '实时字幕' : 'Live captions'),
        }, (props) => h(Overlay, { ...props, ctx })))
      },
    }
  },
})
