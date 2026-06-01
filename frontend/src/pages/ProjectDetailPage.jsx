import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';

function ProjectTypeBadge({ type }) {
  if (type === 'FIXED_FEE') return <span className="badge-fixed badge">Fixed Fee</span>;
  if (type === 'TIME_MATERIALS') return <span className="badge-tm badge">T&amp;M</span>;
  return <span className="badge-non-billable-project badge">Non-Billable</span>;
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/projects/${id}`)
      .then((r) => setProject(r.data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="text-text-muted text-sm">Loading…</div>;
  if (!project) return <div className="text-red-500">Project not found.</div>;

  const billableHours = project.timeEntries.filter((e) => e.isBillable).reduce((s, e) => s + e.hours, 0);
  const pct = project.budgetHours ? Math.min((project.hoursSpent / project.budgetHours) * 100, 100) : null;

  return (
    <div>
      <div className="mb-4">
        <Link to="/projects" className="text-sm text-text-muted hover:text-purple-mid">← Projects</Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="page-title">{project.name}</h1>
            <ProjectTypeBadge type={project.type} />
            {!project.isActive && <span className="badge bg-gray-100 text-text-muted">Archived</span>}
          </div>
          <p className="text-text-muted text-sm">{project.client?.name}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <div className="text-xs text-text-muted font-semibold uppercase tracking-wide mb-1">Total Hours</div>
          <div className="text-2xl font-bold text-purple-darkest">{project.hoursSpent.toFixed(1)}h</div>
          {project.budgetHours && (
            <>
              <div className="text-xs text-text-muted mt-1">of {project.budgetHours}h budget</div>
              <div className="h-1.5 bg-border rounded-full mt-2">
                <div
                  className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct > 80 ? 'bg-yellow-400' : 'bg-olive'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          )}
        </div>
        <div className="card p-4">
          <div className="text-xs text-text-muted font-semibold uppercase tracking-wide mb-1">Billable Hours</div>
          <div className="text-2xl font-bold text-olive">{billableHours.toFixed(1)}h</div>
        </div>
        {project.budgetDollars && (
          <div className="card p-4">
            <div className="text-xs text-text-muted font-semibold uppercase tracking-wide mb-1">Budget</div>
            <div className="text-2xl font-bold text-purple-darkest">${project.budgetDollars.toLocaleString()}</div>
          </div>
        )}
      </div>

      {project.notes && (
        <div className="card p-4 mb-6">
          <p className="text-sm text-text-body">{project.notes}</p>
        </div>
      )}

      <h2 className="section-title mb-3">Time Entries</h2>
      {project.timeEntries.length === 0 ? (
        <div className="card p-6 text-center text-text-muted text-sm">No time entries for this project yet.</div>
      ) : (
        <div className="card divide-y divide-border">
          {project.timeEntries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-text-muted">{format(parseISO(entry.date), 'MMM d, yyyy')}</span>
                  <span className="text-text-muted">·</span>
                  <span className="text-sm text-text-body">{entry.taskType?.name}</span>
                  <span className="text-text-muted">·</span>
                  <span className="text-xs text-purple-mid font-semibold">{entry.user?.name}</span>
                </div>
                {entry.note && <p className="text-xs text-text-muted mt-0.5">{entry.note}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {entry.isBillable ? (
                  <span className="badge-billable">Billable</span>
                ) : (
                  <span className="badge-non-billable">Non-billable</span>
                )}
                <span className="text-sm font-semibold text-purple-darkest">{entry.hours}h</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
