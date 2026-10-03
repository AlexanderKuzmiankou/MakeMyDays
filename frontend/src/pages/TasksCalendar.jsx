import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Headphones,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import Badge from '../components/Badge.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PageTransition from '../components/PageTransition.jsx'
import PageHero from '../components/PageHero.jsx'
import { api } from '../api.js'
import { useAuth } from '../auth/AuthContext.jsx'
import { addDays, dateStr, dueInfo, greeting, parseDate, todayStr } from '../utils.js'

const inputCls =
  'bg-[var(--surf-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-accent-400 placeholder:text-[var(--text-3)]'
const primaryBtnCls =
  'px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40'
const secondaryBtnCls =
  'px-4 py-2 rounded-lg text-[13px] bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] transition-all'
const dashedBtnCls =
  'w-full py-2.5 rounded-xl border border-dashed border-[var(--border-2)] text-[var(--text-3)] text-[13px] flex items-center justify-center gap-1.5 hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all'
// Row actions appear on hover with a mouse, but stay visible on touch screens.
const rowActionCls =
  'sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-3)] transition-all shrink-0'

// ── small shared pieces ──────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        <Icon size={13} /> {children}
      </div>
      {right}
    </div>
  )
}

function RowActions({ onEdit, onDelete, label }) {
  return (
    <div className="flex items-center shrink-0">
      <button onClick={onEdit} className={`${rowActionCls} hover:text-accent-400 hover:bg-accent-500/10`} title={`Edit ${label}`}>
        <Pencil size={13} />
      </button>
      <button onClick={onDelete} className={`${rowActionCls} hover:text-red-400 hover:bg-red-500/10`} title={`Delete ${label}`}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function FormButtons({ editing, submitting, valid, onCancel, addLabel }) {
  return (
    <div className="flex gap-2 justify-end">
      <button type="button" onClick={onCancel} className={secondaryBtnCls}>Cancel</button>
      <button type="submit" disabled={submitting || !valid} className={primaryBtnCls}>
        {editing ? 'Save changes' : addLabel}
      </button>
    </div>
  )
}

// Runs an async save, keeping the form open with the error if it fails.
function useSubmit(onSave) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submit = async (payload) => {
    setSubmitting(true)
    setError('')
    try {
      await onSave(payload)
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }
  return { submitting, error, submit }
}

// ── time helpers ─────────────────────────────────────────────────────────────

function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function fmtDuration(start, end) {
  if (!start || !end) return null
  const m = minutes(end) - minutes(start)
  if (m < 60) return `${m}m`
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`
}

function nowHHMM() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// past / ongoing / future, relative to now. Events without an end last an hour.
function eventStatus(event, today, now) {
  if (event.date !== today) return event.date < today ? 'past' : 'future'
  if (event.all_day) return 'allday'
  const start = minutes(event.start_time)
  const end = event.end_time ? minutes(event.end_time) : start + 60
  const n = minutes(now)
  if (n >= end) return 'past'
  if (n >= start) return 'ongoing'
  return 'future'
}

function mondayOf(d) {
  const day = (d.getDay() + 6) % 7 // Monday = 0
  return addDays(d, -day)
}

function fmtLongDate(str) {
  return parseDate(str).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ── header ───────────────────────────────────────────────────────────────────

function Header({ tasks, todayEvents, today }) {
  const { user } = useAuth()
  const firstName = user?.name?.split(' ')[0]

  const open = tasks?.filter((t) => !t.completed) ?? []
  const done = tasks?.filter((t) => t.completed) ?? []
  const overdue = open.filter((t) => t.due && t.due < today).length
  const dueToday = open.filter((t) => t.due === today).length
  const now = nowHHMM()
  const next = todayEvents?.find((e) => !e.all_day && eventStatus(e, today, now) !== 'past')
  const total = tasks?.length ?? 0

  return (
    <PageHero
      icon={CalendarCheck2}
      title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
      subtitle={fmtLongDate(today)}
      tiles={[
        {
          label: 'Open tasks',
          value: tasks ? open.length : '–',
          hint: overdue ? `${overdue} overdue` : dueToday ? `${dueToday} due today` : 'nothing urgent',
          tone: overdue ? 'text-red-400' : 'text-accent-400',
        },
        {
          label: 'Today',
          value: todayEvents ? `${todayEvents.length} ${todayEvents.length === 1 ? 'event' : 'events'}` : '–',
          hint: next ? `next ${next.start_time} ${next.title}` : todayEvents?.length ? 'nothing more today' : 'free day',
          tone: 'text-sky-400',
        },
        { label: 'Done', value: tasks ? done.length : '–', hint: 'completed tasks', tone: 'text-emerald-400' },
      ]}
      progress={total > 0 && { pct: Math.round((done.length / total) * 100), label: `${done.length} of ${total} tasks done` }}
    />
  )
}

// ── tasks ────────────────────────────────────────────────────────────────────

function TaskForm({ task, onSave, onCancel }) {
  const editing = Boolean(task)
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [due, setDue] = useState(task?.due ?? '')
  const { submitting, error, submit } = useSubmit(onSave)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (title.trim()) submit({ title: title.trim(), notes: notes.trim(), due: due || null })
      }}
      className={`flex flex-col gap-2.5 p-4 rounded-xl bg-[var(--surf)] border ${editing ? 'border-accent-400 my-2' : 'border-[var(--border)]'}`}
    >
      {editing && <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400">Edit task</div>}
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={120} className={inputCls} />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        maxLength={500}
        rows={2}
        className={`resize-y ${inputCls}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
          Due
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={`!py-1.5 ${inputCls}`} />
        </label>
        {due && (
          <button type="button" onClick={() => setDue('')} className="text-[12px] text-[var(--text-3)] hover:text-accent-400">
            No due date
          </button>
        )}
      </div>
      {error && <div className="text-[12px] text-red-400">{error}</div>}
      <FormButtons editing={editing} submitting={submitting} valid={title.trim()} onCancel={onCancel} addLabel="Add task" />
    </form>
  )
}

function TaskRow({ task, onToggle, onEdit, onDelete }) {
  const due = !task.completed && dueInfo(task.due)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group flex items-start gap-3 px-1 py-2.5 border-b border-[var(--border)] last:border-b-0"
    >
      <button
        onClick={() => onToggle(task)}
        title={task.completed ? 'Mark as not done' : 'Mark as done'}
        className={`w-5 h-5 mt-0.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
          task.completed
            ? 'bg-emerald-500 border-transparent text-white'
            : 'border-[var(--border-2)] hover:border-emerald-400 hover:bg-emerald-500/10'
        }`}
      >
        {task.completed && <Check size={12} />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={`text-[13.5px] font-medium leading-snug break-words ${
            task.completed ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]'
          }`}
        >
          {task.title}
        </div>
        {task.notes && (
          <div className={`text-[11.5px] text-[var(--text-3)] mt-0.5 truncate ${task.completed ? 'line-through' : ''}`}>
            {task.notes.split('\n')[0]}
          </div>
        )}
      </div>
      {due && (
        <Badge tone={due.tone === 'red' ? 'red' : due.tone === 'amber' ? 'amber' : 'muted'} className="mt-0.5 shrink-0">
          {due.label}
        </Badge>
      )}
      <RowActions onEdit={() => onEdit(task)} onDelete={() => onDelete(task)} label="task" />
    </motion.div>
  )
}

function TasksCard({ onChange }) {
  const [tasks, setTasks] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [showDone, setShowDone] = useState(true)

  const load = () =>
    api.tasks
      .list()
      .then((data) => {
        setTasks(data)
        setLoadError(false)
      })
      .catch(() => setLoadError(true))

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    onChange(tasks)
  }, [tasks])

  const replace = (task) => setTasks((prev) => prev.map((t) => (t.task_id === task.task_id ? task : t)))

  const fail = (err) => {
    setActionError(err.message)
    load()
  }

  const toggle = async (task) => {
    setActionError('')
    replace({ ...task, completed: !task.completed })
    try {
      replace(await api.tasks.toggle(task.task_id))
    } catch (err) {
      fail(err)
    }
  }

  const remove = async (task) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return
    setActionError('')
    setTasks((prev) => prev.filter((t) => t.task_id !== task.task_id))
    try {
      await api.tasks.remove(task.task_id)
    } catch (err) {
      fail(err)
    }
  }

  const create = async (fields) => {
    const task = await api.tasks.create(fields)
    setTasks((prev) => [...prev, task])
    setAdding(false)
  }

  const save = async (id, fields) => {
    replace(await api.tasks.update(id, fields))
    setEditingId(null)
  }

  // Open: by due date, undated last. Completed: most recently finished first.
  const open = (tasks ?? [])
    .filter((t) => !t.completed)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.created_at.localeCompare(b.created_at))
  const done = (tasks ?? [])
    .filter((t) => t.completed)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  const renderTask = (t) =>
    t.task_id === editingId ? (
      <TaskForm key={t.task_id} task={t} onSave={(fields) => save(t.task_id, fields)} onCancel={() => setEditingId(null)} />
    ) : (
      <TaskRow
        key={t.task_id}
        task={t}
        onToggle={toggle}
        onEdit={(task) => {
          setAdding(false)
          setEditingId(task.task_id)
        }}
        onDelete={remove}
      />
    )

  return (
    <GlassCard>
      <SectionLabel
        icon={CheckSquare}
        right={tasks && <span className="text-[12px] text-[var(--text-3)]">{open.length} open</span>}
      >
        Tasks
      </SectionLabel>
      {actionError && <div className="mb-3 text-[12px] text-red-400">{actionError}</div>}

      <div className="mb-3">
        {adding ? (
          <TaskForm onSave={create} onCancel={() => setAdding(false)} />
        ) : (
          <button
            onClick={() => {
              setEditingId(null)
              setAdding(true)
            }}
            className={dashedBtnCls}
          >
            <Plus size={14} /> Add task
          </button>
        )}
      </div>

      {tasks === null && !loadError ? (
        <div className="flex flex-col gap-2.5">
          {[70, 55, 80, 40].map((w) => <div key={w} className="skeleton-line" style={{ width: `${w}%` }} />)}
        </div>
      ) : loadError ? (
        <EmptyState title="Could not load tasks." subtitle="Backend may be offline." />
      ) : (
        <>
          {open.length === 0 ? (
            <EmptyState icon={CheckSquare} title={done.length ? 'All done — nothing open!' : 'No tasks yet — add your first one.'} />
          ) : (
            <AnimatePresence initial={false}>{open.map(renderTask)}</AnimatePresence>
          )}

          {done.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowDone((s) => !s)}
                className="w-full flex items-center gap-2 pb-2 mb-0.5 border-b border-[var(--border)] text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)] hover:text-[var(--text-2)]"
              >
                <ChevronDown size={12} className={`transition-transform ${showDone ? '' : '-rotate-90'}`} />
                Completed ({done.length})
              </button>
              {showDone && <AnimatePresence initial={false}>{done.map(renderTask)}</AnimatePresence>}
            </div>
          )}
        </>
      )}
    </GlassCard>
  )
}

