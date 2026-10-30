import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckSquare,
  List,
  Pin,
  PinOff,
  Plus,
  Search,
  Square,
  StickyNote,
  Table2,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageTransition from '../components/PageTransition.jsx'
import PageHero from '../components/PageHero.jsx'
import { api } from '../api.js'

const inputCls =
  'bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent-400 placeholder:text-[var(--text-3)]'
const iconBtnCls =
  'w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] transition-all hover:text-accent-400 hover:bg-accent-500/10 disabled:opacity-30 disabled:pointer-events-none'
const MAX_TABLE_COLS = 10
const MAX_TABLE_ROWS = 50

// ── helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const units = [
    [60 * 60 * 24 * 365, 'y'],
    [60 * 60 * 24 * 30, 'mo'],
    [60 * 60 * 24 * 7, 'w'],
    [60 * 60 * 24, 'd'],
    [60 * 60, 'h'],
    [60, 'm'],
  ]
  const [size, label] = units.find(([size]) => s >= size)
  return `${Math.floor(s / size)}${label} ago`
}

// Blocks get a client-only `_key` while being edited so React can track them
// through reordering; it is stripped before saving.
let nextKey = 0
const withKey = (block) => ({ ...block, _key: ++nextKey })
const withoutKeys = (blocks) => blocks.map(({ _key, ...b }) => b)

const NEW_BLOCKS = {
  text: () => ({ type: 'text', text: '' }),
  list: () => ({ type: 'list', checklist: false, items: [{ text: '', checked: false }] }),
  checklist: () => ({ type: 'list', checklist: true, items: [{ text: '', checked: false }] }),
  table: () => ({ type: 'table', rows: [['', ''], ['', '']] }),
}

function isEmptyNote(title, blocks) {
  return (
    !title.trim() &&
    blocks.every((b) =>
      b.type === 'text'
        ? !b.text.trim()
        : b.type === 'list'
          ? b.items.every((i) => !i.text.trim())
          : b.rows.every((r) => r.every((c) => !c.trim())),
    )
  )
}

// ── note card (grid view) ────────────────────────────────────────────────────

function BlockPreview({ block }) {
  if (block.type === 'text') {
    return block.text.trim() ? <div className="whitespace-pre-line line-clamp-3">{block.text}</div> : null
  }
  if (block.type === 'list') {
    const items = block.items.filter((i) => i.text.trim())
    if (!items.length) return null
    return (
      <ul className="flex flex-col gap-0.5">
        {items.slice(0, 4).map((item, i) => (
          <li key={i} className={`flex items-center gap-1.5 truncate ${item.checked ? 'line-through text-[var(--text-3)]' : ''}`}>
            {block.checklist ? (
              item.checked ? <CheckSquare size={12} className="shrink-0 text-emerald-400" /> : <Square size={12} className="shrink-0" />
            ) : (
              <span className="w-1 h-1 rounded-full bg-current shrink-0 mx-1" />
            )}
            <span className="truncate">{item.text}</span>
          </li>
        ))}
        {items.length > 4 && <li className="text-[11px] text-[var(--text-3)]">+{items.length - 4} more</li>}
      </ul>
    )
  }
  return (
    <div className="flex items-center gap-1.5 text-[var(--text-3)]">
      <Table2 size={12} /> Table · {block.rows.length} × {block.rows[0]?.length ?? 0}
    </div>
  )
}

function NoteCard({ note, onOpen }) {
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      onClick={() => onOpen(note)}
      className="glass rounded-2xl p-5 text-left flex flex-col gap-2 min-h-[120px] border border-transparent hover:border-accent-400/60 transition-colors"
    >
      <div className="flex items-center gap-2 text-[var(--text-3)]">
        <StickyNote size={14} />
        <span className="text-[11px] flex-1">{timeAgo(note.updated_at)}</span>
        {note.pinned && <Pin size={13} className="text-violet-400" />}
      </div>
      <div className="text-[15px] font-semibold text-[var(--text-1)] truncate w-full">
        {note.title || <span className="text-[var(--text-3)] italic font-normal">Untitled</span>}
      </div>
      <div className="flex flex-col gap-1.5 text-[13px] text-[var(--text-2)] w-full min-w-0">
        {note.blocks.slice(0, 2).map((b, i) => (
          <BlockPreview key={i} block={b} />
        ))}
      </div>
    </motion.button>
  )
}

// ── block editors ────────────────────────────────────────────────────────────

