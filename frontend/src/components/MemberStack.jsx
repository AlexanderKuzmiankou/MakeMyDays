import AvatarCircle from './AvatarCircle.jsx'

// Overlapping member avatars, e.g. in the group list.
export default function MemberStack({ members, max = 4, size = 18 }) {
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
