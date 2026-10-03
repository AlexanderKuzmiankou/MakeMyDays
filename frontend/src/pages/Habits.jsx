import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Plus, Sprout, Trash2, X } from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageTransition from '../components/PageTransition.jsx'
import { api } from '../api.js'
import { dateStr, last7Days, todayStr } from '../utils.js'

function isDone(habit, date) {
  return habit.completions.includes(date)
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

function Header({ habits, days, today }) {
  const total = habits?.length ?? 0
  const doneToday = habits?.filter((h) => isDone(h, today)).length ?? 0
  const best = habits?.reduce((top, h) => (!top || h.current_streak > top.current_streak ? h : top), null)
  const weekDone = habits?.reduce((n, h) => n + days.filter((d) => isDone(h, dateStr(d))).length, 0) ?? 0
  const weekPct = total ? Math.round((weekDone / (total * days.length)) * 100) : 0
  const progress = total ? Math.round((doneToday / total) * 100) : 0
  const allDone = total > 0 && doneToday === total

  return (
    <motion.section
      className="glass rounded-2xl relative overflow-hidden p-5 sm:p-7"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="pointer-events-none absolute -top-24 -right-20 w-72 h-72 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-16 w-60 h-60 rounded-full bg-accent-500/10 blur-3xl" />

      <div className="relative flex items-center gap-3.5">
        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
          <Sprout size={20} className="text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-[28px] leading-tight font-semibold font-serif">Habits</h1>
          <p className="text-[12.5px] sm:text-[14px] text-[var(--text-2)]">Build momentum, one day at a time</p>
        </div>
      </div>

      <div className="relative grid grid-cols-3 gap-2 sm:gap-3 mt-5">
        <SummaryTile
          label="Today"
          value={habits ? `${doneToday}/${total}` : '–'}
          hint={allDone ? 'all done 🎉' : 'done'}
          tone="text-emerald-400"
        />
        <SummaryTile
          label="Best streak"
          value={best?.current_streak ? `🔥 ${best.current_streak}d` : '–'}
          hint={best?.current_streak ? best.name : 'no streak yet'}
          tone="text-amber-400"
        />
        <SummaryTile label="This week" value={habits ? `${weekPct}%` : '–'} hint={`${weekDone} check-ins`} tone="text-accent-400" />
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
          <div className="mt-1.5 text-[11.5px] text-[var(--text-3)]">
            {allDone ? 'Every habit done today — nice!' : `${total - doneToday} left for today`}
          </div>
        </div>
      )}
    </motion.section>
  )
}

function HabitRow({ habit, days, today, onToggle, onDelete }) {
  const done = isDone(habit, today)
  const streak = habit.current_streak
  const goal = habit.goal_streak

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group grid grid-cols-[1fr_auto] items-center gap-4 py-3 border-b border-[var(--border)] last:border-b-0"
    >
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => onToggle(habit)}
          className={`w-9 h-9 rounded-xl border-[1.5px] flex items-center justify-center text-base shrink-0 transition-all ${
            done
              ? 'bg-emerald-500 border-transparent'
              : 'border-[var(--border-2)] hover:border-accent-400 hover:bg-accent-500/10 hover:scale-105'
          }`}
        >
          {done ? <Check size={16} className="text-white" /> : habit.emoji}
        </button>
        <div className="min-w-0">
          <div className={`text-[14px] font-medium truncate ${done ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]'}`}>
            {habit.name}
          </div>
          <div className="text-[11px] text-[var(--text-3)] mt-0.5">
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
      </div>

      <div className="flex items-center gap-3">
        <div className="flex gap-1.5">
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
        <button
          onClick={() => onDelete(habit)}
          className="sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] hover:text-red-400 hover:bg-red-500/10 transition-all shrink-0"
          title="Remove habit"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  )
}

export default function Habits() {
  const [habits, setHabits] = useState(null)
  const [error, setError] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('⭐')
  const [goal, setGoal] = useState(30)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')

  const days = last7Days()
  const today = todayStr()

  const load = () => api.habits.list().then(setHabits).catch(() => setError(true))

  useEffect(() => {
    load()
  }, [])

  const toggle = async (habit) => {
    setActionError('')
    const done = isDone(habit, today)
    setHabits((prev) =>
      prev.map((h) =>
        h.habit_id === habit.habit_id
          ? { ...h, completions: done ? h.completions.filter((d) => d !== today) : [...h.completions, today] }
          : h,
      ),
    )
    try {
      const data = await api.habits.toggle(habit.habit_id, today)
      setHabits((prev) =>
        prev.map((h) =>
          h.habit_id === habit.habit_id
            ? { ...h, completions: data.completions, current_streak: data.current_streak }
            : h,
        ),
      )
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

  const addHabit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setActionError('')
    try {
      const habit = await api.habits.create({ name: name.trim(), emoji: emoji.trim() || '⭐', goal_streak: Number(goal) || 30 })
      setHabits((prev) => [...prev, habit])
      setFormOpen(false)
      setName('')
      setEmoji('⭐')
      setGoal(30)
    } catch (err) {
      setActionError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageTransition>
      <Header habits={habits} days={days} today={today} />

      <GlassCard>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Last 7 days</div>
          <div className="flex gap-1.5 pr-[2px]">
            {days.map((d) => (
              <div key={dateStr(d)} className="w-5 text-center text-[9px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
                {d.toLocaleDateString('en', { weekday: 'short' }).slice(0, 2)}
              </div>
            ))}
          </div>
        </div>

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
              {habits.map((h) => (
                <HabitRow key={h.habit_id} habit={h} days={days} today={today} onToggle={toggle} onDelete={remove} />
              ))}
            </AnimatePresence>
          )}
        </div>

        <div className="mt-4">
          {!formOpen ? (
            <button
              onClick={() => setFormOpen(true)}
              className="w-full py-2.5 rounded-xl border border-dashed border-[var(--border-2)] text-[var(--text-3)] text-[13px] flex items-center justify-center gap-1.5 hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all"
            >
              <Plus size={14} /> Add habit
            </button>
          ) : (
            <form onSubmit={addHabit} className="flex flex-wrap gap-2 items-center">
              <input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={2}
                className="w-12 text-center text-lg bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-2 py-2 outline-none focus:border-accent-400"
                title="Pick an emoji"
              />
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Habit name…"
                maxLength={40}
                className="flex-1 min-w-[140px] bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent-400 placeholder:text-[var(--text-3)]"
              />
              <input
                type="number"
                min={1}
                max={365}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                title="Goal streak (days)"
                className="w-[72px] bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-2 py-2 text-[14px] outline-none focus:border-accent-400"
              />
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all"
              >
                <X size={14} />
              </button>
            </form>
          )}
        </div>
      </GlassCard>
    </PageTransition>
  )
}
