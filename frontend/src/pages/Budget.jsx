import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ChevronLeft, ChevronRight, Gauge, Pencil, Plus, Receipt, Repeat, Tags, Trash2, Wallet, X,
} from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageTransition from '../components/PageTransition.jsx'
import PageHero from '../components/PageHero.jsx'
import Badge from '../components/Badge.jsx'
import BudgetChart from '../components/BudgetChart.jsx'
import BudgetFlow from '../components/BudgetFlow.jsx'
import { api } from '../api.js'
import { todayStr } from '../utils.js'

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'CZK', 'SEK', 'NOK', 'DKK', 'HUF', 'RON', 'UAH', 'JPY', 'CAD', 'AUD']
// Categorical palette (dataviz reference order); the backend seeds defaults in the same order.
const CATEGORY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const FREQUENCIES = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every quarter' },
  { value: 'yearly', label: 'Every year' },
]
const FREQUENCY_LABEL = Object.fromEntries(FREQUENCIES.map((f) => [f.value, f.label.toLowerCase()]))

const inputCls =
  'bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent-400 placeholder:text-[var(--text-3)]'
const primaryBtnCls =
  'px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40'
const secondaryBtnCls =
  'px-4 py-2 rounded-lg text-[13px] bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all'
const dashedBtnCls =
  'w-full py-2.5 rounded-xl border border-dashed border-[var(--border-2)] text-[var(--text-3)] text-[13px] flex items-center justify-center gap-1.5 hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all'
// Cards in a row share a fixed height on large screens and scroll inside, so
// the frames line up no matter how much each one holds.
const ROW1_H = 'lg:h-[440px]'
const ROW2_H = 'lg:h-[560px]'
const scrollCls = 'flex-1 min-h-0 overflow-y-auto -mr-3 pr-3'
// Row actions appear on hover with a mouse, but stay visible on touch screens.
const rowActionCls =
  'sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] transition-all'

const pad = (n) => String(n).padStart(2, '0')

function periodLabel(year, month) {
  if (!month) return String(year)
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function periodBounds(year, month) {
  if (!month) return [`${year}-01-01`, `${year}-12-31`]
  const last = new Date(year, month, 0).getDate()
  return [`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(last)}`]
}

function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">{children}</div>
      {right}
    </div>
  )
}

function ErrorLine({ error }) {
  if (!error) return null
  return <div className="text-[12px] text-red-400">{error}</div>
}

