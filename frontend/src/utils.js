// Dates are local calendar days ("YYYY-MM-DD"), not UTC: toISOString() would
// report yesterday's date shortly after midnight in time zones east of UTC.
export function dateStr(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayStr() {
  return dateStr(new Date())
}

// "YYYY-MM-DD" -> local midnight (new Date("YYYY-MM-DD") would be UTC midnight).
export function parseDate(str) {
  const [y, m, d] = str.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(d, n) {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

export function last7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - 6 + i)
    return d
  })
}

export function fmtTime(iso) {
  if (!iso || iso.length === 10) return null
  return new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function eventDuration(start, end) {
  if (!start || !end || start.length === 10) return null
  const m = Math.round((new Date(end) - new Date(start)) / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

export function eventStatus(start, end) {
  if (!start || start.length === 10) return 'allday'
  const now = Date.now()
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (now >= s && now < e) return 'ongoing'
  if (now >= e) return 'past'
  return 'future'
}

export function dueInfo(dueStr) {
  if (!dueStr) return null
  const due = parseDate(dueStr)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = Math.round((due - now) / 86400000)
  if (diff < 0) return { label: 'Overdue', tone: 'red' }
  if (diff === 0) return { label: 'Today', tone: 'amber' }
  if (diff === 1) return { label: 'Tomorrow', tone: 'muted' }
  return { label: due.toLocaleDateString('en', { month: 'short', day: 'numeric' }), tone: 'muted' }
}

export function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
