// @ts-nocheck
// Option lists + presets for the <Labubu /> template.
// Every piece of the face is its own input, so a "mood" is just a bundle of choices.

export const EYES = ['open', 'angry', 'sleepy', 'joy', 'heart', 'shock', 'sad', 'wink']
export const BROWS = ['neutral', 'none', 'angry', 'sad', 'raised']

// kind 'grin'  = smile curve with a zigzag row of teeth (the classic Labubu grin)
//      'open'  = open mouth with teeth on top (and optional tongue)
// For 'grin', a negative depth turns the smile into a fanged frown.
export const MOUTHS = {
  grin: { kind: 'grin', halfW: 96, yEnd: 226, depth: 66, teeth: 9, T: 13, v: 3 },
  smile: { kind: 'grin', halfW: 58, yEnd: 268, depth: 24, teeth: 6, T: 9, v: 2 },
  flat: { kind: 'grin', halfW: 44, yEnd: 282, depth: 6, teeth: 5, T: 7, v: 2 },
  frown: { kind: 'grin', halfW: 56, yEnd: 290, depth: -24, teeth: 6, T: 9, v: 2 },
  laugh: { kind: 'open', y0: 266, w: 56, h: 30, sag: 8, teeth: 9, tl: 11, tongue: true },
  oh: { kind: 'open', y0: 272, w: 16, h: 26, sag: 4, teeth: 3, tl: 6, tongue: false },
  wail: { kind: 'open', y0: 268, w: 38, h: 32, sag: -9, teeth: 7, tl: 9, tongue: true },
}

// Mood = eyes + brows + mouth + extras (blush, ear droop, floating doodads).
export const MOODS = {
  classic: { eyes: 'open', brows: 'neutral', mouth: 'grin', blush: false, earTilt: 0, extra: null },
  happy: { eyes: 'open', brows: 'raised', mouth: 'grin', blush: true, earTilt: 0, extra: 'sparkle' },
  sleepy: { eyes: 'sleepy', brows: 'none', mouth: 'smile', blush: false, earTilt: -22, extra: 'zzz' },
  angry: { eyes: 'angry', brows: 'angry', mouth: 'grin', blush: '#ff4b3a', earTilt: -8, extra: 'anger' },
  love: { eyes: 'heart', brows: 'none', mouth: 'laugh', blush: true, earTilt: 4, extra: 'hearts' },
  shocked: { eyes: 'shock', brows: 'raised', mouth: 'oh', blush: false, earTilt: 8, extra: 'shock' },
  sad: { eyes: 'sad', brows: 'sad', mouth: 'wail', blush: false, earTilt: -28, extra: 'tears' },
  cheeky: { eyes: 'wink', brows: 'raised', mouth: 'grin', blush: true, earTilt: 6, extra: 'sparkle' },
}
