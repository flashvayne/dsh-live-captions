const PREFIX = '/meeting-captions/api'
const MAX_BODY = 64 * 1024

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/**
 * Same-origin JSON API used by the Web panel: one poll endpoint plus one
 * command endpoint. The agent tool drives the same controller methods.
 */
export function registerApi({ ctx, controller, log }) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    log('api: web server unavailable, the panel will not be able to poll')
    return () => {}
  }

  const handler = async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(PREFIX)) {
        json(response, 404, { ok: false, error: 'not found' })
        return
      }
      const route = url.pathname.slice(PREFIX.length) || '/'

      if (request.method === 'GET' && (route === '/state' || route === '/')) {
        const since = Number(url.searchParams.get('since') ?? '0')
        json(response, 200, { ok: true, state: controller.state(Number.isFinite(since) ? since : 0) })
        return
      }

      if (request.method === 'GET' && route === '/sessions') {
        json(response, 200, { ok: true, sessions: controller.listSessions() })
        return
      }

      if (request.method === 'GET' && route === '/records') {
        const sessions = controller.listSessions()
        const requested = url.searchParams.get('session')
        const sessionId = requested !== null && requested !== '' ? requested : sessions[0]?.id
        if (sessionId === undefined || sessionId === null) {
          json(response, 200, { ok: true, sessionId: null, sessions, records: { entries: [] } })
          return
        }
        json(response, 200, {
          ok: true,
          sessionId,
          sessions,
          records: controller.readRecords(sessionId),
        })
        return
      }

      if (request.method === 'POST' && route === '/command') {
        const body = await readJson(request)
        const action = typeof body.action === 'string' ? body.action : ''
        let result
        switch (action) {
          case 'start':
            result = controller.start()
            break
          case 'stop':
            result = await controller.stop()
            break
          case 'prepare':
            result = controller.prepare()
            break
          case 'clear':
            controller.clear()
            result = { ok: true }
            break
          case 'install_mt_deps': {
            const install = controller.installMtDeps()
            install.catch((error) => log(`mt deps install failed: ${error.message}`))
            result = { ok: true, installing: true }
            break
          }
          case 'settings':
            controller.updateSettings(body.settings ?? {})
            result = { ok: true }
            break
          case 'minutes': {
            const minutes = controller.generateMinutes({ title: body.title })
            minutes.catch((error) => log(`minutes failed: ${error.message}`))
            result = { ok: true, generating: true }
            break
          }
          default:
            json(response, 400, { ok: false, error: `未知操作：${action}` })
            return
        }
        if (result?.ok === false) {
          json(response, 409, { ok: false, error: result.error ?? '操作失败', state: controller.state(0) })
          return
        }
        const since = Number(body.since ?? 0)
        json(response, 200, { ok: true, result, state: controller.state(Number.isFinite(since) ? since : 0) })
        return
      }

      json(response, 405, { ok: false, error: '不支持的请求' })
    } catch (error) {
      log(`api: ${error.message}`)
      try {
        json(response, 500, { ok: false, error: error.message })
      } catch {
        // response already sent
      }
    }
  }

  try {
    return webServer.register({ kind: 'prefix', path: PREFIX, handler })
  } catch (error) {
    log(`api: registration failed: ${error.message}`)
    return () => {}
  }
}
