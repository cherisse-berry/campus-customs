// @ts-nocheck — copied from labubu_lab (plain JS), kept untyped on purpose
import { useId } from 'react'
import { MOODS, MOUTHS } from './labubuPresets.ts'

/*
  <Labubu /> — a plush-in-a-hood Labubu, drawn in SVG.

  Colors:  fur (hood/ears/body), face (face/paws/feet/inner ears), nose, eyeColor, teeth, mouthColor
  Face:    eyes, brows, mouth   (see labubuPresets.js for the options)
  Mood:    a preset that picks eyes/brows/mouth + blush, ear droop and floating extras.
           Any of eyes / brows / mouth / blush / earTilt / extra passed directly wins over the mood.
*/

const INK = '#1c1118'
const CX = 136 // center line of the drawing (everything mirrors around it)
const EYE_L = 94
const EYE_R = 2 * CX - EYE_L
const EYE_Y = 238

const HEART = 'M0 9 C -18 -4 -13 -18 0 -9 C 13 -18 18 -4 0 9 Z'
const STAR = 'M0 -8 Q1.2 -1.2 8 0 Q1.2 1.2 0 8 Q-1.2 1.2 -8 0 Q-1.2 -1.2 0 -8Z'

// ---------- geometry helpers (all computed once) ----------

// Deterministic jitter, so the fur looks hand-scruffed but never changes between renders.
const rnd = (i, seed) => {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return x - Math.floor(x)
}

const poly = (list) => list.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')

// An ellipse whose outline alternates between the base curve and little outward fur tufts.
function furEllipse(cx, cy, rx, ry, n, amp, seed) {
  const out = []
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 0.5) / n) * Math.PI * 2
    const k = amp * (0.4 + rnd(i, seed))
    out.push([cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)])
    out.push([cx + (rx + k) * Math.cos(a1), cy + (ry + k) * Math.sin(a1)])
  }
  return `M${poly(out)} Z`
}

const ticks = (list) => list.map(([x, y, dx, dy]) => `M${x} ${y} l${dx} ${dy}`).join(' ')

const HOOD = furEllipse(CX, 214, 124, 98, 48, 6, 3)
const BODY = furEllipse(CX, 385, 68, 76, 34, 5, 7)
const ARM = furEllipse(0, 0, 19, 42, 22, 4, 11)
const FACE =
  'M36 232 C36 190 82 166 136 166 C190 166 236 190 236 232 C236 278 192 304 136 304 C80 304 36 278 36 232 Z'

// Fur that hangs over the top of the face opening.
const faceTop = (x) => 232 - 66 * Math.sqrt(Math.max(0, 1 - ((x - CX) / 100) ** 2))
const FRINGE = (() => {
  const xs = []
  for (let x = 48; x <= 224; x += 8) xs.push(x)
  const upper = xs.map((x) => [x, faceTop(x) - 4])
  const zig = xs.map((x, i) => [x, faceTop(x) + (i % 2 ? 9 + rnd(i, 5) * 6 : 2)])
  return { fill: `M${poly([...upper, ...[...zig].reverse()])} Z`, edge: `M${poly(zig)}` }
})()

const BODY_TICKS = ticks([
  [98, 352, -3, 10], [172, 348, 3, 10], [92, 392, -3, 9], [182, 396, 3, 9],
  [112, 372, -2, 8], [160, 374, 2, 8], [104, 416, -2, 8], [168, 414, 2, 8],
])
const HOOD_TICKS = ticks([
  [92, 138, 9, 4], [176, 140, 9, -2], [136, 132, 7, 3],
  [24, 226, 2, 10], [248, 222, -2, 10], [30, 190, 4, 8], [242, 188, -4, 8],
])

// ---------- mirror helpers ----------

const Mirror = ({ children }) => (
  <g transform={`translate(${2 * CX} 0) scale(-1 1)`}>{children}</g>
)
// Draw the same shape on both sides of the center line.
const Pair = ({ children }) => (
  <>
    {children}
    <Mirror>{children}</Mirror>
  </>
)

// ---------- body parts ----------

