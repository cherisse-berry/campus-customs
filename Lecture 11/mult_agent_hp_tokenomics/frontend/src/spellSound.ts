/** Short synthesized “spell complete” chime (no audio file needed). */

let sharedCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!sharedCtx) sharedCtx = new AC()
  return sharedCtx
}

function tone(
  ctx: AudioContext,
  freq: number,
  start: number,
  dur: number,
  gain = 0.12,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(g)
  g.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

/** Call from a click/Send handler so later playback is allowed. */
export async function unlockSpellAudio() {
  try {
    const ctx = getCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume()
  } catch {
    // ignore
  }
}

/** Magical arpeggio + soft shimmer when the Headmaster finishes. */
export async function playSpellComplete() {
  try {
    const ctx = getCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') await ctx.resume()

    const t0 = ctx.currentTime + 0.02
    // Rising spell notes (C5–E5–G5–C6)
    const notes = [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => {
      tone(ctx, f, t0 + i * 0.09, 0.35, 0.1, 'triangle')
      tone(ctx, f * 2, t0 + i * 0.09 + 0.02, 0.22, 0.04, 'sine')
    })
    // Soft sparkle dust
    for (let i = 0; i < 6; i += 1) {
      const f = 1200 + Math.random() * 1600
      tone(ctx, f, t0 + 0.28 + i * 0.05, 0.18, 0.025, 'sine')
    }
  } catch {
    // Autoplay / AudioContext quirks — ignore
  }
}

export type ZapKind = 'send' | 'return' | 'step' | 'search' | 'think'

let noiseBuf: AudioBuffer | null = null
let lastZap = 0

function noise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate)
    const ch = noiseBuf.getChannelData(0)
    for (let i = 0; i < ch.length; i += 1) ch[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

const ZAPS: Record<ZapKind, { from: number; to: number; dur: number; gain: number; crackle: number }> = {
  send: { from: 2400, to: 220, dur: 0.22, gain: 0.11, crackle: 0.09 }, // big downward "pew" boss → book
  return: { from: 260, to: 1900, dur: 0.2, gain: 0.09, crackle: 0.07 }, // reverse "bwip" book → boss
  think: { from: 1500, to: 400, dur: 0.16, gain: 0.07, crackle: 0.05 },
  search: { from: 3200, to: 900, dur: 0.1, gain: 0.05, crackle: 0.06 },
  step: { from: 2000, to: 700, dur: 0.07, gain: 0.035, crackle: 0.03 }, // tiny tick for loop steps
}

/** Magical zappy "pew": swept saw through a resonant filter + a crackle of sparks. */
export function playZap(kind: ZapKind = 'step') {
  try {
    const ctx = getCtx()
    if (!ctx || ctx.state !== 'running') return
    const now = ctx.currentTime
    // Bursts of events would turn into mush; space zaps at least 55ms apart.
    if (now - lastZap < 0.055 && kind === 'step') return
    lastZap = now
    const z = ZAPS[kind]
    const t0 = now + 0.005
    const jitter = 1 + (Math.random() - 0.5) * 0.12

    const out = ctx.createGain()
    out.gain.setValueAtTime(0.0001, t0)
    out.gain.exponentialRampToValueAtTime(z.gain, t0 + 0.008)
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + z.dur)
    out.connect(ctx.destination)

    const filt = ctx.createBiquadFilter()
    filt.type = 'bandpass'
    filt.Q.value = 6
    filt.frequency.setValueAtTime(z.from * jitter, t0)
    filt.frequency.exponentialRampToValueAtTime(z.to * jitter, t0 + z.dur)
    filt.connect(out)

    const saw = ctx.createOscillator()
    saw.type = 'sawtooth'
    saw.frequency.setValueAtTime(z.from * jitter, t0)
    saw.frequency.exponentialRampToValueAtTime(z.to * jitter, t0 + z.dur)
    const sq = ctx.createOscillator()
    sq.type = 'square'
    sq.frequency.setValueAtTime((z.from * jitter) / 2, t0)
    sq.frequency.exponentialRampToValueAtTime((z.to * jitter) / 2, t0 + z.dur)
    const sqGain = ctx.createGain()
    sqGain.gain.value = 0.35
    saw.connect(filt)
    sq.connect(sqGain).connect(filt)
    for (const o of [saw, sq]) {
      o.start(t0)
      o.stop(t0 + z.dur + 0.02)
    }

    // Spark crackle: a short burst of high-passed noise.
    const src = ctx.createBufferSource()
    src.buffer = noise(ctx)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 3500
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(z.crackle, t0)
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(0.09, z.dur))
    src.connect(hp).connect(ng).connect(ctx.destination)
    src.start(t0)
    src.stop(t0 + 0.1)

    // A whisper of shimmer on the bigger zaps.
    if (kind === 'send' || kind === 'return') {
      tone(ctx, kind === 'send' ? 1760 : 2093, t0 + z.dur * 0.6, 0.18, 0.03, 'sine')
    }
  } catch {
    // ignore audio quirks
  }
}
