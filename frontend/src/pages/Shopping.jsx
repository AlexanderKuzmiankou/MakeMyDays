import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Crown, ExternalLink, ListPlus, LogOut, Pencil, Plus, ShoppingBag, Trash2, UserPlus, Users, X } from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageTransition from '../components/PageTransition.jsx'
import PageHero from '../components/PageHero.jsx'
import AvatarCircle from '../components/AvatarCircle.jsx'
import MemberStack from '../components/MemberStack.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'

const inputCls =
  'bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent-400 placeholder:text-[var(--text-3)]'
const primaryBtnCls =
  'px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40'
const iconBtnCls =
  'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all'
const dashedBtnCls =
  'w-full py-2.5 rounded-xl border border-dashed border-[var(--border-2)] text-[var(--text-3)] text-[13px] flex items-center justify-center gap-1.5 hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all'
// Row actions appear on hover with a mouse, but stay visible on touch screens.
const rowActionCls =
  'sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] transition-all shrink-0'

const EMPTY_FORM = { name: '', description: '', priceMin: '', priceMax: '', url: '' }
const SELECTED_KEY = 'mmd.shopping.selectedList'

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

function readSelected() {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

function storeSelected(listId) {
  try {
    localStorage.setItem(SELECTED_KEY, listId)
  } catch {
    // storage unavailable (private mode etc.) — just don't remember the choice
  }
}

function SectionLabel({ icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2 min-w-0 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        <Icon size={13} className="shrink-0" /> <span className="truncate">{children}</span>
      </div>
      {right}
    </div>
  )
}

function Header({ list, items, currentUserId }) {
  const pending = items?.filter((i) => !i.purchased) ?? []
  const bought = items?.filter((i) => i.purchased) ?? []
  const total = items?.length ?? 0
  const cost = estimate(pending)
  const spent = estimate(bought)
  const others = list?.members.filter((m) => m.user_id !== currentUserId) ?? []

  let subtitle = 'Things worth saving up for'
  if (list) {
    subtitle = others.length
      ? `${list.name} · shared with ${others.map((m) => (m.name || m.email).split(' ')[0]).join(', ')}`
      : `${list.name} · just you`
  }

  return (
    <PageHero
      icon={ShoppingBag}
      title="Shopping Lists"
      subtitle={subtitle}
      tiles={[
        { label: 'To buy', value: items ? pending.length : '–', hint: pending.length === 1 ? 'item' : 'items' },
        {
          label: 'Est. cost',
          value: items && cost.priced ? fmtRange(cost.low, cost.high) : '–',
          hint: cost.priced && cost.priced < pending.length ? `${cost.priced} of ${pending.length} priced` : 'still to buy',
          tone: 'text-accent-400',
        },
        {
          label: 'Bought',
          value: items ? `${bought.length}/${total}` : '–',
          hint: spent.priced ? `≈ ${fmtRange(spent.low, spent.high)}` : 'items',
          tone: 'text-emerald-400',
        },
      ]}
      progress={total > 0 && { pct: Math.round((bought.length / total) * 100), label: `${Math.round((bought.length / total) * 100)}% of this list bought` }}
    />
  )
}

// ── lists bar ────────────────────────────────────────────────────────────────

function NewListForm({ onCreate, onCancel, autoFocus = true }) {
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await onCreate(name.trim())
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          autoFocus={autoFocus}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="List name, e.g. Groceries…"
          maxLength={60}
          className={`flex-1 min-w-0 ${inputCls}`}
        />
        <button type="submit" disabled={submitting || !name.trim()} className={primaryBtnCls}>Create</button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={iconBtnCls} title="Cancel">
            <X size={14} />
          </button>
        )}
      </div>
      {error && <div className="text-[12px] text-red-400">{error}</div>}
    </form>
  )
}