function Ear({ fur, inner, tilt }) {
  return (
    <g transform={`rotate(${tilt} 91 130)`}>
      <path
        d="M52 146 L52 122 C46 84 58 34 86 14 C100 4 116 8 122 34 C128 60 130 92 130 124 L130 146 Z"
        fill={fur}
        stroke={INK}
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="M66 132 C62 90 72 46 91 28 C104 24 112 50 114 80 C115 100 115 116 115 132 Z"
        fill={inner}
        stroke={INK}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M88 132 C88 108 92 94 100 94 C108 94 112 108 112 132 Z"
        fill={fur}
        stroke={INK}
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M58 60 l4 8 M60 96 l3 8" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  )
}

function Foot({ face }) {
  return (
    <path
      d="M84 452 Q84 448 92 448 L122 448 Q130 448 130 454 L130 470 L124 480 L118 471 L112 481 L106 471 L100 481 L94 471 L88 480 L84 470 Z"
      fill={face}
      stroke={INK}
      strokeWidth="3"
      strokeLinejoin="round"
    />
  )
}

function Arm({ fur, face }) {
  return (
    <g transform="translate(44 366) rotate(14)">
      <path d={ARM} fill={fur} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="0" cy="40" rx="14" ry="12" fill={face} stroke={INK} strokeWidth="2.8" />
      <path d="M-5 44 q4 3 8 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M-4 14 l-2 8 M5 8 l2 8" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  )
}

// ---------- face parts ----------

function OpenEye({ cx, color, big = false }) {
  return (
    <g>
      <ellipse cx={cx} cy={EYE_Y} rx="21" ry="28" fill="#fff" stroke={INK} strokeWidth="3" />
      <ellipse cx={cx} cy={EYE_Y + 1} rx="16.5" ry="23.5" fill={color} />
      <circle cx={cx - 6} cy={EYE_Y - 9} r={big ? 7 : 5.5} fill="#fff" />
      <circle cx={cx + 6} cy={EYE_Y + 11} r={big ? 3.4 : 2.6} fill="#fff" />
    </g>
  )
}

const arc = { fill: 'none', stroke: INK, strokeWidth: 4.6, strokeLinecap: 'round' }

function Eyes({ style, color, face }) {
  switch (style) {
    case 'sleepy':
      return (
        <Pair>
          <path d="M72 236 Q94 258 116 236" {...arc} />
        </Pair>
      )
    case 'joy':
      return (
        <Pair>
          <path d="M72 248 Q94 218 116 248" {...arc} />
        </Pair>
      )
    case 'wink':
      return (
        <g>
          <OpenEye cx={EYE_L} color={color} />
          <path d="M156 248 Q178 218 200 248" {...arc} />
        </g>
      )
    case 'heart':
      return (
        <g>
          {[EYE_L, EYE_R].map((x) => (
            <g key={x} transform={`translate(${x} ${EYE_Y}) scale(1.75)`}>
              <path className="heart-beat" d={HEART} fill="#ff2d6f" stroke={INK} strokeWidth="1.6" />
              <circle cx="-5" cy="-5" r="2.2" fill="#fff" />
            </g>
          ))}
        </g>
      )
    case 'shock':
      return (
        <g>
          {[EYE_L, EYE_R].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={EYE_Y} rx="24" ry="31" fill="#fff" stroke={INK} strokeWidth="3" />
              <circle cx={x} cy={EYE_Y} r="6.5" fill={color} />
              <circle cx={x - 2} cy={EYE_Y - 2} r="2" fill="#fff" />
            </g>
          ))}
        </g>
      )
    case 'sad':
      return (
        <g>
          <OpenEye cx={EYE_L} color={color} big />
          <OpenEye cx={EYE_R} color={color} big />
          {[EYE_L, EYE_R].map((x) => (
            <path
              key={x}
              d={`M${x - 16} ${EYE_Y + 17} Q${x} ${EYE_Y + 32} ${x + 16} ${EYE_Y + 17}`}
              fill="none"
              stroke="#8fdcff"
              strokeWidth="4"
              strokeLinecap="round"
            />
          ))}
        </g>
      )
    case 'angry':
      return (
        <g>
          <OpenEye cx={EYE_L} color={color} />
          <OpenEye cx={EYE_R} color={color} />
          <Pair>
            <polygon points="62,196 124,196 124,247 62,218" fill={face} />
            <path d="M62 218 L124 247" stroke={INK} strokeWidth="4.4" strokeLinecap="round" />
          </Pair>
        </g>
      )
    default:
      return (
        <g>
          <OpenEye cx={EYE_L} color={color} />
          <OpenEye cx={EYE_R} color={color} />
        </g>
      )
  }
}

const BROW_PATHS = {
  neutral: ['M72 203 Q96 200 118 210', 3.6],
  angry: ['M64 194 Q92 202 120 220', 5],
  sad: ['M68 214 Q92 208 120 194', 3.6],
  raised: ['M72 196 Q94 184 116 194', 3.6],
}

function Brows({ style }) {
  const spec = BROW_PATHS[style]
  if (!spec) return null
  return (
    <Pair>
      <path d={spec[0]} fill="none" stroke={INK} strokeWidth={spec[1]} strokeLinecap="round" />
    </Pair>
  )
}

