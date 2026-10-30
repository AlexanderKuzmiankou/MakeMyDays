import { useCallback, useMemo, useRef, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import EmptyState from './EmptyState.jsx'
import { CAP_COLOR, INCOME_COLOR, SURFACE, TipRow, useWidth } from './BudgetChart.jsx'

const HEIGHT = 300
const NODE_W = 10
const GAP = 10
const TOP = 30 // room for the "Budget" label above the middle node
const DEFICIT_COLOR = '#B23A2E' // --red-400: spending covered by savings
const OTHER_COLOR = '#9A9590' // --text-3: folded small categories
const MAX_INCOME_NODES = 4
const MAX_EXPENSE_NODES = 7

const sum = (rows) => rows.reduce((s, r) => s + r.value, 0)

// Past `max` nodes the smallest fold into one neutral node instead of
// shrinking into unreadable slivers.
function fold(rows, max, kind) {
  if (rows.length <= max) return rows
  const rest = rows.slice(max - 1)
  return [
    ...rows.slice(0, max - 1),
    { key: `${kind}-other`, name: `${rest.length} more`, value: sum(rest), color: OTHER_COLOR, folded: rest },
  ]
}

function buildFlow(categories, withUpcoming) {
  const nodes = (kind, color) =>
    categories
      .filter((c) => c.kind === kind)
      .map((c) => ({
        key: `${kind}-${c.category_id ?? 'none'}`,
        name: c.name,
        value: c.amount + (withUpcoming ? c.projected : 0),
        color: color || c.color || OTHER_COLOR,
      }))
      .filter((n) => n.value > 0)
      .sort((a, b) => b.value - a.value)

  const income = nodes('income', INCOME_COLOR)
  const expenses = nodes('expense')
  const totalIn = sum(income)
  const totalOut = sum(expenses)
  const left = fold(income, MAX_INCOME_NODES, 'income')
  const right = fold(expenses, MAX_EXPENSE_NODES, 'expense')
  // Both sides must carry the same total: the difference is saved or drawn from savings.
  if (totalIn > totalOut) right.push({ key: 'saved', name: 'Saved', value: totalIn - totalOut, color: INCOME_COLOR, special: true })
  if (totalOut > totalIn) left.push({ key: 'deficit', name: 'From savings', value: totalOut - totalIn, color: DEFICIT_COLOR, special: true })
  return { left, right, total: Math.max(totalIn, totalOut), totalIn, totalOut }
}

function layoutColumn(nodes, k, plotH) {
  const used = sum(nodes) * k + GAP * (nodes.length - 1)
  let y = TOP + (plotH - used) / 2
  return nodes.map((n) => {
    const h = Math.max(2, n.value * k)
    const placed = { ...n, y, h, linkH: n.value * k }
    y += h + GAP
    return placed
  })
}

// A link is a band whose top and bottom edges are matching cubic curves.
function band(x0, y0, x1, y1, h) {
  const xm = (x0 + x1) / 2
  return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + h}C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h}Z`
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

function NodeLabel({ node, x, anchor, fmt, share, maxChars }) {
  const cy = node.y + node.h / 2
  const twoLines = node.h >= 26
  // A surface-coloured halo keeps the label legible where it crosses a link.
  const halo = { paintOrder: 'stroke', stroke: SURFACE, strokeWidth: 3, strokeLinejoin: 'round' }
  return (
    <text x={x} y={cy} textAnchor={anchor} style={halo} className="pointer-events-none">
      {twoLines ? (
        <>
          <tspan x={x} dy="-0.25em" fontSize="12" fontWeight="500" fill="var(--text-1)">{truncate(node.name, maxChars)}</tspan>
          <tspan x={x} dy="1.25em" fontSize="11" fill="var(--text-3)">{fmt(node.value)}{share && ` · ${share}`}</tspan>
        </>
      ) : (
        <tspan dy="0.32em" fontSize="11" fill="var(--text-2)">
          {truncate(node.name, Math.max(6, maxChars - 10))} · {fmt(node.value)}
        </tspan>
      )}
    </text>
  )
}

function FlowTable({ flow, fmt, pct }) {
  const rows = [
    ...flow.left.map((n) => ({ ...n, from: n.name, to: 'Budget' })),
    ...flow.right.map((n) => ({ ...n, from: 'Budget', to: n.name })),
  ]
  return (
    <div className="overflow-y-auto" style={{ height: HEIGHT }}>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[var(--text-3)] text-[11px] uppercase tracking-wider">
            <th className="py-1.5 font-semibold">From</th>
            <th className="py-1.5 font-semibold">To</th>
            <th className="py-1.5 font-semibold text-right">Amount</th>
            <th className="py-1.5 font-semibold text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-[var(--border)]">
              <td className="py-1.5 text-[var(--text-2)]">{r.from}</td>
              <td className="py-1.5 text-[var(--text-2)]">{r.to}</td>
              <td className="py-1.5 text-right font-mono">{fmt(r.value)}</td>
              <td className="py-1.5 text-right font-mono text-[var(--text-3)]">{pct(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Where the period's money comes from and where it goes: income categories
 * flow into the budget, which flows out to spending categories and savings.
 */
export default function BudgetFlow({ summary, fmt }) {
  const [measureRef, width] = useWidth()
  const box = useRef(null)
  const setBox = useCallback((el) => {
    box.current = el
    measureRef(el)
  }, [measureRef])
  const [withUpcoming, setWithUpcoming] = useState(true)
  const [showTable, setShowTable] = useState(false)
  const [hover, setHover] = useState(null) // { key, x, y }
  const hasUpcoming = summary.projected_income > 0 || summary.projected_expenses > 0

  const flow = useMemo(
    () => buildFlow(summary.categories, withUpcoming && hasUpcoming),
    [summary.categories, withUpcoming, hasUpcoming],
  )
  const pct = (v) => (flow.totalIn > 0 ? `${Math.round((v / flow.totalIn) * 100)}% of income` : '—')
  // Labels sit between the outer nodes and the middle bar, so keep them short.
  const shortPct = (v) => (flow.totalIn > 0 ? `${Math.round((v / flow.totalIn) * 100)}%` : '')

  const layout = useMemo(() => {
    if (!width || flow.total <= 0) return null
    const plotH = HEIGHT - TOP - 4
    const most = Math.max(flow.left.length, flow.right.length)
    const k = (plotH - GAP * (most - 1)) / flow.total
    const left = layoutColumn(flow.left, k, plotH)
    const right = layoutColumn(flow.right, k, plotH)
    const midH = flow.total * k
    const mid = { x: width / 2 - NODE_W / 2, y: TOP + (plotH - midH) / 2, h: midH }
    // Links stack along the middle node in the same order as their outer nodes.
    let inY = mid.y
    let outY = mid.y
    const links = [
      ...left.map((n) => {
        const d = band(NODE_W, n.y, mid.x, inY, n.linkH)
        inY += n.linkH
        return { key: n.key, d, color: n.color }
      }),
      ...right.map((n) => {
        const d = band(mid.x + NODE_W, outY, width - NODE_W, n.y, n.linkH)
        outY += n.linkH
        return { key: n.key, d, color: n.color }
      }),
    ]
    return { left, right, mid, links }
  }, [width, flow])

  const track = (key) => (e) => {
    const r = box.current.getBoundingClientRect()
    setHover({ key, x: e.clientX - r.left, y: e.clientY - r.top })
  }
  const hovered = hover && [...flow.left, ...flow.right].find((n) => n.key === hover.key)
  const isIncomeSide = hovered && flow.left.some((n) => n.key === hovered.key)
  const maxChars = Math.max(8, Math.floor((width / 2 - 40) / 6.5))

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-3 min-h-[20px]">
        {hasUpcoming ? (
          <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-2)] cursor-pointer select-none">
            <input type="checkbox" checked={withUpcoming} onChange={(e) => setWithUpcoming(e.target.checked)} className="accent-[#C8622A]" />
            Include upcoming recurring
          </label>
        ) : (
          <span className="text-[11.5px] text-[var(--text-3)]">Income → budget → spending</span>
        )}
        {flow.total > 0 && (
          <button
            onClick={() => setShowTable((v) => !v)}
            className="shrink-0 text-[11.5px] text-[var(--text-3)] hover:text-accent-400 transition-colors"
          >
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>

      {flow.total <= 0 ? (
        <div style={{ height: HEIGHT }} className="flex items-center justify-center">
          <EmptyState icon={ArrowRightLeft} title="No money in or out in this period yet." />
        </div>
      ) : showTable ? (
        <FlowTable flow={flow} fmt={fmt} pct={pct} />
      ) : (
        <div ref={setBox} className="relative w-full" style={{ height: HEIGHT }} onMouseLeave={() => setHover(null)}>
          {layout && (
            <svg width={width} height={HEIGHT} role="img" aria-label="Budget flow from income to spending categories">
              {layout.links.map((l) => (
                <path
                  key={l.key}
                  d={l.d}
                  fill={l.color}
                  opacity={!hover ? 0.28 : hover.key === l.key ? 0.55 : 0.1}
                  className="transition-opacity cursor-default"
                  onMouseMove={track(l.key)}
                />
              ))}
              {[...layout.left.map((n) => ({ ...n, x: 0 })), ...layout.right.map((n) => ({ ...n, x: width - NODE_W }))].map((n) => (
                <rect key={n.key} x={n.x} y={n.y} width={NODE_W} height={n.h} rx="2" fill={n.color} onMouseMove={track(n.key)} />
              ))}
              <rect x={layout.mid.x} y={layout.mid.y} width={NODE_W} height={layout.mid.h} rx="2" fill={CAP_COLOR} />
              <text x={width / 2} y={14} textAnchor="middle" className="pointer-events-none">
                <tspan fontSize="12" fontWeight="500" fill="var(--text-1)">Budget</tspan>
                <tspan fontSize="11" fill="var(--text-3)"> · {fmt(flow.total)}</tspan>
              </text>
              {layout.left.map((n) => (
                <NodeLabel key={n.key} node={n} x={NODE_W + 6} anchor="start" fmt={fmt} share={shortPct(n.value)} maxChars={maxChars} />
              ))}
              {layout.right.map((n) => (
                <NodeLabel key={n.key} node={n} x={width - NODE_W - 6} anchor="end" fmt={fmt} share={shortPct(n.value)} maxChars={maxChars} />
              ))}
            </svg>
          )}
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] shadow-lg"
              style={{
                top: Math.min(hover.y + 12, HEIGHT - 90),
                ...(hover.x > width - 200 ? { right: width - hover.x + 12 } : { left: hover.x + 12 }),
              }}
            >
              <div className="font-medium text-[var(--text-1)] mb-1">
                {isIncomeSide ? `${hovered.name} → Budget` : `Budget → ${hovered.name}`}
              </div>
              <TipRow label="Amount" value={fmt(hovered.value)} swatch={hovered.color} />
              <TipRow label="Share" value={pct(hovered.value)} />
              {hovered.folded?.map((f) => (
                <TipRow key={f.key} label={f.name} value={fmt(f.value)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
