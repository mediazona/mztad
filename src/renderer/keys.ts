export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '')

export const K = {
  mod: IS_MAC ? '⌘' : 'Ctrl',
  alt: IS_MAC ? '⌥' : 'Alt',
  shift: IS_MAC ? '⇧' : 'Shift',
  enter: '↵',
  combo: (...parts: string[]): string => parts.join(IS_MAC ? '' : '+'),
}
