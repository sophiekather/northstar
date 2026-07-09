import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { PROJECT_STATUSES, ProjectStatusChip } from '../lib/ui';

function ProjectTypeBadge({ type }) {
  if (type === 'FIXED_FEE') return <span className="badge-fixed badge">Fixed Fee</span>;
  if (type === 'TIME_MATERIALS') return <span className="badge-tm badge">T&amp;M</span>;
  return <span className="badge-non-billable-project badge">Non-Billable</span>;
}

function BudgetBar({ hours, budget }) {
  if (!budget) return null;
  const pct = Math.min((hours / budget) * 100, 100);
  const over = hours > budget;
  return (
    <div className="mt-1">
      <div className="flex justify-between text-xs text-text-muted mb-0.5">
        <span>{hours.toFixed(1)}h used</span>
        <span>{budget}h budget</span>
      </div>
      <div className="h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : pct > 80 ? 'bg-yellow-400' : 'bg-olive'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editProject, setEditProject] = useState(null);

  const [form, setForm] = useState({
    clientId: '', name: '', type: 'FIXED_FEE', status: 'OPEN',
    budgetHours: '', budgetDollars: '',
    startDate: '', endDate: '', notes: '',
    taskTypeIds: [],
  });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (clientFilter) params.clientId = clientFilter;
      if (includeArchived) params.includeArchived = 'true';
      const r = await api.get('/projects', { params });
      setProjects(r.data);
    } finally {
      setLoading(false);
    }
  }, [clientFilter, includeArchived]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data));
    api.get('/task-types').then((r) => setTaskTypes(r.data));
  }, []);

  function openAdd() {
    setEditProject(null);
    setForm({ clientId: '', name: '', type: 'FIXED_FEE', status: 'OPEN', budgetHours: '', budgetDollars: '', startDate: '', endDate: '', notes: '', taskTypeIds: [] });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(proj) {
    setEditProject(proj);
    setForm({
      clientId: proj.clientId,
      name: proj.name,
      type: proj.type,
      status: proj.status || 'OPEN',
      budgetHours: proj.budgetHours || '',
      budgetDollars: proj.budgetDollars || '',
      startDate: proj.startDate ? proj.startDate.slice(0, 10) : '',
      endDate: proj.endDate ? proj.endDate.slice(0, 10) : '',
      notes: proj.notes || '',
      taskTypeIds: proj.projectTasks?.map((pt) => pt.taskTypeId) || [],
    });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.clientId || !form.name || !form.type) {
      setFormError('Client, name, and type are required');
      return;
    }
    setSaving(true);
    try {
      const data = {
        clientId: form.clientId,
        name: form.name,
        type: form.type,
        status: form.status,
        budgetHours: form.budgetHours ? parseFloat(form.budgetHours) : null,
        budgetDollars: form.budgetDollars ? parseFloat(form.budgetDollars) : null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        notes: form.notes || null,
        taskTypeIds: form.taskTypeIds,
      };
      if (editProject) {
        await api.put(`/projects/${editProject.id}`, data);
      } else {
        await api.post('/projects', data);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(proj) {
    if (!confirm(`Archive "${proj.name}"?`)) return;
    await api.patch(`/projects/${proj.id}/archive`);
    load();
  }

  async function handleUnarchive(proj) {
    await api.patch(`/projects/${proj.id}/unarchive`);
    load();
  }

  function toggleTaskType(id) {
    setForm((f) => ({
      ...f,
      taskTypeIds: f.taskTypeIds.includes(id)
        ? f.taskTypeIds.filter((x) => x !== id)
        : [...f.taskTypeIds, id],
    }));
  }

  // Group by client
  const byClient = {};
  for (const p of projects) {
    const name = p.client?.name || 'Unknown';
    if (!byClient[name]) byClient[name] = [];
    byClient[name].push(p);
  }
  const clientNames = Object.keys(byClient).sort();

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="page-title">Projects</h1>
        <button onClick={openAdd} className="btn-primary">+ New Project</button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <select className="form-select sm:w-48" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="rounded" />
          Show archived
        </label>
      </div>

      {loading ? (
        <div className="text-text-muted text-sm">Loading…</div>
      ) : clientNames.length === 0 ? (
        <div className="card p-8 text-center text-text-muted">
          No projects yet.{' '}
          <button onClick={openAdd} className="text-purple-mid underline">Create your first project</button>
        </div>
      ) : (
        <div className="space-y-8">
          {clientNames.map((clientName) => (
            <div key={clientName}>
              <h2 className="section-title mb-3">{clientName}</h2>
              <div className="space-y-3">
                {byClient[clientName].map((proj) => (
                  <div key={proj.id} className={`card p-4 ${!proj.isActive ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Link to={`/projects/${proj.id}`} className="font-semibold text-purple-darkest hover:underline">
                            {proj.name}
                          </Link>
                          <ProjectTypeBadge type={proj.type} />
                          <ProjectStatusChip status={proj.status} />
                          {!proj.isActive && <span className="badge bg-gray-100 text-text-muted">Archived</span>}
                        </div>
                        {proj.budgetHours && (
                          <BudgetBar hours={proj.hoursSpent || 0} budget={proj.budgetHours} />
                        )}
                        {proj.notes && <p className="text-xs text-text-muted mt-1 line-clamp-1">{proj.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {proj.budgetDollars && (
                          <span className="text-sm text-text-muted">${proj.budgetDollars.toLocaleString()}</span>
                        )}
                        <button onClick={() => openEdit(proj)} className="btn-ghost text-xs">Edit</button>
                        {proj.isActive ? (
                          <button onClick={() => handleArchive(proj)} className="btn-ghost text-xs text-text-muted">Archive</button>
                        ) : (
                          <button onClick={() => handleUnarchive(proj)} className="btn-ghost text-xs">Unarchive</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form slide-over */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="section-title">{editProject ? 'Edit Project' : 'New Project'}</h2>
              <button onClick={() => setShowForm(false)} className="text-text-muted hover:text-text-body">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="form-label">Client *</label>
                <select className="form-select" value={form.clientId} onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))} required>
                  <option value="">Select client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Project Name *</label>
                <input type="text" className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Type *</label>
                <select className="form-select" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="FIXED_FEE">Fixed Fee</option>
                  <option value="TIME_MATERIALS">Time & Materials</option>
                  <option value="NON_BILLABLE">Non-Billable</option>
                </select>
              </div>
              <div>
                <label className="form-label">Status</label>
                <select className="form-select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Budget Hours</label>
                  <input type="number" step="0.5" min="0" className="form-input" value={form.budgetHours} onChange={(e) => setForm((f) => ({ ...f, budgetHours: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Budget ($)</label>
                  <input type="number" step="0.01" min="0" className="form-input" value={form.budgetDollars} onChange={(e) => setForm((f) => ({ ...f, budgetDollars: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Start Date</label>
                  <input type="date" className="form-input" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">End Date</label>
                  <input type="date" className="form-input" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Task Types</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {taskTypes.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTaskType(t.id)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                        form.taskTypeIds.includes(t.id)
                          ? 'bg-purple-dark text-white border-purple-dark'
                          : 'bg-white text-text-muted border-border hover:border-purple-mid'
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving…' : editProject ? 'Save Changes' : 'Create Project'}
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
