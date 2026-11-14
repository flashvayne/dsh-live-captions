import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from './lib/api.js'
import { MeetingController } from './lib/controller.js'

const LOG_LIMIT = 2 * 1024 * 1024

function resolveDataRoot(config) {
  if (typeof config?.dataRoot === 'string' && config.dataRoot !== '') return config.dataRoot
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'meeting-captions')
}

function createLogger(dataRoot) {
  const directory = join(dataRoot, 'logs')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'meeting-captions.log')
  let writable = true
  try {
    if (statSync(file).size > LOG_LIMIT) appendFileSync(file, '')
  } catch {
    // file does not exist yet
  }
  return (message) => {
    const line = `${new Date().toISOString()} ${message}`
    if (writable) {
      try {
        appendFileSync(file, `${line}\n`)
      } catch {
        writable = false
      }
    }
    console.log(`[meeting-captions] ${message}`)
  }
}

const TOOL_NAME = 'meeting_captions'

/** JSON-schema for the single agent-facing tool. */
const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['start', 'stop', 'status', 'prepare', 'minutes', 'settings'],
      description: 'start/stop 控制实时字幕；status 读取状态；prepare 下载识别模型；minutes 生成会议纪要；settings 修改来源或语言。',
    },
    source: {
      type: 'string',
      enum: ['both', 'speaker', 'mic'],
      description: '音频来源：both=系统声音+麦克风，speaker=仅系统声音（扬声器），mic=仅麦克风。',
    },
    sourceLanguage: {
      type: 'string',
      description: '识别语言提示：auto/zh/en/yue/ja/ko。',
    },
    targetLanguage: {
      type: 'string',
      description: '字幕目标语言，例如 zh、en、ja、ko。',
    },
    translate: {
      type: 'boolean',
      description: '是否把字幕翻译成目标语言。',
    },
    translateEngine: {
      type: 'string',
      enum: ['cloud', 'builtin', 'local'],
      description: '翻译引擎：cloud=云端默认模型；builtin=插件内置的离线多语种模型；local=本机 OpenAI 兼容服务（Ollama/LM Studio 等）。会议纪要始终用云端模型。',
    },
    offlineMode: {
      type: 'boolean',
      description: '一键离线：字幕识别与翻译全部在本机完成（内置模型），此模式下会议纪要不可用。',
    },
    localBaseUrl: {
      type: 'string',
      description: '本地模型的 OpenAI 兼容地址，例如 http://127.0.0.1:11434/v1（Ollama）。',
    },
    localModel: {
      type: 'string',
      description: '本地模型名，例如 qwen2.5:7b（Ollama）或你加载的模型 id。',
    },
    title: {
      type: 'string',
      description: '生成会议纪要时可选的会议标题。',
    },
  },
  required: ['action'],
  additionalProperties: false,
}

function summarize(state) {
  const lines = []
  const statusText = {
    idle: '未运行',
    preparing: '正在准备识别模型',
    starting: '正在启动采集',
    running: '正在采集',
    stopping: '正在停止',
    error: '出错',
  }[state.status] ?? state.status
  lines.push(`状态：${statusText}${state.error ? `（${state.error}）` : ''}`)
  lines.push(`识别：${state.asr.providerName ?? '未知'} / ${state.asr.phase}${state.asr.message ? `（${state.asr.message}）` : ''}`)
  lines.push(`来源：${state.settings.source}；识别语言：${state.settings.sourceLanguage}；字幕语言：${state.targetLabel}`)
  lines.push(`翻译：${state.engine?.label ?? '未知'}${state.offline ? '（离线模式，会议纪要不可用）' : '（会议纪要固定用云端模型）'}`)
  if (state.mt && state.mt.state !== 'ready' && (state.offline || state.settings.translateEngine === 'builtin')) {
    const progress = state.mt.progress ?? {}
    const percent = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : null
    lines.push(`内置翻译模型：${state.mt.state}${percent === null ? '' : ` ${percent}%`}${state.mt.error ? `（${state.mt.error}）` : ''}`)
  }
  if (state.session !== null) {
    lines.push(`本次：${state.session.segments} 段 / ${state.totalEntries} 条字幕`)
  }
  if (state.entries.length > 0) {
    const recent = state.entries.slice(-6)
    lines.push('最近字幕：')
    for (const entry of recent) {
      lines.push(`- [${entry.at}] ${entry.text}${entry.translation ? ` → ${entry.translation}` : ''}`)
    }
  }
  if (state.minutes.error) lines.push(`纪要错误：${state.minutes.error}`)
  if (state.minutes.path) lines.push(`纪要文件：${state.minutes.path}`)
  return lines.join('\n')
}

