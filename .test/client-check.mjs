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

// Lyric history window maths.
const { lyricWindow, nextAnchor } = plugin.__test ?? {}
if (lyricWindow === undefined || nextAnchor === undefined) throw new Error('lyric helpers missing')
const entries = [1, 2, 3, 4, 5].map((seq) => ({ seq, text: `line ${seq}`, translation: null }))
const seqs = (list) => list.map((entry) => entry.seq).join(',')

const live1 = lyricWindow(entries, null, 1)
if (seqs(live1.visible) !== '5' || live1.inHistory) throw new Error(`live window wrong: ${seqs(live1.visible)}`)
const live2 = lyricWindow(entries, null, 2)
if (seqs(live2.visible) !== '4,5') throw new Error(`two-line live window wrong: ${seqs(live2.visible)}`)
const history = lyricWindow(entries, 3, 2)
if (seqs(history.visible) !== '2,3' || !history.inHistory) throw new Error(`history window wrong: ${seqs(history.visible)}`)
const pinnedLatest = lyricWindow(entries, 5, 1)
if (seqs(pinnedLatest.visible) !== '5' || pinnedLatest.inHistory) throw new Error('anchor at latest should be live')

if (nextAnchor(entries, null, -1) !== 4) throw new Error('wheel up from live should go to seq 4')
if (nextAnchor(entries, 4, -1) !== 3) throw new Error('wheel up should step back')
if (nextAnchor(entries, 3, 1) !== 4) throw new Error('wheel down should step forward')
if (nextAnchor(entries, 4, 1) !== null) throw new Error('wheel down at the end should return to live')
if (nextAnchor(entries, null, 1) !== null) throw new Error('live + newer stays live')
if (nextAnchor([], null, -1) !== null) throw new Error('empty list stays live')

for (const { label, disposer } of recorded.effects) {
  if (typeof disposer !== 'function') throw new Error(`effect ${label} has no disposer`)
  disposer()
}

console.log('client bundle: OK')
console.log(`  slot: ${recorded.slot.id} order ${recorded.slot.order}`)
console.log(`  locale ns: ${recorded.locale.ns}, dictionary keys checked: ${keys.size}`)
console.log('  render: root tree built, effects disposable')
console.log('  lyric window: live/history/anchor maths verified')
