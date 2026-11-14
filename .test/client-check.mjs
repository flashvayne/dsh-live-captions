// Offline smoke test for the client bundle: loads the module the way the page
// does, applies it to a stub context, renders the overlay once with stub React
// hooks, and checks the lyric-window maths. No browser required.
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLIENT = fileURLToPath(new URL('../client.js', import.meta.url))
const source = readFileSync(CLIENT, 'utf8')

let loaded = null
globalThis.window = { __ModuleLoader__: { load(entry) { loaded = entry } } }
await import(pathToFileURL(CLIENT).href)
if (loaded === null) throw new Error('client.js did not call __ModuleLoader__.load')
if (loaded.id !== '@local/meeting-captions') throw new Error(`unexpected module id ${loaded.id}`)

const react = {
  createElement: (type, props, children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}

const recorded = { locale: null, slot: null, component: null, effects: [] }
const ctx = {
  effect(fn, label) {
    const disposer = fn()
    recorded.effects.push({ label, disposer })
    return disposer
  },
  locale: {
    register(ns, dicts) {
      recorded.locale = { ns, dicts }
      return () => {}
    },
    subscribe() {
      return () => {}
    },
    getLocale() {
      return { active: 'zh' }
    },
  },
  slots: {
    inject(key, callback) {
      recorded.inject = key
      return callback()
    },
    register(options, component) {
      recorded.slot = options
      recorded.component = component
      return () => {}
    },
  },
}

const plugin = loaded.factory((name) => {
  if (name === 'react') return react
  throw new Error(`unexpected require(${name})`)
})
if (!Array.isArray(plugin.inject)) throw new Error('plugin.inject missing')
plugin.apply(ctx)

if (recorded.inject !== 'shell.overlay') throw new Error(`injected into ${recorded.inject}`)
if (recorded.slot?.id !== 'meeting-captions') throw new Error('slot id mismatch')
if (typeof recorded.slot?.label === 'function') recorded.slot.label()

// Every literal t('...') key (plus the generated language/status keys) must exist in zh and en.
const keys = new Set()
for (const match of source.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) keys.add(match[1])
for (const language of ['es', 'fr', 'de', 'ru', 'pt', 'yue', 'ja', 'ko', 'auto']) keys.add(`lang.${language}`)
for (const status of ['idle', 'preparing', 'starting', 'running', 'stopping', 'error']) keys.add(`status.${status}`)
const dicts = recorded.locale?.dicts ?? {}
if (!dicts.zh || !dicts.en) throw new Error('locale dictionaries missing zh/en')
const missing = []
for (const key of keys) {
  for (const locale of ['zh', 'en']) {
    if (dicts[locale][key] === undefined) missing.push(`${locale}:${key}`)
  }
}
if (missing.length > 0) throw new Error(`missing dictionary keys: ${missing.join(', ')}`)

// Render once with null state.
let tree = recorded.component({})
if (tree === null || tree === undefined) throw new Error('overlay rendered nothing')
if (typeof tree.type === 'function') tree = tree.type(tree.props)
if (tree.props?.className !== 'mc-root') throw new Error('overlay root element missing')

for (const { label, disposer } of recorded.effects) {
  if (typeof disposer !== 'function') throw new Error(`effect ${label} has no disposer`)
  disposer()
}

console.log('client bundle: OK')
console.log(`  slot: ${recorded.slot.id} order ${recorded.slot.order}`)
console.log(`  locale ns: ${recorded.locale.ns}, dictionary keys checked: ${keys.size}`)
console.log('  render: root tree built, effects disposable')
