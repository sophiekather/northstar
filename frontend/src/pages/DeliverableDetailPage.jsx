import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { Avatar, BurnRing, TaskStatusChip, fmtDate, burnColors } from '../lib/ui';
import ClientTree from '../components/ClientTree';

// Wireframe 2d: deliverable burn + hours by contributor + tasks in the deliverable
export default function DeliverableDetailPage() {
  const { clientId, projectId, deliverableId } = useParams();
  const [data, setData] = useState(null);
  const [forecastEdit, setForecastEdit] = useState(null); // string while editing

  const load = useCallback(() => {
    api.get(`/projects/${projectId}/deliverables/${deliverableId}`).then((r) => setData(r.data));
  }, [projectId, deliverableId]);
  useEffect(() => { load(); }, [load]);

  async function saveForecast() {
    await api.patch(`/projects/${projectId}/deliverables/${deliverableId}`, { forecastHours: forecastEdit });
    setForecastEdit(null);
    load();
  }

  if (!data) return <div className="text-text-muted text-sm">Loading…</div>;

  const state = data.health?.state || 'ok';
  const colors = burnColors(state);
  const totalSubExpense = data.contributors.filter((c) => c.type === 'sub' && c.expense).reduce((s, c) => s + c.expense, 0);

  return (
    <div className="lg:grid lg:grid-cols-[260px,1fr] lg:gap-6 lg:items-start">
      <aside className="hidden lg:block"><ClientTree /></aside>

      <div className="min-w-0">
        <div className={`h-1 rounded-full mb-3 ${data.project?.retainerConfig ? 'bg-olive' : 'bg-purple-dark'}`} />
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted mb-1">
          <Link to={`/clients/${clientId}`} className="hover:underline">{data.project?.client?.name}</Link>
          {' / '}
          <Link to={`/clients/${clientId}/projects/${projectId}`} className="hover:underline">{data.project?.name}</Link>
          {' / Deliverables / '}{data.taskType?.name}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <Link to={`/clients/${clientId}/projects/${projectId}`} className="text-sm font-semibold text-purple-mid hover:underline">‹ Overview</Link>
            <h1 className="page-title">{data.taskType?.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            {forecastEdit == null ? (
              <button onClick={() => setForecastEdit(String(data.forecastHours ?? ''))} className="btn-secondary">
                {data.forecastHours ? `Forecast: ${data.forecastHours}h` : 'Set forecast'}
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <input
                  type="number" step="0.5" min="0" autoFocus
                  className="form-input !w-24"
                  value={forecastEdit}
                  onChange={(e) => setForecastEdit(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveForecast()}
                />
                <button onClick={saveForecast} className="btn-primary">Save</button>
                <button onClick={() => setForecastEdit(null)} className="btn-ghost">✕</button>
              </span>
            )}
          </div>
        </div>

        <div className={`card p-4 mb-5 flex items-center gap-4 ${data.forecastHours ? `${colors.bg} ${colors.border}` : ''}`}>
          <BurnRing pct={data.health?.pct} state={state} size={56} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-purple-darkest">
              {data.forecastHours
                ? `${data.loggedHours} of ${data.forecastHours} forecasted hours logged`
                : `${data.loggedHours}h logged — no forecast set`}
            </div>
            <div className="text-xs text-text-muted">
              Across {data.contributors.length} {data.contributors.length === 1 ? 'person' : 'people'}
              {data.forecastHours ? ` · ${Math.round((data.forecastHours - data.loggedHours) * 10) / 10}h remaining` : ''}
            </div>
          </div>
          {data.forecastHours && state !== 'ok' && (
            <span className="badge bg-amber-50 text-amber-700 border border-amber-200">at risk</span>
          )}
        </div>

        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-purple-darkest">Hours by contributor</h2>
          <span className="text-xs text-text-muted">{data.loggedHours}h logged</span>
        </div>
        <div className="space-y-2.5 mb-6">
          {data.contributors.length === 0 && (
            <div className="card p-6 text-center text-xs text-text-muted italic">No hours logged against this deliverable yet.</div>
          )}
          {data.contributors.map((c, i) => {
            const share = data.loggedHours > 0 ? Math.round((c.hours / data.loggedHours) * 100) : 0;
            return (
              <div key={i} className="card p-3.5 flex items-center gap-3">
                <span className="flex items-center gap-2.5 w-44 min-w-0">
                  <Avatar name={c.name} sub={c.type === 'sub'} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-purple-darkest truncate">{c.name}</span>
                    <span className="block text-xs text-text-muted">{c.type === 'sub' ? 'Subcontractor' : 'Partner'}</span>
                  </span>
                </span>
                <span className="flex-1">
                  <span className="block h-2.5 bg-bg-light rounded-full overflow-hidden">
                    <span className={`block h-full rounded-full ${c.type === 'sub' ? 'bg-olive' : 'bg-purple-dark'}`} style={{ width: `${share}%` }} />
                  </span>
                </span>
                <span className="w-14 text-right">
                  <span className="block text-sm font-semibold text-purple-darkest">{c.hours}h</span>
                  <span className="block text-xs text-text-muted">{share}%</span>
                </span>
                <span className="w-36 text-right hidden sm:block">
                  {c.type === 'sub' ? (
                    c.expense ? (
                      <span className="badge bg-olive/10 text-olive border border-olive/30">Expense · ${c.expense.toLocaleString()}</span>
                    ) : <span className="text-xs text-text-muted">manual hours</span>
                  ) : (
                    <span className="text-xs text-text-muted">{c.lastEntry ? `Last entry ${fmtDate(c.lastEntry)}` : ''}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {totalSubExpense > 0 && (
          <p className="text-xs text-text-muted -mt-4 mb-6 px-1">
            Subcontractor hours are logged manually (no NorthStar login) and post to project expenses (${totalSubExpense.toLocaleString()} total).
          </p>
        )}

        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-purple-darkest">Tasks in this deliverable</h2>
          <span className="text-xs text-text-muted">{data.tasks.length}</span>
        </div>
        <div className="space-y-2.5">
          {data.tasks.length === 0 && (
            <div className="card p-6 text-center text-xs text-text-muted italic">
              No tasks linked yet — link tasks to this deliverable from the <Link to="/tasks" className="text-purple-mid underline not-italic">task board</Link>.
            </div>
          )}
          {data.tasks.map((t) => (
            <div key={t.id} className="card p-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-purple-darkest truncate">{t.title}</div>
                <div className="text-xs text-text-muted">
                  {t.assigneeUser?.name || t.assigneeName || 'Unassigned'}
                  {t.isSubcontractor ? ' (Subcontractor)' : ''}
                  {t.subHours ? ` · ${t.subHours}h` : ''}
                  {t.subExpenseAmount ? ` · expense $${Number(t.subExpenseAmount).toLocaleString()}` : ''}
                  {t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ''}
                </div>
              </div>
              <TaskStatusChip status={t.status} />
              <Avatar name={t.assigneeUser?.name || t.assigneeName || '—'} size="sm" sub={t.isSubcontractor} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