// ── schedule ─────────────────────────────────────────────────────────────────

function EventForm({ event, defaultDate, onSave, onCancel }) {
  const editing = Boolean(event)
  const [form, setForm] = useState({
    title: event?.title ?? '',
    date: event?.date ?? defaultDate,
    allDay: event ? event.all_day : false,
    start: event?.start_time ?? '09:00',
    end: event?.end_time ?? '10:00',
    location: event?.location ?? '',
    notes: event?.notes ?? '',
  })
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const { submitting, error, submit } = useSubmit(onSave)

  const timeError = !form.allDay && form.start && form.end && form.end <= form.start
  const valid = form.title.trim() && form.date && (form.allDay || form.start) && !timeError

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        submit({
          title: form.title.trim(),
          date: form.date,
          start_time: form.allDay ? null : form.start,
          end_time: form.allDay ? null : form.end || null,
          location: form.location.trim(),
          notes: form.notes.trim(),
        })
      }}
      className={`flex flex-col gap-2.5 p-4 rounded-xl bg-[var(--surf)] border ${editing ? 'border-accent-400 my-2' : 'border-[var(--border)]'}`}
    >
      {editing && <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-400">Edit appointment</div>}
      <input autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Appointment…" maxLength={120} className={inputCls} />
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} required className={`!py-1.5 ${inputCls}`} />
        {!form.allDay && (
          <div className="flex items-center gap-1.5">
            <input type="time" value={form.start} onChange={(e) => set({ start: e.target.value })} required className={`!py-1.5 ${inputCls}`} />
            <span className="text-[var(--text-3)] text-[13px]">–</span>
            <input type="time" value={form.end} onChange={(e) => set({ end: e.target.value })} className={`!py-1.5 ${inputCls}`} />
          </div>
        )}
        <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-2)] cursor-pointer select-none">
          <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} className="accent-accent-500" />
          All day
        </label>
      </div>
      <input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="Location (optional)" maxLength={200} className={inputCls} />
      <textarea
        value={form.notes}
        onChange={(e) => set({ notes: e.target.value })}
        placeholder="Notes (optional)"
        maxLength={500}
        rows={2}
        className={`resize-y ${inputCls}`}
      />
      {timeError && <div className="text-[12px] text-red-400">The end time must be after the start time.</div>}
      {error && <div className="text-[12px] text-red-400">{error}</div>}
      <FormButtons editing={editing} submitting={submitting} valid={valid} onCancel={onCancel} addLabel="Add appointment" />
    </form>
  )
}

