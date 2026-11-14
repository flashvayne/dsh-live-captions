/**
 * Model calls on the Host `llm` service: subtitle translation and meeting
 * minutes. The model route comes from the profile's default selection, so the
 * plugin never stores provider credentials of its own.
 */

const LANGUAGE_NAMES = {
  zh: '简体中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  yue: '粤语',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
  pt: 'Português',
}

export function languageName(id) {
  return LANGUAGE_NAMES[id] ?? id
}

export function createLlm({ ctx, config, log }) {
  function selection() {
    const owner = ctx.get('agentDefaultModel')
    if (owner !== undefined) {
      try {
        const current = owner.currentSelection()
        if (current?.provider && current?.model) return current
      } catch (error) {
        log(`llm: default selection unavailable: ${error.message}`)
      }
    }
    if (config.provider && config.model) return { provider: config.provider, model: config.model }
    throw new Error('没有可用的模型路由，请先在模型设置里选择默认模型。')
  }

  /**
   * One non-streaming model call assembled from the text deltas.
   * @param {{system?: string, prompt: string, maxTokens?: number, temperature?: number, signal?: AbortSignal}} request
   */
  async function complete({ system, prompt, maxTokens = 1600, temperature = 0.2, signal }) {
    const llm = ctx.get('llm')
    if (llm === undefined) throw new Error('模型服务未加载')
    const route = selection()
    const messages = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
    let text = ''
    let failure = null
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages,
      temperature,
      maxTokens,
      signal,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
        failure = chunk.reason.failure
      }
    }
    if (failure !== null && failure !== undefined) {
      throw new Error(failure.message || '模型调用失败')
    }
    return text.trim()
  }

  /**
   * Translate a batch of transcript lines, preserving the `[n]` markers.
   * @param {Array<{seq:number, text:string}>} entries
   * @param {string} targetLanguage
   * @param {{context?: string, signal?: AbortSignal}} options
   * @returns {Promise<Map<number, string>>}
   */
  async function translate(entries, targetLanguage, { context = '', signal } = {}) {
    if (entries.length === 0) return new Map()
    const target = languageName(targetLanguage)
    const body = entries.map((entry) => `[${entry.seq}] ${entry.text}`).join('\n')
    const contextBlock = context ? `\n前文（仅供理解，不要翻译）：\n${context}\n` : ''
    const prompt = [
      `把下面每一行会议发言翻译成${target}。`,
      '要求：保留行首的 [数字] 标记；每行输出一条译文；不要合并或拆分条目；只输出译文，不要解释。',
      contextBlock,
      '待翻译：',
      body,
    ].join('\n')

    const output = await complete({
      system: `你是实时会议字幕翻译引擎，只输出译文，目标语言是${target}。`,
      prompt,
      maxTokens: Math.min(2000, 120 + entries.length * 90),
      temperature: 0.1,
      signal,
    })

    const result = new Map()
    for (const line of output.split(/\r?\n/)) {
      const match = /^\s*(?:[-*]\s*)?\[(\d+)\]\s*(.*)$/.exec(line)
      if (match === null) continue
      const seq = Number(match[1])
      const text = match[2].trim()
      if (text !== '') result.set(seq, text)
    }
    if (result.size === 0 && entries.length === 1) {
      const only = output.replace(/^\s*(?:[-*]\s*)?\[\d+\]\s*/, '').trim()
      if (only !== '') result.set(entries[0].seq, only)
    }
    // A batch reply can drop a marker; translate the missing lines one by one
    // so one unparsed line never leaves a subtitle permanently untranslated.
    const missing = entries.filter((entry) => !result.has(entry.seq)).slice(0, 3)
    for (const entry of missing) {
      try {
        const single = await complete({
          system: `你是实时会议字幕翻译引擎，只输出${target}译文。`,
          prompt: `把下面这句话翻译成${target}，只输出译文，不要编号、不要解释：\n${entry.text}`,
          maxTokens: 320,
          temperature: 0.1,
          signal,
        })
        const clean = single.replace(/^\s*(?:[-*]\s*)?\[\d+\]\s*/, '').trim()
        if (clean !== '') result.set(entry.seq, clean)
      } catch {
        // keep it missing: the caller marks it as failed and shows the reason
      }
    }
    return result
  }

  /**
   * Stream one line's translation so the caption can update while tokens
   * arrive, instead of waiting for the complete sentence.
   * @param {string} text
   * @param {string} targetLanguage
   * @param {{context?: string, onDelta?: (partial: string) => void, signal?: AbortSignal}} options
   * @returns {Promise<string>}
   */
  async function translateOne(text, targetLanguage, { context = '', onDelta, signal } = {}) {
    const llm = ctx.get('llm')
    if (llm === undefined) throw new Error('模型服务未加载')
    const route = selection()
    const target = languageName(targetLanguage)
    const system = `你是实时会议字幕翻译引擎。只输出${target}译文，不加序号、不加引号、不解释。`
    const prompt = context
      ? `上文（仅供理解，不要翻译）：${context}\n\n把下面这句话翻译成${target}：\n${text}`
      : `把下面这句话翻译成${target}：\n${text}`
    let raw = ''
    let failure = null
    for await (const chunk of llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature: 0.1,
      maxTokens: 320,
      signal,
    })) {
      if (chunk.type === 'text-delta') {
        raw += chunk.text
        const visible = cleanTranslation(raw)
        if (visible !== '') onDelta?.(visible)
      } else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
        failure = chunk.reason.failure
      }
    }
    if (failure !== null && failure !== undefined) throw new Error(failure.message || '模型调用失败')
    return cleanTranslation(raw)
  }

  const MINUTES_SYSTEM = [
    '你是会议纪要助手。你拿到的是会议中的语音转写片段，可能包含识别错误、口语重复和无关寒暄。',
    '请输出结构化的中文 Markdown 会议纪要，不要编造转写里没有的事实；无法确定的信息标注“待确认”。',
    '结构固定为：## 会议概要 / ## 主要议题 / ## 关键结论 / ## 待办事项 / ## 风险与待确认。',
    '待办事项用表格（负责人 | 事项 | 截止时间），没有明确负责人或时间就写“待确认”。',
  ].join('\n')

  /** Summarise one transcript chunk (map step). */
  async function summarizeChunk(text, index, total, signal) {
    return complete({
      system: MINUTES_SYSTEM,
      prompt: `这是会议转写的第 ${index}/${total} 部分，请提炼事实要点（时间、人物、数字、决定、待办）。\n\n${text}`,
      maxTokens: 900,
      temperature: 0.2,
      signal,
    })
  }

  /**
   * Reduce a transcript to a structured minutes document.
   * @param {string} transcript
   * @param {{signal?: AbortSignal, title?: string}} options
   */
  async function minutes(transcript, { signal, title } = {}) {
    const text = transcript.trim()
    if (text === '') throw new Error('还没有可总结的转写内容。')
    const chunkSize = 9000
    let material = text
    if (text.length > chunkSize) {
      const chunks = []
      for (let offset = 0; offset < text.length; offset += chunkSize) {
        chunks.push(text.slice(offset, offset + chunkSize))
      }
      const parts = []
      for (let index = 0; index < chunks.length; index += 1) {
        parts.push(await summarizeChunk(chunks[index], index + 1, chunks.length, signal))
      }
      material = parts.join('\n\n')
    }
    const heading = title ? `会议标题（用户提供）：${title}\n` : ''
    return complete({
      system: MINUTES_SYSTEM,
      prompt: `${heading}根据以下会议材料写出完整纪要：\n\n${material}`,
      maxTokens: 2200,
      temperature: 0.3,
      signal,
    })
  }

  return { complete, translate, translateOne, minutes, selection }
}

/** Strip numbering, lead-ins and wrapping quotes a model may add. */
export function cleanTranslation(value) {
  let text = String(value ?? '')
  text = text.replace(/^\s*(?:[-*]\s*)?\[\d+\]\s*/, '')
  text = text.replace(/^\s*(?:译文|翻译|translation)\s*[:：]\s*/i, '')
  const quoted = /^["“「']([\s\S]*)["”」']$/.exec(text.trim())
  if (quoted !== null) text = quoted[1]
  return text.trim()
}
