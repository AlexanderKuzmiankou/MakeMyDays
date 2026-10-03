import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Camera, ChevronLeft, Pencil, Plus, Receipt, Repeat, Trash2, UserPlus, Users, X } from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageTransition from '../components/PageTransition.jsx'
import AvatarCircle from '../components/AvatarCircle.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { todayStr } from '../utils.js'
import { fileToAvatarDataUrl } from '../avatar.js'

const DEFAULT_CURRENCY = 'EUR'
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'CZK', 'SEK', 'NOK', 'DKK', 'HUF', 'RON', 'UAH', 'JPY', 'CAD', 'AUD']
const FREQUENCIES = [
  { value: '', label: 'One-off' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
]

const inputCls =
  'bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent-400 placeholder:text-[var(--text-3)]'
const primaryBtnCls =
  'px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40'
const dashedBtnCls =
  'w-full py-2.5 rounded-xl border border-dashed border-[var(--border-2)] text-[var(--text-3)] text-[13px] flex items-center justify-center gap-1.5 hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all'
// Row actions appear on hover with a mouse, but stay visible on touch screens.
const rowActionCls =
  'sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] transition-all'

function fmtMoney(amount, currency, { signed = false } = {}) {
  const abs = new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Math.abs(amount))
  if (!signed) return abs
  return `${amount < 0 ? '-' : '+'}${abs}`
}

// { EUR: 12, USD: 3 } -> "€12.00 · $3.00"
function fmtTotals(totals) {
  const entries = Object.entries(totals).filter(([, v]) => v !== 0)
  if (entries.length === 0) return fmtMoney(0, DEFAULT_CURRENCY)
  return entries.map(([c, v]) => fmtMoney(v, c)).join(' · ')
}

// What an expense means for one user: positive = they get money back,
// negative = they owe. Mirrors service.split_amount — equal split to the cent,
// leftover cents go to the first participants.
function netForUser(expense, userId) {
  const cents = Math.round(expense.amount * 100)
  const n = expense.split_between.length
  const idx = expense.split_between.indexOf(userId)
  const shareCents = idx === -1 ? 0 : Math.floor(cents / n) + (idx < cents % n ? 1 : 0)
  const paidCents = expense.paid_by === userId ? cents : 0
  return (paidCents - shareCents) / 100
}

function CurrencySelect({ value, onChange, className = '' }) {
  const options = CURRENCIES.includes(value) ? CURRENCIES : [value, ...CURRENCIES]
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} ${className}`}>
      {options.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  )
}

function SectionLabel({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">{children}</div>
      {right}
    </div>
  )
}

function ErrorLine({ error }) {
  if (!error) return null
  return <div className="text-[12px] text-red-400">{error}</div>
}

function StatChip({ tone, label, value }) {
  const tones = {
    good: 'bg-emerald-500/10 text-emerald-400',
    bad: 'bg-red-500/10 text-red-400',
    neutral: 'bg-[var(--surf-2)] text-[var(--text-2)]',
  }
  return (
    // Stacked on phones so a row of chips fits; inline from sm up.
    <div
      className={`flex-1 sm:flex-none min-w-0 flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-1.5 rounded-lg px-2.5 py-1.5 ${tones[tone]}`}
    >
      <span className="text-[10px] sm:text-[11px] uppercase tracking-wide opacity-80 truncate">{label}</span>
      <span className="text-[13px] sm:text-[13.5px] font-semibold font-mono truncate">{value}</span>
    </div>
  )
}

function GroupAvatar({ group, size = 36 }) {
  const style = { width: size, height: size }
  if (group.avatar_url) {
    return <img src={group.avatar_url} alt={group.name} className="rounded-lg object-cover shrink-0" style={style} />
  }
  return (
    <div className="rounded-lg bg-accent-500/15 flex items-center justify-center shrink-0" style={style}>
      <Users size={Math.round(size * 0.42)} className="text-accent-400" />
    </div>
  )
}

// Click to upload a group picture; the small × removes it.
function EditableGroupAvatar({ group, onChange, onError, size = 40 }) {
  const [busy, setBusy] = useState(false)

  const save = async (avatar_url) => {
    setBusy(true)
    try {
      onChange(await api.sharedCosts.updateGroup(group.group_id, { avatar_url }))
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await save(await fileToAvatarDataUrl(file))
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <div className="relative shrink-0 group/avatar">
      <label title="Change group picture" className={`block cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
        <GroupAvatar group={group} size={size} />
        <span className="absolute inset-0 rounded-lg bg-black/45 flex items-center justify-center text-white opacity-0 group-hover/avatar:opacity-100 transition-opacity">
          <Camera size={15} />
        </span>
        <input type="file" accept="image/*" onChange={pick} className="hidden" />
      </label>
      {group.avatar_url && !busy && (
        <button
          onClick={() => save('')}
          title="Remove group picture"
          className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full flex items-center justify-center bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-3)] hover:text-red-400 sm:opacity-0 sm:group-hover/avatar:opacity-100 transition-all"
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