export function apply(ctx, config) {
  const dataRoot = resolveDataRoot(config)
  mkdirSync(dataRoot, { recursive: true })
  const log = createLogger(dataRoot)
  log(`plugin activated, dataRoot=${dataRoot}`)

  const controller = new MeetingController({ ctx, config: config ?? {}, dataRoot, log })

  ctx.effect(() => () => {
    log('plugin unloading')
    void controller.dispose()
  }, 'meeting-captions: controller')

  // Both the API and the agent tool depend on services that may not exist yet
  // during a cold boot; `ctx.inject` registers them as soon as each appears.
  ctx.inject(['webServer'], (scoped) => {
    const dispose = registerApi({ ctx: scoped, controller, log })
    scoped.effect(() => dispose, 'meeting-captions: api')
  })

  ctx.inject(['tools'], (scoped) => {
    const tools = scoped.tools
    const dispose = tools.register({
      name: TOOL_NAME,
      description: '控制本机实时多语言字幕：采集系统声音/麦克风、识别语音、翻译字幕、生成会议纪要。不传 action 之外的参数时沿用已保存的设置。',
      parameters: TOOL_PARAMETERS,
      timeoutMs: 180000,
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            summary: { type: 'string' },
            minutes: { type: 'string' },
            path: { type: 'string' },
          },
          required: ['ok', 'summary'],
        },
        render: (_args, value) => {
          const blocks = [{ type: 'text', text: String(value?.summary ?? '') }]
          if (value?.minutes) blocks.push({ type: 'text', text: String(value.minutes) })
          if (value?.path) blocks.push({ type: 'text', text: `纪要文件：${value.path}` })
          return blocks
        },
      },
      execute: async (args) => {
        const input = args ?? {}
        const action = input.action
        if (action === 'settings') {
          controller.updateSettings({
            source: input.source,
            sourceLanguage: input.sourceLanguage,
            targetLanguage: input.targetLanguage,
            translate: input.translate,
            translateEngine: input.translateEngine,
            offlineMode: input.offlineMode,
            localBaseUrl: input.localBaseUrl,
            localModel: input.localModel,
          })
          const state = controller.state(0)
          return { ok: true, summary: summarize(state) }
        }
        if (action === 'status') {
          const state = controller.state(0)
          return { ok: true, summary: summarize(state) }
        }
        if (action === 'prepare') {
          const result = controller.prepare()
          return { ok: result.ok !== false, summary: result.ok === false ? `准备失败：${result.error}` : `已开始准备识别模型（${result.providerId}），可从面板查看进度。` }
        }
        if (action === 'start') {
          if (input.source || input.targetLanguage || input.sourceLanguage || input.translate !== undefined
            || input.translateEngine || input.offlineMode !== undefined || input.localBaseUrl || input.localModel) {
            controller.updateSettings({
              source: input.source,
              sourceLanguage: input.sourceLanguage,
              targetLanguage: input.targetLanguage,
              translate: input.translate,
              translateEngine: input.translateEngine,
              offlineMode: input.offlineMode,
              localBaseUrl: input.localBaseUrl,
              localModel: input.localModel,
            })
          }
          const result = controller.start()
          return {
            ok: result.ok !== false,
            summary: result.ok === false
              ? `启动失败：${result.error}`
              : `已开始：${result.note ?? '正在准备识别模型，准备好后自动开始采集。'}\n\n${summarize(controller.state(0))}`,
          }
        }
        if (action === 'stop') {
          const result = await controller.stop()
          return { ok: result.ok !== false, summary: `已停止。\n\n${summarize(controller.state(0))}` }
        }
        if (action === 'minutes') {
          const result = await controller.generateMinutes({ title: input.title })
          return {
            ok: true,
            summary: `已生成会议纪要并保存到 ${result.path}`,
            minutes: result.text,
            path: result.path,
          }
        }
        return { ok: false, summary: `未知操作：${String(action)}` }
      },
    }, {})
    scoped.effect(() => dispose, 'meeting-captions: tool')
  })
}
