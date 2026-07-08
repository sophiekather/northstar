import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { Avatar, ProjectKindChip, SlideOver, fmtDate } from '../lib/ui';
import ClientTree from '../components/ClientTree';

const COLUMNS = [
  { status: 'DONE', label: 'Done', dot: 'bg-olive' },
  { status: 'IN_PROGRESS', label: 'In progress', dot: 'bg-amber-600' },
  { status: 'UPCOMING', label: 'Upcoming', dot: 'bg-gray-300' },
];

const EMPTY_FORM = { name: '', status: 'UPCOMING', dueDate: '', ownerId: '', tags: '', atRisk: false, notes: '' };

function MilestoneCard({ m, onEdit }) {
  const risky = m.atRisk && m.status !== 'DONE';
  return (
    <button
      onClick={() => onEdit(m)}
      className={`card p-3.5 flex flex-col gap-2 text-left w-full hover:shadow-md transition-shadow ${risky ? 'ring-1.5 ring-amber-600 ring-inset' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm text-purple-darkest truncate">{m.name}</span>
        {m.status === 'DONE' ? (
          <span className="badge bg-olive/10 text-olive">Done</span>
        ) : m.dueDate ? (
          <span className={`badge ${risky ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-bg-light text-text-muted border border-border'}`}>
            {fmtDate(m.dueDate)}
          </span>
        ) : null}
      </div>
      {m.status === 'DONE' && (m.completedAt || m.dueDate) && (
        <span className="text-xs text-text-muted">Completed {fmtDate(m.completedAt || m.dueDate)}</span>
      )}
      {m.notes && <span className="text-xs text-text-muted line-clamp-2">{m.notes}</span>}
      {m.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.tags.map((t) => <span key={t} className="badge bg-bg-light text-text-muted border border-border">{t}</span>)}
        </div>
      )}
      <div className="flex items-center justify-between">
        {m.owner ? (
          <span className="flex items-center gap-1.5">
            <Avatar name={m.owner.name} size="xs" />
            <span className="text-xs text-text-muted">{m.owner.name.split(' ')[0]}</span>
          </span>
        ) : <span />}
        {risky && <span className="badge bg-amber-50 text-amber-700 border border-amber-200">at risk</span>}
      </div>
    </button>
  );
}

export default function TimelineBoardPage() {
  const { clientId, projectId } = useParams();
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.get(`/projects/${projectId}/overview`).then((r) => setData(r.data));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/reports/users').then((r) => setUsers(r.data)); }, []);

  function openAdd() {
    setEditItem(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(m) {
    setEditItem(m);
    setForm({
      name: m.name,
      status: m.status,
      dueDate: m.dueDate ? m.dueDate.slice(0, 10) : '',
      ownerId: m.ownerId || '',
      tags: (m.tags || []).join(', '),
      atRisk: m.atRisk,
      notes: m.notes || '',
    });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name) { setFormError('Name required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        status: form.status,
        dueDate: form.dueDate || null,
        ownerId: form.ownerId || null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        atRisk: form.atRisk,
        notes: form.notes || null,
      };
      if (editItem) await api.put(`/projects/${projectId}/milestones/${editItem.id}`, payload);
      else await api.post(`/projects/${projectId}/milestones`, payload);
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editItem) return;
    if (!confirm(`Delete milestone "${editItem.name}"?`)) return;
    await api.delete(`/projects/${projectId}/milestones/${editItem.id}`);
    setShowForm(false);
    load();
  }

  if (!data) return <div className="text-text-muted text-sm">Loading…</div>;

  return (
    <div className="lg:grid lg:grid-cols-[260px,1fr] lg:gap-6 lg:items-start">
      <aside className="hidden lg:block"><ClientTree /></aside>

      <div className="min-w-0">
        <div className={`h-1 rounded-full mb-3 ${data.isRetainer ? 'bg-olive' : 'bg-purple-dark'}`} />
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted mb-1">
          <Link to={`/clients/${clientId}`} className="hover:underline">{data.client?.name}</Link>
          {' / '}
          <Link to={`/clients/${clientId}/projects/${projectId}`} className="hover:underline">{data.name}</Link>
          {' / Timeline'}{data.sowNumber ? ` · ${data.sowNumber}` : ''}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <Link to={`/clients/${clientId}/projects/${projectId}`} className="text-sm font-semibold text-purple-mid hover:underline">‹ Overview</Link>
            <h1 className="page-title">Timeline & milestones</h1>
            <ProjectKindChip isRetainer={data.isRetainer} />
          </div>
          <button onClick={openAdd} className="btn-primary">+ Milestone</button>
        </div>

        <div className="grid md:grid-cols-3 gap-4 items-start">
          {COLUMNS.map((col) => {
            const items = data.milestones.filter((m) => m.status === col.status);
            return (
              <div key={col.status} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <span className="font-semibold text-sm text-purple-darkest">{col.label}</span>
                  </span>
                  <span className="badge bg-bg-light text-text-muted border border-border">{items.length}</span>
                </div>
                {items.map((m) => <MilestoneCard key={m.id} m={m} onEdit={openEdit} />)}
                {items.length === 0 && (
                  <div className="border border-dashed border-border rounded-xl p-4 text-center text-xs text-text-muted">Empty</div>
                )}
              </div>
            );
          })}
        </div>

        {showForm && (
          <SlideOver title={editItem ? 'Edit Milestone' : 'New Milestone'} onClose={() => setShowForm(false)}>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="form-label">Name *</label>
                <input type="text" className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    <option value="UPCOMING">Upcoming</option>
                    <option value="IN_PROGRESS">In progress</option>
                    <option value="DONE">Done</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Due date</label>
                  <input type="date" className="form-input" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label">Owner</label>
                <select className="form-select" value={form.ownerId} onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Tags</label>
                <input type="text" className="form-input" placeholder="Front-end, CMS (comma-separated)" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm text-text-body cursor-pointer">
                <input type="checkbox" className="rounded" checked={form.atRisk} onChange={(e) => setForm((f) => ({ ...f, atRisk: e.target.checked }))} />
                Flag as at risk
              </label>
              <div>
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : 'Save'}</button>
                {editItem && <button type="button" onClick={handleDelete} className="btn-ghost text-red-600">Delete</button>}
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </SlideOver>
        )}
      </div>
    </div>
  );
}