// Overlapping member avatars, e.g. in the group list.
function MemberStack({ members, max = 4, size = 18 }) {
  const shown = members.slice(0, max)
  const extra = members.length - shown.length
  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <AvatarCircle
          key={m.user_id}
          user={{ ...m, name: m.name || m.email }}
          size={size}
          className={`ring-2 ring-[var(--surf)] ${i > 0 ? '-ml-1.5' : ''}`}
        />
      ))}
      {extra > 0 && <span className="ml-1 text-[11px] text-[var(--text-3)]">+{extra}</span>}
    </div>
  )
}

// Compact page header shared by the overview and a group. In a group it acts
// as a breadcrumb ("Shared Costs › Group") with the way back on the left.
function PageHeader({ group, onBack, onGroupChanged, onError, chips, actions }) {
  return (
    <motion.section
      className="glass rounded-2xl px-4 py-3 sm:px-5 sm:py-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 sm:gap-y-3">
        {group ? (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={onBack}
              title="Back to all groups"
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-accent-400 hover:border-accent-400 transition-all"
            >
              <ChevronLeft size={18} />
            </button>
            <EditableGroupAvatar group={group} onChange={onGroupChanged} onError={onError} />
            <div className="min-w-0">
              <button
                onClick={onBack}
                className="text-[11.5px] text-[var(--text-3)] hover:text-accent-400 transition-colors"
              >
                Shared Costs
              </button>
              <span className="hidden sm:inline text-[11.5px] text-[var(--text-3)]"> › {group.members.length} {group.members.length === 1 ? 'member' : 'members'}</span>
              <h1 className="text-[20px] leading-tight font-semibold font-serif truncate">{group.name}</h1>
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] leading-tight font-semibold font-serif">Shared Costs</h1>
            <div className="hidden sm:block text-[12px] text-[var(--text-3)]">Split group expenses and settle up</div>
          </div>
        )}
        {actions && <div className="shrink-0 sm:order-last">{actions}</div>}
        {chips && <div className="w-full sm:w-auto flex flex-wrap gap-2">{chips}</div>}
      </div>
    </motion.section>
  )
}

// ── overview ─────────────────────────────────────────────────────────────────

function NewGroupForm({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const group = await api.sharedCosts.createGroup({ name: name.trim(), currency })
      setOpen(false)
      setName('')
      setCurrency(DEFAULT_CURRENCY)
      onCreated(group)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`mt-1 ${dashedBtnCls}`}>
        <Plus size={14} /> New group
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-1 flex flex-col gap-2.5 p-4 rounded-xl bg-[var(--surf)] border border-[var(--border)]">
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name…"
          maxLength={80}
          className={`flex-1 min-w-[140px] ${inputCls}`}
        />
        <CurrencySelect value={currency} onChange={setCurrency} />
        <button type="submit" disabled={submitting || !name.trim()} className={primaryBtnCls}>Create</button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all"
        >
          <X size={14} />
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  )
}