function WeekStrip({ selected, today, eventDates, onSelect }) {
  const monday = mondayOf(parseDate(selected))
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  return (
    <div className="grid grid-cols-7 gap-1 mb-4">
      {days.map((d) => {
        const ds = dateStr(d)
        const isSel = ds === selected
        const isToday = ds === today
        return (
          <button
            key={ds}
            onClick={() => onSelect(ds)}
            className={`flex flex-col items-center py-1.5 rounded-lg border transition-all ${
              isSel
                ? 'bg-accent-500 border-transparent text-white'
                : isToday
                  ? 'border-accent-400 text-accent-400'
                  : 'border-transparent text-[var(--text-2)] hover:bg-[var(--surf)]'
            }`}
          >
            <span className={`text-[9.5px] font-semibold uppercase tracking-wide ${isSel ? 'text-white/80' : 'text-[var(--text-3)]'}`}>
              {d.toLocaleDateString('en', { weekday: 'short' }).slice(0, 2)}
            </span>
            <span className="text-[14px] font-semibold leading-tight">{d.getDate()}</span>
            <span className={`w-1 h-1 rounded-full mt-0.5 ${eventDates.has(ds) ? (isSel ? 'bg-white' : 'bg-accent-400') : 'bg-transparent'}`} />
          </button>
        )
      })}
    </div>
  )
}

