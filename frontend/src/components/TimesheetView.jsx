import { useState, useEffect, useCallback, useRef } from 'react';
import { format, addDays, parseISO, isSameDay } from 'date-fns';
import api from '../lib/api';

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function toDateStr(d) { return format(d, 'yyyy-MM-dd'); }

function isToday(d) {
  return isSameDay(d, new Date());
}

// Row selector modal — pick project + task to add a new row
function AddRowModal({ projects, taskTypes, onAdd, onClose }) {
  const [projectId, setProjectId] = useState('');
  const [taskTypeId, setTaskTypeId] = useState('');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState([]);
  const [filteredProjects, setFilteredProjects] = useState(projects);
  const [filteredTasks, setFilteredTasks] = useState(taskTypes);

  useEffect(() => {
    const unique = {};
    projects.forEach(p => { if (p.client) unique[p.client.id] = p.client; });
    setClients(Object.values(unique).sort((a,b) => a.name.localeCompare(b.name)));
  }, [projects]);

  useEffect(() => {
    setFilteredProjects(clientId ? projects.filter(p => p.clientId === clientId) : projects);
    setProjectId(''); setTaskTypeId('');
  }, [clientId, projects]);

  useEffect(() => {
    if (projectId) {
      const proj = projects.find(p => p.id === projectId);
      const taskIds = proj?.projectTasks?.map(pt => pt.taskTypeId) || [];
      setFilteredTasks(taskIds.length ? taskTypes.filter(t => taskIds.includes(t.id)) : taskTypes);
    } else {
      setFilteredTasks(taskTypes);
    }
    setTaskTypeId('');
  }, [projectId, projects, taskTypes]);

  function handleAdd() {
    if (!projectId || !taskTypeId) return;
    const proj = projects.find(p => p.id === projectId);
    const task = taskTypes.find(t => t.id === taskTypeId);
    onAdd({ projectId, taskTypeId, projectName: proj?.name, clientName: proj?.client?.name, taskName: task?.name, isBillable: task?.isBillableDefault ?? true });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-sm z-10">
        <h3 className="font-bold text-text-body mb-4">Add Row</h3>
        <div className="space-y-3">
          <div>
            <label className="form-label">Client</label>
            <select className="form-select" value={clientId} onChange={e => setClientId(e.target.value)}>
              <option value="">All clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Project *</label>
            <select className="form-select" value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Select project…</option>
              {filteredProjects.map(p => <option key={p.id} value={p.id}>{p.client?.name} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Task Type *</label>
            <select className="form-select" value={taskTypeId} onChange={e => setTaskTypeId(e.target.value)}>
              <option value="">Select task…</option>
              {filteredTasks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={handleAdd} disabled={!projectId || !taskTypeId} className="btn-primary flex-1">Add Row</button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function TimesheetView({ weekStart, entries, onRefresh, projects, taskTypes }) {
  // weekDays: Mon–Sun
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // grid[rowKey][dateStr] = { hours, entryId }
  const [grid, setGrid] = useState({});
  // rows[rowKey] = { projectId, taskTypeId, projectName, clientName, taskName, isBillable }
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState({}); // rowKey+date -> true
  const [showAddRow, setShowAddRow] = useState(false);
  const prevEntriesRef = useRef(null);

  // Build grid from entries whenever entries change
  useEffect(() => {
    if (JSON.stringify(entries) === JSON.stringify(prevEntriesRef.current)) return;
    prevEntriesRef.current = entries;

    const newRows = {};
    const newGrid = {};

    for (const e of entries) {
      const key = `${e.projectId}::${e.taskTypeId}`;
      if (!newRows[key]) {
        newRows[key] = {
          projectId: e.projectId,
          taskTypeId: e.taskTypeId,
          projectName: e.project?.name,
          clientName: e.project?.client?.name,
          taskName: e.taskType?.name,
          isBillable: e.isBillable,
        };
      }
      if (!newGrid[key]) newGrid[key] = {};
      const dateStr = toDateStr(parseISO(e.date));
      newGrid[key][dateStr] = { hours: e.hours, entryId: e.id };
    }

    // Merge: keep existing rows that aren't in new data (user-added empty rows)
    setRows(prev => {
      const merged = { ...newRows };
      prev.forEach(r => {
        const k = `${r.projectId}::${r.taskTypeId}`;
        if (!merged[k]) merged[k] = r;
      });
      return Object.values(merged);
    });
    setGrid(prev => {
      // Deep merge: preserve pending edits
      const merged = { ...newGrid };
      for (const key of Object.keys(prev)) {
        if (!merged[key]) merged[key] = {};
        for (const [d, v] of Object.entries(prev[key])) {
          if (!merged[key][d]) merged[key][d] = v;
        }
      }
      return merged;
    });
  }, [entries]);

  const cellKey = (rowKey, dateStr) => `${rowKey}__${dateStr}`;

  async function handleCellBlur(row, dateStr, displayValue) {
    const rowKey = `${row.projectId}::${row.taskTypeId}`;
    const hours = parseFloat(displayValue);
    const existing = grid[rowKey]?.[dateStr];
    const ck = cellKey(rowKey, dateStr);

    // Nothing to do
    if ((isNaN(hours) || hours === 0) && !existing?.entryId) return;
    if (existing?.hours === hours) return;

    setSaving(s => ({ ...s, [ck]: true }));
    try {
      if (isNaN(hours) || hours === 0) {
        // Delete
        if (existing?.entryId) {
          await api.delete(`/time-entries/${existing.entryId}`);
          setGrid(g => { const n = { ...g }; delete n[rowKey][dateStr]; return n; });
        }
      } else if (existing?.entryId) {
        // Update
        await api.put(`/time-entries/${existing.entryId}`, { hours, date: dateStr });
        setGrid(g => ({ ...g, [rowKey]: { ...g[rowKey], [dateStr]: { hours, entryId: existing.entryId } } }));
      } else {
        // Create
        const r = await api.post('/time-entries', {
          projectId: row.projectId,
          taskTypeId: row.taskTypeId,
          date: dateStr,
          hours,
          isBillable: row.isBillable,
          hourlyRate: 0,
        });
        setGrid(g => ({ ...g, [rowKey]: { ...g[rowKey], [dateStr]: { hours, entryId: r.data.id } } }));
      }
      onRefresh();
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setSaving(s => ({ ...s, [ck]: false }));
    }
  }

  function handleCellChange(rowKey, dateStr, val) {
    setGrid(g => ({
      ...g,
      [rowKey]: { ...(g[rowKey] || {}), [dateStr]: { ...(g[rowKey]?.[dateStr] || {}), hours: val === '' ? '' : val } },
    }));
  }

  function addRow(rowData) {
    const key = `${rowData.projectId}::${rowData.taskTypeId}`;
    if (rows.find(r => `${r.projectId}::${r.taskTypeId}` === key)) return;
    setRows(r => [...r, rowData]);
    setGrid(g => ({ ...g, [key]: g[key] || {} }));
  }

  function removeRow(rowKey) {
    setRows(r => r.filter(row => `${row.projectId}::${row.taskTypeId}` !== rowKey));
  }

  // Day totals
  const dayTotals = weekDays.map(day => {
    const ds = toDateStr(day);
    return rows.reduce((sum, row) => {
      const key = `${row.projectId}::${row.taskTypeId}`;
      const h = parseFloat(grid[key]?.[ds]?.hours) || 0;
      return sum + h;
    }, 0);
  });
  const weekTotal = dayTotals.reduce((s, h) => s + h, 0);

  return (
    <div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-semibold text-text-muted text-xs uppercase w-64 min-w-[200px]">Project / Task</th>
              {weekDays.map((day, i) => (
                <th key={i} className={`text-center px-2 py-3 font-semibold text-xs w-20 min-w-[72px] ${isToday(day) ? 'text-purple-mid' : 'text-text-muted'}`}>
                  <div className="uppercase">{DAYS[i]}</div>
                  <div className={`text-base font-bold mt-0.5 ${isToday(day) ? 'text-purple-mid' : 'text-text-body'}`}>
                    {format(day, 'd')}
                  </div>
                </th>
              ))}
              <th className="text-right px-4 py-3 font-semibold text-text-muted text-xs uppercase w-16">Total</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-text-muted py-10 text-sm">
                  No rows yet. Click <strong>+ Add row</strong> below to start.
                </td>
              </tr>
            )}
            {rows.map(row => {
              const rowKey = `${row.projectId}::${row.taskTypeId}`;
              const rowTotal = weekDays.reduce((sum, day) => {
                const h = parseFloat(grid[rowKey]?.[toDateStr(day)]?.hours) || 0;
                return sum + h;
              }, 0);
              return (
                <tr key={rowKey} className="group hover:bg-bg-light/40">
                  <td className="px-4 py-2">
                    <div className="font-semibold text-text-body leading-tight">{row.projectName}
                      <span className="font-normal text-text-muted"> ({row.clientName})</span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">{row.taskName}</div>
                  </td>
                  {weekDays.map((day, i) => {
                    const ds = toDateStr(day);
                    const cellVal = grid[rowKey]?.[ds]?.hours;
                    const displayVal = cellVal === '' ? '' : (cellVal !== undefined ? String(cellVal) : '');
                    const ck = cellKey(rowKey, ds);
                    const isSavingCell = saving[ck];
                    return (
                      <td key={i} className={`px-1 py-2 text-center ${isToday(day) ? 'bg-purple-50/40' : ''}`}>
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          className={`w-16 text-center border rounded-md py-1.5 text-sm transition-colors outline-none
                            ${isSavingCell ? 'border-olive bg-olive/10' : 'border-border bg-white hover:border-purple-mid focus:border-purple-mid focus:ring-1 focus:ring-purple-mid/30'}
                            ${parseFloat(displayVal) > 0 ? 'font-semibold text-text-body' : 'text-text-muted'}`}
                          value={displayVal}
                          placeholder="—"
                          onChange={e => handleCellChange(rowKey, ds, e.target.value)}
                          onBlur={e => handleCellBlur(row, ds, e.target.value)}
                          onFocus={e => e.target.select()}
                        />
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-right font-bold text-text-body">
                    {rowTotal > 0 ? rowTotal.toFixed(1) : <span className="text-text-muted font-normal">0</span>}
                  </td>
                  <td className="pr-2 py-2">
                    <button onClick={() => removeRow(rowKey)}
                      className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all p-1 rounded">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-bg-light font-bold">
              <td className="px-4 py-3 text-xs uppercase text-text-muted">Day Total</td>
              {dayTotals.map((h, i) => (
                <td key={i} className={`text-center py-3 text-sm ${isToday(weekDays[i]) ? 'text-purple-mid' : 'text-text-body'}`}>
                  {h > 0 ? h.toFixed(1) : <span className="text-text-muted font-normal">0</span>}
                </td>
              ))}
              <td className="text-right px-4 py-3 text-sm text-purple-darkest">
                {weekTotal.toFixed(1)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button onClick={() => setShowAddRow(true)}
        className="mt-3 flex items-center gap-1.5 text-sm text-text-muted hover:text-purple-mid font-semibold transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
        </svg>
        Add row
      </button>

      {showAddRow && (
        <AddRowModal
          projects={projects}
          taskTypes={taskTypes}
          onAdd={addRow}
          onClose={() => setShowAddRow(false)}
        />
      )}
    </div>
  );
}
