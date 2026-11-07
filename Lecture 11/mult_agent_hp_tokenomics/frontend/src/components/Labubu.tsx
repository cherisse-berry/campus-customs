import type { AgentStatus, Delegation } from '../types'
import './Labubu.css'

export type LabubuVariant = 'boss' | 'book'

export interface LabubuProps {
  label: string
  sublabel?: string
  accent?: string
  variant?: LabubuVariant
  status?: AgentStatus
  badge?: string
  propEmoji?: string
  delegation?: Delegation | null
  tooltipOpen?: boolean
  onSelect?: () => void
}

function tipText(d: Delegation): string {
  const bits = [
    `${d.agent} · ${d.status}`,
    d.question ? `Asked: ${d.question}` : null,
    d.reply ? `Replied: ${d.reply}` : d.status === 'running' ? 'Replied: (still working…)' : null,
  ]
  return bits.filter(Boolean).join('\n\n')
}

/** Fuzzy Labubu SVG — brown monster, star eyes, toothy grin. */
export function Labubu({
  label,
  sublabel,
  accent = '#c9a227',
  variant = 'book',
  status = 'idle',
  badge,
  propEmoji,
  delegation = null,
  tooltipOpen = false,
  onSelect,
}: LabubuProps) {
  const fur = variant === 'boss' ? '#3d2914' : '#4a2f1a'
  const furDark = variant === 'boss' ? '#2a1a0c' : '#3a2412'
  const face = '#e8b896'
  const isThinking = status === 'thinking'
  const isDone = status === 'done'
  const isError = status === 'error'
  const showTip = Boolean(delegation && (tooltipOpen || isThinking || isDone || isError))

  return (
    <div
      className={`labubu ${status} ${variant}${tooltipOpen ? ' tip-pinned' : ''}${onSelect ? ' clickable' : ''}`}
      style={{ ['--accent' as string]: accent }}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!onSelect) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="labubu-stage">
        <svg viewBox="0 0 160 200" className="labubu-svg" aria-hidden>
          <g className="ears">
            <ellipse cx="48" cy="28" rx="14" ry="32" fill={fur} transform="rotate(-12 48 28)" />
            <ellipse cx="48" cy="30" rx="7" ry="20" fill={face} transform="rotate(-12 48 30)" />
            <ellipse cx="112" cy="28" rx="14" ry="32" fill={fur} transform="rotate(12 112 28)" />
            <ellipse cx="112" cy="30" rx="7" ry="20" fill={face} transform="rotate(12 112 30)" />
          </g>

          <ellipse cx="80" cy="145" rx="48" ry="42" fill={fur} />
          <ellipse cx="80" cy="150" rx="36" ry="30" fill={furDark} opacity="0.35" />

          <ellipse cx="34" cy="140" rx="14" ry="22" fill={fur} transform="rotate(18 34 140)" />
          <ellipse cx="126" cy="140" rx="14" ry="22" fill={fur} transform="rotate(-18 126 140)" />
          <ellipse cx="28" cy="158" rx="10" ry="8" fill={face} />
          <ellipse cx="132" cy="158" rx="10" ry="8" fill={face} />

          <ellipse cx="58" cy="182" rx="14" ry="10" fill={fur} />
          <ellipse cx="102" cy="182" rx="14" ry="10" fill={fur} />
          <ellipse cx="58" cy="190" rx="12" ry="7" fill={face} />
          <ellipse cx="102" cy="190" rx="12" ry="7" fill={face} />

          <circle cx="80" cy="88" r="46" fill={fur} />
          <circle cx="80" cy="92" r="34" fill={face} />

          <path d="M58 78 Q66 72 74 78" stroke="#2a1a0c" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M86 78 Q94 72 102 78" stroke="#2a1a0c" strokeWidth="3" fill="none" strokeLinecap="round" />

          <ellipse cx="66" cy="92" rx="8" ry="11" fill="#1a1008" />
          <ellipse cx="94" cy="92" rx="8" ry="11" fill="#1a1008" />
          <g className="star-glints">
            <polygon points="70,84 71.5,87.5 75,89 71.5,90.5 70,94 68.5,90.5 65,89 68.5,87.5" fill="#fff8dc" />
            <polygon points="98,84 99.5,87.5 103,89 99.5,90.5 98,94 96.5,90.5 93,89 96.5,87.5" fill="#fff8dc" />
          </g>

          <path d="M80 98 L76 104 L84 104 Z" fill="#5c3a22" />

          <path d="M52 112 Q80 128 108 112" fill="#1a1008" />
          <g className="teeth">
            {[56, 64, 72, 80, 88, 96].map((x) => (
              <polygon key={x} points={`${x},112 ${x + 4},112 ${x + 2},120`} fill="#f7f2ea" />
            ))}
          </g>

          <circle cx="54" cy="104" r="5" fill="#e89aaa" opacity="0.45" />
          <circle cx="106" cy="104" r="5" fill="#e89aaa" opacity="0.45" />

          <path
            d="M48 122 Q80 136 112 122"
            stroke={accent}
            strokeWidth="7"
            fill="none"
            strokeLinecap="round"
            opacity="0.95"
          />
          <circle cx="80" cy="132" r="7" fill={variant === 'boss' ? '#d4af37' : '#c0c0c0'} stroke="#333" strokeWidth="1" />
          {badge && (
            <text x="80" y="135" textAnchor="middle" fontSize="8" fontWeight="700" fill="#111">
              {badge}
            </text>
          )}

          {variant === 'boss' && (
            <g>
              <ellipse cx="80" cy="48" rx="22" ry="6" fill="#111" />
              <rect x="68" y="22" width="24" height="28" rx="4" fill="#111" />
              <rect x="68" y="42" width="24" height="5" fill={accent} />
            </g>
          )}
        </svg>

        {propEmoji && <span className="labubu-prop">{propEmoji}</span>}
        {isThinking && (
          <span className="think-dots" aria-hidden>
            ···
          </span>
        )}
        {isDone && <span className="status-pip done">✓</span>}
        {isError && <span className="status-pip err">!</span>}

        {showTip && delegation && (
          <div className={`labubu-tip${tooltipOpen ? ' open' : ''}`} role="tooltip">
            <div className="labubu-tip-head">
              <strong>{delegation.agent}</strong>
              <span className={`tip-status ${delegation.status}`}>{delegation.status}</span>
            </div>
            {delegation.question && (
              <p>
                <em>Asked</em>
                {delegation.question}
              </p>
            )}
            <p>
              <em>Replied</em>
              {delegation.reply || (delegation.status === 'running' ? '(still working…)' : '—')}
            </p>
          </div>
        )}
      </div>
      <div className="labubu-label">{label}</div>
      {sublabel && <div className="labubu-sub">{sublabel}</div>}
      {/* native title fallback for quick hover on idle-with-data */}
      {delegation && <span className="sr-only">{tipText(delegation)}</span>}
    </div>
  )
}

export const BOOK_PROPS: Record<number, string> = {
  1: '🪄',
  2: '📓',
  3: '⏳',
  4: '🏆',
  5: '🔮',
  6: '👑',
  7: '△',
}