function NowLine() {
  return (
    <div className="flex items-center gap-2.5 py-1 my-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400 font-mono">now</span>
      <div className="flex-1 h-px bg-gradient-to-r from-emerald-400/50 to-transparent" />
    </div>
  )
}

function EventCard({ event, status, onEdit, onDelete }) {
  const dur = fmtDuration(event.start_time, event.end_time)
  return (
    <div
      className={`group flex items-start gap-2 rounded-lg border px-3 py-2 my-0.5 mb-1.5 transition-colors ${
        status === 'ongoing' ? 'border-emerald-500/30 bg-emerald-500/[0.07]' : 'border-[var(--border)] bg-[var(--surf)]'
      } ${status === 'past' ? 'opacity-50' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-[var(--text-1)] break-words">{event.title}</span>
          {status === 'ongoing' && <Badge tone="green" dot>Now</Badge>}
          {event.all_day && <Badge tone="muted">All day</Badge>}
        </div>
        {(event.start_time || event.location) && (
          <div className="text-[11px] text-[var(--text-3)] mt-0.5 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
            {event.start_time && (
              <span>
                {event.start_time}
                {event.end_time ? `–${event.end_time}` : ''}
                {dur ? ` · ${dur}` : ''}
              </span>
            )}
            {event.location && (
              <span className="inline-flex items-center gap-1 min-w-0">
                <MapPin size={10} className="shrink-0" /> <span className="truncate">{event.location}</span>
              </span>
            )}
          </div>
        )}
        {event.notes && <div className="text-[11px] text-[var(--text-3)] mt-0.5 truncate">{event.notes}</div>}
      </div>
      <RowActions onEdit={() => onEdit(event)} onDelete={() => onDelete(event)} label="appointment" />
    </div>
  )
}

function DayTimeline({ events, day, today, onEdit, onDelete, editingId, renderForm }) {
  if (!events.length) {
    return <EmptyState icon={CalendarDays} title={day === today ? 'Nothing scheduled today' : 'Nothing scheduled this day'} />
  }

  const now = nowHHMM()
  const allDay = events.filter((e) => e.all_day)
  const timed = events.filter((e) => !e.all_day)
  const nowIndex = day === today ? timed.findIndex((e) => eventStatus(e, today, now) !== 'past') : -2

  return (
    <div>
      {allDay.length > 0 && (
        <div className={timed.length ? 'mb-3 pb-3 border-b border-[var(--border)]' : ''}>
          {allDay.map((e) =>
            e.event_id === editingId ? renderForm(e) : (
              <EventCard key={e.event_id} event={e} status="allday" onEdit={onEdit} onDelete={onDelete} />
            ),
          )}
        </div>
      )}
      {timed.map((e, i) => {
        const status = eventStatus(e, today, now)
        const isLast = i === timed.length - 1
        return (
          <div key={e.event_id}>
            {i === nowIndex && i > 0 && <NowLine />}
            {e.event_id === editingId ? (
              renderForm(e)
            ) : (
              <div className="grid grid-cols-[40px_12px_1fr] gap-x-2">
                <div
                  className={`text-[11px] font-mono text-right pt-2.5 leading-none ${
                    status === 'ongoing' ? 'text-emerald-400' : 'text-[var(--text-3)]'
                  } ${status === 'past' ? 'opacity-50' : ''}`}
                >
                  {e.start_time}
                </div>
                <div className="flex flex-col items-center pt-2.5">
                  <div
                    className={`w-[7px] h-[7px] rounded-full shrink-0 ${status === 'ongoing' ? 'bg-emerald-400' : 'bg-[var(--text-3)]'} ${
                      status === 'past' ? 'opacity-40' : ''
                    }`}
                  />
                  {!isLast && <div className="w-px flex-1 bg-[var(--surf-3)] mt-1 -mb-0.5" />}
                </div>
                <EventCard event={e} status={status} onEdit={onEdit} onDelete={onDelete} />
              </div>
            )}
          </div>
        )
      })}
      {day === today && timed.length > 0 && nowIndex === -1 && <NowLine />}
    </div>
  )
}

function ScheduleCard({ today, onTodayEvents }) {
  const [selected, setSelected] = useState(today)
  const [events, setEvents] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const weekStart = dateStr(mondayOf(parseDate(selected)))
  const weekEnd = dateStr(addDays(parseDate(weekStart), 6))

  const load = () =>
    api.events
      .list(weekStart, weekEnd)
      .then((data) => {
        setEvents(data)
        setLoadError(false)
      })
      .catch(() => setLoadError(true))

  useEffect(() => {
    setEvents(null)
    load()
  }, [weekStart])

  // Only the week containing today knows today's events.
  useEffect(() => {
    if (events && today >= weekStart && today <= weekEnd) onTodayEvents(events.filter((e) => e.date === today))
  }, [events])

  const byStart = (a, b) =>
    a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.created_at.localeCompare(b.created_at)
  const inWeek = (e) => e.date >= weekStart && e.date <= weekEnd

  const upsert = (event) =>
    setEvents((prev) => [...prev.filter((e) => e.event_id !== event.event_id), ...(inWeek(event) ? [event] : [])].sort(byStart))

  const create = async (fields) => {
    const event = await api.events.create(fields)
    setAdding(false)
    if (inWeek(event)) upsert(event)
    setSelected(event.date)
  }

  const save = async (id, fields) => {
    const event = await api.events.update(id, fields)
    setEditingId(null)
    upsert(event)
    setSelected(event.date)
  }

  const remove = async (event) => {
    if (!window.confirm(`Delete "${event.title}"?`)) return
    setActionError('')
    setEvents((prev) => prev.filter((e) => e.event_id !== event.event_id))
    try {
      await api.events.remove(event.event_id)
    } catch (err) {
      setActionError(err.message)
      load()
    }
  }

  const dayEvents = (events ?? []).filter((e) => e.date === selected)
  const eventDates = useMemo(() => new Set((events ?? []).map((e) => e.date)), [events])
  const shift = (days) => setSelected(dateStr(addDays(parseDate(selected), days)))

  return (
    <GlassCard>
      <SectionLabel
        icon={CalendarDays}
        right={
          <div className="flex items-center gap-1">
            {selected !== today && (
              <button onClick={() => setSelected(today)} className="px-2 py-1 rounded-md text-[11.5px] text-accent-400 hover:bg-accent-500/10">
                Today
              </button>
            )}
            <button onClick={() => shift(-7)} title="Previous week" className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surf)]">
              <ChevronLeft size={15} />
            </button>
            <button onClick={() => shift(7)} title="Next week" className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--surf)]">
              <ChevronRight size={15} />
            </button>
          </div>
        }
      >
        Schedule
      </SectionLabel>

      <WeekStrip selected={selected} today={today} eventDates={eventDates} onSelect={setSelected} />

      <div className="flex items-baseline justify-between gap-2 mb-3">
        <div className="text-[13.5px] font-semibold text-[var(--text-1)]">
          {selected === today ? 'Today' : fmtLongDate(selected)}
          {selected === today && <span className="font-normal text-[var(--text-3)]"> · {fmtLongDate(today)}</span>}
        </div>
        {events && dayEvents.length > 0 && (
          <span className="text-[12px] text-[var(--text-3)] shrink-0">
            {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
          </span>
        )}
      </div>
      {actionError && <div className="mb-3 text-[12px] text-red-400">{actionError}</div>}

      {events === null && !loadError ? (
        <div className="flex flex-col gap-2.5">
          {[65, 50, 75].map((w) => <div key={w} className="skeleton-line" style={{ width: `${w}%` }} />)}
        </div>
      ) : loadError ? (
        <EmptyState title="Could not load your schedule." subtitle="Backend may be offline." />
      ) : (
        <DayTimeline
          events={dayEvents}
          day={selected}
          today={today}
          editingId={editingId}
          onEdit={(e) => {
            setAdding(false)
            setEditingId(e.event_id)
          }}
          onDelete={remove}
          renderForm={(e) => (
            <EventForm key={e.event_id} event={e} onSave={(fields) => save(e.event_id, fields)} onCancel={() => setEditingId(null)} />
          )}
        />
      )}

      <div className="mt-3">
        {adding ? (
          <EventForm defaultDate={selected} onSave={create} onCancel={() => setAdding(false)} />
        ) : (
          <button
            onClick={() => {
              setEditingId(null)
              setAdding(true)
            }}
            className={dashedBtnCls}
          >
            <CalendarPlus size={14} /> Add appointment
          </button>
        )}
      </div>
    </GlassCard>
  )
}

// ── briefing ─────────────────────────────────────────────────────────────────

function BriefingCard() {
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioSrc, setAudioSrc] = useState(null)

  const load = () => {
    setLoading(true)
    api
      .briefing()
      .then((d) => setBriefing(d.briefing))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const fetchAudio = async () => {
    setAudioLoading(true)
    try {
      const res = await fetch('/api/briefing/audio')
      const blob = await res.blob()
      setAudioSrc(URL.createObjectURL(blob))
    } catch {
      // TODO: surface audio generation failure in the UI
    } finally {
      setAudioLoading(false)
    }
  }

  return (
    <GlassCard>
      <SectionLabel icon={Sparkles}>Daily Briefing</SectionLabel>
      <div className={`text-[15px] leading-[1.75] ${loading ? 'italic text-[var(--text-3)]' : 'text-[var(--text-2)]'} min-h-[48px] whitespace-pre-line`}>
        {loading
          ? 'Generating your briefing…'
          : error
            ? 'Backend offline — briefing unavailable. Check your schedule and tasks below.'
            : briefing}
      </div>
      {audioSrc && <audio controls src={audioSrc} className="w-full mt-3.5 rounded-lg" />}
      <div className="flex gap-2.5 mt-5">
        <button
          onClick={fetchAudio}
          disabled={audioLoading}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all disabled:opacity-40"
        >
          <Headphones size={14} /> {audioLoading ? 'Generating…' : 'Listen'}
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--surf-2)] border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surf-3)] hover:text-[var(--text-1)] transition-all disabled:opacity-40"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
    </GlassCard>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function TasksCalendar() {
  const today = todayStr()
  // The cards own their data and report what the header summarizes.
  const [tasks, setTasks] = useState(null)
  const [todayEvents, setTodayEvents] = useState(null)

  return (
    <PageTransition>
      <Header tasks={tasks} todayEvents={todayEvents} today={today} />
      <BriefingCard />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
        <TasksCard onChange={setTasks} />
        <ScheduleCard today={today} onTodayEvents={setTodayEvents} />
      </div>
    </PageTransition>
  )
}
