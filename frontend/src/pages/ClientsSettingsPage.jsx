import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';

function TagInput({ label, values, onChange, placeholder }) {
  const [input, setInput] = useState('');

  function addTag(e) {
    e.preventDefault();
    const val = input.trim();
    if (val && !values.includes(val)) {
      onChange([...values, val]);
    }
    setInput('');
  }

  function removeTag(tag) {
    onChange(values.filter((v) => v !== tag));
  }

  return (
    <div>
      <label className="form-label">{label}</label>
      <div className="flex flex-wrap gap-1 mb-1">
        {values.map((v) => (
          <span key={v} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-light border border-border text-xs text-text-body">
            {v}
            <button type="button" onClick={() => removeTag(v)} className="text-text-muted hover:text-red-500">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="form-input flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTag(e)}
          placeholder={placeholder}
        />
        <button type="button" onClick={addTag} className="btn-secondary px-3">Add</button>
      </div>
    </div>
  );
}

export default function ClientsSettingsPage() {
  const [clients, setClients] = useState([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const [form, setForm] = useState({ name: '', emails: [], keywords: [], notes: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    api.get('/clients', { params: { includeArchived: includeArchived ? 'true' : 'false' } })
      .then((r) => setClients(r.data));
  }

  useEffect(() => { load(); }, [includeArchived]);

  function openAdd() {
    setEditClient(null);
    setForm({ name: '', emails: [], keywords: [], notes: '' });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(client) {
    setEditClient(client);
    setForm({ name: client.name, emails: client.emails || [], keywords: client.keywords || [], notes: client.notes || '' });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name) { setFormError('Name required'); return; }
    setSaving(true);
    try {
      if (editClient) {
        await api.put(`/clients/${editClient.id}`, form);
      } else {
        await api.post('/clients', form);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(client) {
    if (!confirm(`Archive "${client.name}"?`)) return;
    await api.patch(`/clients/${client.id}/archive`);
    load();
  }

  async function handleUnarchive(client) {
    await api.patch(`/clients/${client.id}/unarchive`);
    load();
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/settings" className="text-sm text-text-muted hover:text-purple-mid">← Settings</Link>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="page-title">Clients</h1>
        <button onClick={openAdd} className="btn-primary">+ Add Client</button>
      </div>

      <label className="flex items-center gap-2 text-sm text-text-muted mb-4 cursor-pointer">
        <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="rounded" />
        Show archived
      </label>

      <div className="space-y-3">
        {clients.length === 0 && (
          <div className="card p-8 text-center text-text-muted">No clients yet.</div>
        )}
        {clients.map((client) => (
          <div key={client.id} className={`card p-4 flex items-start justify-between gap-3 ${!client.isActive ? 'opacity-60' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="font-semibold text-text-body">{client.name}</span>
                {!client.isActive && <span className="badge bg-gray-100 text-text-muted">Archived</span>}
              </div>
              {client.emails?.length > 0 && (
                <p className="text-xs text-text-muted">{client.emails.join(', ')}</p>
              )}
              {client.keywords?.length > 0 && (
                <p className="text-xs text-text-muted">Keywords: {client.keywords.join(', ')}</p>
              )}
              {client.notes && <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{client.notes}</p>}
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => openEdit(client)} className="btn-ghost text-xs">Edit</button>
              {client.isActive ? (
                <button onClick={() => handleArchive(client)} className="btn-ghost text-xs text-text-muted">Archive</button>
              ) : (
                <button onClick={() => handleUnarchive(client)} className="btn-ghost text-xs">Unarchive</button>
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
              <h2 className="section-title">{editClient ? 'Edit Client' : 'Add Client'}</h2>
              <button onClick={() => setShowForm(false)} className="text-text-muted hover:text-text-body">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="form-label">Client Name *</label>
                <input type="text" className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <TagInput
                label="Email Addresses"
                values={form.emails}
                onChange={(v) => setForm((f) => ({ ...f, emails: v }))}
                placeholder="e.g. contact@client.com"
              />
              <TagInput
                label="Keywords"
                values={form.keywords}
                onChange={(v) => setForm((f) => ({ ...f, keywords: v }))}
                placeholder="e.g. foundation"
              />
              <div>
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving…' : editClient ? 'Save Changes' : 'Add Client'}
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