// The current user's net position in a group, e.g. "+€50.00 / you're owed".
function GroupBalance({ balance }) {
  const entries = Object.entries(balance).filter(([, v]) => v !== 0)
  if (entries.length === 0) {
    return <div className="text-[12px] text-[var(--text-3)] shrink-0">settled</div>
  }
  return (
    <div className="flex flex-col items-end shrink-0">
      {entries.map(([currency, amount]) => (
        <div key={currency} className={`text-[13px] font-mono font-medium ${amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          {fmtMoney(amount, currency, { signed: true })}
        </div>
      ))}
      {entries.length === 1 && (
        <div className={`text-[11px] ${entries[0][1] < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          {entries[0][1] < 0 ? 'you owe' : "you're owed"}
        </div>
      )}
    </div>
  )
}

function Overview({ data, people, currentUserId, onOpenGroup, onGroupCreated }) {
  // Sum per currency so different currencies are never added together.
  const owed = {}
  const owe = {}
  for (const b of data.balances) {
    const bucket = b.amount > 0 ? owed : owe
    bucket[b.currency] = (bucket[b.currency] || 0) + Math.abs(b.amount)
  }

  const groupName = Object.fromEntries(data.groups.map((g) => [g.group_id, g.name]))

  return (
    <>
      <PageHeader
        chips={
          <>
            <StatChip tone={Object.keys(owed).length ? 'good' : 'neutral'} label="You're owed" value={fmtTotals(owed)} />
            <StatChip tone={Object.keys(owe).length ? 'bad' : 'neutral'} label="You owe" value={fmtTotals(owe)} />
            <StatChip tone="neutral" label="Groups" value={data.groups.length} />
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard>
          <SectionLabel>Groups</SectionLabel>
          <div className="flex flex-col gap-3">
            {data.groups.length === 0 && <EmptyState icon={Users} title="No groups yet — create one to start splitting." />}
            {data.groups.map((g) => (
              <button
                key={g.group_id}
                onClick={() => onOpenGroup(g.group_id)}
                className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surf)] border border-[var(--border)] px-3.5 py-3 text-left hover:border-accent-400 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <GroupAvatar group={g} size={38} />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-medium text-[var(--text-1)] truncate">{g.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11.5px] text-[var(--text-3)]">
                      <MemberStack members={g.members} />
                      <span>· {g.currency}</span>
                    </div>
                  </div>
                </div>
                <GroupBalance balance={g.balance || {}} />
              </button>
            ))}
            <NewGroupForm onCreated={onGroupCreated} />
          </div>
        </GlassCard>

        <GlassCard>
          <SectionLabel>Balances</SectionLabel>
          {data.balances.length === 0 ? (
            <EmptyState title="All settled up." />
          ) : (
            <div className="flex flex-col">
              {data.balances.map((b) => {
                const person = people[b.user_id] || { name: 'Unknown' }
                return (
                  <div
                    key={`${b.user_id}-${b.currency}`}
                    className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-b-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AvatarCircle user={{ ...person, name: person.name || person.email }} size={26} />
                      <span className="text-[13.5px] text-[var(--text-1)] truncate">{person.name || person.email}</span>
                    </div>
                    <div className={`text-[13px] font-mono font-medium shrink-0 ${b.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {fmtMoney(b.amount, b.currency, { signed: true })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </GlassCard>
      </div>

      <GlassCard>
        <SectionLabel>Recent shared expenses</SectionLabel>
        {data.recent_expenses.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses yet." />
        ) : (
          <div className="flex flex-col">
            {data.recent_expenses.map((e) => (
              <ExpenseRow
                key={e.expense_id}
                expense={e}
                people={people}
                currentUserId={currentUserId}
                groupName={groupName[e.group_id]}
              />
            ))}
          </div>
        )}
      </GlassCard>
    </>
  )
}

function ExpenseRow({ expense: e, people, currentUserId, groupName, onEdit, onDelete }) {
  const payer = e.paid_by === currentUserId ? { name: 'You' } : people[e.paid_by]
  const net = netForUser(e, currentUserId)
  const involved = e.paid_by === currentUserId || e.split_between.includes(currentUserId)

  let tone = 'text-[var(--text-2)]'
  let note = involved ? 'your own expense' : 'not involved'
  if (net > 0) {
    tone = 'text-emerald-400'
    note = `you get back ${fmtMoney(net, e.currency)}`
  } else if (net < 0) {
    tone = 'text-red-400'
    note = `you owe ${fmtMoney(net, e.currency)}`
  }

  return (
    <div className="group flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`w-1 self-stretch rounded-full shrink-0 ${net > 0 ? 'bg-emerald-400' : net < 0 ? 'bg-red-400' : 'bg-[var(--border-2)]'}`}
        />
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-[var(--text-1)] truncate flex items-center gap-1.5">
            {e.recurring_id && <Repeat size={12} className="text-accent-400 shrink-0" title="Recurring" />}
            {e.description}
          </div>
          <div className="text-[11.5px] text-[var(--text-3)] mt-0.5">
            {payer?.name || payer?.email || 'Someone'} paid ·{' '}
            {e.split_between.includes(e.paid_by)
              ? `split ${e.split_between.length} ${e.split_between.length === 1 ? 'way' : 'ways'}`
              : 'owed in full'}
            {groupName ? ` · ${groupName}` : ''} · {e.date}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <div className="text-right">
          <div className={`text-[13px] font-mono font-medium ${tone}`}>{fmtMoney(e.amount, e.currency)}</div>
          <div className={`text-[11px] ${net === 0 ? 'text-[var(--text-3)]' : tone}`}>{note}</div>
        </div>
        {onEdit && (
          <button onClick={() => onEdit(e)} className={`${rowActionCls} hover:text-accent-400 hover:bg-accent-500/10`} title="Edit expense">
            <Pencil size={13} />
          </button>
        )}
        {onDelete && (
          <button onClick={() => onDelete(e)} className={`${rowActionCls} hover:text-red-400 hover:bg-red-500/10`} title="Delete expense">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ── group detail ─────────────────────────────────────────────────────────────

function AddMemberForm({ groupId, onAdded }) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError('')
    try {
      onAdded(await api.sharedCosts.addMember(groupId, email.trim()))
      setEmail('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Add by email…"
          className={`flex-1 min-w-0 ${inputCls}`}
        />
        <button type="submit" disabled={submitting || !email.trim()} className={`${primaryBtnCls} flex items-center gap-1.5`}>
          <UserPlus size={14} /> Add
        </button>
      </div>
      <ErrorLine error={error} />
    </form>
  )
}

const SPLIT_MODES = [
  { value: 'equal', label: 'Split equally' },
  { value: 'owed', label: "You're owed full" },
  { value: 'owe', label: 'You owe full' },
]

// Which split option an existing expense corresponds to, from your point of view.
function detectSplitMode(expense, currentUserId) {
  const { paid_by: payer, split_between: split } = expense
  if (split.includes(payer)) return 'equal'
  if (payer === currentUserId) return 'owed'
  if (split.length === 1 && split[0] === currentUserId) return 'owe'
  return 'equal'
}

// Creates a one-off or recurring expense, or edits an existing one when
// `expense` is given (a single occurrence, so the repeat options are hidden).
function ExpenseForm({ group, currentUserId, expense, onSaved, onCancel }) {
  const editing = Boolean(expense)
  const [form, setForm] = useState(() =>
    editing
      ? {
          description: expense.description,
          amount: String(expense.amount),
          currency: expense.currency,
          paidBy: expense.paid_by,
          split: expense.split_between,
          date: expense.date,
          frequency: '',
          endDate: '',
        }
      : {
          description: '',
          amount: '',
          currency: group.currency,
          paidBy: currentUserId,
          split: group.members.map((m) => m.user_id),
          date: todayStr(),
          frequency: '',
          endDate: '',
        },
  )
  const others = (uid) => group.members.map((m) => m.user_id).filter((id) => id !== uid)
  const [splitMode, setSplitMode] = useState(() => (editing ? detectSplitMode(expense, currentUserId) : 'equal'))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const splitBetween =
    splitMode === 'owed' ? form.split.filter((id) => id !== currentUserId)
    : splitMode === 'owe' ? [currentUserId]
    : form.split

  const toggleSplit = (uid) =>
    set({ split: form.split.includes(uid) ? form.split.filter((id) => id !== uid) : [...form.split, uid] })

  const changeSplitMode = (mode) => {
    setSplitMode(mode)
    if (mode === 'equal') {
      set({ split: group.members.map((m) => m.user_id) })
    } else if (mode === 'owed') {
      set({ paidBy: currentUserId, split: others(currentUserId) })
    } else {
      set({ paidBy: form.paidBy !== currentUserId ? form.paidBy : others(currentUserId)[0], split: [currentUserId] })
    }
  }

  const valid = form.description.trim() && parseFloat(form.amount) > 0 && splitBetween.length > 0

  const submit = async (e) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError('')
    const common = {
      description: form.description.trim(),
      amount: parseFloat(form.amount),
      currency: form.currency,
      paid_by: form.paidBy,
      split_between: splitBetween,
    }
    try {
      if (editing) {
        await api.sharedCosts.updateExpense(group.group_id, expense.expense_id, { ...common, date: form.date })
      } else if (form.frequency) {
        await api.sharedCosts.createRecurring(group.group_id, {
          ...common,
          frequency: form.frequency,
          start_date: form.date,
          end_date: form.endDate || null,
        })
      } else {
        await api.sharedCosts.createExpense(group.group_id, { ...common, date: form.date })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className={`flex flex-col gap-3 p-4 rounded-xl bg-[var(--surf)] border ${editing ? 'border-accent-400 my-2' : 'border-[var(--border)]'}`}
    >
      {editing && (
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400">
          Edit expense{expense.recurring_id ? ' (this occurrence only)' : ''}
        </div>
      )}
      <input
        autoFocus
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="What was it for?"
        maxLength={120}
        className={inputCls}
      />
      <div className="flex flex-wrap gap-2">
        <input
          type="number" min={0.01} step={0.01}
          value={form.amount}
          onChange={(e) => set({ amount: e.target.value })}
          placeholder="Amount"
          className={`w-32 ${inputCls}`}
        />
        <CurrencySelect value={form.currency} onChange={(currency) => set({ currency })} />
        {splitMode !== 'owed' && (
          <select value={form.paidBy} onChange={(e) => set({ paidBy: e.target.value })} className={`flex-1 min-w-[140px] ${inputCls}`}>
            {group.members
              .filter((m) => splitMode !== 'owe' || m.user_id !== currentUserId)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  Paid by {m.user_id === currentUserId ? 'you' : m.name || m.email}
                </option>
              ))}
          </select>
        )}
      </div>

      <div>
        {group.members.length > 1 && (
          <div className="flex sm:inline-flex mb-2 p-0.5 rounded-lg bg-[var(--surf-2)] border border-[var(--border)]">
            {SPLIT_MODES.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => changeSplitMode(opt.value)}
                className={`flex-1 sm:flex-none px-2.5 sm:px-3 py-1 rounded-md text-[12px] leading-tight transition-all ${
                  splitMode === opt.value ? 'bg-accent-500 text-white' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {splitMode === 'owe' ? (
          <div className="text-[12px] text-[var(--text-2)]">
            You owe {group.members.find((m) => m.user_id === form.paidBy)?.name || 'them'} the full amount.
          </div>
        ) : (
          <>
            <div className="text-[11.5px] text-[var(--text-3)] mb-1.5">
              {splitMode === 'owed' ? 'Owed to you in full by' : 'Split equally between'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.members
                .filter((m) => splitMode !== 'owed' || m.user_id !== currentUserId)
                .map((m) => {
                  const on = form.split.includes(m.user_id)
                  return (
                    <button
                      type="button"
                      key={m.user_id}
                      onClick={() => toggleSplit(m.user_id)}
                      className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-[12px] border transition-all ${
                        on
                          ? 'bg-accent-500/15 border-accent-400 text-accent-400'
                          : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-2)]'
                      }`}
                    >
                      <AvatarCircle user={m} size={18} className={on ? '' : 'opacity-50'} />
                      {m.user_id === currentUserId ? 'You' : m.name || m.email}
                    </button>
                  )
                })}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {!editing && (
          <select value={form.frequency} onChange={(e) => set({ frequency: e.target.value })} className={inputCls}>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
          {form.frequency ? 'Starts' : 'Date'}
          <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} required className={inputCls} />
        </label>
        {form.frequency && (
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
            Ends
            <input
              type="date"
              value={form.endDate}
              min={form.date}
              onChange={(e) => set({ endDate: e.target.value })}
              className={inputCls}
            />
          </label>
        )}
      </div>

      <ErrorLine error={error} />
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-[13px] bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all"
        >
          Cancel
        </button>
        <button type="submit" disabled={submitting || !valid} className={primaryBtnCls}>
          {editing ? 'Save changes' : form.frequency ? 'Add recurring expense' : 'Add expense'}
        </button>
      </div>
    </form>
  )
}

function GroupDetail({ group, currentUserId, onBack, onGroupChanged }) {
  const [expenses, setExpenses] = useState(null)
  const [recurring, setRecurring] = useState([])
  const [balances, setBalances] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const people = useMemo(() => Object.fromEntries(group.members.map((m) => [m.user_id, m])), [group.members])
  const nameOf = (uid) => (uid === currentUserId ? 'You' : people[uid]?.name || people[uid]?.email || 'Unknown')

  const load = () => {
    const id = group.group_id
    // Expenses first: reading them materializes due recurring occurrences.
    return api.sharedCosts
      .expenses(id)
      .then(async (exp) => {
        const [rec, bal] = await Promise.all([api.sharedCosts.recurring(id), api.sharedCosts.balances(id)])
        setExpenses(exp)
        setRecurring(rec)
        setBalances(bal)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    load()
  }, [group.group_id])

  const changeCurrency = async (currency) => {
    try {
      onGroupChanged(await api.sharedCosts.updateGroup(group.group_id, { currency }))
    } catch (err) {
      setError(err.message)
    }
  }

  const removeExpense = async (expense) => {
    if (!window.confirm(`Delete "${expense.description}"?`)) return
    setExpenses((prev) => prev.filter((e) => e.expense_id !== expense.expense_id))
    try {
      await api.sharedCosts.removeExpense(group.group_id, expense.expense_id)
    } finally {
      load()
    }
  }

  const stopRecurring = async (r) => {
    if (!window.confirm(`Stop "${r.description}"? Expenses already added are kept.`)) return
    try {
      await api.sharedCosts.removeRecurring(group.group_id, r.recurring_id)
    } finally {
      load()
    }
  }

  // The current user's net position in this group, per currency.
  const myBalance = {}
  for (const c of balances?.currencies || []) {
    const mine = c.balances.find((b) => b.user_id === currentUserId)
    if (mine && mine.amount !== 0) myBalance[c.currency] = mine.amount
  }
  const myEntries = Object.entries(myBalance)

  return (
    <>
      <PageHeader
        group={group}
        onBack={onBack}
        onGroupChanged={onGroupChanged}
        onError={setError}
        chips={
          balances &&
          (myEntries.length === 0 ? (
            <StatChip tone="neutral" label="You" value="settled" />
          ) : (
            myEntries.map(([currency, amount]) => (
              <StatChip
                key={currency}
                tone={amount > 0 ? 'good' : 'bad'}
                label={amount > 0 ? "You're owed" : 'You owe'}
                value={fmtMoney(amount, currency)}
              />
            ))
          ))
        }
        actions={
          <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-3)]" title="Used for new expenses in this group">
            <span className="hidden sm:inline">Currency</span>
            <CurrencySelect value={group.currency} onChange={changeCurrency} className="!py-1.5 !text-[13px]" />
          </label>
        }
      />
      <ErrorLine error={error} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard>
          <SectionLabel>Members</SectionLabel>
          <div className="flex flex-col">
            {group.members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2.5 py-2 border-b border-[var(--border)] last:border-b-0">
                <AvatarCircle user={{ ...m, name: m.name || m.email }} size={30} />
                <div className="min-w-0">
                  <div className="text-[13.5px] text-[var(--text-1)] truncate">
                    {m.name || m.email}
                    {m.user_id === currentUserId && <span className="text-[var(--text-3)]"> (you)</span>}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-3)] truncate">{m.email}</div>
                </div>
              </div>
            ))}
          </div>
          <AddMemberForm groupId={group.group_id} onAdded={onGroupChanged} />
        </GlassCard>

        <GlassCard>
          <SectionLabel>Settle up</SectionLabel>
          {balances === null ? (
            <div className="skeleton-line" style={{ width: '70%' }} />
          ) : balances.currencies.every((c) => c.settlements.length === 0) ? (
            <EmptyState title="All settled up." />
          ) : (
            <div className="flex flex-col">
              {balances.currencies.flatMap((c) =>
                c.settlements.map((s) => (
                  <div
                    key={`${c.currency}-${s.from}-${s.to}`}
                    className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border)] last:border-b-0"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 text-[13.5px] text-[var(--text-1)]">
                      <AvatarCircle user={{ ...people[s.from], name: people[s.from]?.name || people[s.from]?.email }} size={22} />
                      <span className="truncate">{nameOf(s.from)}</span>
                      <ArrowRight size={12} className="shrink-0 text-[var(--text-3)]" />
                      <AvatarCircle user={{ ...people[s.to], name: people[s.to]?.name || people[s.to]?.email }} size={22} />
                      <span className="truncate">{nameOf(s.to)}</span>
                    </div>
                    <div
                      className={`text-[13px] font-mono font-medium shrink-0 ${
                        s.from === currentUserId ? 'text-red-400' : s.to === currentUserId ? 'text-emerald-400' : 'text-[var(--text-2)]'
                      }`}
                    >
                      {fmtMoney(s.amount, c.currency)}
                    </div>
                  </div>
                )),
              )}
            </div>
          )}
        </GlassCard>
      </div>

      {recurring.length > 0 && (
        <GlassCard>
          <SectionLabel>Recurring</SectionLabel>
          <div className="flex flex-col">
            {recurring.map((r) => (
              <div key={r.recurring_id} className="group flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border)] last:border-b-0">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-[var(--text-1)] truncate flex items-center gap-1.5">
                    <Repeat size={12} className="text-accent-400 shrink-0" /> {r.description}
                  </div>
                  <div className="text-[11.5px] text-[var(--text-3)] mt-0.5">
                    {FREQUENCIES.find((f) => f.value === r.frequency)?.label} · {nameOf(r.paid_by)} pays ·{' '}
                    {r.next_due ? `next ${r.next_due}` : 'ended'}
                    {r.end_date ? ` · until ${r.end_date}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <div className="text-[13px] font-mono font-medium text-[var(--text-2)]">{fmtMoney(r.amount, r.currency)}</div>
                  <button
                    onClick={() => stopRecurring(r)}
                    className={`${rowActionCls} hover:text-red-400 hover:bg-red-500/10`}
                    title="Stop recurring"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard>
        <SectionLabel>Expenses</SectionLabel>
        <div className="mb-4">
          {adding ? (
            <ExpenseForm
              group={group}
              currentUserId={currentUserId}
              onSaved={() => {
                setAdding(false)
                load()
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              onClick={() => {
                setEditingId(null)
                setAdding(true)
              }}
              className={dashedBtnCls}
            >
              <Receipt size={14} /> Add expense
            </button>
          )}
        </div>
        {expenses === null ? (
          <div className="flex flex-col gap-3 py-2">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton-line" style={{ width: `${60 + i * 10}%` }} />)}
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses in this group yet." />
        ) : (
          <div className="flex flex-col">
            {expenses.map((e) =>
              e.expense_id === editingId ? (
                <ExpenseForm
                  key={e.expense_id}
                  group={group}
                  currentUserId={currentUserId}
                  expense={e}
                  onSaved={() => {
                    setEditingId(null)
                    load()
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ExpenseRow
                  key={e.expense_id}
                  expense={e}
                  people={people}
                  currentUserId={currentUserId}
                  onEdit={(exp) => {
                    setAdding(false)
                    setEditingId(exp.expense_id)
                  }}
                  onDelete={removeExpense}
                />
              ),
            )}
          </div>
        )}
      </GlassCard>
    </>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function SharedCosts() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)
  const [openGroupId, setOpenGroupId] = useState(null)

  const load = () => api.sharedCosts.overview().then(setData).catch(() => setError(true))

  useEffect(() => {
    load()
  }, [])

  // Everyone the current user shares a group with, for resolving user ids to names.
  const people = useMemo(() => {
    const map = {}
    for (const g of data?.groups || []) for (const m of g.members) map[m.user_id] = m
    return map
  }, [data])

  const openGroup = data?.groups.find((g) => g.group_id === openGroupId)

  const replaceGroup = (group) =>
    setData((d) => ({ ...d, groups: d.groups.map((g) => (g.group_id === group.group_id ? { ...g, ...group } : g)) }))

  return (
    <PageTransition>
      {data === null && !error ? (
        <>
          <PageHeader />
          <GlassCard>
            <div className="flex flex-col gap-3 py-2">
              {[1, 2, 3].map((i) => <div key={i} className="skeleton-line" style={{ width: `${60 + i * 10}%` }} />)}
            </div>
          </GlassCard>
        </>
      ) : error ? (
        <>
          <PageHeader />
          <GlassCard>
            <EmptyState title="Could not load shared costs." subtitle="Backend may be offline." />
          </GlassCard>
        </>
      ) : openGroup ? (
        <GroupDetail
          key={openGroup.group_id}
          group={openGroup}
          currentUserId={user?.user_id}
          onBack={() => {
            setOpenGroupId(null)
            load()
          }}
          onGroupChanged={replaceGroup}
        />
      ) : (
        <Overview
          data={data}
          people={people}
          currentUserId={user?.user_id}
          onOpenGroup={setOpenGroupId}
          onGroupCreated={(group) => {
            setData((d) => ({ ...d, groups: [...d.groups, { ...group, totals: {}, balance: {} }] }))
            setOpenGroupId(group.group_id)
          }}
        />
      )}
    </PageTransition>
  )
}