function ListsBar({ lists, selectedId, onSelect, onCreate }) {
  const [creating, setCreating] = useState(false)
  return (
    <GlassCard className="!p-3 sm:!p-4">
      {creating ? (
        <NewListForm
          onCreate={async (name) => {
            await onCreate(name)
            setCreating(false)
          }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-0.5">
          {lists.map((l) => {
            const on = l.list_id === selectedId
            return (
              <button
                key={l.list_id}
                onClick={() => onSelect(l.list_id)}
                className={`flex items-center gap-2 shrink-0 pl-3 pr-2 py-2 rounded-xl border text-[13px] font-medium transition-all ${
                  on
                    ? 'bg-accent-500 border-transparent text-white shadow-md shadow-accent-500/20'
                    : 'bg-[var(--surf)] border-[var(--border)] text-[var(--text-2)] hover:border-accent-400'
                }`}
              >
                <span className="max-w-[160px] truncate">{l.name}</span>
                {l.members.length > 1 && <MemberStack members={l.members} max={3} size={16} />}
                <span
                  className={`min-w-[20px] px-1.5 rounded-full text-[11px] font-semibold ${
                    on ? 'bg-white/25 text-white' : 'bg-[var(--surf-2)] text-[var(--text-3)]'
                  }`}
                >
                  {l.pending_count ?? 0}
                </span>
              </button>
            )
          })}
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-xl border border-dashed border-[var(--border-2)] text-[13px] text-[var(--text-3)] hover:border-accent-400 hover:text-accent-400 transition-all"
          >
            <ListPlus size={14} /> New list
          </button>
        </div>
      )}
    </GlassCard>
  )
}

// ── members ──────────────────────────────────────────────────────────────────

function AddMemberForm({ listId, onAdded }) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError('')
    try {
      onAdded(await api.shopping.addMember(listId, email.trim()))
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
          placeholder="Share by email…"
          className={`flex-1 min-w-0 ${inputCls}`}
        />
        <button type="submit" disabled={submitting || !email.trim()} className={`${primaryBtnCls} flex items-center gap-1.5`}>
          <UserPlus size={14} /> Add
        </button>
      </div>
      {error && <div className="text-[12px] text-red-400">{error}</div>}
    </form>
  )
}

function MembersCard({ list, currentUserId, onListChanged, onLeft }) {
  const [error, setError] = useState('')
  const isOwner = list.created_by === currentUserId

  const leaveOrDelete = async () => {
    const question = isOwner
      ? `Delete "${list.name}" and all its items for everyone?`
      : `Leave "${list.name}"? You'll lose access to it.`
    if (!window.confirm(question)) return
    setError('')
    try {
      await (isOwner ? api.shopping.deleteList(list.list_id) : api.shopping.leaveList(list.list_id))
      onLeft(list.list_id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <GlassCard>
      <SectionLabel icon={Users}>Shared with</SectionLabel>
      <div className="flex flex-col">
        {list.members.map((m) => (
          <div key={m.user_id} className="flex items-center gap-2.5 py-2 border-b border-[var(--border)] last:border-b-0">
            <AvatarCircle user={{ ...m, name: m.name || m.email }} size={30} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] text-[var(--text-1)] truncate">
                {m.name || m.email}
                {m.user_id === currentUserId && <span className="text-[var(--text-3)]"> (you)</span>}
              </div>
              <div className="text-[11.5px] text-[var(--text-3)] truncate">{m.email}</div>
            </div>
            {m.user_id === list.created_by && (
              <span title="Created this list" className="text-amber-400 shrink-0">
                <Crown size={13} />
              </span>
            )}
          </div>
        ))}
      </div>
      <AddMemberForm listId={list.list_id} onAdded={onListChanged} />

      <div className="mt-4 pt-3 border-t border-[var(--border)]">
        {(isOwner || list.members.length > 1) && (
          <button
            onClick={leaveOrDelete}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--text-3)] hover:text-red-400 transition-colors"
          >
            {isOwner ? <Trash2 size={13} /> : <LogOut size={13} />}
            {isOwner ? 'Delete list' : 'Leave list'}
          </button>
        )}
        {error && <div className="mt-2 text-[12px] text-red-400">{error}</div>}
      </div>
    </GlassCard>
  )
}

