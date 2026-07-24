import { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { Avatar, SlideOver } from '../lib/ui';

const EMPTY_FORM = { name: '', email: '', role: 'MEMBER', weeklyHourTarget: 35, notificationsEnabled: true };

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

// Per-project billable presets for one user. "Default" = no rule (new entries
// start billable, or follow the task type's default in the timesheet view).
// Rules only pre-set the toggle — every entry stays editable.
function BillableRulesEditor({ projects, rules, onChange }) {
  const active = projects.filter((p) => p.isActive);

  // Group by client for a scannable list
  const byClient = {};
  for (const p of active) {
    const key = p.client?.name || 'No client';
    (byClient[key] = byClient[key] || []).push(p);
  }

  function setRule(projectId, value) {
    const next = { ...rules };
    if (value === null) delete next[projectId];
    else next[projectId] = value;
    onChange(next);
  }

  const OPTIONS = [
    { value: true,  label: 'Billable' },
    { value: false, label: 'Non-bill.' },
    { value: null,  label: 'Default' },
  ];

  return (
    <div>
      <label className="form-label">Billable presets by project</label>
      <p className="text-xs text-text-muted mb-2">
        New time entries this user logs start with this setting. They can still flip
        any single entry. "Default" leaves the normal behavior (billable).
      </p>
      <div className="border border-border rounded-lg divide-y divide-border max-h-72 overflow-y-auto">
        {Object.entries(byClient).map(([clientName, ps]) => (
          <div key={clientName} className="px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1.5">
              {clientName}
            </div>
            <div className="space-y-1.5">
              {ps.map((p) => {
                const current = rules[p.id] ?? null;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text-body truncate">{p.name}</span>
                    <div className="flex rounded-md bg-bg-light p-0.5 shrink-0">
                      {OPTIONS.map((o) => (
                        <button
                          key={String(o.value)}
                          type="button"
                          onClick={() => setRule(p.id, o.value)}
                          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                            current === o.value
                              ? 'bg-white shadow-sm font-semibold text-purple-dark'
                              : 'text-text-muted hover:text-text-body'
                          }`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {active.length === 0 && (
          <div className="px-3 py-4 text-sm text-text-muted">No active projects.</div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [handoff, setHandoff] = useState(null); // { user, password }

  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // { [projectId]: true | false } — projects absent from the map use the default
  const [billableRules, setBillableRules] = useState({});
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

  useEffect(() => {
    load();
    api.get('/projects').then((r) => setProjects(r.data)).catch(() => {});
  }, []);

  function openAdd() {
    setEditUser(null);
    setForm(EMPTY_FORM);
    setBillableRules({});
    setFormError('');
    setShowForm(true);
  }

  async function openEdit(u) {
    setEditUser(u);
    setForm({
      name: u.name, email: u.email, role: u.role,
      weeklyHourTarget: u.weeklyHourTarget,
      notificationsEnabled: u.notificationsEnabled ?? true,
    });
    setBillableRules({});
    setFormError('');
    setShowForm(true);
    try {
      const r = await api.get(`/users/${u.id}/billable-rules`);
      setBillableRules(Object.fromEntries(r.data.map((x) => [x.projectId, x.isBillable])));
    } catch { /* rules panel just starts empty */ }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name || !form.email) return setFormError('Name and email are required');
    setSaving(true);
    try {
      if (editUser) {
        const r = await api.put(`/users/${editUser.id}`, form);
        await api.put(`/users/${editUser.id}/billable-rules`, {
          rules: Object.entries(billableRules).map(([projectId, isBillable]) => ({ projectId, isBillable })),
        });
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
            <div className="flex items-center justify-between">
              <div>
                <label className="form-label mb-0">Email notifications</label>
                <p className="text-xs text-text-muted">Daily task digest and time-logging nudge.</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, notificationsEnabled: !f.notificationsEnabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.notificationsEnabled ? 'bg-olive' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {editUser && (
              <BillableRulesEditor
                projects={projects}
                rules={billableRules}
                onChange={setBillableRules}
              />
            )}
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
