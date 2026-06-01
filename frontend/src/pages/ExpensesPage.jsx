import { useState, useEffect, useCallback } from 'react';
import { format, parseISO, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';

export default function ExpensesPage() {
  const { user } = useAuth();
  const [everyone, setEveryone] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [mileage, setMileage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formType, setFormType] = useState('expense'); // 'expense' | 'mileage'
  const [clients, setClients] = useState([]);
  const [categories, setCategories] = useState([]);

  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    clientId: '',
    categoryId: '',
    amount: '',
    description: '',
    isBillable: false,
    expenseType: 'OVERHEAD',
    miles: '',
    purpose: '',
    ratePerMile: '0.70',
  });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { everyone: everyone ? 'true' : 'false' };
      if (typeFilter === 'MILEAGE') {
        const [m] = await Promise.all([api.get('/mileage', { params })]);
        setMileage(m.data);
        setExpenses([]);
      } else if (typeFilter) {
        const [e] = await Promise.all([api.get('/expenses', { params: { ...params, expenseType: typeFilter } })]);
        setExpenses(e.data);
        setMileage([]);
      } else {
        const [e, m] = await Promise.all([
          api.get('/expenses', { params }),
          api.get('/mileage', { params }),
        ]);
        setExpenses(e.data);
        setMileage(m.data);
      }
    } finally {
      setLoading(false);
    }
  }, [everyone, typeFilter]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data));
    api.get('/expenses/categories').then((r) => setCategories(r.data));
  }, []);

  function openAdd(type = 'expense') {
    setEditItem(null);
    setFormType(type);
    setForm({
      date: format(new Date(), 'yyyy-MM-dd'),
      clientId: '',
      categoryId: '',
      amount: '',
      description: '',
      isBillable: false,
      expenseType: 'OVERHEAD',
      miles: '',
      purpose: '',
      ratePerMile: '0.70',
    });
    setFormError('');
    setShowForm(true);
  }

  function openEditExpense(entry) {
    setEditItem({ ...entry, kind: 'expense' });
    setFormType('expense');
    setForm({
      date: format(parseISO(entry.date), 'yyyy-MM-dd'),
      clientId: entry.clientId || '',
      categoryId: entry.categoryId,
      amount: String(entry.amount),
      description: entry.description,
      isBillable: entry.isBillable,
      expenseType: entry.expenseType,
      miles: '',
      purpose: '',
      ratePerMile: '0.70',
    });
    setFormError('');
    setShowForm(true);
  }

  function openEditMileage(entry) {
    setEditItem({ ...entry, kind: 'mileage' });
    setFormType('mileage');
    setForm({
      date: format(parseISO(entry.date), 'yyyy-MM-dd'),
      clientId: entry.clientId || '',
      miles: String(entry.miles),
      purpose: entry.purpose,
      ratePerMile: String(entry.ratePerMile),
      isBillable: entry.isBillable,
      categoryId: '',
      amount: '',
      description: '',
      expenseType: 'OVERHEAD',
    });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (formType === 'mileage') {
        const data = {
          clientId: form.clientId || null,
          date: form.date,
          miles: parseFloat(form.miles),
          purpose: form.purpose,
          ratePerMile: parseFloat(form.ratePerMile),
          isBillable: form.isBillable,
        };
        if (editItem?.kind === 'mileage') {
          await api.put(`/mileage/${editItem.id}`, data);
        } else {
          await api.post('/mileage', data);
        }
      } else {
        const fd = new FormData();
        fd.append('date', form.date);
        if (form.clientId) fd.append('clientId', form.clientId);
        fd.append('categoryId', form.categoryId);
        fd.append('amount', form.amount);
        fd.append('description', form.description);
        fd.append('isBillable', form.isBillable);
        fd.append('expenseType', form.expenseType);
        const receipt = document.getElementById('receipt-upload')?.files?.[0];
        if (receipt) fd.append('receipt', receipt);
        if (editItem?.kind === 'expense') {
          await api.put(`/expenses/${editItem.id}`, fd);
        } else {
          await api.post('/expenses', fd);
        }
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteExpense(id) {
    if (!confirm('Delete this expense?')) return;
    await api.delete(`/expenses/${id}`);
    load();
  }

  async function handleDeleteMileage(id) {
    if (!confirm('Delete this mileage entry?')) return;
    await api.delete(`/mileage/${id}`);
    load();
  }

  // Combine and sort by date desc
  const allItems = [
    ...expenses.map((e) => ({ ...e, _kind: 'expense', _date: e.date })),
    ...mileage.map((m) => ({ ...m, _kind: 'mileage', _date: m.date, amount: m.calculatedAmount, expenseType: 'MILEAGE' })),
  ].sort((a, b) => new Date(b._date) - new Date(a._date));

  // Group by month
  const byMonth = {};
  for (const item of allItems) {
    const key = format(parseISO(item._date), 'yyyy-MM');
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(item);
  }
  const sortedMonths = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));

  const mileageRate = parseFloat(form.ratePerMile) || 0;
  const estimatedMileage = form.miles ? (parseFloat(form.miles) * mileageRate).toFixed(2) : null;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="page-title">Expenses</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => openAdd('expense')} className="btn-secondary">+ Expense</button>
          <button onClick={() => openAdd('mileage')} className="btn-primary">+ Mileage</button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex items-center gap-1 bg-bg-light rounded-lg p-1">
          <button onClick={() => setEveryone(false)} className={`px-3 py-1 text-sm rounded-md ${!everyone ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}>
            My Expenses
          </button>
          <button onClick={() => setEveryone(true)} className={`px-3 py-1 text-sm rounded-md ${everyone ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}>
            Everyone
          </button>
        </div>
        <select className="form-select sm:w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="CLIENT">Client</option>
          <option value="OVERHEAD">Overhead</option>
          <option value="MILEAGE">Mileage</option>
        </select>
      </div>

      {loading ? (
        <div className="text-text-muted text-sm">Loading…</div>
      ) : sortedMonths.length === 0 ? (
        <div className="card p-8 text-center text-text-muted">No expenses found.</div>
      ) : (
        <div className="space-y-8">
          {sortedMonths.map((month) => {
            const items = byMonth[month];
            const total = items.reduce((s, i) => s + (i.amount || 0), 0);
            return (
              <div key={month}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-text-muted">
                    {format(new Date(month + '-01'), 'MMMM yyyy')}
                  </h3>
                  <span className="text-sm text-text-muted">${total.toFixed(2)}</span>
                </div>
                <div className="card divide-y divide-border">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-bg-light group">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`badge text-xs px-2 py-0.5 rounded-full font-semibold ${
                            item._kind === 'mileage' ? 'bg-lavender/20 text-purple-slate' :
                            item.expenseType === 'CLIENT' ? 'bg-purple-mid/10 text-purple-mid' :
                            'bg-gray-100 text-text-muted'
                          }`}>
                            {item._kind === 'mileage' ? 'Mileage' : item.expenseType === 'CLIENT' ? 'Client' : 'Overhead'}
                          </span>
                          <span className="text-sm font-semibold text-text-body">
                            {item._kind === 'mileage' ? item.purpose : item.description}
                          </span>
                          {item.client && <span className="text-xs text-text-muted">· {item.client.name}</span>}
                          {item.category && <span className="text-xs text-text-muted">· {item.category.name}</span>}
                          {item._kind === 'mileage' && (
                            <span className="text-xs text-text-muted">· {item.miles} mi @ ${item.ratePerMile}/mi</span>
                          )}
                          {everyone && <span className="text-xs text-purple-mid font-semibold">· {item.user?.name}</span>}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">{format(parseISO(item._date), 'MMM d')}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.isBillable && <span className="badge-billable">Billable</span>}
                        <span className="text-sm font-semibold text-purple-darkest">${(item.amount || 0).toFixed(2)}</span>
                        {item.user?.id === user?.id && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => item._kind === 'mileage' ? openEditMileage(item) : openEditExpense(item)}
                              className="text-text-muted hover:text-purple-dark p-1"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => item._kind === 'mileage' ? handleDeleteMileage(item.id) : handleDeleteExpense(item.id)}
                              className="text-text-muted hover:text-red-500 p-1"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form slide-over */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <h2 className="section-title">{editItem ? 'Edit' : 'Add'}</h2>
                <div className="flex gap-1 bg-bg-light rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => setFormType('expense')}
                    className={`px-3 py-1 text-xs rounded-md ${formType === 'expense' ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}
                  >
                    Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormType('mileage')}
                    className={`px-3 py-1 text-xs rounded-md ${formType === 'mileage' ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}
                  >
                    Mileage
                  </button>
                </div>
              </div>
              <button onClick={() => setShowForm(false)} className="text-text-muted hover:text-text-body">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="form-label">Date</label>
                <input type="date" className="form-input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
              </div>

              {formType === 'mileage' ? (
                <>
                  <div>
                    <label className="form-label">Client (optional)</label>
                    <select className="form-select" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                      <option value="">No client</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Purpose *</label>
                    <input type="text" className="form-input" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="form-label">Miles *</label>
                    <input type="number" step="0.1" min="0.1" className="form-input" value={form.miles} onChange={(e) => setForm((f) => ({ ...f, miles: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="form-label">Rate per Mile</label>
                    <input type="number" step="0.01" className="form-input" value={form.ratePerMile} onChange={(e) => setForm((f) => ({ ...f, ratePerMile: e.target.value }))} />
                  </div>
                  {estimatedMileage && (
                    <div className="bg-bg-light rounded-lg p-3 text-sm">
                      <span className="text-text-muted">Calculated amount: </span>
                      <span className="font-semibold text-purple-darkest">${estimatedMileage}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="form-label">Type</label>
                    <select className="form-select" value={form.expenseType} onChange={(e) => setForm((f) => ({ ...f, expenseType: e.target.value, clientId: e.target.value === 'OVERHEAD' ? '' : f.clientId }))}>
                      <option value="CLIENT">Client</option>
                      <option value="OVERHEAD">Overhead</option>
                    </select>
                  </div>
                  {form.expenseType === 'CLIENT' && (
                    <div>
                      <label className="form-label">Client</label>
                      <select className="form-select" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}>
                        <option value="">Select client…</option>
                        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="form-label">Category *</label>
                    <select className="form-select" value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))} required>
                      <option value="">Select category…</option>
                      {categories
                        .filter((c) => form.expenseType === 'OVERHEAD' ? true : !c.isOverheadOnly)
                        .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Amount ($) *</label>
                    <input type="number" step="0.01" min="0" className="form-input" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="form-label">Description *</label>
                    <input type="text" className="form-input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="form-label">Receipt (optional)</label>
                    <input id="receipt-upload" type="file" accept="image/*" capture="environment" className="form-input text-sm" />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="form-label mb-0">Billable</label>
                    <button type="button" onClick={() => setForm((f) => ({ ...f, isBillable: !f.isBillable }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.isBillable ? 'bg-olive' : 'bg-gray-200'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.isBillable ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </>
              )}

              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving…' : editItem ? 'Save Changes' : 'Add Entry'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