function Swatch({ color, size = 10 }) {
  return (
    <span
      className="rounded-full shrink-0"
      style={{ width: size, height: size, background: color || 'var(--border-2)' }}
    />
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg bg-[var(--surf-2)] border border-[var(--border)]">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-md text-[12px] leading-tight whitespace-nowrap transition-all ${
            value === opt.value ? 'bg-accent-500 text-white' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function CategorySelect({ categories, kind, value, onChange, className = '' }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${className}`}>
      <option value="">No category</option>
      {categories
        .filter((c) => c.kind === kind)
        .map((c) => (
          <option key={c.category_id} value={c.category_id}>{c.name}</option>
        ))}
    </select>
  )
}

// ── period toolbar ───────────────────────────────────────────────────────────

function PeriodBar({ view, year, month, onChange }) {
  const shift = (delta) => {
    if (view === 'year') return onChange({ year: year + delta, month })
    const d = new Date(year, month - 1 + delta, 1)
    onChange({ year: d.getFullYear(), month: d.getMonth() + 1 })
  }
  const now = new Date()
  const isCurrent = year === now.getFullYear() && (view === 'year' || month === now.getMonth() + 1)
  const navBtn =
    'w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-accent-400 hover:border-accent-400 transition-all'

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Segmented
        options={[{ value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }]}
        value={view}
        onChange={(v) => onChange({ view: v })}
      />
      <div className="flex items-center gap-2">
        {!isCurrent && (
          <button
            onClick={() => onChange({ year: now.getFullYear(), month: now.getMonth() + 1 })}
            className="text-[12px] text-[var(--text-3)] hover:text-accent-400 transition-colors mr-1"
          >
            Today
          </button>
        )}
        <button onClick={() => shift(-1)} className={navBtn} title={`Previous ${view}`}><ChevronLeft size={16} /></button>
        <div className="min-w-[132px] text-center text-[14px] font-medium text-[var(--text-1)]">
          {periodLabel(year, view === 'month' ? month : null)}
        </div>
        <button onClick={() => shift(1)} className={navBtn} title={`Next ${view}`}><ChevronRight size={16} /></button>
      </div>
    </div>
  )
}

// ── category breakdown with caps ─────────────────────────────────────────────

function BreakdownRow({ row, scale, fmt }) {
  const total = row.amount + row.projected
  const over = row.cap != null && total > row.cap
  const pct = (v) => `${Math.min(100, (v / scale) * 100)}%`
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Swatch color={row.color} />
          <span className="text-[13.5px] text-[var(--text-1)] truncate">{row.name}</span>
        </div>
        <div className="text-[12.5px] font-mono text-[var(--text-1)] shrink-0">
          {fmt(row.amount)}
          {row.cap != null && <span className="text-[var(--text-3)]"> / {fmt(row.cap)}</span>}
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-[var(--surf-2)] overflow-hidden">
        {/* upcoming recurring sits behind the actual amount in a lighter step */}
        {row.projected > 0 && (
          <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(total), background: row.color || 'var(--text-3)', opacity: 0.35 }} />
        )}
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(row.amount), background: row.color || 'var(--text-3)' }} />
        {row.cap != null && row.cap < scale && (
          <div className="absolute inset-y-0 w-0.5 bg-[var(--text-2)]" style={{ left: pct(row.cap) }} title={`Cap ${fmt(row.cap)}`} />
        )}
      </div>
      {(over || row.projected > 0) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
          {over && (
            <Badge tone="red">
              <AlertTriangle size={10} /> over cap by {fmt(total - row.cap)}
            </Badge>
          )}
          {row.projected > 0 && (
            <span className="text-[11px] text-[var(--text-3)]">+ {fmt(row.projected)} upcoming recurring</span>
          )}
        </div>
      )}
    </div>
  )
}

function CategoryBreakdown({ summary, fmt }) {
  const expenses = summary.categories.filter((c) => c.kind === 'expense')
  const income = summary.categories.filter((c) => c.kind === 'income')
  // One shared scale so rows compare with each other; a cap can stretch it.
  const scale = Math.max(1, ...expenses.map((c) => Math.max(c.amount + c.projected, c.cap || 0)))

  return (
    <GlassCard className={`flex flex-col ${ROW1_H}`}>
      <SectionLabel>Spending by category</SectionLabel>
      <div className={scrollCls}>
      {expenses.length === 0 ? (
        <EmptyState icon={Tags} title="No spending in this period yet." />
      ) : (
        <div className="flex flex-col">
          {expenses.map((row) => (
            <BreakdownRow key={row.category_id ?? 'none'} row={row} scale={scale} fmt={fmt} />
          ))}
        </div>
      )}
      {income.length > 0 && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mt-5 mb-2">Income</div>
          {income.map((row) => (
            <div key={row.category_id ?? 'none'} className="flex items-center justify-between gap-3 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Swatch color={row.color} />
                <span className="text-[13.5px] text-[var(--text-1)] truncate">{row.name}</span>
              </div>
              <div className="text-[12.5px] font-mono text-emerald-400 shrink-0">
                {fmt(row.amount)}
                {row.projected > 0 && <span className="text-[var(--text-3)]"> +{fmt(row.projected)}</span>}
              </div>
            </div>
          ))}
        </>
      )}
      </div>
    </GlassCard>
  )
}

// ── transactions and recurring entries ───────────────────────────────────────

// Adds a one-off or recurring entry, or edits an existing transaction /
// recurring template (`entry` + `entryType`).
function EntryForm({ categories, entry, entryType, defaultDate, onSaved, onCancel }) {
  const editing = Boolean(entry)
  const [form, setForm] = useState(() => ({
    kind: entry?.kind || 'expense',
    amount: entry ? String(entry.amount) : '',
    description: entry?.description || '',
    categoryId: entry?.category_id || '',
    date: entry?.date || entry?.start_date || defaultDate,
    frequency: entryType === 'recurring' ? entry.frequency : '',
    endDate: entry?.end_date || '',
  }))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const valid = parseFloat(form.amount) > 0 && form.date

  const submit = async (e) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError('')
    const common = {
      amount: parseFloat(form.amount),
      description: form.description.trim(),
      category_id: form.categoryId,
    }
    try {
      if (editing && entryType === 'recurring') {
        await api.budget.updateRecurring(entry.recurring_id, { ...common, end_date: form.endDate })
      } else if (editing) {
        await api.budget.updateTransaction(entry.transaction_id, { ...common, date: form.date })
      } else if (form.frequency) {
        await api.budget.createRecurring({
          ...common,
          kind: form.kind,
          category_id: form.categoryId || null,
          frequency: form.frequency,
          start_date: form.date,
          end_date: form.endDate || null,
        })
      } else {
        await api.budget.createTransaction({ ...common, kind: form.kind, category_id: form.categoryId || null, date: form.date })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const noun = form.kind === 'income' ? 'income' : 'expense'
  let title = null
  if (editing && entryType === 'recurring') title = `Edit recurring ${noun} (future occurrences)`
  else if (editing) title = `Edit ${noun}${entry.recurring_id ? ' (this occurrence only)' : ''}`

  return (
    <form
      onSubmit={submit}
      className={`flex flex-col gap-3 p-4 rounded-xl bg-[var(--surf)] border ${editing ? 'border-accent-400 my-2' : 'border-[var(--border)]'}`}
    >
      {title && <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400">{title}</div>}
      {!editing && (
        <Segmented
          options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]}
          value={form.kind}
          onChange={(kind) => set({ kind, categoryId: '' })}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus
          type="number" min={0.01} step={0.01}
          value={form.amount}
          onChange={(e) => set({ amount: e.target.value })}
          placeholder="Amount"
          className={`w-32 ${inputCls}`}
        />
        <CategorySelect
          categories={categories}
          kind={form.kind}
          value={form.categoryId}
          onChange={(categoryId) => set({ categoryId })}
          className="flex-1 min-w-[140px]"
        />
      </div>
      <input
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder={form.kind === 'income' ? 'Where from? (optional)' : 'What for? (optional)'}
        maxLength={120}
        className={inputCls}
      />
      <div className="flex flex-wrap gap-2 items-center">
        {!editing && (
          <select value={form.frequency} onChange={(e) => set({ frequency: e.target.value })} className={inputCls}>
            <option value="">One-off</option>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        )}
        {entryType !== 'recurring' && (
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
            {form.frequency ? 'Starts' : 'Date'}
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} required className={inputCls} />
          </label>
        )}
        {form.frequency && (
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
            Ends
            <input type="date" value={form.endDate} min={form.date} onChange={(e) => set({ endDate: e.target.value })} className={inputCls} />
          </label>
        )}
      </div>
      <ErrorLine error={error} />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className={secondaryBtnCls}>Cancel</button>
        <button type="submit" disabled={submitting || !valid} className={primaryBtnCls}>
          {editing ? 'Save changes' : form.frequency ? `Add recurring ${noun}` : `Add ${noun}`}
        </button>
      </div>
    </form>
  )
}

function AmountText({ kind, amount, fmt }) {
  return (
    <div className={`text-[13px] font-mono font-medium ${kind === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
      {kind === 'income' ? '+' : '−'}{fmt(amount)}
    </div>
  )
}

function EntryRow({ title, meta, kind, amount, color, recurring, wrapMeta, fmt, onEdit, onDelete, deleteTitle }) {
  return (
    <div className="group flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <Swatch color={color} />
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-[var(--text-1)] truncate flex items-center gap-1.5">
            {recurring && <Repeat size={12} className="text-accent-400 shrink-0" />}
            {title}
          </div>
          <div className={`text-[11.5px] text-[var(--text-3)] mt-0.5 ${wrapMeta ? '' : 'truncate'}`}>{meta}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <AmountText kind={kind} amount={amount} fmt={fmt} />
        <button onClick={onEdit} className={`${rowActionCls} hover:text-accent-400 hover:bg-accent-500/10`} title="Edit">
          <Pencil size={13} />
        </button>
        <button onClick={onDelete} className={`${rowActionCls} hover:text-red-400 hover:bg-red-500/10`} title={deleteTitle}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function Transactions({ data, year, month, fmt, onChanged, onError }) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [filter, setFilter] = useState('all')
  const byId = useMemo(() => Object.fromEntries(data.categories.map((c) => [c.category_id, c])), [data.categories])

  const [start, end] = periodBounds(year, month)
  const today = todayStr()
  const defaultDate = today >= start && today <= end ? today : start
  const rows = data.transactions.filter((t) => filter === 'all' || t.kind === filter)

  const remove = async (t) => {
    if (!window.confirm(`Delete this ${t.kind}${t.description ? ` "${t.description}"` : ''}?`)) return
    try {
      await api.budget.removeTransaction(t.transaction_id)
      onChanged()
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <GlassCard className={`flex flex-col lg:col-span-2 ${ROW2_H}`}>
      <SectionLabel
        right={
          <Segmented
            options={[{ value: 'all', label: 'All' }, { value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]}
            value={filter}
            onChange={setFilter}
          />
        }
      >
        Transactions
      </SectionLabel>
      {!adding && (
        <button onClick={() => setAdding(true)} className={`mb-3 ${dashedBtnCls}`}>
          <Plus size={14} /> Add income or expense
        </button>
      )}
      <div className={`flex flex-col ${scrollCls} max-h-[480px] lg:max-h-none`}>
        {adding && (
          <div className="mb-2">
            <EntryForm
              categories={data.categories}
              defaultDate={defaultDate}
              onSaved={() => { setAdding(false); onChanged() }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
        {rows.length === 0 && <EmptyState icon={Receipt} title="Nothing recorded for this period." />}
        {rows.map((t) => {
          const cat = byId[t.category_id]
          if (editingId === t.transaction_id) {
            return (
              <EntryForm
                key={t.transaction_id}
                categories={data.categories}
                entry={t}
                entryType="transaction"
                onSaved={() => { setEditingId(null); onChanged() }}
                onCancel={() => setEditingId(null)}
              />
            )
          }
          return (
            <EntryRow
              key={t.transaction_id}
              title={t.description || cat?.name || (t.kind === 'income' ? 'Income' : 'Expense')}
              meta={`${cat?.name || 'Uncategorized'} · ${t.date}`}
              kind={t.kind}
              amount={t.amount}
              color={cat?.color}
              recurring={Boolean(t.recurring_id)}
              fmt={fmt}
              onEdit={() => setEditingId(t.transaction_id)}
              onDelete={() => remove(t)}
              deleteTitle="Delete"
            />
          )
        })}
      </div>
    </GlassCard>
  )
}

function RecurringList({ data, fmt, onChanged, onError }) {
  const [editingId, setEditingId] = useState(null)
  const byId = useMemo(() => Object.fromEntries(data.categories.map((c) => [c.category_id, c])), [data.categories])

  // Rough monthly equivalent so different frequencies can be compared at a glance.
  const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }
  const active = data.recurring.filter((r) => r.next_due)
  const monthly = (kind) => active.filter((r) => r.kind === kind).reduce((s, r) => s + r.amount * PER_MONTH[r.frequency], 0)

  const remove = async (r) => {
    if (!window.confirm(`Stop "${r.description || 'this recurring entry'}"? Entries already added are kept.`)) return
    try {
      await api.budget.removeRecurring(r.recurring_id)
      onChanged()
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <GlassCard className="flex flex-col flex-1 min-h-[240px]">
      <SectionLabel>Recurring</SectionLabel>
      {active.length > 0 && (
        <div className="-mt-2 mb-2 text-[11.5px] text-[var(--text-3)]">
          ≈ <span className="text-emerald-400 font-mono">+{fmt(monthly('income'))}</span> /{' '}
          <span className="text-red-400 font-mono">−{fmt(monthly('expense'))}</span> a month
        </div>
      )}
      {data.recurring.length === 0 ? (
        <EmptyState icon={Repeat} title="No recurring income or expenses." subtitle="Pick a repeat option when adding a transaction." />
      ) : (
        <div className={`flex flex-col ${scrollCls} max-h-[420px] lg:max-h-none`}>
          {data.recurring.map((r) => {
            const cat = byId[r.category_id]
            if (editingId === r.recurring_id) {
              return (
                <EntryForm
                  key={r.recurring_id}
                  categories={data.categories}
                  entry={r}
                  entryType="recurring"
                  onSaved={() => { setEditingId(null); onChanged() }}
                  onCancel={() => setEditingId(null)}
                />
              )
            }
            const meta = [
              cat?.name || 'Uncategorized',
              FREQUENCY_LABEL[r.frequency],
              r.next_due ? `next ${r.next_due}` : 'ended',
              r.end_date && r.next_due ? `until ${r.end_date}` : null,
            ].filter(Boolean).join(' · ')
            return (
              <EntryRow
                key={r.recurring_id}
                title={r.description || cat?.name || (r.kind === 'income' ? 'Income' : 'Expense')}
                meta={meta}
                kind={r.kind}
                amount={r.amount}
                color={cat?.color}
                fmt={fmt}
                onEdit={() => setEditingId(r.recurring_id)}
                onDelete={() => remove(r)}
                deleteTitle="Stop repeating"
                wrapMeta
              />
            )
          })}
        </div>
      )}
    </GlassCard>
  )
}

// ── caps ─────────────────────────────────────────────────────────────────────

const CAP_SOURCE = {
  month: 'set for this month',
  year: 'set for this year',
  default: (isYear) => (isYear ? 'default for every year' : 'default for every month'),
  months: 'sum of the monthly caps',
}

function CapEditor({ data, isYear, year, month, fmt, onChanged }) {
  const cap = data.summary.cap
  const specific = isYear ? String(year) : `${year}-${pad(month)}`
  const fallback = isYear ? 'yearly' : 'monthly'
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState(specific)
  const [form, setForm] = useState({ total: '', categories: {} })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const capsByPeriod = useMemo(() => Object.fromEntries(data.caps.map((c) => [c.period, c])), [data.caps])
  const expenseCategories = data.categories.filter((c) => c.kind === 'expense')

  const startEditing = () => {
    const initial = capsByPeriod[specific] ? specific : capsByPeriod[fallback] ? fallback : specific
    pickScope(initial)
    setOpen(true)
  }

  const pickScope = (period) => {
    const existing = capsByPeriod[period]
    setScope(period)
    setError('')
    setForm({
      total: existing?.total != null ? String(existing.total) : '',
      categories: Object.fromEntries(Object.entries(existing?.categories || {}).map(([k, v]) => [k, String(v)])),
    })
  }

  const save = async (e) => {
    e.preventDefault()
    const categories = Object.fromEntries(
      Object.entries(form.categories).filter(([, v]) => parseFloat(v) > 0).map(([k, v]) => [k, parseFloat(v)]),
    )
    const total = parseFloat(form.total) > 0 ? parseFloat(form.total) : null
    setBusy(true)
    setError('')
    try {
      if (total == null && Object.keys(categories).length === 0) {
        if (capsByPeriod[scope]) await api.budget.removeCap(scope)
      } else {
        await api.budget.setCap(scope, { total, categories })
      }
      setOpen(false)
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await api.budget.removeCap(scope)
      setOpen(false)
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const spent = data.summary.expenses
  const source = typeof CAP_SOURCE[cap.source] === 'function' ? CAP_SOURCE[cap.source](isYear) : CAP_SOURCE[cap.source]

  return (
    <GlassCard className="shrink-0 lg:shrink lg:min-h-0 overflow-y-auto">
      <SectionLabel
        right={
          !open && (
            <button onClick={startEditing} className="text-[12px] text-[var(--text-3)] hover:text-accent-400 transition-colors flex items-center gap-1">
              <Pencil size={12} /> {cap.source ? 'Edit' : 'Set cap'}
            </button>
          )
        }
      >
        Budget cap
      </SectionLabel>

      {!open && (
        cap.source ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-[13px] text-[var(--text-2)]">Overall</div>
              <div className="text-[14px] font-mono text-[var(--text-1)]">
                {cap.total != null ? fmt(cap.total) : <span className="text-[var(--text-3)]">no limit</span>}
              </div>
            </div>
            {cap.total != null && (
              <div className={`text-[12px] ${spent > cap.total ? 'text-red-400' : 'text-[var(--text-3)]'}`}>
                {spent > cap.total
                  ? <span className="inline-flex items-center gap-1"><AlertTriangle size={12} /> Over by {fmt(spent - cap.total)}</span>
                  : `${fmt(cap.total - spent)} left`}
              </div>
            )}
            {Object.keys(cap.categories).length > 0 && (
              <div className="text-[12px] text-[var(--text-3)]">
                {Object.keys(cap.categories).length} category {Object.keys(cap.categories).length === 1 ? 'limit' : 'limits'} — see spending by category
              </div>
            )}
            <div className="text-[11.5px] text-[var(--text-3)] mt-1">Cap is {source}.</div>
          </div>
        ) : (
          <EmptyState icon={Gauge} title={`No cap for this ${isYear ? 'year' : 'month'}.`} subtitle="Set an overall limit or limits per category." />
        )
      )}

      {open && (
        <form onSubmit={save} className="flex flex-col gap-3">
          <Segmented
            options={[
              { value: specific, label: isYear ? `Only ${year}` : `Only ${periodLabel(year, month)}` },
              { value: fallback, label: isYear ? 'Every year' : 'Every month' },
            ]}
            value={scope}
            onChange={pickScope}
          />
          <label className="flex items-center justify-between gap-3 text-[13px] text-[var(--text-2)]">
            Overall cap
            <input
              type="number" min={0} step={0.01}
              value={form.total}
              onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
              placeholder="No limit"
              className={`w-36 ${inputCls}`}
            />
          </label>
          {expenseCategories.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mt-1">Per category</div>
              {expenseCategories.map((c) => (
                <label key={c.category_id} className="flex items-center justify-between gap-3 text-[13px] text-[var(--text-2)]">
                  <span className="flex items-center gap-2 min-w-0"><Swatch color={c.color} /><span className="truncate">{c.name}</span></span>
                  <input
                    type="number" min={0} step={0.01}
                    value={form.categories[c.category_id] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, categories: { ...f.categories, [c.category_id]: e.target.value } }))}
                    placeholder="No limit"
                    className={`w-36 ${inputCls}`}
                  />
                </label>
              ))}
            </div>
          )}
          {scope === fallback && (
            <div className="text-[11.5px] text-[var(--text-3)]">
              Applies to every {isYear ? 'year' : 'month'} that has no cap of its own.
            </div>
          )}
          <ErrorLine error={error} />
          <div className="flex gap-2 justify-end">
            {capsByPeriod[scope] && (
              <button type="button" onClick={remove} disabled={busy} className={`${secondaryBtnCls} mr-auto hover:!text-red-400`}>
                Remove
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className={secondaryBtnCls}>Cancel</button>
            <button type="submit" disabled={busy} className={primaryBtnCls}>Save cap</button>
          </div>
        </form>
      )}
    </GlassCard>
  )
}

// ── categories and settings ──────────────────────────────────────────────────
// Categories are shown as compact chips; clicking one (or "+ Add") opens a
// one-line editor under the chips.

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORY_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          onClick={() => onChange(c)}
          title={c}
          className={`w-5 h-5 rounded-full transition-all ${value === c ? 'ring-2 ring-offset-2 ring-[var(--text-2)] ring-offset-[var(--surf)]' : 'hover:scale-110'}`}
          style={{ background: c }}
        />
      ))}
    </div>
  )
}

const chipCls = 'inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-[12.5px] transition-all'

// `editing` is { category } for an existing one or { kind } for a new one.
function CategoryEditor({ editing, categories, onDone, onChanged }) {
  const existing = editing.category
  const kind = existing?.kind || editing.kind
  const [name, setName] = useState(existing?.name || '')
  const [color, setColor] = useState(() => {
    if (existing) return existing.color
    // Suggest the first palette colour this kind doesn't use yet.
    const used = new Set(categories.filter((c) => c.kind === kind).map((c) => c.color))
    return CATEGORY_COLORS.find((c) => !used.has(c)) || CATEGORY_COLORS[0]
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (action) => {
    setBusy(true)
    setError('')
    try {
      await action()
      onDone()
      onChanged()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const save = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    run(() =>
      existing
        ? api.budget.updateCategory(existing.category_id, { name: name.trim(), color })
        : api.budget.createCategory({ name: name.trim(), kind, color }),
    )
  }

  const remove = () => {
    if (!window.confirm(`Delete category "${existing.name}"? Its transactions become uncategorized.`)) return
    run(() => api.budget.removeCategory(existing.category_id))
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-col gap-2 p-3 rounded-xl bg-[var(--surf)] border border-accent-400">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-400">
          {existing ? 'Edit' : 'New'} {kind === 'income' ? 'income' : 'spending'} category
        </span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name…"
          maxLength={40}
          className={`flex-1 min-w-[140px] !py-1.5 ${inputCls}`}
        />
        <ColorPicker value={color} onChange={setColor} />
        <div className="flex gap-2 ml-auto">
          {existing && (
            <button type="button" onClick={remove} disabled={busy} title="Delete category"
              className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-3)] hover:text-red-400 transition-all">
              <Trash2 size={14} />
            </button>
          )}
          <button type="button" onClick={onDone} className={`${secondaryBtnCls} !py-1.5`}>Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className={`${primaryBtnCls} !py-1.5`}>{existing ? 'Save' : 'Add'}</button>
        </div>
      </div>
      <ErrorLine error={error} />
    </form>
  )
}

function CategoryManager({ data, onChanged, onError }) {
  const [editing, setEditing] = useState(null)
  const currency = data.settings.currency
  const options = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]

  const changeCurrency = async (value) => {
    try {
      await api.budget.updateSettings({ currency: value })
      onChanged()
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <GlassCard className="!py-5">
      <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-6">
        <div className="flex lg:flex-col items-center lg:items-start justify-between gap-3 lg:w-40 shrink-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Categories</div>
          <label className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
            Currency
            <select value={currency} onChange={(e) => changeCurrency(e.target.value)} className={`${inputCls} !py-1 !px-2 !text-[12.5px]`}>
              {options.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {['expense', 'income'].map((kind) => (
            <div key={kind} className="flex items-start gap-3">
              <div className="w-16 shrink-0 pt-1.5 text-[11.5px] text-[var(--text-3)]">{kind === 'expense' ? 'Spending' : 'Income'}</div>
              <div className="flex flex-wrap gap-1.5">
                {data.categories.filter((c) => c.kind === kind).map((c) => {
                  const active = editing?.category?.category_id === c.category_id
                  return (
                    <button
                      key={c.category_id}
                      onClick={() => setEditing(active ? null : { category: c })}
                      title="Edit category"
                      className={`${chipCls} ${active ? 'border-accent-400 bg-accent-500/10 text-[var(--text-1)]' : 'border-[var(--border)] bg-[var(--surf-2)] text-[var(--text-2)] hover:border-accent-400'}`}
                    >
                      <Swatch color={c.color} size={8} />
                      {c.name}
                    </button>
                  )
                })}
                <button
                  onClick={() => setEditing({ kind })}
                  className={`${chipCls} border-dashed border-[var(--border-2)] text-[var(--text-3)] hover:border-accent-400 hover:text-accent-400`}
                >
                  <Plus size={12} /> Add
                </button>
              </div>
            </div>
          ))}
          {editing && (
            <CategoryEditor
              key={editing.category?.category_id || `new-${editing.kind}`}
              editing={editing}
              categories={data.categories}
              onDone={() => setEditing(null)}
              onChanged={onChanged}
            />
          )}
        </div>
      </div>
    </GlassCard>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function Budget() {
  const now = new Date()
  const [period, setPeriod] = useState({ view: 'month', year: now.getFullYear(), month: now.getMonth() + 1 })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [chartMode, setChartMode] = useState('flow')
  const latest = useRef(0)

  const isYear = period.view === 'year'
  const load = useCallback(async () => {
    const id = ++latest.current // ignore responses for a period the user already left
    try {
      const result = await api.budget.overview(period.year, isYear ? null : period.month)
      if (id === latest.current) {
        setData(result)
        setError('')
      }
    } catch (err) {
      if (id === latest.current) setError(err.message)
    }
  }, [period.year, period.month, isYear])

  useEffect(() => {
    load()
  }, [load])

  const fmt = useMemo(() => {
    const f = new Intl.NumberFormat(undefined, { style: 'currency', currency: data?.settings.currency || 'EUR' })
    return (n) => f.format(n)
  }, [data?.settings.currency])

  const label = periodLabel(period.year, isYear ? null : period.month)
  const s = data?.summary
  const scope = isYear ? 'this year' : 'this month'

  let tiles = []
  let progress = null
  if (s) {
    tiles = [
      {
        label: 'Income',
        value: fmt(s.income),
        hint: s.projected_income ? `+${fmt(s.projected_income)} upcoming` : scope,
        tone: 'text-emerald-400',
      },
      {
        label: 'Expenses',
        value: fmt(s.expenses),
        hint: s.projected_expenses ? `+${fmt(s.projected_expenses)} upcoming` : scope,
        tone: 'text-red-400',
      },
      {
        label: 'Balance',
        value: fmt(s.balance),
        hint: s.projected_income || s.projected_expenses
          ? `${fmt(s.balance + s.projected_income - s.projected_expenses)} projected`
          : s.balance >= 0 ? 'saved' : 'overspent',
        tone: s.balance < 0 ? 'text-red-400' : 'text-accent-400',
      },
      s.cap.total != null
        ? {
            label: 'Cap left',
            value: fmt(s.cap.total - s.expenses),
            hint: `of ${fmt(s.cap.total)} cap`,
            tone: s.expenses > s.cap.total ? 'text-red-400' : 'text-sky-400',
          }
        : { label: 'Cap', value: '—', hint: 'no cap set' },
    ]
    if (s.cap.total) {
      const pct = Math.round((s.expenses / s.cap.total) * 100)
      progress = {
        pct,
        label: s.expenses > s.cap.total ? `Over the cap by ${fmt(s.expenses - s.cap.total)}` : `${pct}% of the cap used`,
      }
    } else if (s.income > 0) {
      const pct = Math.round((s.expenses / s.income) * 100)
      progress = { pct, label: `${pct}% of income spent` }
    }
  }

  return (
    <PageTransition>
      <PageHero icon={Wallet} theme="amber" title="Budget" subtitle={label} tiles={tiles} progress={progress} />

      <PeriodBar
        view={period.view}
        year={period.year}
        month={period.month}
        onChange={(patch) => setPeriod((p) => ({ ...p, ...patch }))}
      />

      {error && (
        <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-400 flex items-center justify-between gap-3">
          {error}
          <button onClick={() => setError('')} className="shrink-0"><X size={14} /></button>
        </div>
      )}

      {!data ? (
        !error && <GlassCard><div className="h-40 rounded-xl bg-[var(--surf-2)] animate-pulse" /></GlassCard>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <GlassCard className={`lg:col-span-2 min-w-0 flex flex-col ${ROW1_H}`}>
              <SectionLabel
                right={
                  <Segmented
                    options={[{ value: 'flow', label: 'Flow' }, { value: 'trend', label: 'Over time' }]}
                    value={chartMode}
                    onChange={setChartMode}
                  />
                }
              >
                {chartMode === 'flow' ? 'Budget flow' : isYear ? 'Income and expenses' : 'Spending so far'}
              </SectionLabel>
              {chartMode === 'flow' ? (
                <BudgetFlow summary={s} fmt={fmt} />
              ) : (
                <BudgetChart summary={s} isYear={isYear} fmt={fmt} />
              )}
            </GlassCard>
            <CategoryBreakdown summary={s} fmt={fmt} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Transactions data={data} year={period.year} month={isYear ? null : period.month} fmt={fmt} onChanged={load} onError={setError} />
            <div className={`flex flex-col gap-5 min-h-0 ${ROW2_H}`}>
              <CapEditor
                key={`${period.view}-${period.year}-${period.month}`}
                data={data}
                isYear={isYear}
                year={period.year}
                month={period.month}
                fmt={fmt}
                onChanged={load}
              />
              <RecurringList data={data} fmt={fmt} onChanged={load} onError={setError} />
            </div>
          </div>

          <CategoryManager data={data} onChanged={load} onError={setError} />
        </>
      )}
    </PageTransition>
  )
}
