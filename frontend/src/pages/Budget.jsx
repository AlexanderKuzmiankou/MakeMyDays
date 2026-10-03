import { Wallet } from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import PageTransition from '../components/PageTransition.jsx'
import PageHero from '../components/PageHero.jsx'

// TODO: replace with real data from GET /api/budget/summary once the backend endpoint exists.
const MOCK_SUMMARY = { income: 3200, expenses: 2140, balance: 1060 }

// TODO: replace with real data from GET /api/budget/transactions once the backend endpoint exists.
const MOCK_TRANSACTIONS = [
  { id: 1, label: 'Rent', amount: -1200, date: '2026-08-01', category: 'Housing' },
  { id: 2, label: 'Salary', amount: 3200, date: '2026-08-01', category: 'Income' },
  { id: 3, label: 'Groceries', amount: -180, date: '2026-08-06', category: 'Food' },
  { id: 4, label: 'Gym membership', amount: -45, date: '2026-08-08', category: 'Health' },
]

function fmt(n) {
  const sign = n < 0 ? '-' : '+'
  return `${sign}€${Math.abs(n).toLocaleString()}`
}

const eur = (n) => `€${n.toLocaleString()}`

export default function Budget() {
  const spentPct = Math.round((MOCK_SUMMARY.expenses / MOCK_SUMMARY.income) * 100)
  return (
    <PageTransition>
      <PageHero
        icon={Wallet}
        theme="amber"
        title="Budget"
        subtitle="Sample data until the budget API ships"
        tiles={[
          { label: 'Income', value: eur(MOCK_SUMMARY.income), hint: 'this month', tone: 'text-emerald-400' },
          { label: 'Expenses', value: eur(MOCK_SUMMARY.expenses), hint: 'this month', tone: 'text-red-400' },
          { label: 'Balance', value: eur(MOCK_SUMMARY.balance), hint: 'left to spend', tone: 'text-accent-400' },
        ]}
        progress={{ pct: spentPct, label: `${spentPct}% of income spent` }}
      />

      <GlassCard>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-4">
          Recent transactions
        </div>
        <div className="flex flex-col">
          {MOCK_TRANSACTIONS.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-b-0">
              <div>
                <div className="text-[14px] font-medium text-[var(--text-1)]">{t.label}</div>
                <div className="text-[11.5px] text-[var(--text-3)] mt-0.5">{t.category} · {t.date}</div>
              </div>
              <div className={`text-[13px] font-mono font-medium ${t.amount < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {fmt(t.amount)}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </PageTransition>
  )
}
