import { Plus, StickyNote } from 'lucide-react'
import GlassCard from '../components/GlassCard.jsx'
import PageTransition from '../components/PageTransition.jsx'
import PageHero from '../components/PageHero.jsx'

// TODO: replace with real data from GET /api/notes once the backend endpoint exists.
const MOCK_NOTES = [
  { id: 1, title: 'Trip packing list', preview: 'Passport, charger, hiking boots, first aid kit…', updated: '2 days ago' },
  { id: 2, title: 'Book recommendations', preview: 'Project Hail Mary, The Three-Body Problem…', updated: '5 days ago' },
  { id: 3, title: 'Recipe: weekend pasta', preview: 'Garlic, chili flakes, anchovies, pecorino…', updated: '1 week ago' },
]

export default function Notes() {
  return (
    <PageTransition>
      <PageHero
        icon={StickyNote}
        theme="violet"
        title="Notes"
        subtitle="Sample data until the notes API ships"
        tiles={[
          { label: 'Notes', value: MOCK_NOTES.length, hint: 'in total', tone: 'text-violet-400' },
          { label: 'Last edited', value: MOCK_NOTES[0].updated, hint: MOCK_NOTES[0].title, tone: 'text-accent-400' },
        ]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {MOCK_NOTES.map((n) => (
          <GlassCard key={n.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[var(--text-3)]">
              <StickyNote size={14} />
              <span className="text-[11px]">{n.updated}</span>
            </div>
            <div className="text-[15px] font-semibold text-[var(--text-1)]">{n.title}</div>
            <div className="text-[13px] text-[var(--text-2)] line-clamp-2">{n.preview}</div>
          </GlassCard>
        ))}

        {/* TODO: wire up POST /api/notes once the backend endpoint exists */}
        <button className="rounded-2xl border border-dashed border-[var(--border-2)] flex flex-col items-center justify-center gap-2 py-10 text-[var(--text-3)] hover:border-accent-400 hover:text-accent-400 hover:bg-accent-500/5 transition-all">
          <Plus size={20} />
          <span className="text-[13px] font-medium">New note</span>
        </button>
      </div>
    </PageTransition>
  )
}