// ── items ────────────────────────────────────────────────────────────────────

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

function ShopRow({ item, addedBy, onToggle, onEdit, onDelete }) {
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

      {addedBy && (
        <span title={`Added by ${addedBy.name || addedBy.email}`} className="shrink-0">
          <AvatarCircle user={{ ...addedBy, name: addedBy.name || addedBy.email }} size={20} />
        </span>
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


function RenameListForm({ list, onSave, onCancel }) {
  const [name, setName] = useState(list.name)
  const [error, setError] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await onSave(name.trim())
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <form onSubmit={submit} className="mb-4 flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`flex-1 min-w-0 ${inputCls}`} />
        <button type="submit" disabled={!name.trim()} className={primaryBtnCls}>Save</button>
        <button type="button" onClick={onCancel} className={iconBtnCls} title="Cancel">
          <X size={14} />
        </button>
      </div>
      {error && <div className="text-[12px] text-red-400">{error}</div>}
    </form>
  )
}

function ItemsCard({ list, items, loadError, currentUserId, onItemsChange, onListChanged, reload }) {
  const [actionError, setActionError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [renaming, setRenaming] = useState(false)

  const shared = list.members.length > 1
  const memberById = Object.fromEntries(list.members.map((m) => [m.user_id, m]))
  const lid = list.list_id

  const replace = (item) => onItemsChange((prev) => prev.map((i) => (i.item_id === item.item_id ? item : i)))

  const fail = (err) => {
    setActionError(err.message)
    reload()
  }

  const toggle = async (item) => {
    setActionError('')
    replace({ ...item, purchased: !item.purchased })
    try {
      replace(await api.shopping.toggle(lid, item.item_id))
    } catch (err) {
      fail(err)
    }
  }

  const remove = async (item) => {
    if (!window.confirm(`Remove "${item.name}" from ${list.name}?`)) return
    setActionError('')
    onItemsChange((prev) => prev.filter((i) => i.item_id !== item.item_id))
    try {
      await api.shopping.removeItem(lid, item.item_id)
    } catch (err) {
      fail(err)
    }
  }

  const create = async (fields) => {
    const item = await api.shopping.createItem(lid, fields)
    onItemsChange((prev) => [...prev, item])
    setAdding(false)
  }

  const save = async (id, fields) => {
    replace(await api.shopping.updateItem(lid, id, fields))
    setEditingId(null)
  }

  const rename = async (name) => {
    onListChanged(await api.shopping.renameList(lid, name))
    setRenaming(false)
  }

  // Still-to-buy first, bought items sink to the bottom.
  const sorted = items ? [...items].sort((a, b) => a.purchased - b.purchased) : []

  return (
    <GlassCard>
      {renaming ? (
        <RenameListForm list={list} onSave={rename} onCancel={() => setRenaming(false)} />
      ) : (
        <SectionLabel
          icon={ShoppingBag}
          right={
            <button
              onClick={() => setRenaming(true)}
              title="Rename list"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] hover:text-accent-400 hover:bg-accent-500/10 transition-all"
            >
              <Pencil size={13} />
            </button>
          }
        >
          {list.name}
        </SectionLabel>
      )}
      {actionError && <div className="mb-3 text-[12px] text-red-400">{actionError}</div>}

      {items === null && !loadError ? (
        <div className="flex flex-col gap-3 py-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton-line" style={{ width: `${60 + i * 10}%` }} />)}
        </div>
      ) : loadError ? (
        <EmptyState title="Could not load this list." subtitle="Backend may be offline." />
      ) : items.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="This list is empty — add something below!" />
      ) : (
        <AnimatePresence initial={false}>
          {sorted.map((item) =>
            item.item_id === editingId ? (
              <ItemForm key={item.item_id} item={item} onSave={(fields) => save(item.item_id, fields)} onCancel={() => setEditingId(null)} />
            ) : (
              <ShopRow
                key={item.item_id}
                item={item}
                addedBy={shared && item.added_by && item.added_by !== currentUserId ? memberById[item.added_by] : null}
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
            className={dashedBtnCls}
          >
            <Plus size={14} /> Add item
          </button>
        )}
      </div>
    </GlassCard>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function Shopping() {
  const { user } = useAuth()
  const currentUserId = user?.user_id
  const [lists, setLists] = useState(null)
  const [listsError, setListsError] = useState(false)
  const [selectedId, setSelectedId] = useState(readSelected)
  const [items, setItems] = useState(null)
  const [itemsError, setItemsError] = useState(false)

  const loadLists = () =>
    api.shopping
      .lists()
      .then((data) => {
        setLists(data)
        setListsError(false)
      })
      .catch(() => setListsError(true))

  useEffect(() => {
    loadLists()
  }, [])

  // Fall back to the first list when the remembered one is gone.
  const selected = lists?.find((l) => l.list_id === selectedId) ?? lists?.[0] ?? null
  const listId = selected?.list_id

  // Returns a cancel function so a slow response for a list you've already
  // switched away from can't overwrite the new list's items.
  const loadItems = () => {
    if (!listId) return undefined
    let active = true
    api.shopping
      .items(listId)
      .then((data) => {
        if (!active) return
        setItems(data)
        setItemsError(false)
      })
      .catch(() => active && setItemsError(true))
    return () => {
      active = false
    }
  }

  useEffect(() => {
    setItems(null)
    setItemsError(false)
    return loadItems()
  }, [listId])

  const select = (id) => {
    setSelectedId(id)
    storeSelected(id)
  }

  // Keep the pending count on the list pill in step with item changes.
  useEffect(() => {
    if (!items || !listId) return
    const pending = items.filter((i) => !i.purchased).length
    setLists((ls) => ls.map((l) => (l.list_id === listId ? { ...l, item_count: items.length, pending_count: pending } : l)))
  }, [items])

  const replaceList = (list) => setLists((ls) => ls.map((l) => (l.list_id === list.list_id ? { ...l, ...list } : l)))

  const createList = async (name) => {
    const list = await api.shopping.createList(name)
    setLists((ls) => [...ls, list])
    select(list.list_id)
  }

  const dropList = (id) => {
    setLists((ls) => ls.filter((l) => l.list_id !== id))
    if (id === selectedId) setSelectedId(null)
  }

  return (
    <PageTransition>
      <Header list={selected} items={selected ? items : []} currentUserId={currentUserId} />

      {lists === null && !listsError ? (
        <GlassCard>
          <div className="flex flex-col gap-3 py-2">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton-line" style={{ width: `${60 + i * 10}%` }} />)}
          </div>
        </GlassCard>
      ) : listsError ? (
        <GlassCard>
          <EmptyState title="Could not load your shopping lists." subtitle="Backend may be offline." />
        </GlassCard>
      ) : lists.length === 0 ? (
        <GlassCard>
          <EmptyState icon={ShoppingBag} title="No lists yet — create your first one." />
          <div className="mt-4 max-w-md mx-auto">
            <NewListForm onCreate={createList} autoFocus={false} />
          </div>
        </GlassCard>
      ) : (
        <>
          <ListsBar lists={lists} selectedId={listId} onSelect={select} onCreate={createList} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 min-w-0">
              <ItemsCard
                key={listId}
                list={selected}
                items={items}
                loadError={itemsError}
                currentUserId={currentUserId}
                onItemsChange={setItems}
                onListChanged={replaceList}
                reload={loadItems}
              />
            </div>
            <MembersCard key={`m-${listId}`} list={selected} currentUserId={currentUserId} onListChanged={replaceList} onLeft={dropList} />
          </div>
        </>
      )}
    </PageTransition>
  )
}
