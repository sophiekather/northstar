import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

export default function TaskTypesSettingsPage() {
  const [taskTypes, setTaskTypes] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [form, setForm] = useState({ name: '', defaultHourlyRate: '', isBillableDefault: true });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    api.get('/task-types', { params: { includeArchived: includeArchived ? 'true' : 'false' } })
      .then((r) => setTaskTypes(r.data));
  }

  useEffect(() => { load(); }, [includeArchived]);

  function openAdd() {
    setEditTask(null);
    setForm({ name: '', defaultHourlyRate: '', isBillableDefault: true });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(task) {
    setEditTask(task);
    setForm({ name: task.name, defaultHourlyRate: String(task.defaultHourlyRate), isBillableDefault: task.isBillableDefault });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name) { setFormError('Name required'); return; }
    setSaving(true);
    try {
      const data = {
        name: form.name,
        defaultHourlyRate: parseFloat(form.defaultHourlyRate) || 0,
        isBillableDefault: form.isBillableDefault,
      };
      if (editTask) {
        await api.put(`/task-types/${editTask.id}`, data);
      } else {
        await api.post('/task-types', data);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(task) {
    await api.patch(`/task-types/${task.id}/archive`);
    load();
  }

  async function handleUnarchive(task) {
    await api.patch(`/task-types/${task.id}/unarchive`);
    load();
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/settings" className="text-sm text-text-muted hover:text-purple-mid">← Settings</Link>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="page-title">Task Types</h1>
        <button onClick={openAdd} className="btn-primary">+ Add Task Type</button>
      </div>

      <label className="flex items-center gap-2 text-sm text-text-muted mb-4 cursor-pointer">
        <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="rounded" />
        Show archived
      </label>

      <div className="card divide-y divide-border">
        {taskTypes.length === 0 && (
          <div className="p-8 text-center text-text-muted">No task types.</div>
        )}
        {taskTypes.map((task) => (
          <div key={task.id} className={`flex items-center justify-between px-4 py-3 ${task.isArchived ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-text-body">{task.name}</span>
              {task.defaultHourlyRate > 0 && (
                <span className="text-xs text-text-muted">${task.defaultHourlyRate}/hr</span>
              )}
              {!task.isBillableDefault && <span className="badge-non-billable">Non-billable default</span>}
              {task.isArchived && <span className="badge bg-gray-100 text-text-muted">Archived</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEdit(task)} className="btn-ghost text-xs">Edit</button>
              {task.isArchived ? (
                <button onClick={() => handleUnarchive(task)} className="btn-ghost text-xs">Unarchive</button>
              ) : (
                <button onClick={() => handleArchive(task)} className="btn-ghost text-xs text-text-muted">Archive</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="section-title">{editTask ? 'Edit Task Type' : 'Add Task Type'}</h2>
              <button onClick={() => setShowForm(false)} className="text-text-muted hover:text-text-body">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="form-label">Name *</label>
                <input type="text" className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="form-label">Default Hourly Rate ($)</label>
                <input type="number" step="0.01" min="0" className="form-input" value={form.defaultHourlyRate} onChange={(e) => setForm((f) => ({ ...f, defaultHourlyRate: e.target.value }))} placeholder="0" />
              </div>
              <div className="flex items-center justify-between">
                <label className="form-label mb-0">Billable by default</label>
                <button type="button" onClick={() => setForm((f) => ({ ...f, isBillableDefault: !f.isBillableDefault }))} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.isBillableDefault ? 'bg-olive' : 'bg-gray-200'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.isBillableDefault ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving…' : editTask ? 'Save Changes' : 'Add Task Type'}
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
