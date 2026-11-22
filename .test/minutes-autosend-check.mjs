// Offline interaction test for the minutes auto-send flow (wire-first design).
//
// Simulates the exact surfaces runMinutesAutoSend touches:
//   - uiWorkspace: workspaces.list snapshot, mainReference, openSession()
//   - sessions (ClientSessions): create(), retain() -> { ready, release,
//     binding.session.prompt(content, mode) }
//
// The OLD failure mode (slow new-session window > poll window) cannot recur
// by construction: there is no polling and no composer draft involved.
// Scenarios covered:
//   1. happy path — prompt goes to the NEW session via Remote prompt RPC,
//      old session untouched, openSession reveals the new id, no draft calls.
//   2. create failure — returns { ok:false, reason:'create-failed' }.
//   3. prompt rejection — returns { ok:false, reason:'prompt-rejected' }.
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const start = source.indexOf('async function runMinutesAutoSend')
const end = source.indexOf('\n}', start) + 2
// Grab the function plus nothing else from module scope; expose it manually.
const fnSource = source.slice(start, end)
const runMinutesAutoSend = new Function(`${fnSource}; return runMinutesAutoSend`)()

const OLD = 'session-old'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeMocks({ createError, promptResult, slowReadyMs = 0 } = {}) {
  const state = { created: [], prompts: [], opened: [], drafts: [], released: 0 }
  const workspace = {
    workspaces: { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: [OLD] }] }) } },
    mainReference: { sessionId: OLD },
    openSession: (id) => { state.opened.push(id) },
    startSession: (wid, opts) => { state.drafts.push(opts) },
  }
  const sessions = {
    create: async (opts) => {
      await sleep(5)
      if (createError) throw createError
      const id = `new-${state.created.length + 1}`
      state.created.push({ id, opts })
      return id
    },
    retain: (id) => {
      const reference = {
        sessionId: id,
        ready: (async () => { await sleep(slowReadyMs); return true })(),
        binding: {
          sessionId: id,
          session: {
            prompt: async (content, mode) => {
              state.prompts.push({ id, content, mode })
              return promptResult ?? { ok: true }
            },
          },
        },
        release: () => { state.released += 1 },
      }
      return reference
    },
  }
  return { workspace, sessions, state }
}

// 1. Happy path.
{
  const { workspace, sessions, state } = makeMocks()
  const result = await runMinutesAutoSend(workspace, sessions, 'MINUTES PROMPT')
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`)
  assert.match(result.sessionId, /^new-/)
  assert.equal(state.created.length, 1)
  assert.deepEqual(state.created[0].opts, { workspaceId: 'ws-1' }, 'must create in the current workspace')
  assert.equal(state.prompts.length, 1, 'exactly one prompt')
  assert.equal(state.prompts[0].id, result.sessionId, 'prompt must target the NEW session')
  assert.deepEqual(state.prompts[0].content, [{ type: 'text', text: 'MINUTES PROMPT' }])
  assert.equal(state.prompts[0].mode, 'queue', 'composer parity: mode queue')
  assert.deepEqual(state.opened, [result.sessionId], 'must reveal the new session')
  assert.equal(state.drafts.length, 0, 'no composer draft prefill on success')
  assert.equal(state.released, 1, 'retained reference must be released')
  assert.ok(OLD !== state.prompts[0].id)
}

// 1b. Happy path with a slow reference (simulates a slow environment):
//     the flow simply awaits `ready`; total time reflects the wait, and the
//     prompt still lands exactly once in the NEW session.
{
  const { workspace, sessions, state } = makeMocks({ slowReadyMs: 900 })
  const t0 = Date.now()
  const result = await runMinutesAutoSend(workspace, sessions, 'P')
  const elapsed = Date.now() - t0
  assert.equal(result.ok, true)
  assert.ok(elapsed >= 850, `must await readiness (elapsed ${elapsed}ms)`)
  assert.equal(state.prompts.length, 1)
  assert.equal(state.prompts[0].id, result.sessionId)
}

// 2. create failure.
{
  const { workspace, sessions, state } = makeMocks({ createError: new Error('boom') })
  const result = await runMinutesAutoSend(workspace, sessions, 'P')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'create-failed')
  assert.equal(state.prompts.length, 0)
  assert.equal(state.opened.length, 0)
}

// 3. prompt rejection.
{
  const { workspace, sessions, state } = makeMocks({ promptResult: { ok: false, error: { code: 'session/x', message: 'nope' } } })
  const result = await runMinutesAutoSend(workspace, sessions, 'P')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'prompt-rejected')
  assert.equal(state.opened.length, 0, 'must not navigate when the prompt was rejected')
  assert.equal(state.released, 1)
}

console.log('minutes-autosend-check: PASS (wire-first: create -> Remote prompt -> reveal)')
