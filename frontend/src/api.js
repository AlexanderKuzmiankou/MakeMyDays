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

  tasks: {
    list: () => request('/api/tasks'),
    create: (task) => request('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),
    update: (id, patch) => request(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    toggle: (id) => request(`/api/tasks/${id}/toggle`, { method: 'POST' }),
    remove: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  },

  events: {
    list: (start, end) => request(`/api/events?${new URLSearchParams({ start, end })}`),
    create: (event) => request('/api/events', { method: 'POST', body: JSON.stringify(event) }),
    update: (id, patch) => request(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id) => request(`/api/events/${id}`, { method: 'DELETE' }),
  },

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

  notes: {
    list: () => request('/api/notes'),
    create: (note) => request('/api/notes', { method: 'POST', body: JSON.stringify(note) }),
    update: (id, patch) => request(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id) => request(`/api/notes/${id}`, { method: 'DELETE' }),
  },

  shopping: {
    lists: () => request('/api/shopping/lists'),
    createList: (name) => request('/api/shopping/lists', { method: 'POST', body: JSON.stringify({ name }) }),
    renameList: (listId, name) =>
      request(`/api/shopping/lists/${listId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    deleteList: (listId) => request(`/api/shopping/lists/${listId}`, { method: 'DELETE' }),
    addMember: (listId, email) =>
      request(`/api/shopping/lists/${listId}/members`, { method: 'POST', body: JSON.stringify({ email }) }),
    leaveList: (listId) => request(`/api/shopping/lists/${listId}/leave`, { method: 'POST' }),
    items: (listId) => request(`/api/shopping/lists/${listId}/items`),
    createItem: (listId, item) =>
      request(`/api/shopping/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(item) }),
    updateItem: (listId, id, patch) =>
      request(`/api/shopping/lists/${listId}/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    toggle: (listId, id) => request(`/api/shopping/lists/${listId}/items/${id}/toggle`, { method: 'POST' }),
    removeItem: (listId, id) => request(`/api/shopping/lists/${listId}/items/${id}`, { method: 'DELETE' }),
  },

  budget: {
    overview: (year, month) =>
      request(`/api/budget/overview?${new URLSearchParams(month ? { year, month } : { year })}`),
    updateSettings: (patch) => request('/api/budget/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    createCategory: (category) => request('/api/budget/categories', { method: 'POST', body: JSON.stringify(category) }),
    updateCategory: (id, patch) =>
      request(`/api/budget/categories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    removeCategory: (id) => request(`/api/budget/categories/${id}`, { method: 'DELETE' }),
    createTransaction: (tx) => request('/api/budget/transactions', { method: 'POST', body: JSON.stringify(tx) }),
    updateTransaction: (id, patch) =>
      request(`/api/budget/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    removeTransaction: (id) => request(`/api/budget/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createRecurring: (rec) => request('/api/budget/recurring', { method: 'POST', body: JSON.stringify(rec) }),
    updateRecurring: (id, patch) =>
      request(`/api/budget/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    removeRecurring: (id) => request(`/api/budget/recurring/${id}`, { method: 'DELETE' }),
    setCap: (period, cap) => request(`/api/budget/caps/${period}`, { method: 'PUT', body: JSON.stringify(cap) }),
    removeCap: (period) => request(`/api/budget/caps/${period}`, { method: 'DELETE' }),
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
