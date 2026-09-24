import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  CalendarCheck2,
  Check,
  Flame,
  MapPin,
  Plus,
  ShoppingBag,
  Sparkles,
  StickyNote,
  Users,
  Wallet,
} from 'lucide-react'
import AuthModal from '../components/AuthModal.jsx'
import logo from '../assets/makemydays_logo.svg'

function TopBar() {
  return (
    <header className="flex items-center px-5 md:px-8 py-5">
      <img src={logo} alt="MakeMyDays" className="h-6 md:h-7 w-auto" />
    </header>
  )
}

function MiniTasksPreview() {
  return (
    <div className="flex flex-col gap-2">
      {[
        { done: true, label: 'Send project update' },
        { done: false, label: 'Book dentist appointment' },
        { done: false, label: 'Review budget for August' },
      ].map((t) => (
        <div key={t.label} className="flex items-center gap-2.5">
          <div className={`w-4 h-4 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${t.done ? 'bg-emerald-500 border-transparent' : 'border-[var(--border-2)]'}`}>
            {t.done && <Check size={10} className="text-white" />}
          </div>
          <span className={`text-[12.5px] ${t.done ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-2)]'}`}>{t.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)] mt-1 pt-2 border-t border-[var(--border)]">
        <MapPin size={11} /> 2 events today
      </div>
    </div>
  )
}

function MiniHabitsPreview() {
  const days = [1, 1, 1, 0, 1, 1, 0]
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0">
          <Check size={13} className="text-white" />
        </div>
        <div className="text-[12.5px] text-[var(--text-1)] font-medium">Morning run</div>
        <div className="text-[11px] text-amber-400 font-semibold ml-auto">🔥 12d</div>
      </div>
      <div className="flex gap-1.5">
        {days.map((d, i) => (
          <div key={i} className={`w-4 h-4 rounded-[5px] ${d ? 'bg-emerald-500' : 'bg-[var(--surf-2)] border border-[var(--border-2)]'}`} />
        ))}
      </div>
    </div>
  )
}

function MiniShoppingPreview() {
  return (
    <div className="flex flex-col gap-2.5">
      {[
        { name: 'Standing desk', price: '€300–450' },
        { name: 'Noise-cancelling headphones', price: 'from €180' },
      ].map((i) => (
        <div key={i.name} className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-[var(--text-2)] truncate">{i.name}</span>
          <span className="text-[11px] font-mono text-[var(--text-3)] shrink-0">{i.price}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5 text-[11px] text-accent-400 mt-0.5">
        <Plus size={11} /> Add item
      </div>
    </div>
  )
}

function MiniBudgetPreview() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <div className="rounded-lg bg-[var(--surf)] border border-[var(--border)] p-2.5">
        <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wide">Income</div>
        <div className="text-[15px] font-bold text-emerald-400">€3,200</div>
      </div>
      <div className="rounded-lg bg-[var(--surf)] border border-[var(--border)] p-2.5">
        <div className="text-[10px] text-[var(--text-3)] uppercase tracking-wide">Expenses</div>
        <div className="text-[15px] font-bold text-red-400">€2,140</div>
      </div>
    </div>
  )
}

function MiniSharedCostsPreview() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-[var(--text-2)]">Lake house weekend</span>
        <span className="text-[11px] text-[var(--text-3)]">4 people</span>
      </div>
      {[
        { name: 'Josh', amount: '+€42.50' },
        { name: 'Ovo', amount: '-€18.00' },
        { name: 'Jennifer', amount: '-€24.50' },
      ].map((b) => (
        <div key={b.name} className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-[var(--text-2)] truncate">{b.name}</span>
          <span className={`text-[11px] font-mono shrink-0 ${b.amount.startsWith('-') ? 'text-red-400' : 'text-emerald-400'}`}>
            {b.amount}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-1.5 text-[11px] text-accent-400 mt-0.5">
        <Plus size={11} /> Add expense
      </div>
    </div>
  )
}

function MiniNotesPreview() {
  return (
    <div className="flex flex-col gap-2">
      {['Trip packing list', 'Book recommendations'].map((t) => (
        <div key={t} className="rounded-lg bg-[var(--surf)] border border-[var(--border)] px-2.5 py-2">
          <div className="text-[12.5px] text-[var(--text-1)] font-medium truncate">{t}</div>
        </div>
      ))}
    </div>
  )
}

const PREVIEWS = [
  { title: 'Tasks & Calendar', desc: 'Google Tasks and Calendar, together in one view', icon: CalendarCheck2, Preview: MiniTasksPreview },
  { title: 'Habits', desc: 'Streaks, goals, and a 7-day view that keeps you honest', icon: Flame, Preview: MiniHabitsPreview },
  { title: 'Shopping', desc: 'A wishlist for things worth saving up for', icon: ShoppingBag, Preview: MiniShoppingPreview },
  { title: 'Budget', desc: 'Income, expenses, and balance at a glance', icon: Wallet, Preview: MiniBudgetPreview },
  { title: 'Shared Costs', desc: 'Split group expenses and settle up automatically', icon: Users, Preview: MiniSharedCostsPreview },
  { title: 'Notes', desc: 'Quick notes for the things you don’t want to forget', icon: StickyNote, Preview: MiniNotesPreview },
]

export default function Landing() {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('login')
  const location = useLocation()

  useEffect(() => {
    if (location.state?.from) {
      setModalMode('login')
      setModalOpen(true)
    }
  }, [location.state])

  const openLogin = () => {
    setModalMode('login')
    setModalOpen(true)
  }
  const openSignup = () => {
    setModalMode('signup')
    setModalOpen(true)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />

      <main className="flex-1 flex flex-col items-center px-5 md:px-8">
        <motion.section
          className="max-w-2xl text-center pt-10 md:pt-16 pb-14"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent-400 bg-accent-500/10 border border-accent-500/20 rounded-full px-3 py-1 mb-5">
            <Sparkles size={12} /> Personal productivity, in one place
          </div>
          <h1 className="text-[36px] md:text-[48px] font-semibold tracking-normal font-serif leading-[1.08] mb-4">
            Make every day count.
          </h1>
          <p className="text-[15px] md:text-[16px] text-[var(--text-2)] leading-relaxed mb-8 max-w-lg mx-auto">
            Tasks, calendar, habits, shopping list, budget, and notes — one calm, private
            space for your day. Your account, your data.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={openSignup}
              className="px-6 py-2.5 rounded-full text-[14px] font-medium bg-accent-500 text-white hover:bg-accent-400 transition-all"
            >
              Get started free
            </button>
            <button
              onClick={openLogin}
              className="px-6 py-2.5 rounded-full text-[14px] font-medium glass hover:bg-[var(--surf-3)] transition-all"
            >
              Log in
            </button>
          </div>
        </motion.section>

        <motion.section
          className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-20"
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        >
          {PREVIEWS.map(({ title, desc, icon: Icon, Preview }) => (
            <motion.div
              key={title}
              variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
              className="glass rounded-2xl p-5 flex flex-col gap-4"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent-500/15 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-accent-400" />
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold text-[var(--text-1)]">{title}</div>
                  <div className="text-[11px] text-[var(--text-3)]">{desc}</div>
                </div>
              </div>
              <div className="rounded-xl bg-[var(--surf-3)] border border-[var(--border)] p-3.5">
                <Preview />
              </div>
            </motion.div>
          ))}
        </motion.section>
      </main>

      <footer className="text-center text-[11px] text-[var(--text-3)] py-6">
        MakeMyDays &mdash; your days, your data.
      </footer>

      <AuthModal open={modalOpen} initialMode={modalMode} onClose={() => setModalOpen(false)} />
    </div>
  )
}
