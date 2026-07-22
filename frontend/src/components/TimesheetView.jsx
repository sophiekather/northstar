import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { format, addDays, parseISO, isSameDay } from 'date-fns';
import api from '../lib/api';

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function toDateStr(d) { return format(d, 'yyyy-MM-dd'); }
function isToday(d) { return isSameDay(d, new Date()); }

// Row key includes userId when showing everyone to avoid merging rows across users.
function makeRowKey(userId, projectId, taskTypeId, everyone) {
  return everyone ? `${userId}::${projectId}::${taskTypeId}` : `${projectId}::${taskTypeId}`;
}

function NoteIcon({ note }) {
  return (
    <div className="mt-0.5 flex justify-center" title={note}>
      <svg className="w-3 h-3 text-purple-mid/70" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z" clipRule="evenodd" />
      </svg>
    </div>
  );
}

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
    setClients(Object.values(unique).sort((a, b) => a.name.localeCompare(b.name)));
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
    onAdd({
      projectId, taskTypeId,
      projectName: proj?.name, clientName: proj?.client?.name,
      taskName: task?.name, isBillable: task?.isBillableDefault ?? true,
    });
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

// Props: everyone — whether the "Everyone" toggle is active
//        currentUser — { id, name } of the logged-in user
export default function TimesheetView({ weekStart, entries, onRefresh, projects, taskTypes, everyone, currentUser }) {
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // grid[rowKey][dateStr] = { hours, entryId, note }
  const [grid, setGrid] = useState({});
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState({});
  const [showAddRow, setShowAddRow] = useState(false);
  const prevEntriesRef = useRef(null);

  useEffect(() => {
    if (JSON.stringify(entries) === JSON.stringify(prevEntriesRef.current)) return;
    prevEntriesRef.current = entries;

    const newRows = {};
    const newGrid = {};

    for (const e of entries) {
      const uid = e.userId || '';
      const key = makeRowKey(uid, e.projectId, e.taskTypeId, everyone);
      if (!newRows[key]) {
        newRows[key] = {
          userId: uid,
          userName: e.user?.name || '',
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
      newGrid[key][dateStr] = { hours: e.hours, entryId: e.id, note: e.note || '' };
    }

    setRows(prev => {
      const merged = { ...newRows };
      prev.forEach(r => {
        const k = makeRowKey(r.userId || '', r.projectId, r.taskTypeId, everyone);
        if (!merged[k]) merged[k] = r;
      });
      return Object.values(merged);
    });
    setGrid(prev => {
      const merged = { ...newGrid };
      for (const key of Object.keys(prev)) {
        if (!merged[key]) merged[key] = {};
        for (const [d, v] of Object.entries(prev[key])) {
          if (!merged[key][d]) merged[key][d] = v;
        }
      }
      return merged;
    });
  }, [entries, everyone]);

  // When everyone=true, group rows by user for display.
  const userGroups = useMemo(() => {
    if (!everyone) return null;
    const groups = {};
    rows.forEach(row => {
      const uid = row.userId || currentUser?.id || '';
      if (!groups[uid]) groups[uid] = { userId: uid, userName: row.userName || currentUser?.name || 'Me', rows: [] };
      groups[uid].rows.push(row);
    });
    return Object.values(groups).sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
  }, [everyone, rows, currentUser]);

  const cellKey = (rk, dateStr) => `${rk}__${dateStr}`;

  async function handleCellBlur(row, dateStr, displayValue) {
    const rk = makeRowKey(row.userId || '', row.projectId, row.taskTypeId, everyone);
    const hours = parseFloat(displayValue);
    const existing = grid[rk]?.[dateStr];
    const ck = cellKey(rk, dateStr);

    if ((isNaN(hours) || hours === 0) && !existing?.entryId) return;
    if (existing?.hours === hours) return;

    setSaving(s => ({ ...s, [ck]: true }));
    try {
      if (isNaN(hours) || hours === 0) {
        if (existing?.entryId) {
          await api.delete(`/time-entries/${existing.entryId}`);
          setGrid(g => { const n = { ...g }; delete n[rk][dateStr]; return n; });
        }
      } else if (existing?.entryId) {
        await api.put(`/time-entries/${existing.entryId}`, { hours, date: dateStr });
        setGrid(g => ({ ...g, [rk]: { ...g[rk], [dateStr]: { hours, entryId: existing.entryId, note: existing.note || '' } } }));
      } else {
        const r = await api.post('/time-entries', {
          projectId: row.projectId,
          taskTypeId: row.taskTypeId,
          date: dateStr,
          hours,
          isBillable: row.isBillable,
          hourlyRate: 0,
        });
        setGrid(g => ({ ...g, [rk]: { ...g[rk], [dateStr]: { hours, entryId: r.data.id, note: '' } } }));
      }
      onRefresh();
    } catch (err) {
      console.error('Save failed', err);
    } finally {
      setSaving(s => ({ ...s, [ck]: false }));
    }
  }

  function handleCellChange(rk, dateStr, val) {
    setGrid(g => ({
      ...g,
      [rk]: { ...(g[rk] || {}), [dateStr]: { ...(g[rk]?.[dateStr] || {}), hours: val === '' ? '' : val } },
    }));
  }

  function addRow(rowData) {
    const uid = currentUser?.id || '';
    const enriched = { ...rowData, userId: uid, userName: currentUser?.name || '' };
    const key = makeRowKey(uid, rowData.projectId, rowData.taskTypeId, everyone);
    if (rows.find(r => makeRowKey(r.userId || '', r.projectId, r.taskTypeId, everyone) === key)) return;
    setRows(r => [...r, enriched]);
    setGrid(g => ({ ...g, [key]: g[key] || {} }));
  }

  function removeRow(rk) {
    setRows(r => r.filter(row => makeRowKey(row.userId || '', row.projectId, row.taskTypeId, everyone) !== rk));
  }

  const dayTotals = weekDays.map(day => {
    const ds = toDateStr(day);
    return rows.reduce((sum, row) => {
      const key = makeRowKey(row.userId || '', row.projectId, row.taskTypeId, everyone);
      return sum + (parseFloat(grid[key]?.[ds]?.hours) || 0);
    }, 0);
  });
  const weekTotal = dayTotals.reduce((s, h) => s + h, 0);

  function renderDataRow(row) {
    const rk = makeRowKey(row.userId || '', row.projectId, row.taskTypeId, everyone);
    // In everyone mode, other users' rows are read-only.
    const readOnly = everyone && row.userId && row.userId !== currentUser?.id;
    const rowTotal = weekDays.reduce((sum, day) => {
      return sum + (parseFloat(grid[rk]?.[toDateStr(day)]?.hours) || 0);
    }, 0);
    return (
      <tr key={rk} className="group hover:bg-bg-light/40">
        <td className="px-4 py-2">
          <div className="font-semibold text-text-body leading-tight">
            {row.projectName}
            <span className="font-normal text-text-muted"> ({row.clientName})</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-text-muted">{row.taskName}</span>
            {!row.isBillable && (
              <span className="text-xs bg-gray-100 text-gray-400 px-1 rounded leading-tight">Non-bill.</span>
            )}
          </div>
        </td>
        {weekDays.map((day, i) => {
          const ds = toDateStr(day);
          const cellData = grid[rk]?.[ds];
          const displayVal = cellData?.hours === '' ? '' : (cellData?.hours !== undefined ? String(cellData.hours) : '');
          const ck = cellKey(rk, ds);
          const isSavingCell = saving[ck];
          return (
            <td key={i} className={`px-1 py-2 text-center align-top ${isToday(day) ? 'bg-purple-50/40' : ''}`}>
              {/* step="any" so odd durations (1.3, 0.83) aren't rejected —
                  the grid still arrows up and down in whole units. */}
              <input
                type="number"
                step="any"
                min="0"
                readOnly={readOnly}
                className={`w-16 text-center border rounded-md py-1.5 text-sm transition-colors outline-none
                  ${readOnly ? 'bg-transparent border-transparent cursor-default text-text-body' : ''}
                  ${!readOnly && isSavingCell ? 'border-olive bg-olive/10' : ''}
                  ${!readOnly && !isSavingCell ? 'border-border bg-white hover:border-purple-mid focus:border-purple-mid focus:ring-1 focus:ring-purple-mid/30' : ''}
                  ${parseFloat(displayVal) > 0 ? 'font-semibold text-text-body' : 'text-text-muted'}`}
                value={displayVal}
                placeholder="—"
                onChange={e => !readOnly && handleCellChange(rk, ds, e.target.value)}
                onBlur={e => !readOnly && handleCellBlur(row, ds, e.target.value)}
                onFocus={e => !readOnly && e.target.select()}
                title={cellData?.note || undefined}
              />
              {cellData?.note && <NoteIcon note={cellData.note} />}
            </td>
          );
        })}
        <td className="px-4 py-2 text-right font-bold text-text-body align-top pt-3">
          {rowTotal > 0 ? rowTotal.toFixed(1) : <span className="text-text-muted font-normal">0</span>}
        </td>
        <td className="pr-2 py-2 align-top pt-2.5">
          {!readOnly && (
            <button onClick={() => removeRow(rk)}
              className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all p-1 rounded">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </td>
      </tr>
    );
  }

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
            {rows.length === 0 && !userGroups && (
              <tr>
                <td colSpan={10} className="text-center text-text-muted py-10 text-sm">
                  No rows yet. Click <strong>+ Add row</strong> below to start.
                </td>
              </tr>
            )}

            {userGroups ? userGroups.map(group => {
              const userDayTotals = weekDays.map(day => {
                const ds = toDateStr(day);
                return group.rows.reduce((sum, row) => {
                  const key = makeRowKey(row.userId || '', row.projectId, row.taskTypeId, everyone);
                  return sum + (parseFloat(grid[key]?.[ds]?.hours) || 0);
                }, 0);
              });
              const userWeekTotal = userDayTotals.reduce((s, h) => s + h, 0);
              return (
                <Fragment key={group.userId}>
                  {/* User header row with per-day subtotals */}
                  <tr className="bg-purple-darkest/5 border-t-2 border-border">
                    <td className="px-4 py-2 font-bold text-purple-darkest text-sm">{group.userName}</td>
                    {userDayTotals.map((h, i) => (
                      <td key={i} className={`text-center py-2 text-xs font-semibold tabular-nums ${isToday(weekDays[i]) ? 'text-purple-mid' : 'text-text-muted'}`}>
                        {h > 0 ? h.toFixed(1) : <span className="opacity-30">—</span>}
                      </td>
                    ))}
                    <td className="text-right px-4 py-2 text-xs font-bold text-purple-darkest tabular-nums">
                      {userWeekTotal.toFixed(1)}
                    </td>
                    <td />
                  </tr>
                  {group.rows.map(renderDataRow)}
                </Fragment>
              );
            }) : rows.map(renderDataRow)}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-bg-light font-bold">
              <td className="px-4 py-3 text-xs uppercase text-text-muted">Day Total</td>
              {dayTotals.map((h, i) => (
                <td key={i} className={`text-center py-3 text-sm tabular-nums ${isToday(weekDays[i]) ? 'text-purple-mid' : 'text-text-body'}`}>
                  {h > 0 ? h.toFixed(1) : <span className="text-text-muted font-normal">0</span>}
                </td>
              ))}
              <td className="text-right px-4 py-3 text-sm text-purple-darkest tabular-nums">
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
