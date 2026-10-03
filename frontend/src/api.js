async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let detail = `${options?.method || 'GET'} ${path} failed: ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : detail
    } catch {
      // response had no JSON body — keep the generic message
    }
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  health: () => request('/health'),
  briefing: () => request('/api/briefing'),

  tasks: () => request('/api/tasks'),
  events: () => request('/api/events'),

  auth: {
    me: () => request('/api/auth/me'),
    signup: (email, password, name) =>
      request('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
    login: (email, password) =>
      request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    updateProfile: (patch) => request('/api/auth/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  },

  habits: {
    list: () => request('/api/habits'),
    create: (habit) => request('/api/habits', { method: 'POST', body: JSON.stringify(habit) }),
    update: (id, patch) => request(`/api/habits/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    toggle: (id, date) => request(`/api/habits/${id}/toggle`, { method: 'POST', body: JSON.stringify({ date }) }),
    remove: (id) => request(`/api/habits/${id}`, { method: 'DELETE' }),
  },

  shopping: {
    list: () => request('/api/shopping'),
    create: (item) => request('/api/shopping', { method: 'POST', body: JSON.stringify(item) }),
    update: (id, patch) => request(`/api/shopping/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    toggle: (id) => request(`/api/shopping/${id}/toggle`, { method: 'POST' }),
    remove: (id) => request(`/api/shopping/${id}`, { method: 'DELETE' }),
  },

  sharedCosts: {
    overview: () => request('/api/shared-costs/overview'),
    createGroup: (group) => request('/api/shared-costs/groups', { method: 'POST', body: JSON.stringify(group) }),
    updateGroup: (id, patch) => request(`/api/shared-costs/groups/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    addMember: (id, email) =>
      request(`/api/shared-costs/groups/${id}/members`, { method: 'POST', body: JSON.stringify({ email }) }),
    expenses: (id) => request(`/api/shared-costs/groups/${id}/expenses`),
    createExpense: (id, expense) =>
      request(`/api/shared-costs/groups/${id}/expenses`, { method: 'POST', body: JSON.stringify(expense) }),
    updateExpense: (id, expenseId, patch) =>
      request(`/api/shared-costs/groups/${id}/expenses/${encodeURIComponent(expenseId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    removeExpense: (id, expenseId) =>
      request(`/api/shared-costs/groups/${id}/expenses/${encodeURIComponent(expenseId)}`, { method: 'DELETE' }),
    recurring: (id) => request(`/api/shared-costs/groups/${id}/recurring`),
    createRecurring: (id, recurring) =>
      request(`/api/shared-costs/groups/${id}/recurring`, { method: 'POST', body: JSON.stringify(recurring) }),
    removeRecurring: (id, recurringId) =>
      request(`/api/shared-costs/groups/${id}/recurring/${recurringId}`, { method: 'DELETE' }),
    balances: (id) => request(`/api/shared-costs/groups/${id}/balances`),
  },
}