function TextEditor({ block, onChange, autoFocus }) {
  const ref = useRef(null)
  // Grow with the content instead of scrolling inside a small box.
  useLayoutEffect(() => {
    const el = ref.current
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [block.text])

  return (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      value={block.text}
      onChange={(e) => onChange({ ...block, text: e.target.value })}
      placeholder="Write something…"
      rows={2}
      maxLength={20000}
      className={`w-full resize-none leading-relaxed ${inputCls}`}
    />
  )
}

function ListEditor({ block, onChange, autoFocus }) {
  const refs = useRef([])
  const [focusIdx, setFocusIdx] = useState(autoFocus ? 0 : null)

  useEffect(() => {
    if (focusIdx === null) return
    refs.current[focusIdx]?.focus()
    setFocusIdx(null)
  }, [focusIdx])

  const setItems = (items) => onChange({ ...block, items })
  const patchItem = (idx, patch) => setItems(block.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const insertAfter = (idx) => {
    if (block.items.length >= 200) return
    setItems([...block.items.slice(0, idx + 1), { text: '', checked: false }, ...block.items.slice(idx + 1)])
    setFocusIdx(idx + 1)
  }
  const removeItem = (idx) => {
    setItems(block.items.filter((_, i) => i !== idx))
    setFocusIdx(Math.max(0, idx - 1))
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1 mb-1">
        {[
          [false, List, 'Bullets'],
          [true, CheckSquare, 'Checklist'],
        ].map(([checklist, Icon, label]) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange({ ...block, checklist })}
            className={`px-2 py-1 rounded-md text-[11px] flex items-center gap-1 transition-all ${
              block.checklist === checklist
                ? 'bg-accent-500/15 text-accent-400'
                : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      {block.items.map((item, idx) => (
        <div key={idx} className="group/item flex items-center gap-2">
          {block.checklist ? (
            <button
              type="button"
              onClick={() => patchItem(idx, { checked: !item.checked })}
              className={`w-5 h-5 rounded-md border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
                item.checked ? 'bg-emerald-500 border-transparent' : 'border-[var(--border-2)] hover:border-accent-400'
              }`}
              title={item.checked ? 'Uncheck' : 'Check'}
            >
              {item.checked && <CheckSquare size={12} className="text-white" />}
            </button>
          ) : (
            <span className="w-5 flex justify-center shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-3)]" />
            </span>
          )}
          <input
            ref={(el) => (refs.current[idx] = el)}
            value={item.text}
            onChange={(e) => patchItem(idx, { text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                insertAfter(idx)
              } else if (e.key === 'Backspace' && !item.text && block.items.length > 1) {
                e.preventDefault()
                removeItem(idx)
              }
            }}
            placeholder="List item"
            maxLength={500}
            className={`flex-1 min-w-0 !py-1.5 bg-transparent border-transparent ${inputCls} ${
              item.checked ? 'line-through text-[var(--text-3)]' : ''
            }`}
          />
          <button
            type="button"
            onClick={() => removeItem(idx)}
            className={`${iconBtnCls} sm:opacity-0 sm:group-hover/item:opacity-100 hover:!text-red-400 hover:!bg-red-500/10`}
            title="Remove item"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => insertAfter(block.items.length - 1)}
        className="self-start ml-7 mt-0.5 text-[12px] text-[var(--text-3)] hover:text-accent-400 flex items-center gap-1"
      >
        <Plus size={12} /> Add item
      </button>
    </div>
  )
}

function TableEditor({ block, onChange, autoFocus }) {
  const { rows } = block
  const cols = rows[0].length
  const setRows = (next) => onChange({ ...block, rows: next })
  const setCell = (r, c, value) => setRows(rows.map((row, ri) => (ri === r ? row.map((v, ci) => (ci === c ? value : v)) : row)))

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="border-collapse text-[13px]">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="group/row">
                {row.map((cell, c) => (
                  <td key={c} className="border border-[var(--border)] p-0 min-w-[110px]">
                    <input
                      autoFocus={autoFocus && r === 0 && c === 0}
                      value={cell}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      placeholder={r === 0 ? `Column ${c + 1}` : ''}
                      maxLength={500}
                      className={`w-full px-2.5 py-1.5 outline-none focus:bg-accent-500/5 placeholder:text-[var(--text-3)] ${
                        r === 0 ? 'font-semibold bg-[var(--surf-2)]' : 'bg-transparent'
                      }`}
                    />
                  </td>
                ))}
                <td className="pl-1">
                  <button
                    type="button"
                    disabled={rows.length <= 1}
                    onClick={() => setRows(rows.filter((_, ri) => ri !== r))}
                    className={`${iconBtnCls} sm:opacity-0 sm:group-hover/row:opacity-100 hover:!text-red-400 hover:!bg-red-500/10`}
                    title="Remove row"
                  >
                    <X size={12} />
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {rows[0].map((_, c) => (
                <td key={c} className="text-center pt-1">
                  <button
                    type="button"
                    disabled={cols <= 1}
                    onClick={() => setRows(rows.map((row) => row.filter((_, ci) => ci !== c)))}
                    className={`${iconBtnCls} mx-auto hover:!text-red-400 hover:!bg-red-500/10`}
                    title="Remove column"
                  >
                    <X size={12} />
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 text-[12px]">
        <button
          type="button"
          disabled={rows.length >= MAX_TABLE_ROWS}
          onClick={() => setRows([...rows, Array(cols).fill('')])}
          className="text-[var(--text-3)] hover:text-accent-400 flex items-center gap-1 disabled:opacity-30"
        >
          <Plus size={12} /> Row
        </button>
        <button
          type="button"
          disabled={cols >= MAX_TABLE_COLS}
          onClick={() => setRows(rows.map((row) => [...row, '']))}
          className="text-[var(--text-3)] hover:text-accent-400 flex items-center gap-1 disabled:opacity-30"
        >
          <Plus size={12} /> Column
        </button>
      </div>
    </div>
  )
}

const EDITORS = { text: TextEditor, list: ListEditor, table: TableEditor }

function BlockShell({ block, index, count, autoFocus, onChange, onMove, onRemove }) {
  const Editor = EDITORS[block.type]
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group/block relative flex gap-2"
    >
      <div className="flex-1 min-w-0">
        <Editor block={block} onChange={onChange} autoFocus={autoFocus} />
      </div>
      <div className="flex flex-col gap-0.5 sm:opacity-0 sm:group-hover/block:opacity-100 focus-within:opacity-100 transition-opacity">
        <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className={iconBtnCls} title="Move up">
          <ArrowUp size={13} />
        </button>
        <button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className={iconBtnCls} title="Move down">
          <ArrowDown size={13} />
        </button>
        <button type="button" onClick={onRemove} className={`${iconBtnCls} hover:!text-red-400 hover:!bg-red-500/10`} title="Remove block">
          <Trash2 size={13} />
        </button>
      </div>
    </motion.div>
  )
}

// ── note editor ──────────────────────────────────────────────────────────────

// Edits `note`, or a new note when `note` has no note_id yet.
function NoteEditor({ note, onSave, onDelete, onClose }) {
  const isNew = !note.note_id
  const [title, setTitle] = useState(note.title)
  const [blocks, setBlocks] = useState(() => note.blocks.map(withKey))
  const [pinned, setPinned] = useState(note.pinned)
  const [focusKey, setFocusKey] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const initial = useRef(JSON.stringify({ title: note.title, blocks: note.blocks, pinned: note.pinned }))

  const current = { title, blocks: withoutKeys(blocks), pinned }
  const dirty = JSON.stringify(current) !== initial.current

  const addBlock = (kind) => {
    const block = withKey(NEW_BLOCKS[kind]())
    setBlocks((prev) => [...prev, block])
    setFocusKey(block._key)
  }
  const updateBlock = (key, next) => setBlocks((prev) => prev.map((b) => (b._key === key ? { ...next, _key: key } : b)))
  const moveBlock = (idx, dir) =>
    setBlocks((prev) => {
      const next = [...prev]
      ;[next[idx], next[idx + dir]] = [next[idx + dir], next[idx]]
      return next
    })

  const close = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave(current)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Delete "${note.title || 'Untitled'}"?`)) return
    try {
      await onDelete()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <GlassCard className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={close} className={iconBtnCls} title="Back to notes">
          <ArrowLeft size={16} />
        </button>
        <input
          autoFocus={isNew}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          maxLength={120}
          className="flex-1 min-w-0 bg-transparent text-[20px] font-semibold font-serif outline-none placeholder:text-[var(--text-3)]"
        />
        <button
          type="button"
          onClick={() => setPinned((p) => !p)}
          className={`${iconBtnCls} ${pinned ? '!text-violet-400' : ''}`}
          title={pinned ? 'Unpin' : 'Pin to top'}
        >
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <AnimatePresence initial={false}>
          {blocks.map((b, i) => (
            <BlockShell
              key={b._key}
              block={b}
              index={i}
              count={blocks.length}
              autoFocus={b._key === focusKey}
              onChange={(next) => updateBlock(b._key, next)}
              onMove={(dir) => moveBlock(i, dir)}
              onRemove={() => setBlocks((prev) => prev.filter((x) => x._key !== b._key))}
            />
          ))}
        </AnimatePresence>
        {blocks.length === 0 && <div className="text-[13px] text-[var(--text-3)]">Add text, a list or a table below.</div>}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ['text', Type, 'Text'],
          ['list', List, 'List'],
          ['checklist', CheckSquare, 'Checklist'],
          ['table', Table2, 'Table'],
        ].map(([kind, Icon, label]) => (
          <button
            key={kind}
            type="button"
            disabled={blocks.length >= 100}
            onClick={() => addBlock(kind)}
            className="px-3 py-1.5 rounded-lg border border-dashed border-[var(--border-2)] text-[12px] text-[var(--text-3)] flex items-center gap-1.5 hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all disabled:opacity-40"
          >
            <Plus size={12} />
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {error && <div className="text-[12px] text-red-400">{error}</div>}

      <div className="flex items-center gap-2 pt-3 border-t border-[var(--border)]">
        {!isNew && (
          <button
            type="button"
            onClick={remove}
            className="px-3 py-2 rounded-lg text-[13px] text-[var(--text-3)] hover:text-red-400 hover:bg-red-500/10 flex items-center gap-1.5 transition-all"
          >
            <Trash2 size={14} /> Delete
          </button>
        )}
        <div className="flex-1 text-[11px] text-[var(--text-3)] text-right">
          {!isNew && `Edited ${timeAgo(note.updated_at)}`}
        </div>
        <button
          type="button"
          onClick={close}
          className="px-4 py-2 rounded-lg text-[13px] bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || (isNew && isEmptyNote(title, current.blocks))}
          className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40"
        >
          {isNew ? 'Create note' : 'Save'}
        </button>
      </div>
    </GlassCard>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

const blankNote = () => ({ title: '', blocks: [NEW_BLOCKS.text()], pinned: false })

function matches(note, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const text = [
    note.title,
    ...note.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : b.type === 'list' ? b.items.map((i) => i.text) : b.rows.flat())),
  ]
  return text.some((t) => t.toLowerCase().includes(q))
}

export default function Notes() {
  const [notes, setNotes] = useState(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(null) // note being edited (blankNote() for a new one)
  const [query, setQuery] = useState('')

  const load = () => api.notes.list().then(setNotes).catch(() => setError(true))

  useEffect(() => {
    load()
  }, [])

  // Keep the server's order rules: pinned first, then most recently edited.
  const sortNotes = (list) =>
    [...list].sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.updated_at.localeCompare(a.updated_at)))

  const save = async (fields) => {
    const saved = open.note_id ? await api.notes.update(open.note_id, fields) : await api.notes.create(fields)
    setNotes((prev) => sortNotes([saved, ...prev.filter((n) => n.note_id !== saved.note_id)]))
    setOpen(null)
  }

  const remove = async () => {
    await api.notes.remove(open.note_id)
    setNotes((prev) => prev.filter((n) => n.note_id !== open.note_id))
    setOpen(null)
  }

  const visible = notes?.filter((n) => matches(n, query)) ?? []
  const latest = notes?.reduce((top, n) => (!top || n.updated_at > top.updated_at ? n : top), null)

  return (
    <PageTransition>
      <PageHero
        icon={StickyNote}
        theme="violet"
        title="Notes"
        subtitle="Text, lists and tables — all in one place"
        tiles={[
          { label: 'Notes', value: notes ? notes.length : '–', hint: 'in total', tone: 'text-violet-400' },
          { label: 'Pinned', value: notes ? notes.filter((n) => n.pinned).length : '–', hint: 'at the top', tone: 'text-amber-400' },
          {
            label: 'Last edited',
            value: latest ? timeAgo(latest.updated_at) : '–',
            hint: latest ? latest.title || 'Untitled' : 'nothing yet',
            tone: 'text-accent-400',
          },
        ]}
      />

      {open ? (
        <NoteEditor key={open.note_id ?? 'new'} note={open} onSave={save} onDelete={remove} onClose={() => setOpen(null)} />
      ) : (
        <>
          {notes?.length > 0 && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes…"
                className={`w-full !pl-9 ${inputCls}`}
              />
            </div>
          )}

          {notes === null && !error ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <GlassCard key={i} className="flex flex-col gap-3">
                  <div className="skeleton-line" style={{ width: '40%' }} />
                  <div className="skeleton-line" style={{ width: '80%' }} />
                </GlassCard>
              ))}
            </div>
          ) : error ? (
            <GlassCard>
              <EmptyState title="Could not load notes." subtitle="Backend may be offline." />
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AnimatePresence initial={false}>
                {visible.map((n) => (
                  <NoteCard key={n.note_id} note={n} onOpen={setOpen} />
                ))}
              </AnimatePresence>
              {query && visible.length === 0 && (
                <div className="sm:col-span-2">
                  <EmptyState icon={Search} title={`No notes match "${query}".`} />
                </div>
              )}
              <button
                onClick={() => setOpen(blankNote())}
                className="rounded-2xl border border-dashed border-[var(--border-2)] flex flex-col items-center justify-center gap-2 py-10 min-h-[120px] text-[var(--text-3)] hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all"
              >
                <Plus size={20} />
                <span className="text-[13px] font-medium">New note</span>
              </button>
            </div>
          )}
        </>
      )}
    </PageTransition>
  )
}
