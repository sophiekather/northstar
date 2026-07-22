import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Avatar, SlideOver } from '../lib/ui';

const EMPTY_FORM = { name: '', email: '', role: 'MEMBER', weeklyHourTarget: 35 };

function RoleChip({ role }) {
  return role === 'ADMIN' ? (
    <span className="badge bg-purple-mid/10 text-purple-mid border border-purple-mid/30">Admin</span>
  ) : (
    <span className="badge bg-bg-light text-text-muted border border-border">Member</span>
  );
}

// Temp passwords are shown once, right after they're generated — nothing emails
// them and they're never readable again.
function PasswordHandoff({ user, password, onDone }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card p-4 mb-6 border-olive/40 bg-olive/5">
      <div className="text-sm font-semibold text-purple-darkest mb-1">
        Temporary password for {user}
      </div>
      <p className="text-xs text-text-muted mb-3">
        Copy this now — it won't be shown again. Send it to them however you normally would,
        and have them change it under Settings on first login.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-white border border-border rounded-lg px-3 py-2 text-sm font-mono text-purple-darkest">
          {password}
        </code>
        <button
          onClick={() => { navigator.clipboard?.writeText(password); setCopied(true); }}
          className="btn-secondary shrink-0"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={onDone} className="btn-ghost shrink-0">Dismiss</button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [handoff, setHandoff] = useState(null); // { user, password }

  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get('/users');
      setUsers(r.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditUser(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(u) {
    setEditUser(u);
    setForm({ name: u.name, email: u.email, role: u.role, weeklyHourTarget: u.weeklyHourTarget });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name || !form.email) return setFormError('Name and email are required');
    setSaving(true);
    try {
      if (editUser) {
        const r = await api.put(`/users/${editUser.id}`, form);
        setUsers((us) => us.map((u) => (u.id === editUser.id ? { ...u, ...r.data } : u)));
      } else {
        const r = await api.post('/users', form);
        setUsers((us) => [...us, { ...r.data, openTasks: 0 }]);
        setHandoff({ user: r.data.name, password: r.data.tempPassword });
      }
      setShowForm(false);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(u) {
    if (!confirm(`Reset ${u.name}'s password? Their current one stops working immediately.`)) return;
    try {
      const r = await api.post(`/users/${u.id}/reset-password`);
      setHandoff({ user: u.name, password: r.data.tempPassword });
    } catch (err) {
      setError(err.response?.data?.error || 'Password reset failed');
    }
  }

  async function handleToggleActive(u) {
    const reactivating = !u.isActive;
    if (!reactivating && !confirm(
      `Deactivate ${u.name}? They lose access immediately, but all their time, expenses and tasks stay in the records.`
    )) return;
    try {
      const r = reactivating
        ? await api.put(`/users/${u.id}`, { isActive: true })
        : await api.delete(`/users/${u.id}`);
      setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, ...r.data } : x)));
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Update failed');
    }
  }

  const active = users.filter((u) => u.isActive);
  const inactive = users.filter((u) => !u.isActive);

  function UserRow({ u }) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-bg-light transition-colors group">
        <Avatar name={u.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-body truncate">{u.name}</span>
            {u.id === me?.id && <span className="text-[11px] text-text-muted">(you)</span>}
          </div>
          <div className="text-xs text-text-muted truncate">{u.email}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <RoleChip role={u.role} />
          {u.isActive ? (
            <span className="text-xs text-text-muted tabular-nums" title="Open tasks assigned">
              {u.openTasks} open
            </span>
          ) : (
            <span className="badge bg-gray-100 text-text-muted">Deactivated</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <button onClick={() => openEdit(u)} className="btn-ghost text-xs">Edit</button>
          <button onClick={() => handleResetPassword(u)} className="btn-ghost text-xs">Reset password</button>
          <button
            onClick={() => handleToggleActive(u)}
            disabled={u.id === me?.id && u.isActive}
            className={`btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed ${u.isActive ? 'text-red-600' : 'text-olive'}`}
            title={u.id === me?.id && u.isActive ? 'You cannot deactivate yourself' : undefined}
          >
            {u.isActive ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="text-sm text-text-muted mt-1">Manage who has access to NorthStar.</p>
        </div>
        <button onClick={openAdd} className="btn-primary shrink-0">+ Add user</button>
      </div>

      {handoff && (
        <PasswordHandoff user={handoff.user} password={handoff.password} onDone={() => setHandoff(null)} />
      )}
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {loading ? (
        <div className="text-text-muted text-sm">Loading…</div>
      ) : (
        <>
          <div className="text-sm font-semibold text-purple-darkest mb-2">
            Active ({active.length})
          </div>
          <div className="card divide-y divide-border mb-8">
            {active.map((u) => <UserRow key={u.id} u={u} />)}
          </div>

          {inactive.length > 0 && (
            <>
              <div className="text-sm font-semibold text-text-muted mb-2">
                Deactivated ({inactive.length})
              </div>
              <div className="card divide-y divide-border opacity-70">
                {inactive.map((u) => <UserRow key={u.id} u={u} />)}
              </div>
            </>
          )}
        </>
      )}

      {showForm && (
        <SlideOver title={editUser ? 'Edit User' : 'Add User'} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="form-label">Name *</label>
              <input
                type="text" className="form-input" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
              />
            </div>
            <div>
              <label className="form-label">Email *</label>
              <input
                type="email" className="form-input" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required
              />
            </div>
            <div>
              <label className="form-label">Role</label>
              <select
                className="form-select" value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                <option value="MEMBER">Member — logs their own time, sees the shared boards</option>
                <option value="ADMIN">Admin — everything, plus user management</option>
              </select>
            </div>
            <div>
              <label className="form-label">Weekly Hour Target</label>
              <input
                type="number" step="0.5" min="1" className="form-input" value={form.weeklyHourTarget}
                onChange={(e) => setForm((f) => ({ ...f, weeklyHourTarget: e.target.value }))}
              />
            </div>
            {!editUser && (
              <p className="text-xs text-text-muted">
                A temporary password is generated when you save — you'll see it once, to pass on.
              </p>
            )}
            {formError && <p className="text-red-600 text-sm">{formError}</p>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving…' : editUser ? 'Save Changes' : 'Create User'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </SlideOver>
      )}
    </div>
  );
}
