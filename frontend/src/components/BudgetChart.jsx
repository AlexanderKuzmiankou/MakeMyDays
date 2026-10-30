import { useEffect, useMemo, useState } from 'react'
import { todayStr } from '../utils.js'

// Validated against the card surface (#F2EDE4) with the dataviz palette
// checker: both clear contrast, chroma and colour-blind separation.
export const INCOME_COLOR = '#2f8f6a'
export const EXPENSE_COLOR = '#C8622A'
export const CAP_COLOR = '#4A4740' // --text-2: a reference line, not a data series
const GRID_COLOR = '#E2DDD5' // --border
export const SURFACE = '#F2EDE4' // --surf, used for the 2px gaps and marker rings

const HEIGHT = 290
const M = { top: 14, right: 12, bottom: 26, left: 48 }
const MAX_BAR = 24
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Callback ref, so the observer re-attaches when the chart remounts (table toggle).
export function useWidth() {
  const [node, setNode] = useState(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])
  return [setNode, width]
}

// 0 -> max in 4-5 round steps (1, 2, 2.5, 5 x 10^n).
function niceTicks(max) {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw)
  const ticks = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

// Column with a 4px rounded data end and a square baseline.
function columnPath(x, y, w, h, rounded) {
  if (h <= 0) return ''
  const r = rounded ? Math.min(4, w / 2, h) : 0
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-[var(--text-2)]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {it.line ? (
            <svg width="16" height="8" aria-hidden>
              <line x1="0" x2="16" y1="4" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.dashed ? '4 3' : undefined} />
            </svg>
          ) : (
            <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: it.color, opacity: it.faded ? 0.35 : 1 }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  )
}

function Tooltip({ x, width, children }) {
  // Flip to the left of the pointer near the right edge so it never overflows.
  const flip = x > width - 190
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-[170px] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] shadow-lg"
      style={flip ? { right: width - x + 12 } : { left: x + 12 }}
    >
      {children}
    </div>
  )
}

export function TipRow({ label, value, swatch, faded }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-[var(--text-2)]">
        {swatch && <span className="w-2 h-2 rounded-[2px]" style={{ background: swatch, opacity: faded ? 0.35 : 1 }} />}
        {label}
      </span>
      <span className="font-mono text-[var(--text-1)]">{value}</span>
    </div>
  )
}

function YAxis({ ticks, y, width }) {
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
  return ticks.map((t) => (
    <g key={t}>
      <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={GRID_COLOR} strokeWidth="1" />
      <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10.5" fill="var(--text-3)">
        {compact.format(t)}
      </text>
    </g>
  ))
}

// ── year: income vs expenses per month ───────────────────────────────────────

function YearChart({ series, fmt, width }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(
    ...series.flatMap((s) => [s.income + s.projected_income, s.expenses + s.projected_expenses, s.cap || 0]),
  )
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]
  const plotH = HEIGHT - M.top - M.bottom
  const y = (v) => M.top + plotH - (v / top) * plotH
  const band = (width - M.left - M.right) / 12
  const barW = Math.max(3, Math.min(MAX_BAR, (band - 10) / 2))

  const stack = (x, actual, projected, color) => {
    const hActual = y(0) - y(actual)
    const hProj = y(0) - y(actual + projected) - hActual
    const gap = hActual > 0 && hProj > 2 ? 2 : 0
    return (
      <>
        <path d={columnPath(x, y(actual), barW, hActual, hProj <= 2)} fill={color} />
        {hProj > 2 && <path d={columnPath(x, y(actual + projected), barW, hProj - gap, true)} fill={color} opacity="0.35" />}
      </>
    )
  }

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Income and expenses per month">
        <YAxis ticks={ticks} y={y} width={width} />
        {series.map((s, i) => {
          const cx = M.left + band * i + band / 2
          const active = hover === i
          return (
            <g key={s.period}>
              {active && <rect x={cx - band / 2} y={M.top} width={band} height={plotH} fill="var(--surf-2)" />}
              {stack(cx - barW - 1, s.income, s.projected_income, INCOME_COLOR)}
              {stack(cx + 1, s.expenses, s.projected_expenses, EXPENSE_COLOR)}
              {s.cap != null && (
                <line x1={cx - barW - 4} x2={cx + barW + 4} y1={y(s.cap)} y2={y(s.cap)} stroke={CAP_COLOR} strokeWidth="2" strokeLinecap="round" />
              )}
              <text x={cx} y={HEIGHT - 8} textAnchor="middle" fontSize="10.5" fill={active ? 'var(--text-1)' : 'var(--text-3)'}>
                {band < 34 ? MONTHS[i][0] : MONTHS[i]}
              </text>
              {/* hit target: the whole band, bigger than the bars */}
              <rect x={cx - band / 2} y={M.top} width={band} height={plotH + M.bottom} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          )
        })}
        <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} stroke="var(--border-2)" strokeWidth="1" />
      </svg>
      {hover != null && (() => {
        const s = series[hover]
        const net = s.income + s.projected_income - s.expenses - s.projected_expenses
        return (
          <Tooltip x={M.left + band * hover + band / 2} width={width}>
            <div className="font-medium text-[var(--text-1)] mb-1">{MONTHS[hover]} {s.period.slice(0, 4)}</div>
            <TipRow label="Income" value={fmt(s.income)} swatch={INCOME_COLOR} />
            {s.projected_income > 0 && <TipRow label="Upcoming income" value={fmt(s.projected_income)} swatch={INCOME_COLOR} faded />}
            <TipRow label="Expenses" value={fmt(s.expenses)} swatch={EXPENSE_COLOR} />
            {s.projected_expenses > 0 && <TipRow label="Upcoming expenses" value={fmt(s.projected_expenses)} swatch={EXPENSE_COLOR} faded />}
            {s.cap != null && <TipRow label="Cap" value={fmt(s.cap)} />}
            <div className="border-t border-[var(--border)] mt-1 pt-1">
              <TipRow label="Net" value={fmt(net)} />
            </div>
          </Tooltip>
        )
      })()}
    </div>
  )
}