// The signature grin: a smile curve with a zigzag row of teeth sitting on it.
// Negative depth flips it into a fanged frown (teeth hang down).
function Grin({ m, teeth }) {
  const { halfW, yEnd, depth, teeth: count, T, v } = m
  const flip = depth >= 0 ? 1 : -1
  const c = depth / 0.75
  const P = [
    [CX - halfW, yEnd],
    [CX - halfW * 0.73, yEnd + c],
    [CX + halfW * 0.73, yEnd + c],
    [CX + halfW, yEnd],
  ]
  const at = (t) => {
    const u = 1 - t
    return [0, 1].map(
      (k) => u ** 3 * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t ** 3 * P[3][k],
    )
  }
  const normal = (t) => {
    const u = 1 - t
    const d = [0, 1].map(
      (k) => 3 * u * u * (P[1][k] - P[0][k]) + 6 * u * t * (P[2][k] - P[1][k]) + 3 * t * t * (P[3][k] - P[2][k]),
    )
    const len = Math.hypot(d[0], d[1])
    return [(d[1] / len) * flip, (-d[0] / len) * flip]
  }

  const n = count * 2
  const zig = []
  const base = []
  for (let i = 0; i <= n; i++) {
    const t = 0.07 + (0.86 * i) / n
    const [x, y] = at(t)
    const [nx, ny] = normal(t)
    const off = i % 2 ? T : v
    zig.push([x + nx * off, y + ny * off])
    base.push([x, y])
  }
  const band = `M${poly([...zig, ...[...base].reverse()])} Z`
  const curve = `M${P[0].join(' ')} C${P[1].join(' ')} ${P[2].join(' ')} ${P[3].join(' ')}`
  const s = flip * 8

  return (
    <g>
      <path d={band} fill={teeth} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d={curve} fill="none" stroke={INK} strokeWidth="3.6" strokeLinecap="round" />
      <path
        d={`M${P[0][0]} ${yEnd} l-3 ${-s} M${P[3][0]} ${yEnd} l3 ${-s}`}
        stroke={INK}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </g>
  )
}

function OpenMouth({ m, clipId, teeth, mouthColor }) {
  const { y0, w, h, sag, teeth: count, tl, tongue } = m
  const d =
    `M${CX - w} ${y0} Q${CX} ${y0 + sag} ${CX + w} ${y0} ` +
    `C${CX + w * 0.75} ${y0 + h * 1.33} ${CX - w * 0.75} ${y0 + h * 1.33} ${CX - w} ${y0} Z`
  const lip = (x) => {
    const u = (x - (CX - w)) / (2 * w)
    return y0 + 2 * u * (1 - u) * sag
  }
  const step = (2 * w) / count
  const tri = Array.from({ length: count }, (_, i) => {
    const xl = CX - w + i * step
    const xr = xl + step
    const xm = (xl + xr) / 2
    return `${xl},${lip(xl) - 1} ${xr},${lip(xr) - 1} ${xm},${lip(xm) + tl}`
  })

  return (
    <g>
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>
      <path d={d} fill={mouthColor} />
      <g clipPath={`url(#${clipId})`}>
        {tongue && <ellipse cx={CX} cy={y0 + h * 0.92} rx={w * 0.5} ry={h * 0.34} fill="#ff7b9c" />}
        {tri.map((pts) => (
          <polygon key={pts} points={pts} fill={teeth} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
        ))}
      </g>
      <path d={d} fill="none" stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
    </g>
  )
}

// ---------- floating extras ----------

const label = { fontFamily: 'Nunito, system-ui, sans-serif', fontWeight: 900 }

