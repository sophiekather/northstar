import { useState, useEffect, useCallback } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, parseISO, isSameDay } from 'date-fns';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useTimer, formatTimer } from '../hooks/useTimer';
import TimesheetView from '../components/TimesheetView';

function ProjectTypeBadge({ type }) {
  if (type === 'FIXED_FEE') return <span className="badge-fixed badge">Fixed Fee</span>;
  if (type === 'TIME_MATERIALS') return <span className="badge-tm badge">T&M</span>;
  return <span className="badge-non-billable-project badge">Non-Billable</span>;
}

export default function TimePage() {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [everyone, setEveryone] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'timesheet'
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState(null);

  // Form state
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState([]);
  const [filteredTaskTypes, setFilteredTaskTypes] = useState([]);

  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    clientId: '',
    projectId: '',
    taskTypeId: '',
    hours: '',
    isBillable: true,
    note: '',
    noteClientVisible: false,
  });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Timer — persisted app-wide, survives navigation and refresh
  const { running: timerRunning, seconds: timerSeconds, start: startTimer, stop: stopTimer } = useTimer();

  // List view billable filter
  const [billableFilter, setBillableFilter] = useState('all'); // 'all' | 'billable' | 'nonbillable'

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/time-entries', {
        params: {
          startDate: weekStart.toISOString(),
          endDate: weekEnd.toISOString(),
          everyone: everyone ? 'true' : 'false',
        },
      });
      setEntries(r.data);
    } finally {
      setLoading(false);
    }
  }, [weekStart, everyone]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data));
    api.get('/task-types').then((r) => setTaskTypes(r.data));
    api.get('/projects').then((r) => setProjects(r.data));
  }, []);

  useEffect(() => {
    if (form.clientId) {
      setFilteredProjects(projects.filter((p) => p.clientId === form.clientId));
    } else {
      setFilteredProjects(projects);
    }
    if (form.projectId !== editEntry?.projectId) {
      setForm((f) => ({ ...f, projectId: '', taskTypeId: '' }));
    }
  }, [form.clientId, projects]);

  useEffect(() => {
    if (form.projectId) {
      const proj = projects.find((p) => p.id === form.projectId);
      if (proj?.projectTasks?.length) {
        const ids = proj.projectTasks.map((pt) => pt.taskTypeId);
        setFilteredTaskTypes(taskTypes.filter((t) => ids.includes(t.id)));
      } else {
        setFilteredTaskTypes(taskTypes);
      }
    } else {
      setFilteredTaskTypes(taskTypes);
    }
  }, [form.projectId, projects, taskTypes]);

  function openAdd() {
    setEditEntry(null);
    setForm({
      date: format(new Date(), 'yyyy-MM-dd'),
      clientId: '',
      projectId: '',
      taskTypeId: '',
      hours: '',
      isBillable: true,
      note: '',
      noteClientVisible: false,
    });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(entry) {
    setEditEntry(entry);
    setForm({
      date: format(parseISO(entry.date), 'yyyy-MM-dd'),
      clientId: entry.project?.client?.id || '',
      projectId: entry.projectId,
      taskTypeId: entry.taskTypeId,
      hours: String(entry.hours),
      isBillable: entry.isBillable,
      note: entry.note || '',
      noteClientVisible: entry.noteClientVisible,
    });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.projectId || !form.taskTypeId || !form.hours) {
      setFormError('Project, task type, and hours are required');
      return;
    }
    if (parseFloat(form.hours) <= 0) {
      setFormError('Hours must be greater than 0');
      return;
    }
    setSaving(true);
    try {
      if (editEntry) {
        await api.put(`/time-entries/${editEntry.id}`, {
          projectId: form.projectId,
          taskTypeId: form.taskTypeId,
          date: form.date,
          hours: parseFloat(form.hours),
          isBillable: form.isBillable,
          note: form.note,
          noteClientVisible: form.noteClientVisible,
        });
      } else {
        await api.post('/time-entries', {
          projectId: form.projectId,
          taskTypeId: form.taskTypeId,
          date: form.date,
          hours: parseFloat(form.hours),
          isBillable: form.isBillable,
          note: form.note,
          noteClientVisible: form.noteClientVisible,
        });
      }
      setShowForm(false);
      loadEntries();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this time entry?')) return;
    await api.delete(`/time-entries/${id}`);
    loadEntries();
  }

  // BUG-1 fix: update the single entry in place instead of refetching — a full
  // reload flips `loading`, remounts the list, and resets the scroll position.
  async function toggleBillable(entry) {
    setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, isBillable: !entry.isBillable } : e)));
    try {
      await api.put(`/time-entries/${entry.id}`, { isBillable: !entry.isBillable });
    } catch {
      setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, isBillable: entry.isBillable } : e)));
    }
  }

  async function toggleNoteVisible(entry) {
    setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, noteClientVisible: !entry.noteClientVisible } : e)));
    try {
      await api.put(`/time-entries/${entry.id}`, { noteClientVisible: !entry.noteClientVisible });
    } catch {
      setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, noteClientVisible: entry.noteClientVisible } : e)));
    }
  }

  function handleStopTimer() {
    const secs = stopTimer();
    // Never produce 0.00 — the form requires hours > 0
    const hours = Math.max(secs / 3600, 0.01).toFixed(2);
    setEditEntry(null);
    setForm({
      date: format(new Date(), 'yyyy-MM-dd'),
      clientId: '',
      projectId: '',
      taskTypeId: '',
      hours,
      isBillable: true,
      note: '',
      noteClientVisible: false,
    });
    setFormError('');
    setShowForm(true);
  }

  // Apply billable filter for list view
  const filteredEntries = entries.filter(e => {
    if (billableFilter === 'billable') return e.isBillable;
    if (billableFilter === 'nonbillable') return !e.isBillable;
    return true;
  });

  // Group entries by date
  const byDate = {};
  for (const e of filteredEntries) {
    const d = format(parseISO(e.date), 'yyyy-MM-dd');
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(e);
  }
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries.filter((e) => e.isBillable).reduce((s, e) => s + e.hours, 0);
  const nonBillableHours = totalHours - billableHours;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="page-title">Time</h1>
        <div className="flex items-center gap-2">
          {!timerRunning ? (
            <button onClick={startTimer} className="btn-secondary flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" strokeWidth="2" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 8l6 4-6 4V8z" />
              </svg>
              Start Timer
            </button>
          ) : (
            <button onClick={handleStopTimer} className="bg-red-500 text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-red-600 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" strokeWidth="2" />
              </svg>
              Stop — {formatTimer(timerSeconds)}
            </button>
          )}
          <button onClick={openAdd} className="btn-primary">+ Log Time</button>
        </div>
      </div>

      {/* Week nav + toggles */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart((w) => subWeeks(w, 1))} className="btn-ghost">
            ← Prev
          </button>
          <span className="text-sm font-semibold text-purple-darkest">
            {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
          </span>
          <button onClick={() => setWeekStart((w) => addWeeks(w, 1))} className="btn-ghost">
            Next →
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            className="text-xs text-purple-mid hover:underline ml-1"
          >
            Today
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center gap-1 bg-bg-light rounded-lg p-1">
            <button onClick={() => setView('list')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${view === 'list' ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}>
              List
            </button>
            <button onClick={() => setView('timesheet')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${view === 'timesheet' ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}>
              Timesheet
            </button>
          </div>
          {/* Billable filter */}
          <div className="flex items-center gap-1 bg-bg-light rounded-lg p-1">
            {[['all','All'],['billable','Billable'],['nonbillable','Non-bill.']].map(([val, label]) => (
              <button key={val} onClick={() => setBillableFilter(val)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${billableFilter === val ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* My Time / Everyone */}
          <div className="flex items-center gap-1 bg-bg-light rounded-lg p-1">
            <button
              onClick={() => setEveryone(false)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${!everyone ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}
            >
              My Time
            </button>
            <button
              onClick={() => setEveryone(true)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${everyone ? 'bg-white shadow-sm font-semibold text-purple-dark' : 'text-text-muted'}`}
            >
              Everyone
            </button>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div className="card p-4 mb-6 flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-text-muted font-semibold uppercase tracking-wide">Total</div>
          <div className="text-2xl font-bold text-purple-darkest">{totalHours.toFixed(1)}h</div>
        </div>
        <div>
          <div className="text-xs text-text-muted font-semibold uppercase tracking-wide">Billable</div>
          <div className="text-2xl font-bold text-olive">{billableHours.toFixed(1)}h</div>
        </div>
        <div>
          <div className="text-xs text-text-muted font-semibold uppercase tracking-wide">Non-Billable</div>
          <div className="text-2xl font-bold text-text-muted">{nonBillableHours.toFixed(1)}h</div>
        </div>
      </div>

      {/* Timesheet view */}
      {view === 'timesheet' && (
        <TimesheetView
          weekStart={weekStart}
          entries={entries}
          onRefresh={loadEntries}
          projects={projects}
          taskTypes={taskTypes}
          everyone={everyone}
          currentUser={user}
        />
      )}

      {/* List view */}
      {view === 'list' && loading ? (
        <div className="text-text-muted text-sm">Loading…</div>
      ) : view === 'list' && sortedDates.length === 0 ? (
        <div className="card p-8 text-center text-text-muted">
          No time entries for this week.{' '}
          <button onClick={openAdd} className="text-purple-mid underline">Log your first entry</button>
        </div>
      ) : view === 'list' ? (
        <div className="space-y-6">
          {sortedDates.map((date) => {
            const dayEntries = byDate[date];
            const dayHours = dayEntries.reduce((s, e) => s + e.hours, 0);
            return (
              <div key={date}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-text-muted">
                    {format(parseISO(date), 'EEEE, MMM d')}
                  </h3>
                  <span className="text-sm text-text-muted">{dayHours.toFixed(1)}h</span>
                </div>
                <div className="card divide-y divide-border">
                  {dayEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-bg-light transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-text-body truncate">
                            {entry.project?.client?.name}
                          </span>
                          <span className="text-text-muted text-sm">·</span>
                          <span className="text-sm text-text-body truncate">{entry.project?.name}</span>
                          <span className="text-text-muted text-sm">·</span>
                          <span className="text-sm text-text-muted">{entry.taskType?.name}</span>
                          {everyone && (
                            <>
                              <span className="text-text-muted text-sm">·</span>
                              <span className="text-xs text-purple-mid font-semibold">{entry.user?.name}</span>
                            </>
                          )}
                        </div>
                        {entry.note && (
                          <p className="text-xs text-text-muted mt-0.5 truncate flex items-center gap-1">
                            {entry.noteClientVisible && (
                              <svg className="w-3 h-3 shrink-0 text-purple-mid/60" fill="none" stroke="currentColor" viewBox="0 0 24 24" title="Client-visible note">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            )}
                            {entry.note}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Billable toggle — click to flip for own entries */}
                        {entry.userId === user?.id ? (
                          <button
                            onClick={() => toggleBillable(entry)}
                            title={entry.isBillable ? 'Click to mark non-billable' : 'Click to mark billable'}
                            className={`text-xs px-2 py-0.5 rounded-full font-semibold transition-all hover:opacity-70 active:scale-95 cursor-pointer ${entry.isBillable ? 'badge-billable' : 'badge-non-billable'}`}
                          >
                            {entry.isBillable ? 'Billable' : 'Non-billable'}
                          </button>
                        ) : (
                          <span className={entry.isBillable ? 'badge-billable' : 'badge-non-billable'}>
                            {entry.isBillable ? 'Billable' : 'Non-billable'}
                          </span>
                        )}

                        {/* Note visibility toggle — shown for own entries that have a note */}
                        {entry.note && entry.userId === user?.id && (
                          <button
                            onClick={() => toggleNoteVisible(entry)}
                            title={entry.noteClientVisible ? 'Note is client-visible — click to hide' : 'Note is hidden from client — click to make visible'}
                            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold border transition-all hover:opacity-70 active:scale-95 cursor-pointer ${
                              entry.noteClientVisible
                                ? 'bg-purple-mid/10 text-purple-mid border-purple-mid/40'
                                : 'bg-gray-100 text-gray-400 border-gray-200'
                            }`}
                          >
                            {entry.noteClientVisible ? (
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            ) : (
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
                              </svg>
                            )}
                            {entry.noteClientVisible ? 'Client' : 'Hidden'}
                          </button>
                        )}

                        <span className="text-sm font-semibold text-purple-darkest w-12 text-right">
                          {entry.hours}h
                        </span>
                        {entry.userId === user?.id && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openEdit(entry)}
                              className="text-text-muted hover:text-purple-dark p-1"
                              title="Edit"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="text-text-muted hover:text-red-500 p-1"
                              title="Delete"
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
      ) : null}

      {/* Slide-over form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowForm(false)} />
          <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="section-title">{editEntry ? 'Edit Time Entry' : 'Log Time'}</h2>
              <button onClick={() => setShowForm(false)} className="text-text-muted hover:text-text-body">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div>
                <label className="form-label">Date</label>
                <input
                  type="date"
                  className="form-input"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="form-label">Client</label>
                <select
                  className="form-select"
                  value={form.clientId}
                  onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value, projectId: '', taskTypeId: '' }))}
                >
                  <option value="">All clients</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Project *</label>
                <select
                  className="form-select"
                  value={form.projectId}
                  onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value, taskTypeId: '' }))}
                  required
                >
                  <option value="">Select project…</option>
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.client?.name} — {p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Task Type *</label>
                <select
                  className="form-select"
                  value={form.taskTypeId}
                  onChange={(e) => setForm((f) => ({ ...f, taskTypeId: e.target.value }))}
                  required
                >
                  <option value="">Select task…</option>
                  {filteredTaskTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Hours *</label>
                <input
                  type="number"
                  step="0.25"
                  min="0.01"
                  className="form-input"
                  value={form.hours}
                  onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                  placeholder="e.g. 1.5"
                  required
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="form-label mb-0">Billable</label>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, isBillable: !f.isBillable }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.isBillable ? 'bg-olive' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.isBillable ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div>
                <label className="form-label">Note</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Optional note…"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-text-muted">Client-visible note</label>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, noteClientVisible: !f.noteClientVisible }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.noteClientVisible ? 'bg-purple-mid' : 'bg-gray-200'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.noteClientVisible ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">
                  {saving ? 'Saving…' : editEntry ? 'Save Changes' : 'Log Time'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
