import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Pencil, Plus, Sprout, Trash2 } from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageTransition from '../components/PageTransition.jsx'
import PageHero from '../components/PageHero.jsx'
import { api } from '../api.js'
import { dateStr, last7Days, todayStr } from '../utils.js'

const inputCls =
  'bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent-400 placeholder:text-[var(--text-3)]'

function isDone(habit, date) {
  return habit.completions.includes(date)
}

function Header({ habits, days, today }) {
  const total = habits?.length ?? 0
  const doneToday = habits?.filter((h) => isDone(h, today)).length ?? 0
  const best = habits?.reduce((top, h) => (!top || h.current_streak > top.current_streak ? h : top), null)
  const weekDone = habits?.reduce((n, h) => n + days.filter((d) => isDone(h, dateStr(d))).length, 0) ?? 0
  const weekPct = total ? Math.round((weekDone / (total * days.length)) * 100) : 0
  const allDone = total > 0 && doneToday === total

  return (
    <PageHero
      icon={Sprout}
      theme="emerald"
      title="Habits"
      subtitle="Build momentum, one day at a time"
      tiles={[
        { label: 'Today', value: habits ? `${doneToday}/${total}` : '–', hint: allDone ? 'all done 🎉' : 'done', tone: 'text-emerald-400' },
        {
          label: 'Best streak',
          value: best?.current_streak ? `🔥 ${best.current_streak}d` : '–',
          hint: best?.current_streak ? best.name : 'no streak yet',
          tone: 'text-amber-400',
        },
        { label: 'This week', value: habits ? `${weekPct}%` : '–', hint: `${weekDone} check-ins`, tone: 'text-accent-400' },
      ]}
      progress={
        total > 0 && {
          pct: Math.round((doneToday / total) * 100),
          label: allDone ? 'Every habit done today — nice!' : `${total - doneToday} left for today`,
        }
      }
    />
  )
}

// ── emoji picker ─────────────────────────────────────────────────────────────

const EMOJI_GROUPS = [
  { label: 'Health', emojis: ['💪', '🏃', '🚴', '🏋️', '🧘', '🤸', '🏊', '🚶', '🥗', '🍎', '🥦', '💧', '😴', '🛌', '🦷', '💊'] },
  { label: 'Mind', emojis: ['📚', '📖', '✍️', '📝', '🧠', '🎯', '🧩', '🎨', '🎸', '🎹', '🗣️', '🌍', '💻', '🎧', '📷', '🔬'] },
  { label: 'Life', emojis: ['🧹', '🧺', '🍳', '🌱', '🪴', '🐶', '💰', '📵', '🚭', '☕', '📞', '❤️', '🙏', '😊', '☀️', '🌙'] },
  { label: 'Fun', emojis: ['⭐', '✅', '🔥', '⚡', '🌈', '🎉', '🏆', '🚀', '🎮', '🎲', '🧶', '🌊', '⛰️', '🏕️', '🌸', '🍀'] },
]

