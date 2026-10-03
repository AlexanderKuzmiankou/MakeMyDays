import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ExternalLink, Pencil, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageTransition from '../components/PageTransition.jsx'
import { api } from '../api.js'

const inputCls =
  'bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent-400 placeholder:text-[var(--text-3)]'
const primaryBtnCls =
  'px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40'
// Row actions appear on hover with a mouse, but stay visible on touch screens.
const rowActionCls =
  'sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] transition-all shrink-0'

const EMPTY_FORM = { name: '', description: '', priceMin: '', priceMax: '', url: '' }

const eur = (value) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: value % 1 ? 2 : 0 }).format(value)

function fmtRange(low, high) {
  if (low == null && high == null) return ''
  if (low != null && high != null) return low === high ? eur(low) : `${eur(low)}–${eur(high)}`
  return low != null ? `from ${eur(low)}` : `up to ${eur(high)}`
}

// Estimated cost range of a list of items. An item with only one bound
// counts as that price at both ends.
function estimate(items) {
  let low = 0
  let high = 0
  let priced = 0
  for (const i of items) {
    if (i.price_min == null && i.price_max == null) continue
    low += i.price_min ?? i.price_max
    high += i.price_max ?? i.price_min
    priced += 1
  }
  return { low, high, priced }
}

function SummaryTile({ label, value, hint, tone = 'text-[var(--text-1)]' }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--surf)] border border-[var(--border)] px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] truncate">{label}</div>
      <div className={`mt-0.5 text-[16px] sm:text-[20px] leading-tight font-semibold font-serif truncate ${tone}`}>{value}</div>
      {hint && <div className="text-[11px] text-[var(--text-3)] truncate">{hint}</div>}
    </div>
  )
}

function Header({ items }) {
  const pending = items?.filter((i) => !i.purchased) ?? []
  const bought = items?.filter((i) => i.purchased) ?? []
  const total = items?.length ?? 0
  const cost = estimate(pending)
  const spent = estimate(bought)
  const progress = total ? Math.round((bought.length / total) * 100) : 0

  return (
    <motion.section
      className="glass rounded-2xl relative overflow-hidden p-5 sm:p-7"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="pointer-events-none absolute -top-24 -right-20 w-72 h-72 rounded-full bg-accent-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-16 w-60 h-60 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative flex items-center gap-3.5">
        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-accent-400 to-accent-500 flex items-center justify-center shrink-0 shadow-lg shadow-accent-500/20">
          <ShoppingBag size={20} className="text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-[28px] leading-tight font-semibold font-serif">Shopping Wishlist</h1>
          <p className="text-[12.5px] sm:text-[14px] text-[var(--text-2)]">Things worth saving up for</p>
        </div>
      </div>

      <div className="relative grid grid-cols-3 gap-2 sm:gap-3 mt-5">
        <SummaryTile label="To buy" value={items ? pending.length : '–'} hint={pending.length === 1 ? 'item' : 'items'} />
        <SummaryTile
          label="Est. cost"
          value={items ? (cost.priced ? fmtRange(cost.low, cost.high) : '–') : '–'}
          hint={cost.priced && cost.priced < pending.length ? `${cost.priced} of ${pending.length} priced` : 'still to buy'}
          tone="text-accent-400"
        />
        <SummaryTile
          label="Bought"
          value={items ? `${bought.length}/${total}` : '–'}
          hint={spent.priced ? `≈ ${fmtRange(spent.low, spent.high)}` : 'items'}
          tone="text-emerald-400"
        />
      </div>

      {total > 0 && (
        <div className="relative mt-4">
          <div className="h-1.5 rounded-full bg-[var(--surf-2)] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="mt-1.5 text-[11.5px] text-[var(--text-3)]">{progress}% of your wishlist bought</div>
        </div>
      )}
    </motion.section>
  )
}

