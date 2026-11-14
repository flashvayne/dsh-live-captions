// Throwaway OpenAI-compatible endpoint used to verify the plugin's local-engine
// path without installing a real local model. Streams a distinctive answer and
// records every request so the test can prove which calls hit "local".
const http = require('node:http')
const fs = require('node:fs')

const port = Number(process.argv[2] ?? 11434)
const logFile = process.argv[3] ?? require('node:path').join(require('node:os').tmpdir(), 'mock-local-llm.log')
fs.writeFileSync(logFile, '')

const server = http.createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    fs.appendFileSync(logFile, `${JSON.stringify({
      at: new Date().toISOString(),
      method: request.method,
      url: request.url,
      body: body.slice(0, 800),
    })}\n`)

    if (!String(request.url).endsWith('/chat/completions')) {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}')
      return
    }

    let payload = {}
    try { payload = JSON.parse(body) } catch { /* keep empty */ }
    const user = payload.messages?.find((message) => message.role === 'user')?.content ?? ''
    const lastLine = String(user).split('\n').filter(Boolean).pop() ?? ''
    const text = `【本地】${lastLine.slice(0, 60)}`

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const parts = text.match(/[\s\S]{1,5}/g) ?? [text]
    let index = 0
    const timer = setInterval(() => {
      if (index >= parts.length) {
        clearInterval(timer)
        response.write('data: [DONE]\n\n')
        response.end()
        return
      }
      const chunk = { id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: parts[index] } }] }
      response.write(`data: ${JSON.stringify(chunk)}\n\n`)
      index += 1
    }, 35)
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock local model listening on http://127.0.0.1:${port}/v1 (log: ${logFile})`)
})
