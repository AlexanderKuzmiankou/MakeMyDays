import { motion } from 'framer-motion'

// Background glow and icon tile colours. Full class names so Tailwind keeps them.
const THEMES = {
  accent: {
    glow1: 'bg-accent-500/15',
    glow2: 'bg-emerald-500/10',
    tile: 'from-accent-400 to-accent-500 shadow-accent-500/20',
  },
  emerald: {
    glow1: 'bg-emerald-500/15',
    glow2: 'bg-accent-500/10',
    tile: 'from-emerald-400 to-emerald-600 shadow-emerald-500/20',
  },
  sky: {
    glow1: 'bg-sky-500/15',
    glow2: 'bg-accent-500/10',
    tile: 'from-sky-400 to-sky-600 shadow-sky-500/20',
  },
  violet: {
    glow1: 'bg-violet-500/15',
    glow2: 'bg-accent-500/10',
    tile: 'from-violet-400 to-violet-600 shadow-violet-500/20',
  },
  amber: {
    glow1: 'bg-amber-500/15',
    glow2: 'bg-emerald-500/10',
    tile: 'from-amber-400 to-amber-600 shadow-amber-500/20',
  },
}

const GRID_COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }

export function SummaryTile({ label, value, hint, tone = 'text-[var(--text-1)]' }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--surf)] border border-[var(--border)] px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] truncate">{label}</div>
      <div className={`mt-0.5 text-[16px] sm:text-[20px] leading-tight font-semibold font-serif truncate ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] text-[var(--text-3)] truncate">{hint}</div>}
    </div>
  )
}

/**
 * The header card every page opens with: icon (or a custom `leading` node),
 * title + subtitle, optional `actions` on the right, a row of summary tiles
 * and an optional progress bar.
 *
 * tiles: [{ label, value, hint?, tone? }]
 * progress: { pct: 0-100, label } | null
 */
export default function PageHero({ icon: Icon, leading, title, subtitle, actions, tiles = [], progress, theme = 'accent' }) {
  const t = THEMES[theme] ?? THEMES.accent
  return (
    <motion.section
      className="glass rounded-2xl relative overflow-hidden p-5 sm:p-7"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className={`pointer-events-none absolute -top-24 -right-20 w-72 h-72 rounded-full blur-3xl ${t.glow1}`} />
      <div className={`pointer-events-none absolute -bottom-28 -left-16 w-60 h-60 rounded-full blur-3xl ${t.glow2}`} />

      <div className="relative flex items-center gap-3.5">
        {leading ??
          (Icon && (
            <div
              className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0 shadow-lg ${t.tile}`}
            >
              <Icon size={20} className="text-white" />
            </div>
          ))}
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] sm:text-[28px] leading-tight font-semibold font-serif truncate">{title}</h1>
          {subtitle && <div className="text-[12.5px] sm:text-[14px] text-[var(--text-2)] truncate">{subtitle}</div>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>

      {tiles.length > 0 && (
        <div className={`relative grid gap-2 sm:gap-3 mt-5 ${GRID_COLS[tiles.length] ?? GRID_COLS[3]}`}>
          {tiles.map((tile) => (
            <SummaryTile key={tile.label} {...tile} />
          ))}
        </div>
      )}

      {progress && (
        <div className="relative mt-4">
          <div className="h-1.5 rounded-full bg-[var(--surf-2)] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(0, Math.min(100, progress.pct))}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          {progress.label && <div className="mt-1.5 text-[11.5px] text-[var(--text-3)]">{progress.label}</div>}
        </div>
      )}
    </motion.section>
  )
}
