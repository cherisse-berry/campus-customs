import Labubu from './Labubu.tsx'

/*
  <FrogLabubu /> — Tauhid's class outfit: a brown Labubu in a green knit frog beanie
  (bunny ears poking out the top) and a green sweater with a frog patch.
  Everything is drawn in the same 272×490 coordinate space as <Labubu />.
*/

const INK = '#1c1118'
const GREEN = '#22a35a'
const GREEN_DARK = '#16793f'
const PATCH = '#e3f6da'

// Quadratic curve y at fraction t, for curves that run x 12 → 260 with control x 136.
const q = (y0: number, yc: number, t: number) => y0 - 2 * (y0 - yc) * t * (1 - t)

const brimRibs = Array.from({ length: 21 }, (_, i) => {
  const x = 22 + i * 11.4
  const t = (x - 12) / 248
  return `M${x.toFixed(1)} ${q(196, 150, t).toFixed(1)} L${x.toFixed(1)} ${q(226, 182, t).toFixed(1)}`
}).join(' ')

const domeRibs = [60, 86, 112, 136, 160, 186, 212]
  .map((x) => `M${x} ${x === 136 ? 92 : 104 + Math.abs(x - 136) * 0.45} Q${x + (x - 136) * 0.12} 140 ${x} ${q(196, 150, (x - 12) / 248) - 4}`)
  .join(' ')

function FrogEye({ cx, cy, look }: { cx: number; cy: number; look: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="30" fill={GREEN} stroke={INK} strokeWidth="3.2" />
      <circle cx={cx} cy={cy + 2} r="19" fill="#fff" stroke={INK} strokeWidth="2.4" />
      <circle cx={cx + look} cy={cy + 3} r="12" fill={INK} />
      <circle cx={cx + look - 4} cy={cy - 2} r="3.6" fill="#fff" />
    </g>
  )
}

function Beanie() {
  return (
    <g>
      <path
        d="M12 196 C8 126 66 86 136 86 C206 86 264 126 260 196 Q136 150 12 196 Z"
        fill={GREEN}
        stroke={INK}
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
      <path d={domeRibs} fill="none" stroke={GREEN_DARK} strokeWidth="2.2" strokeLinecap="round" opacity=".7" />
      <path
        d="M12 196 Q136 150 260 196 L260 226 Q136 182 12 226 Z"
        fill={GREEN_DARK}
        stroke={INK}
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path d={brimRibs} stroke="#0f5a2e" strokeWidth="2" strokeLinecap="round" opacity=".75" />
      <FrogEye cx={60} cy={112} look={5} />
      <FrogEye cx={212} cy={112} look={-5} />
    </g>
  )
}

function Sleeve() {
  return (
    <g transform="translate(44 366) rotate(14)">
      <path d="M-25 -46 Q0 -58 25 -46 L27 20 Q0 28 -27 20 Z" fill={GREEN} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M-27 12 Q0 20 27 12 L27 22 Q0 30 -27 22 Z" fill={GREEN_DARK} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
    </g>
  )
}

function Sweater() {
  return (
    <g>
      <path
        d="M70 324 Q136 306 202 324 L212 432 Q136 448 60 432 Z"
        fill={GREEN}
        stroke={INK}
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path
        d="M62 414 Q136 430 210 414 L212 432 Q136 448 60 432 Z"
        fill={GREEN_DARK}
        stroke={INK}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M96 318 Q136 338 176 318 L180 332 Q136 354 92 332 Z"
        fill={GREEN_DARK}
        stroke={INK}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <Sleeve />
      <g transform="translate(272 0) scale(-1 1)">
        <Sleeve />
      </g>
      {/* frog patch */}
      <rect x="108" y="356" width="56" height="42" rx="4" fill={PATCH} stroke={INK} strokeWidth="2.4" />
      <ellipse cx="136" cy="382" rx="17" ry="11" fill="#7fd36b" stroke={INK} strokeWidth="1.8" />
      {[127, 145].map((x) => (
        <g key={x}>
          <circle cx={x} cy="370" r="5.5" fill="#7fd36b" stroke={INK} strokeWidth="1.6" />
          <circle cx={x} cy="370" r="2.2" fill={INK} />
        </g>
      ))}
      <path d="M129 384 Q136 390 143 384" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="124" cy="384" rx="3" ry="2" fill="#ff8fa8" opacity=".8" />
      <ellipse cx="148" cy="384" rx="3" ry="2" fill="#ff8fa8" opacity=".8" />
    </g>
  )
}

type Props = { mood?: string; className?: string; sticker?: boolean }

export default function FrogLabubu({ mood = 'classic', className = '', sticker = true }: Props) {
  return (
    <Labubu
      fur="#eae3b1"
      face="#f6d4bb"
      nose="#b8735c"
      eyeColor="#3a2016"
      mood={mood}
      sticker={sticker}
      className={className}
      label="Froggy, a Labubu in a frog beanie and sweater"
      outfitBody={<Sweater />}
      outfitHead={<Beanie />}
    />
  )
}
