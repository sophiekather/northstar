import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import api from '../lib/api';
import {
  Avatar, PriorityChip, TaskStatusChip, SlideOver, ClientProject, DueDate, TASK_STATUS_LABELS,
} from '../lib/ui';

const EMPTY_FORM = {
  title: '', projectId: '', assigneeMode: 'user', assigneeUserId: '', assigneeName: '',
  priority: 'MEDIUM', status: 'TODO', dueDate: '', deliverableId: '', notes: '',
  subHours: '', subExpenseAmount: '',
};

const NEXT_STATUS = { TODO: 'IN_PROGRESS', IN_PROGRESS: 'DONE', DONE: 'TODO' };

// Ranked task list with filters, drag-reorder, and subcontractor expense strip
// (wireframe 2b). lockedProjectId scopes it to one project (overview Tasks tab).
export default function TaskBoard({ lockedProjectId }) {
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [clientFilter, setClientFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState(lockedProjectId || '');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [sort, setSort] = useState('rank');

  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const dragIndex = useRef(null);

  // Log-time slide-over — logs against a task and lands on the timesheet
  const [timeTask, setTimeTask] = useState(null);
  const [taskTypes, setTaskTypes] = useState([]);
  const [timeForm, setTimeForm] = useState(null);
  const [timeError, setTimeError] = useState('');
  const [timeSaving, setTimeSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (lockedProjectId) params.projectId = lockedProjectId;
      else if (projectFilter) params.projectId = projectFilter;
      else if (clientFilter) params.clientId = clientFilter;
      if (assigneeFilter) params.assignee = assigneeFilter;
      if (statusFilter === 'all') params.status = 'all';
      else if (statusFilter !== 'open') params.status = statusFilter;
      const r = await api.get('/tasks', { params });
      setTasks(r.data);
    } finally {
      setLoading(false);
    }
  }, [lockedProjectId, projectFilter, clientFilter, assigneeFilter, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/projects').then((r) => setProjects(r.data));
    api.get('/reports/users').then((r) => setUsers(r.data));
    api.get('/task-types').then((r) => setTaskTypes(r.data));
  }, []);

  const clients = useMemo(() => {
    const map = {};
    for (const p of projects) if (p.client) map[p.client.id] = p.client.name;
    return Object.entries(map).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const subNames = useMemo(
    () => [...new Set(tasks.filter((t) => t.isSubcontractor && t.assigneeName).map((t) => t.assigneeName))],
    [tasks]
  );

  const visible = useMemo(() => {
    const list = [...tasks];
    if (sort === 'priority') {
      const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      list.sort((a, b) => order[a.priority] - order[b.priority] || a.rank - b.rank);
    } else if (sort === 'due') {
      list.sort((a, b) => (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity));
    }
    return list;
  }, [tasks, sort]);

  const canDrag = sort === 'rank';

  async function persistOrder(list) {
    setTasks(list);
    await api.patch('/tasks/reorder', { ids: list.map((t) => t.id) });
  }

  function handleDrop(dropIdx) {
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from == null || from === dropIdx) return;
    const list = [...visible];
    const [moved] = list.splice(from, 1);
    list.splice(dropIdx, 0, moved);
    persistOrder(list);
  }

  async function cycleStatus(task) {
    const status = NEXT_STATUS[task.status];
    const r = await api.put(`/tasks/${task.id}`, { status });
    // In-place update — no refetch, no scroll jump. Tasks completed while the
    // "Open" filter is active drop out of the list.
    setTasks((ts) =>
      ts
        .map((t) => (t.id === task.id ? r.data : t))
        .filter((t) => !(statusFilter === 'open' && t.status === 'DONE'))
    );
  }

  function openAdd() {
    setEditTask(null);
    setForm({ ...EMPTY_FORM, projectId: lockedProjectId || projectFilter || '' });
    setFormError('');
    setShowForm(true);
  }

  function openEdit(task) {
    setEditTask(task);
    setForm({
      title: task.title,
      projectId: task.projectId,
      assigneeMode: task.isSubcontractor ? 'sub' : 'user',
      assigneeUserId: task.assigneeUserId || '',
      assigneeName: task.assigneeName || '',
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      deliverableId: task.deliverableId || '',
      notes: task.notes || '',
      subHours: task.subHours ?? '',
      subExpenseAmount: task.subExpenseAmount ?? '',
    });
    setFormError('');
    setShowForm(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title || !form.projectId) {
      setFormError('Title and project are required');
      return;
    }
    const isSub = form.assigneeMode === 'sub';
    if (isSub && !form.assigneeName) {
      setFormError('Subcontractor name required');
      return;
    }
    setSaving(true);
    try {
      const data = {
        title: form.title,
        projectId: form.projectId,
        assigneeUserId: isSub ? null : form.assigneeUserId || null,
        assigneeName: isSub ? form.assigneeName : null,
        isSubcontractor: isSub,
        priority: form.priority,
        status: form.status,
        dueDate: form.dueDate || null,
        deliverableId: form.deliverableId || null,
        notes: form.notes || null,
        subHours: isSub ? form.subHours : null,
        subExpenseAmount: isSub ? form.subExpenseAmount : null,
      };
      if (editTask) {
        const r = await api.put(`/tasks/${editTask.id}`, data);
        setTasks((ts) => ts.map((t) => (t.id === editTask.id ? r.data : t)));
      } else {
        await api.post('/tasks', data);
        load();
      }
      setShowForm(false);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Task types offered when logging time: the project's own deliverables if it
  // has them, otherwise the full list (same rule as the Timesheet form).
  function typesForProject(projectId) {
    const proj = projects.find((p) => p.id === projectId);
    const ids = (proj?.projectTasks || []).map((pt) => pt.taskTypeId);
    return ids.length ? taskTypes.filter((t) => ids.includes(t.id)) : taskTypes;
  }

  function openLogTime(task) {
    const options = typesForProject(task.projectId);
    setTimeTask(task);
    setTimeForm({
      date: format(new Date(), 'yyyy-MM-dd'),
      hours: '',
      // Prefer the deliverable this task rolls up to, so the entry lands in the
      // right bucket on the project burn without anyone picking it.
      taskTypeId: task.deliverable?.taskTypeId || options[0]?.id || '',
      isBillable: true,
      note: task.title,
    });
    setTimeError('');
  }

  async function handleLogTime(e) {
    e.preventDefault();
    const hours = parseFloat(timeForm.hours);
    if (!timeForm.taskTypeId) return setTimeError('Pick a task type');
    if (!hours || hours <= 0) return setTimeError('Hours must be greater than 0');

    setTimeSaving(true);
    try {
      await api.post('/time-entries', {
        projectId: timeTask.projectId,
        taskTypeId: timeForm.taskTypeId,
        taskId: timeTask.id,
        date: timeForm.date,
        hours,
        isBillable: timeForm.isBillable,
        note: timeForm.note || null,
      });
      // Reflect the new total on the card without a full board refetch.
      setTasks((ts) =>
        ts.map((t) => (t.id === timeTask.id ? { ...t, loggedHours: (t.loggedHours || 0) + hours } : t))
      );
      setTimeTask(null);
    } catch (err) {
      setTimeError(err.response?.data?.error || 'Could not log time');
    } finally {
      setTimeSaving(false);
    }
  }

  async function handleDelete() {
    if (!editTask) return;
    if (!confirm(`Delete task "${editTask.title}"?`)) return;
    await api.delete(`/tasks/${editTask.id}`);
    setTasks((ts) => ts.filter((t) => t.id !== editTask.id));
    setShowForm(false);
  }

  const formProject = projects.find((p) => p.id === form.projectId);

  return (
    <div>
      {/* Filter bar — every control is the same height and carries its own
          label, so the row reads as one strip rather than mixed widgets. */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {!lockedProjectId && (
          <>
            <select className="filter-select" value={clientFilter} onChange={(e) => { setClientFilter(e.target.value); setProjectFilter(''); }}>
              <option value="">Client: All</option>
              {clients.map((c) => <option key={c.id} value={c.id}>Client: {c.name}</option>)}
            </select>
            <select className="filter-select" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">Project: All</option>
              {projects.filter((p) => !clientFilter || p.clientId === clientFilter).map((p) => (
                <option key={p.id} value={p.id}>Project: {p.name}</option>
              ))}
            </select>
          </>
        )}
        <select className="filter-select" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
          <option value="">Assignee: All</option>
          {users.map((u) => <option key={u.id} value={`user:${u.id}`}>Assignee: {u.name}</option>)}
          {subNames.length > 0 && <option value="subs">Assignee: All subcontractors</option>}
          {subNames.map((n) => <option key={n} value={`sub:${n}`}>Assignee: {n} (sub)</option>)}
        </select>
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="open">Status: Open</option>
          <option value="TODO">Status: To do</option>
          <option value="IN_PROGRESS">Status: In progress</option>
          <option value="DONE">Status: Done</option>
        </select>
        <select className="filter-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="rank">Sort: Priority rank</option>
          <option value="priority">Sort: Priority level</option>
          <option value="due">Sort: Due date</option>
        </select>
        <div className="flex-1" />
        <button onClick={openAdd} className="btn-primary shrink-0">+ New task</button>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-purple-darkest">
          {assigneeFilter ? 'Ranked' : 'All tasks — ranked'}
        </div>
        <span className="text-xs text-text-muted">
          {visible.length} shown{canDrag ? ' · drag to re-rank' : ''}
        </span>
      </div>

      {loading ? (
        <div className="text-text-muted text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="card p-8 text-center text-text-muted">
          No tasks match. <button onClick={openAdd} className="text-purple-mid underline">Create one</button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((task, i) => (
            <div
              key={task.id}
              draggable={canDrag}
              onDragStart={() => { dragIndex.current = i; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              className={`card p-3.5 flex flex-col gap-2 ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-text-muted w-4 text-right shrink-0">{i + 1}</span>
                {canDrag && (
                  <span className="flex flex-col gap-0.5 shrink-0" title="Drag to re-rank">
                    <i className="block w-3 h-px bg-gray-300" /><i className="block w-3 h-px bg-gray-300" /><i className="block w-3 h-px bg-gray-300" />
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <button onClick={() => openEdit(task)} className="font-semibold text-sm text-purple-darkest hover:underline text-left">
                    {task.title}
                  </button>
                  <ClientProject project={task.project} suffix={task.deliverable?.taskType?.name} />
                </div>
                <PriorityChip priority={task.priority} />
              </div>
              <div className="flex items-center justify-between gap-2 pl-6">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar name={task.assigneeUser?.name || task.assigneeName || '—'} size="sm" sub={task.isSubcontractor} />
                  <span className="text-xs text-text-muted truncate">{task.assigneeUser?.name || task.assigneeName || 'Unassigned'}</span>
                  {task.isSubcontractor && (
                    <span className="badge bg-olive/10 text-olive border border-olive/30">Subcontractor</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {task.loggedHours > 0 && (
                    <span className="text-xs text-text-muted tabular-nums" title="Hours logged against this task">
                      {task.loggedHours.toFixed(1)}h
                    </span>
                  )}
                  {!task.isSubcontractor && (
                    <button
                      onClick={() => openLogTime(task)}
                      className="text-xs font-semibold text-purple-mid hover:text-purple-dark hover:underline"
                      title="Log time against this task — it lands on your timesheet"
                    >
                      + Log time
                    </button>
                  )}
                  <DueDate date={task.dueDate} />
                  <button onClick={() => cycleStatus(task)} title={`Click → ${TASK_STATUS_LABELS[NEXT_STATUS[task.status]]}`} className="hover:opacity-70">
                    <TaskStatusChip status={task.status} />
                  </button>
                </div>
              </div>
              {task.isSubcontractor && (
                <div className="flex items-center justify-between gap-2 pl-6 pt-2 border-t border-dashed border-border">
                  <span className="text-xs text-text-muted">↳ No NorthStar login · tracked as project expense</span>
                  <div className="flex items-center gap-2">
                    {task.subHours != null && <span className="badge bg-bg-light text-text-muted border border-border">{task.subHours}h</span>}
                    {task.subExpenseAmount != null && (
                      <span className="badge bg-olive/10 text-olive border border-olive/30">
                        Expense · ${Number(task.subExpenseAmount).toLocaleString()}
                      </span>
                    )}
                    <button onClick={() => openEdit(task)} className="text-xs text-purple-mid hover:underline">Edit</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <SlideOver title={editTask ? 'Edit Task' : 'New Task'} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="form-label">Title *</label>
              <input type="text" className="form-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
            </div>
            <div>
              <label className="form-label">Project *</label>
              <select
                className="form-select"
                value={form.projectId}
                disabled={!!lockedProjectId}
                onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value, deliverableId: '' }))}
                required
              >
                <option value="">Select project…</option>
                {clients.map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {projects.filter((p) => p.clientId === c.id).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Assignee</label>
              <div className="flex gap-2 mb-2">
                {[['user', 'Partner'], ['sub', 'Subcontractor']].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, assigneeMode: mode }))}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      form.assigneeMode === mode ? 'bg-purple-dark text-white border-purple-dark' : 'bg-white text-text-muted border-border'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {form.assigneeMode === 'user' ? (
                <select className="form-select" value={form.assigneeUserId} onChange={(e) => setForm((f) => ({ ...f, assigneeUserId: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              ) : (
                <input
                  type="text" className="form-input" placeholder="Subcontractor name"
                  value={form.assigneeName} onChange={(e) => setForm((f) => ({ ...f, assigneeName: e.target.value }))}
                  list="sub-names"
                />
              )}
              <datalist id="sub-names">
                {subNames.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
            {form.assigneeMode === 'sub' && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-olive/5 border border-olive/20">
                <div>
                  <label className="form-label">Hours (manual)</label>
                  <input type="number" step="0.5" min="0" className="form-input" value={form.subHours} onChange={(e) => setForm((f) => ({ ...f, subHours: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Expense ($)</label>
                  <input type="number" step="0.01" min="0" className="form-input" value={form.subExpenseAmount} onChange={(e) => setForm((f) => ({ ...f, subExpenseAmount: e.target.value }))} />
                </div>
                <p className="col-span-2 text-xs text-text-muted">No NorthStar login — hours are logged manually and post to project burn; the fee is tracked as a project expense.</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Priority</label>
                <select className="form-select" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </div>
              <div>
                <label className="form-label">Status</label>
                <select className="form-select" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="TODO">To do</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="DONE">Done</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Due date</label>
                <input type="date" className="form-input" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Deliverable</label>
                <select className="form-select" value={form.deliverableId} onChange={(e) => setForm((f) => ({ ...f, deliverableId: e.target.value }))}>
                  <option value="">None</option>
                  {(formProject?.projectTasks || []).map((pt) => (
                    <option key={pt.id} value={pt.id}>{pt.taskType?.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Notes</label>
              <textarea className="form-input" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            {formError && <p className="text-red-600 text-sm">{formError}</p>}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving…' : editTask ? 'Save Changes' : 'Create Task'}
              </button>
              {editTask && (
                <button type="button" onClick={handleDelete} className="btn-ghost text-red-600">Delete</button>
              )}
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </SlideOver>
      )}

      {timeTask && timeForm && (
        <SlideOver title="Log Time" onClose={() => setTimeTask(null)}>
          <form onSubmit={handleLogTime} className="space-y-4">
            <div className="p-3 rounded-lg bg-bg-light border border-border">
              <div className="text-sm font-semibold text-purple-darkest">{timeTask.title}</div>
              <ClientProject project={timeTask.project} className="mt-0.5" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Date</label>
                <input
                  type="date" className="form-input" value={timeForm.date}
                  onChange={(e) => setTimeForm((f) => ({ ...f, date: e.target.value }))} required
                />
              </div>
              <div>
                <label className="form-label">Hours *</label>
                {/* step="any": a 0.25 step off a 0.01 floor makes 1.5 an invalid
                    value and the browser silently blocks submit. Hours are
                    validated in handleLogTime and on the server instead. */}
                <input
                  type="number" step="any" min="0.01" className="form-input" placeholder="e.g. 1.5"
                  value={timeForm.hours} onChange={(e) => setTimeForm((f) => ({ ...f, hours: e.target.value }))}
                  autoFocus required
                />
              </div>
            </div>
            <div>
              <label className="form-label">Task Type *</label>
              <select
                className="form-select" value={timeForm.taskTypeId}
                onChange={(e) => setTimeForm((f) => ({ ...f, taskTypeId: e.target.value }))} required
              >
                <option value="">Select task type…</option>
                {typesForProject(timeTask.projectId).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="form-label mb-0">Billable</label>
              <button
                type="button"
                onClick={() => setTimeForm((f) => ({ ...f, isBillable: !f.isBillable }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${timeForm.isBillable ? 'bg-olive' : 'bg-gray-200'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${timeForm.isBillable ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div>
              <label className="form-label">Note</label>
              <textarea
                className="form-input" rows={2} value={timeForm.note}
                onChange={(e) => setTimeForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            {timeError && <p className="text-red-600 text-sm">{timeError}</p>}
            <p className="text-xs text-text-muted">This posts straight to your timesheet and the project burn.</p>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={timeSaving} className="btn-primary flex-1">
                {timeSaving ? 'Logging…' : 'Log Time'}
              </button>
              <button type="button" onClick={() => setTimeTask(null)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </SlideOver>
      )}
    </div>
  );
}