// ── month: cumulative spending against the cap ───────────────────────────────

function MonthChart({ series, cap, fmt, width }) {
  const [hover, setHover] = useState(null)
  const today = todayStr()
  const n = series.length
  const max = Math.max(series[n - 1]?.cumulative_expenses || 0, cap || 0)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]
  const plotH = HEIGHT - M.top - M.bottom
  const plotW = width - M.left - M.right
  const x = (i) => M.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2)
  const y = (v) => M.top + plotH - (v / top) * plotH

  // Days up to today are actual; later days only carry upcoming recurring items.
  const lastActual = series.findLastIndex((d) => d.date <= today)
  const actual = series.slice(0, lastActual + 1)
  const pts = (rows, offset = 0) => rows.map((d, i) => `${x(i + offset)},${y(d.cumulative_expenses)}`).join(' ')
  const area = actual.length
    ? `M${x(0)},${y(0)} L${pts(actual).replaceAll(' ', ' L')} L${x(actual.length - 1)},${y(0)}Z`
    : ''

  const step = n > 1 ? plotW / (n - 1) : plotW
  const labelEvery = width < 420 ? 7 : width < 640 ? 5 : 3
  const overCap = cap != null && (series[lastActual]?.cumulative_expenses || 0) > cap

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Cumulative spending this month">
        <YAxis ticks={ticks} y={y} width={width} />
        {area && <path d={area} fill={EXPENSE_COLOR} opacity="0.1" />}
        {lastActual >= 0 && lastActual < n - 1 && (
          <polyline
            points={pts(series.slice(lastActual), lastActual)}
            fill="none" stroke={EXPENSE_COLOR} strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" strokeLinecap="round" opacity="0.6"
          />
        )}
        {actual.length > 0 && (
          <polyline points={pts(actual)} fill="none" stroke={EXPENSE_COLOR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {cap != null && (
          <g>
            <line x1={M.left} x2={width - M.right} y1={y(cap)} y2={y(cap)} stroke={CAP_COLOR} strokeWidth="1.5" />
            {/* left end: the cumulative line starts low, so the label stays clear of it */}
            <text x={M.left + 6} y={y(cap) - 6} fontSize="10.5" fill="var(--text-2)">
              Cap {fmt(cap)}
            </text>
          </g>
        )}
        {series.map((d, i) =>
          i % labelEvery === 0 || (i === n - 1 && i % labelEvery > labelEvery / 2) ? (
            <text key={d.date} x={x(i)} y={HEIGHT - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-3)">
              {i + 1}
            </text>
          ) : null,
        )}
        <line x1={M.left} x2={width - M.right} y1={y(0)} y2={y(0)} stroke="var(--border-2)" strokeWidth="1" />
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={y(0)} stroke="var(--border-2)" strokeWidth="1" />
        )}
        {lastActual >= 0 && (
          <circle cx={x(lastActual)} cy={y(actual[lastActual].cumulative_expenses)} r="4.5"
            fill={overCap ? '#B23A2E' : EXPENSE_COLOR} stroke={SURFACE} strokeWidth="2" />
        )}
        {hover != null && hover !== lastActual && (
          <circle cx={x(hover)} cy={y(series[hover].cumulative_expenses)} r="4" fill={EXPENSE_COLOR} stroke={SURFACE} strokeWidth="2" />
        )}
        {series.map((d, i) => (
          <rect key={d.date} x={x(i) - step / 2} y={M.top} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover != null && (() => {
        const d = series[hover]
        const upcoming = d.date > today
        return (
          <Tooltip x={x(hover)} width={width}>
            <div className="font-medium text-[var(--text-1)] mb-1">
              {new Date(`${d.date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              {upcoming && <span className="text-[var(--text-3)] font-normal"> · upcoming</span>}
            </div>
            <TipRow label={upcoming ? 'Due that day' : 'Spent that day'} value={fmt(d.expenses + d.projected_expenses)} swatch={EXPENSE_COLOR} faded={upcoming} />
            <TipRow label="Spent so far" value={fmt(d.cumulative_expenses)} />
            {d.income + d.projected_income > 0 && <TipRow label="Income" value={fmt(d.income + d.projected_income)} swatch={INCOME_COLOR} faded={upcoming} />}
            {cap != null && <TipRow label={d.cumulative_expenses > cap ? 'Over cap' : 'Left under cap'} value={fmt(Math.abs(cap - d.cumulative_expenses))} />}
          </Tooltip>
        )
      })()}
    </div>
  )
}

function SeriesTable({ series, isYear, fmt }) {
  const rows = isYear ? series : series.filter((d) => d.expenses || d.income || d.projected_expenses || d.projected_income)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[var(--text-3)] text-[11px] uppercase tracking-wider">
            <th className="py-1.5 font-semibold">{isYear ? 'Month' : 'Day'}</th>
            <th className="py-1.5 font-semibold text-right">Income</th>
            <th className="py-1.5 font-semibold text-right">Expenses</th>
            <th className="py-1.5 font-semibold text-right">Upcoming</th>
            <th className="py-1.5 font-semibold text-right">{isYear ? 'Cap' : 'Spent so far'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} className="py-3 text-center text-[var(--text-3)]">Nothing recorded yet.</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.period || r.date} className="border-t border-[var(--border)]">
              <td className="py-1.5 text-[var(--text-2)]">{isYear ? MONTHS[i] : r.date.slice(8)}</td>
              <td className="py-1.5 text-right font-mono">{fmt(r.income)}</td>
              <td className="py-1.5 text-right font-mono">{fmt(r.expenses)}</td>
              <td className="py-1.5 text-right font-mono text-[var(--text-3)]">
                {r.projected_income || r.projected_expenses ? `+${fmt(r.projected_income)} / −${fmt(r.projected_expenses)}` : '—'}
              </td>
              <td className="py-1.5 text-right font-mono">
                {isYear ? (r.cap != null ? fmt(r.cap) : '—') : fmt(r.cumulative_expenses)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Year view: income and expense columns per month, upcoming recurring
 * amounts stacked on top in a lighter step, monthly cap as a tick.
 * Month view: cumulative spending line against the cap.
 */
export default function BudgetChart({ summary, isYear, fmt }) {
  const [ref, width] = useWidth()
  const [showTable, setShowTable] = useState(false)
  const hasUpcoming = summary.projected_expenses > 0 || summary.projected_income > 0
  const hasCap = isYear ? summary.series.some((s) => s.cap != null) : summary.cap.total != null

  const legend = useMemo(() => {
    if (isYear) {
      return [
        { label: 'Income', color: INCOME_COLOR },
        { label: 'Expenses', color: EXPENSE_COLOR },
        ...(hasUpcoming ? [{ label: 'Upcoming recurring', color: 'var(--text-3)', faded: true }] : []),
        ...(hasCap ? [{ label: 'Monthly cap', color: CAP_COLOR, line: true }] : []),
      ]
    }
    return [
      { label: 'Spent so far', color: EXPENSE_COLOR, line: true },
      ...(hasUpcoming ? [{ label: 'Upcoming recurring', color: EXPENSE_COLOR, line: true, dashed: true }] : []),
      ...(hasCap ? [{ label: 'Cap', color: CAP_COLOR, line: true }] : []),
    ]
  }, [isYear, hasUpcoming, hasCap])

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <Legend items={legend} />
        <button
          onClick={() => setShowTable((v) => !v)}
          className="shrink-0 text-[11.5px] text-[var(--text-3)] hover:text-accent-400 transition-colors"
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {showTable ? (
        <SeriesTable series={summary.series} isYear={isYear} fmt={fmt} />
      ) : (
        <div ref={ref} className="w-full">
          {width > 0 &&
            (isYear ? (
              <YearChart series={summary.series} fmt={fmt} width={width} />
            ) : (
              <MonthChart series={summary.series} cap={summary.cap.total} fmt={fmt} width={width} />
            ))}
        </div>
      )}
    </div>
  )
}
