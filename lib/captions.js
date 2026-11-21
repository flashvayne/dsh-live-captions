/**
 * Caption sentence rules.
 *
 * Audio is captured in segments, not in sentences: the helper cuts at a pause
 * when it hears one and otherwise at a hard cap. A hard cut lands inside a word,
 * so the next segment's text is the continuation of the previous caption. These
 * helpers decide when that happens and how the two halves are joined.
 */

/** Text that ends in a Latin letter or digit needs a space before more of it. */
const LATIN_TAIL = /[A-Za-z0-9]$/
const LATIN_HEAD = /^[A-Za-z0-9]/

/**
 * Join two caption halves. Chinese/Japanese/Korean text is concatenated as is;
 * two Latin halves get the space the cut swallowed ("real" + "time" must not
 * become "realtime").
 */
export function mergeCaptionText(previous, addition) {
  const left = String(previous ?? '').trimEnd()
  const right = String(addition ?? '').trimStart()
  if (left === '') return right
  if (right === '') return left
  if (LATIN_TAIL.test(left) && LATIN_HEAD.test(right)) return `${left} ${right}`
  return left + right
}

/** A caption that is still waiting for the rest of its utterance. */
export function shouldMergeCaption(previous, text) {
  if (previous === null || previous === undefined) return false
  if (previous.awaitingMore !== true) return false
  if (typeof text !== 'string' || text.trim() === '') return false
  // A runaway utterance must not become one endless caption.
  if (String(previous.text ?? '').length >= 260) return false
  return true
}