function Extras({ kind }) {
  switch (kind) {
    case 'sparkle':
      return (
        <g fill="#ffd54a" stroke={INK} strokeWidth="1.2">
          <g transform="translate(16 150) scale(1.3)"><path className="twinkle" d={STAR} /></g>
          <g transform="translate(258 132) scale(1.1)"><path className="twinkle d2" d={STAR} /></g>
          <g transform="translate(248 60)"><path className="twinkle d3" d={STAR} /></g>
        </g>
      )
    case 'zzz':
      return (
        <g {...label} fill="#fff" stroke={INK} strokeWidth="1.6" paintOrder="stroke">
          <text className="zzz" x="238" y="108" fontSize="20">z</text>
          <text className="zzz d2" x="248" y="82" fontSize="25">z</text>
          <text className="zzz d3" x="254" y="50" fontSize="30">Z</text>
          <g transform="translate(146 254)">
            <circle className="bubble" r="10" fill="#fff" fillOpacity=".6" stroke={INK} strokeWidth="2" />
          </g>
        </g>
      )
    case 'anger':
      return (
        <g transform="translate(240 138)">
          <path
            className="pulse"
            d="M-11 -5 Q-4 -5 -4 -12 M11 -5 Q4 -5 4 -12 M-11 5 Q-4 5 -4 12 M11 5 Q4 5 4 12"
            fill="none"
            stroke="#e62117"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
      )
    case 'hearts':
      return (
        <g fill="#ff5c9d" stroke={INK} strokeWidth="1.6">
          <g transform="translate(16 150) scale(.75)"><path className="float-up" d={HEART} /></g>
          <g transform="translate(258 140) scale(.65)"><path className="float-up d2" d={HEART} /></g>
          <g transform="translate(246 70) scale(.55)"><path className="float-up d3" d={HEART} /></g>
        </g>
      )
    case 'shock':
      return (
        <g>
          <g transform="translate(260 158)">
            <path className="sweat" d="M0 -13 Q11 3 0 11 Q-11 3 0 -13Z" fill="#7fd6ff" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          </g>
          <text {...label} x="240" y="104" fontSize="40" fill="#ff2d95" stroke={INK} strokeWidth="2" paintOrder="stroke" className="pulse">!</text>
        </g>
      )
    case 'tears':
      return (
        <g>
          {[EYE_L - 12, EYE_R + 12].map((x, i) => (
            <g key={x}>
              <path d={`M${x} ${EYE_Y + 28} Q${x + (i ? 6 : -6)} ${EYE_Y + 48} ${x + (i ? 2 : -2)} ${EYE_Y + 66}`} fill="none" stroke="#8fdcff" strokeWidth="5" strokeLinecap="round" opacity=".6" />
              <g transform={`translate(${x} ${EYE_Y + 30})`}>
                <path className={i ? 'tear d2' : 'tear'} d="M0 0 C7 12 9 21 0 28 C-9 21 -7 12 0 0Z" fill="#8fdcff" stroke={INK} strokeWidth="1.8" />
              </g>
            </g>
          ))}
        </g>
      )
    default:
      return null
  }
}

// ---------- the template ----------

export default function Labubu({
  fur = '#e8778d',
  face = '#fbe9c9',
  nose = '#f2879a',
  eyeColor = '#1c1118',
  teeth = '#fffaf0',
  mouthColor = '#6b1c33',
  mood = 'classic',
  eyes,
  brows,
  mouth,
  blush,
  earTilt,
  extra,
  sticker = true,
  label: ariaLabel,
  className = '',
  outfitBody = null, // drawn over the body + arms (e.g. a sweater)
  outfitHead = null, // drawn over the face (e.g. a hat)
}: any) {
  const uid = useId().replace(/:/g, '')
  const preset = MOODS[mood] ?? MOODS.classic
  const eyeStyle = eyes ?? preset.eyes
  const browStyle = brows ?? preset.brows
  const mouthSpec = MOUTHS[mouth ?? preset.mouth] ?? MOUTHS.grin
  const tilt = earTilt ?? preset.earTilt ?? 0
  const blushSetting = blush ?? preset.blush
  const blushColor = blushSetting === true ? '#ff7a9a' : blushSetting
  const extraKind = extra === undefined ? preset.extra : extra

  return (
    <svg
      viewBox="0 0 272 490"
      className={`labubu${sticker ? ' sticker' : ''} ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <clipPath id={`body-${uid}`}>
          <path d={BODY} />
        </clipPath>
      </defs>

      <Pair>
        <Ear fur={fur} inner={face} tilt={tilt} />
      </Pair>

      <Pair>
        <Foot face={face} />
      </Pair>

      <path d={BODY} fill={fur} stroke={INK} strokeWidth="3.2" strokeLinejoin="round" />
      <ellipse cx={CX} cy="318" rx="92" ry="22" fill="#000" opacity=".16" clipPath={`url(#body-${uid})`} />
      <path d={BODY_TICKS} stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path
        d="M140 348 q5 6 10 0 M108 432 Q136 448 164 432"
        stroke={INK}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />

      <Pair>
        <Arm fur={fur} face={face} />
      </Pair>

      {outfitBody}

      <path d={HOOD} fill={fur} stroke={INK} strokeWidth="3.4" strokeLinejoin="round" />
      <path d={HOOD_TICKS} stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />

      <path d={FACE} fill={face} stroke={INK} strokeWidth="3" />
      <path d={FRINGE.fill} fill={fur} />
      <path d={FRINGE.edge} fill="none" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />

      {blushColor && (
        <Pair>
          <ellipse cx="62" cy="266" rx="13" ry="8" fill={blushColor} opacity=".55" />
        </Pair>
      )}

      <Eyes style={eyeStyle} color={eyeColor} face={face} />
      <Brows style={browStyle} />

      <path
        d="M124 245 Q136 241 148 245 Q142 259 136 260 Q130 259 124 245 Z"
        fill={nose}
        stroke={INK}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />

      {mouthSpec.kind === 'grin' ? (
        <Grin m={mouthSpec} teeth={teeth} />
      ) : (
        <OpenMouth m={mouthSpec} clipId={`mouth-${uid}`} teeth={teeth} mouthColor={mouthColor} />
      )}

      {outfitHead}

      <Extras kind={extraKind} />
    </svg>
  )
}
