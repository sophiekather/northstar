import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwError, setPwError] = useState('');
  const [pwSaved, setPwSaved] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    api.get('/settings').then((r) => setSettings(r.data));
  }, []);

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const r = await api.put('/settings', {
        weeklyHourTarget: settings.weeklyHourTarget,
        notificationsEnabled: settings.notificationsEnabled,
      });
      setSettings(r.data);
      setUser((u) => ({ ...u, weeklyHourTarget: r.data.weeklyHourTarget }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwError('');
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords do not match');
      return;
    }
    setPwSaving(true);
    try {
      await api.put('/auth/password', { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 2500);
    } catch (err) {
      setPwError(err.response?.data?.error || 'Password change failed');
    } finally {
      setPwSaving(false);
    }
  }

  if (!settings) return <div className="text-text-muted text-sm">Loading…</div>;

  return (
    <div className="max-w-2xl">
      <h1 className="page-title mb-6">Settings</h1>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        <Link to="/settings/clients" className="card p-4 hover:bg-bg-light transition-colors flex items-center justify-between">
          <div>
            <div className="font-semibold text-text-body">Clients</div>
            <div className="text-xs text-text-muted">Manage client list</div>
          </div>
          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
        <Link to="/settings/tasks" className="card p-4 hover:bg-bg-light transition-colors flex items-center justify-between">
          <div>
            <div className="font-semibold text-text-body">Task Types</div>
            <div className="text-xs text-text-muted">Manage task categories</div>
          </div>
          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Account info */}
      <div className="card p-6 mb-6">
        <h2 className="section-title mb-4">Account</h2>
        <div className="space-y-2">
          <div>
            <label className="form-label">Name</label>
            <div className="form-input bg-bg-light text-text-muted">{settings.name}</div>
          </div>
          <div>
            <label className="form-label">Email</label>
            <div className="form-input bg-bg-light text-text-muted">{settings.email}</div>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <form onSubmit={handleSaveSettings} className="card p-6 mb-6 space-y-4">
        <h2 className="section-title">Preferences</h2>
        <div>
          <label className="form-label">Weekly Hour Target</label>
          <input
            type="number"
            step="0.5"
            min="1"
            className="form-input"
            value={settings.weeklyHourTarget}
            onChange={(e) => setSettings((s) => ({ ...s, weeklyHourTarget: parseFloat(e.target.value) }))}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="form-label mb-0">Email Notifications</div>
            <div className="text-xs text-text-muted">Daily reminder (Phase 2)</div>
          </div>
          <button
            type="button"
            onClick={() => setSettings((s) => ({ ...s, notificationsEnabled: !s.notificationsEnabled }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.notificationsEnabled ? 'bg-olive' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
          {saved && <span className="text-sm text-olive font-semibold">Saved!</span>}
        </div>
      </form>

      {/* Change password */}
      <form onSubmit={handleChangePassword} className="card p-6 space-y-4">
        <h2 className="section-title">Change Password</h2>
        <div>
          <label className="form-label">Current Password</label>
          <input type="password" className="form-input" value={pwForm.currentPassword} onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))} required />
        </div>
        <div>
          <label className="form-label">New Password</label>
          <input type="password" className="form-input" value={pwForm.newPassword} onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))} required minLength={8} />
        </div>
        <div>
          <label className="form-label">Confirm New Password</label>
          <input type="password" className="form-input" value={pwForm.confirmPassword} onChange={(e) => setPwForm((f) => ({ ...f, confirmPassword: e.target.value }))} required />
        </div>
        {pwError && <p className="text-red-600 text-sm">{pwError}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pwSaving} className="btn-primary">
            {pwSaving ? 'Updating…' : 'Update Password'}
          </button>
          {pwSaved && <span className="text-sm text-olive font-semibold">Password updated!</span>}
        </div>
      </form>
    </div>
  );
}
