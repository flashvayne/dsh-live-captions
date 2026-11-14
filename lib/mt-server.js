/**
 * Built-in offline translation, isolated in its own Node process.
 *
 * ONNX Runtime is a native dependency and a fault there must never take the
 * Host down with it, so this script runs in a child process (Electron's Node
 * mode) and talks newline-delimited JSON over stdin/stdout.
 *
 * stdin:  {"type":"translate","id":1,"text":"...","src":"en","tgt":"zh"}
 * stdout: {"type":"ready"} | {"type":"progress","payload":{...}}
 *         {"type":"result","id":1,"text":"..."} | {"type":"error","id":1,"error":"..."}
 *         {"type":"fatal","error":"..."}
 */
import { env, pipeline } from '@huggingface/transformers'

const cacheDir = process.env.MT_CACHE_DIR ?? './models'
const remoteHost = process.env.MT_REMOTE_HOST ?? 'https://hf-mirror.com'
const model = process.env.MT_MODEL ?? 'Xenova/m2m100_418M'

env.cacheDir = cacheDir
env.remoteHost = remoteHost
env.allowRemoteModels = true

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

let translator = null
const queue = []
let busy = false

async function pump() {
  if (busy || translator === null) return
  busy = true
  try {
    while (queue.length > 0) {
      const job = queue.shift()
      try {
        const output = await translator(job.text, {
          src_lang: job.src,
          tgt_lang: job.tgt,
          max_new_tokens: 192,
        })
        send({ type: 'result', id: job.id, text: output?.[0]?.translation_text ?? '' })
      } catch (error) {
        send({ type: 'error', id: job.id, error: String(error?.message ?? error) })
      }
    }
  } finally {
    busy = false
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.type === 'translate') {
      queue.push(message)
      void pump()
    }
  }
})
process.stdin.on('end', () => process.exit(0))

// If the Host dies without killing this process (crash, force-quit), the pipe
// may stay open long enough for a 600 MB model to linger. Watch the parent.
const parentPid = process.ppid
setInterval(() => {
  try {
    process.kill(parentPid, 0)
  } catch {
    process.exit(0)
  }
}, 5000).unref()

try {
  translator = await pipeline('translation', model, {
    dtype: 'q8',
    device: 'cpu',
    progress_callback: (payload) => send({ type: 'progress', payload }),
  })
  send({ type: 'ready' })
  void pump()
} catch (error) {
  send({ type: 'fatal', error: String(error?.message ?? error) })
  process.exitCode = 1
}