function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const pick = (emoji) => {
    onChange(emoji)
    setOpen(false)
    setCustom('')
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Choose an icon"
        className={`w-11 h-10 rounded-lg text-xl flex items-center justify-center bg-[var(--surf-2)] border transition-all ${
          open ? 'border-accent-400' : 'border-[var(--border)] hover:border-accent-400'
        }`}
      >
        {value}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full mt-2 z-30 w-[288px] max-w-[calc(100vw-48px)] p-3 rounded-xl glass border border-[var(--border)] shadow-xl bg-[var(--surf)]"
          >
            <div className="max-h-[260px] overflow-y-auto pr-1">
              {EMOJI_GROUPS.map((g) => (
                <div key={g.label} className="mb-2 last:mb-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-1">{g.label}</div>
                  <div className="grid grid-cols-8 gap-0.5">
                    {g.emojis.map((e) => (
                      <button
                        type="button"
                        key={e}
                        onClick={() => pick(e)}
                        className={`h-8 rounded-md text-[18px] flex items-center justify-center transition-all hover:bg-accent-500/15 hover:scale-110 ${
                          e === value ? 'bg-accent-500/20 ring-1 ring-accent-400' : ''
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5 mt-2.5 pt-2.5 border-t border-[var(--border)]">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (custom.trim()) pick(custom.trim())
                  }
                }}
                placeholder="Or type / paste any emoji"
                maxLength={16}
                className={`flex-1 min-w-0 !py-1.5 !text-[13px] ${inputCls}`}
              />
              <button
                type="button"
                disabled={!custom.trim()}
                onClick={() => pick(custom.trim())}
                className="px-3 rounded-lg text-[12px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40"
              >
                Use
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── rows ─────────────────────────────────────────────────────────────────────
// The weekday labels and each row's day strip share one layout so the columns
// line up: on phones the strip sits on its own line indented past the habit
// icon; from sm up it sits right-aligned in front of the row actions.

const stripPlacementCls = 'order-last sm:order-none w-full sm:w-auto pl-12 sm:pl-0'
const actionsCls = 'w-14 shrink-0 flex justify-end'
const rowActionCls =
  'sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] transition-all'

function DayLabels({ days }) {
  return (
    <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap mb-1">
      <div className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Last 7 days</div>
      <div className={`flex gap-1.5 ${stripPlacementCls}`}>
        {days.map((d) => (
          <div key={dateStr(d)} className="w-5 text-center text-[9px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
            {d.toLocaleDateString('en', { weekday: 'short' }).slice(0, 2)}
          </div>
        ))}
      </div>
      <div className={`hidden sm:block ${actionsCls}`} />
    </div>
  )
}

function HabitRow({ habit, days, today, onToggle, onEdit, onDelete }) {
  const done = isDone(habit, today)
  const streak = habit.current_streak
  const goal = habit.goal_streak

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group flex items-center flex-wrap sm:flex-nowrap gap-x-3 gap-y-2 py-3 border-b border-[var(--border)] last:border-b-0"
    >
      <button
        onClick={() => onToggle(habit)}
        title={done ? 'Mark as not done today' : 'Mark as done today'}
        className={`w-9 h-9 rounded-xl border-[1.5px] flex items-center justify-center text-base shrink-0 transition-all ${
          done
            ? 'bg-emerald-500 border-transparent'
            : 'border-[var(--border-2)] hover:border-accent-400 hover:bg-accent-500/10 hover:scale-105'
        }`}
      >
        {done ? <Check size={16} className="text-white" /> : habit.emoji}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-[14px] font-medium truncate ${done ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]'}`}>
          {habit.name}
        </div>
        <div className="text-[11px] text-[var(--text-3)] mt-0.5 truncate">
          {streak > 1 ? (
            <span className="text-amber-400 font-semibold">🔥 {streak}d streak</span>
          ) : streak === 1 ? (
            <span className="text-emerald-400 font-semibold">🌱 Started today</span>
          ) : (
            'No streak yet'
          )}
          {' '}· goal: {goal}d
        </div>
      </div>

      <div className={`flex gap-1.5 ${stripPlacementCls}`}>
        {days.map((d) => {
          const ds = dateStr(d)
          const dn = isDone(habit, ds)
          const isToday = ds === today
          return (
            <div
              key={ds}
              className={`w-5 h-5 rounded-md border transition-all ${
                dn ? 'bg-emerald-500 border-transparent' : 'bg-[var(--surf)] border-[var(--border)]'
              } ${isToday && !dn ? 'border-accent-400 border-[1.5px]' : ''}`}
              title={ds}
            />
          )
        })}
      </div>

      <div className={actionsCls}>
        <button onClick={() => onEdit(habit)} className={`${rowActionCls} hover:text-accent-400 hover:bg-accent-500/10`} title="Edit habit">
          <Pencil size={13} />
        </button>
        <button onClick={() => onDelete(habit)} className={`${rowActionCls} hover:text-red-400 hover:bg-red-500/10`} title="Remove habit">
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  )
}

// Adds a new habit, or edits `habit` when given.
function HabitForm({ habit, onSave, onCancel }) {
  const editing = Boolean(habit)
  const [name, setName] = useState(habit?.name ?? '')
  const [emoji, setEmoji] = useState(habit?.emoji ?? '⭐')
  const [goal, setGoal] = useState(habit?.goal_streak ?? 30)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const goalNum = Number(goal)
  const valid = name.trim() && Number.isInteger(goalNum) && goalNum >= 1 && goalNum <= 365

  const submit = async (e) => {
    e.preventDefault()
    if (!valid) return
    setSubmitting(true)
    setError('')
    try {
      await onSave({ name: name.trim(), emoji, goal_streak: goalNum })
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
      {editing && <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400">Edit habit</div>}
      <div className="flex flex-wrap gap-2 items-center">
        <EmojiPicker value={emoji} onChange={setEmoji} />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Habit name…"
          maxLength={40}
          className={`flex-1 min-w-[140px] ${inputCls}`}
        />
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)]" title="Goal streak in days">
          Goal
          <input
            type="number"
            min={1}
            max={365}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className={`w-[68px] !px-2 ${inputCls}`}
          />
          days
        </label>
      </div>
      {error && <div className="text-[12px] text-red-400">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-[13px] bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !valid}
          className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40"
        >
          {editing ? 'Save changes' : 'Add habit'}
        </button>
      </div>
    </form>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function Habits() {
  const [habits, setHabits] = useState(null)
  const [error, setError] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [actionError, setActionError] = useState('')

  const days = last7Days()
  const today = todayStr()

  const load = () => api.habits.list().then(setHabits).catch(() => setError(true))

  useEffect(() => {
    load()
  }, [])

  const patchHabit = (id, patch) => setHabits((prev) => prev.map((h) => (h.habit_id === id ? { ...h, ...patch } : h)))

  const toggle = async (habit) => {
    setActionError('')
    const done = isDone(habit, today)
    patchHabit(habit.habit_id, {
      completions: done ? habit.completions.filter((d) => d !== today) : [...habit.completions, today],
    })
    try {
      const data = await api.habits.toggle(habit.habit_id, today)
      patchHabit(habit.habit_id, { completions: data.completions, current_streak: data.current_streak })
    } catch (err) {
      setActionError(err.message)
      load()
    }
  }

  const remove = async (habit) => {
    if (!window.confirm(`Delete "${habit.name}" and its history?`)) return
    setActionError('')
    setHabits((prev) => prev.filter((h) => h.habit_id !== habit.habit_id))
    try {
      await api.habits.remove(habit.habit_id)
    } catch (err) {
      setActionError(err.message)
      load()
    }
  }

  const create = async (fields) => {
    const habit = await api.habits.create(fields)
    setHabits((prev) => [...prev, habit])
    setAdding(false)
  }

  const save = async (id, fields) => {
    const habit = await api.habits.update(id, fields)
    patchHabit(id, habit)
    setEditingId(null)
  }

  return (
    <PageTransition>
      <Header habits={habits} days={days} today={today} />

      <GlassCard>
        <DayLabels days={days} />

        {actionError && <div className="mt-2 text-[12px] text-red-400">{actionError}</div>}
        <div className="mt-2">
          {habits === null && !error ? (
            <div className="flex flex-col gap-3 py-2">
              {[1, 2, 3].map((i) => <div key={i} className="skeleton-line" style={{ width: `${60 + i * 10}%` }} />)}
            </div>
          ) : error ? (
            <EmptyState title="Could not load habits." subtitle="Backend may be offline." />
          ) : habits.length === 0 ? (
            <EmptyState icon={Sprout} title="No habits yet — add one below!" />
          ) : (
            <AnimatePresence initial={false}>
              {habits.map((h) =>
                h.habit_id === editingId ? (
                  <HabitForm key={h.habit_id} habit={h} onSave={(fields) => save(h.habit_id, fields)} onCancel={() => setEditingId(null)} />
                ) : (
                  <HabitRow
                    key={h.habit_id}
                    habit={h}
                    days={days}
                    today={today}
                    onToggle={toggle}
                    onEdit={(habit) => {
                      setAdding(false)
                      setEditingId(habit.habit_id)
                    }}
                    onDelete={remove}
                  />
                ),
              )}
            </AnimatePresence>
          )}
        </div>

        <div className="mt-4">
          {adding ? (
            <HabitForm onSave={create} onCancel={() => setAdding(false)} />
          ) : (
            <button
              onClick={() => {
                setEditingId(null)
                setAdding(true)
              }}
              className="w-full py-2.5 rounded-xl border border-dashed border-[var(--border-2)] text-[var(--text-3)] text-[13px] flex items-center justify-center gap-1.5 hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all"
            >
              <Plus size={14} /> Add habit
            </button>
          )}
        </div>
      </GlassCard>
    </PageTransition>
  )
}