// Adds a new item, or edits `item` when given.
function ItemForm({ item, onSave, onCancel }) {
  const editing = Boolean(item)
  const [form, setForm] = useState(() =>
    editing
      ? {
          name: item.name,
          description: item.description,
          priceMin: item.price_min ?? '',
          priceMax: item.price_max ?? '',
          url: item.url,
        }
      : EMPTY_FORM,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const priceMin = form.priceMin !== '' ? parseFloat(form.priceMin) : null
  const priceMax = form.priceMax !== '' ? parseFloat(form.priceMax) : null
  const rangeError = priceMin != null && priceMax != null && priceMin > priceMax
  const valid = form.name.trim() && !rangeError

  const submit = async (e) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError('')
    try {
      await onSave({
        name: form.name.trim(),
        description: form.description.trim(),
        price_min: priceMin,
        price_max: priceMax,
        url: form.url.trim(),
      })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className={`flex flex-col gap-2.5 p-4 rounded-xl bg-[var(--surf)] border ${editing ? 'border-accent-400 my-2' : 'border-[var(--border)]'}`}
    >
      {editing && <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400">Edit item</div>}
      <input
        autoFocus
        value={form.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="Item name…"
        maxLength={80}
        className={inputCls}
      />
      <input
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="Description (optional)"
        maxLength={200}
        className={inputCls}
      />
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="number" min={0} step={0.01}
          value={form.priceMin}
          onChange={(e) => set({ priceMin: e.target.value })}
          placeholder="Min €"
          className={`w-24 !px-2 ${inputCls}`}
        />
        <span className="text-[var(--text-3)] text-[13px]">–</span>
        <input
          type="number" min={0} step={0.01}
          value={form.priceMax}
          onChange={(e) => set({ priceMax: e.target.value })}
          placeholder="Max €"
          className={`w-24 !px-2 ${inputCls}`}
        />
        <input
          type="url"
          value={form.url}
          onChange={(e) => set({ url: e.target.value })}
          placeholder="Link (optional)"
          maxLength={2000}
          className={`flex-1 min-w-[160px] ${inputCls}`}
        />
      </div>
      {rangeError && <div className="text-[12px] text-red-400">Min price can't be above the max.</div>}
      {error && <div className="text-[12px] text-red-400">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-[13px] bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all"
        >
          Cancel
        </button>
        <button type="submit" disabled={submitting || !valid} className={primaryBtnCls}>
          {editing ? 'Save changes' : 'Add item'}
        </button>
      </div>
    </form>
  )
}

function ShopRow({ item, onToggle, onEdit, onDelete }) {
  const price = fmtRange(item.price_min, item.price_max)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group flex items-center gap-3 py-3 border-b border-[var(--border)] last:border-b-0"
    >
      <button
        onClick={() => onToggle(item)}
        title={item.purchased ? 'Mark as pending' : 'Mark as purchased'}
        className={`w-6 h-6 rounded-lg border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
          item.purchased
            ? 'bg-emerald-500 border-transparent text-white'
            : 'border-[var(--border-2)] hover:border-emerald-400 hover:bg-emerald-500/10'
        }`}
      >
        {item.purchased && <Check size={13} />}
      </button>

      <div className="flex-1 min-w-0">
        <div className={`text-[14px] font-medium truncate ${item.purchased ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]'}`}>
          {item.name}
        </div>
        {(item.description || item.url) && (
          <div className="flex items-center gap-2 mt-0.5 min-w-0 text-[11.5px] text-[var(--text-3)]">
            {item.description && <span className="truncate">{item.description}</span>}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-400 inline-flex items-center gap-1 shrink-0 hover:underline"
              >
                <ExternalLink size={11} /> Link
              </a>
            )}
          </div>
        )}
      </div>

      {price && (
        <div className={`text-[12.5px] font-mono shrink-0 ${item.purchased ? 'text-[var(--text-3)]' : 'text-[var(--text-2)]'}`}>
          {price}
        </div>
      )}

      <div className="flex items-center shrink-0">
        <button onClick={() => onEdit(item)} className={`${rowActionCls} hover:text-accent-400 hover:bg-accent-500/10`} title="Edit">
          <Pencil size={13} />
        </button>
        <button onClick={() => onDelete(item)} className={`${rowActionCls} hover:text-red-400 hover:bg-red-500/10`} title="Remove">
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  )
}

export default function Shopping() {
  const [items, setItems] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const load = () =>
    api.shopping
      .list()
      .then((data) => {
        setItems(data)
        setLoadError(false)
      })
      .catch(() => setLoadError(true))

  useEffect(() => {
    load()
  }, [])

  const replace = (item) => setItems((prev) => prev.map((i) => (i.item_id === item.item_id ? item : i)))

  const toggle = async (item) => {
    setActionError('')
    replace({ ...item, purchased: !item.purchased })
    try {
      replace(await api.shopping.toggle(item.item_id))
    } catch (err) {
      setActionError(err.message)
      load()
    }
  }

  const remove = async (item) => {
    if (!window.confirm(`Remove "${item.name}" from your wishlist?`)) return
    setActionError('')
    setItems((prev) => prev.filter((i) => i.item_id !== item.item_id))
    try {
      await api.shopping.remove(item.item_id)
    } catch (err) {
      setActionError(err.message)
      load()
    }
  }

  const create = async (fields) => {
    const item = await api.shopping.create(fields)
    setItems((prev) => [...prev, item])
    setAdding(false)
  }

  const save = async (id, fields) => {
    replace(await api.shopping.update(id, fields))
    setEditingId(null)
  }

  // Still-to-buy first, bought items sink to the bottom.
  const sorted = items ? [...items].sort((a, b) => a.purchased - b.purchased) : []

  return (
    <PageTransition>
      <Header items={items} />

      <GlassCard>
        <div className="flex items-center gap-2 mb-4 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          <ShoppingBag size={13} /> Wishlist
        </div>
        {actionError && <div className="mb-3 text-[12px] text-red-400">{actionError}</div>}

        {items === null && !loadError ? (
          <div className="flex flex-col gap-3 py-2">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton-line" style={{ width: `${60 + i * 10}%` }} />)}
          </div>
        ) : loadError ? (
          <EmptyState title="Could not load shopping list." subtitle="Backend may be offline." />
        ) : items.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="Your wishlist is empty — add something below!" />
        ) : (
          <AnimatePresence initial={false}>
            {sorted.map((item) =>
              item.item_id === editingId ? (
                <ItemForm
                  key={item.item_id}
                  item={item}
                  onSave={(fields) => save(item.item_id, fields)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ShopRow
                  key={item.item_id}
                  item={item}
                  onToggle={toggle}
                  onEdit={(i) => {
                    setAdding(false)
                    setEditingId(i.item_id)
                  }}
                  onDelete={remove}
                />
              ),
            )}
          </AnimatePresence>
        )}

        <div className="mt-4">
          {adding ? (
            <ItemForm onSave={create} onCancel={() => setAdding(false)} />
          ) : (
            <button
              onClick={() => {
                setEditingId(null)
                setAdding(true)
              }}
              className="w-full py-2.5 rounded-xl border border-dashed border-[var(--border-2)] text-[var(--text-3)] text-[13px] flex items-center justify-center gap-1.5 hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all"
            >
              <Plus size={14} /> Add item
            </button>
          )}
        </div>
      </GlassCard>
    </PageTransition>
  )
}
