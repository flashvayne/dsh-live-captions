// Drive the translation child process exactly like the plugin does:
// spawn Electron in Node mode, wait for {"type":"ready"}, translate, report.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const server = fileURLToPath(new URL('../lib/mt-server.js', import.meta.url))
const child = spawn(process.env.DSH_NODE_EXECUTABLE ?? process.execPath, [server], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    MT_CACHE_DIR: `${process.env.USERPROFILE}/.dsh/live-captions/models/mt`,
    MT_REMOTE_HOST: 'https://hf-mirror.com',
    MT_MODEL: 'Xenova/m2m100_418M',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
})

const started = Date.now()
let buffer = ''
let sent = false

child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line === '') continue
    const message = JSON.parse(line)
    if (message.type === 'ready') {
      console.log(`ready after ${Date.now() - started}ms`)
      child.stdin.write(`${JSON.stringify({ type: 'translate', id: 1, text: 'The budget review is done. We approved the hiring plan.', src: 'en', tgt: 'zh' })}\n`)
      sent = true
    } else if (message.type === 'result') {
      console.log(`result id=${message.id} in ${Date.now() - started}ms: ${message.text}`)
      child.kill()
      process.exit(0)
    } else if (message.type === 'error') {
      console.log(`error: ${message.error}`)
      child.kill()
      process.exit(1)
    } else if (message.type === 'fatal') {
      console.log(`fatal: ${message.error}`)
      child.kill()
      process.exit(1)
    }
  }
})

child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => process.stderr.write(chunk))

child.on('exit', (code) => {
  if (!sent) console.log(`child exited early code=${code}`)
})
setTimeout(() => {
  console.log('timeout')
  child.kill()
  process.exit(2)
}, 180000)
