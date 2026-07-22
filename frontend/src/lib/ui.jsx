import { format, parseISO } from 'date-fns';


export function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function fmtDate(d) {
  if (!d) return '';
  // Dates are stored as UTC midnight — format the calendar date, not the
  // local-time instant (which would render the previous day in the US).
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  return format(parseISO(s), 'MMM d');
}

// Compare calendar dates, not instants — a task due today isn't overdue, and
// dates are stored as UTC midnight (see fmtDate).
export function isOverdue(d) {
  if (!d) return false;
  const due = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  return due < format(new Date(), 'yyyy-MM-dd');
}

// Due date in olive, flipping to red once it's past. Bold either way so the
// date reads at a glance down a long list.
export function DueDate({ date, className = '' }) {
  if (!date) return null;
  const late = isOverdue(date);
  return (
    <span
      className={`text-xs font-bold ${late ? 'text-red-600' : 'text-olive'} ${className}`}
      title={late ? 'Past due' : 'Due date'}
    >
      {late ? 'Overdue · ' : 'Due '}{fmtDate(date)}
    </span>
  );
}

// Client · Project attribution line — bold olive so you can see which client's
// work you're looking at without reading the whole card.
export function ClientProject({ project, suffix, className = '' }) {
  if (!project) return null;
  return (
    <div className={`text-xs font-bold text-olive truncate ${className}`}>
      {project.client?.name}
      {project.name ? ` · ${project.name}` : ''}
      {suffix ? <span className="font-medium text-text-muted"> · {suffix}</span> : null}
    </div>
  );
}

// Avatar square with initials — olive tint for subcontractors, purple for partners
export function Avatar({ name, sub = false, size = 'md' }) {
  const sizes = { xs: 'w-5 h-5 text-[8px]', sm: 'w-6 h-6 text-[9px]', md: 'w-8 h-8 text-[11px]', lg: 'w-10 h-10 text-sm' };
  return (
    <span
      className={`${sizes[size]} rounded-lg border inline-flex items-center justify-center font-bold shrink-0 ${
        sub ? 'bg-olive/10 text-olive border-olive/30' : 'bg-bg-light text-purple-dark border-border'
      }`}
    >
      {initials(name)}
    </span>
  );
}

// Burn state → visual treatment
export function burnColors(state) {
  if (state === 'over' || state === 'warn') {
    return { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', bar: 'bg-amber-600', ring: '#b45309' };
  }
  return { text: 'text-olive', bg: 'bg-olive/10', border: 'border-olive/30', bar: 'bg-olive', ring: '#87a93e' };
}

// Conic-gradient percentage ring (wireframe burn ring)
export function BurnRing({ pct, state = 'ok', size = 56, label }) {
  const colors = burnColors(state);
  const shown = Math.min(Math.max(pct ?? 0, 0), 100);
  return (
    <div className="relative shrink-0 rounded-full" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full"
        style={{ background: `conic-gradient(${colors.ring} ${shown}%, #efeaf5 0)` }}
      />
      <div className="absolute rounded-full bg-white" style={{ inset: size / 8 }} />
      <div className="absolute inset-0 flex items-center justify-center font-bold text-purple-darkest" style={{ fontSize: size / 4.5 }}>
        {label ?? (pct != null ? `${pct}%` : '—')}
      </div>
    </div>
  );
}

export function StateChip({ state }) {
  if (state === 'over' || state === 'warn') {
    return <span className="badge bg-amber-50 text-amber-700 border border-amber-200">at risk</span>;
  }
  return <span className="badge bg-olive/10 text-olive border border-olive/30">on track</span>;
}

export function PriorityChip({ priority }) {
  if (priority === 'HIGH') return <span className="badge bg-amber-50 text-amber-700 border border-amber-200">High</span>;
  if (priority === 'LOW') return <span className="badge bg-gray-100 text-text-muted">Low</span>;
  return <span className="badge bg-bg-light text-text-muted border border-border">Med</span>;
}

export const TASK_STATUS_LABELS = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };

export function TaskStatusChip({ status }) {
  if (status === 'DONE') return <span className="badge bg-olive/10 text-olive">Done</span>;
  if (status === 'IN_PROGRESS') return <span className="badge bg-purple-mid/10 text-purple-mid">In progress</span>;
  return <span className="badge bg-gray-100 text-text-muted">To do</span>;
}

// Project status — order matches the dropdown order Sophie requested
export const PROJECT_STATUSES = [
  { value: 'OPEN', label: 'Open' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'PENDING_AWARD', label: 'Pending Award' },
  { value: 'BID_AWARDED', label: 'Bid Awarded' },
  { value: 'BID_NOT_AWARDED', label: 'Bid Not Awarded' },
];

export const PROJECT_STATUS_LABELS = Object.fromEntries(PROJECT_STATUSES.map((s) => [s.value, s.label]));

const PROJECT_STATUS_STYLES = {
  OPEN: 'bg-bg-light text-purple-dark border border-border',
  CLOSED: 'bg-gray-100 text-text-muted border border-border',
  IN_PROGRESS: 'bg-purple-mid/10 text-purple-mid border border-purple-mid/30',
  SUBMITTED: 'bg-amber-50 text-amber-700 border border-amber-200',
  PENDING_AWARD: 'bg-amber-50 text-amber-700 border border-amber-200',
  BID_AWARDED: 'bg-olive/10 text-olive border border-olive/30',
  BID_NOT_AWARDED: 'bg-red-50 text-red-700 border border-red-200',
};

export function ProjectStatusChip({ status }) {
  if (!status) return null;
  return (
    <span className={`badge ${PROJECT_STATUS_STYLES[status] || PROJECT_STATUS_STYLES.OPEN}`}>
      {PROJECT_STATUS_LABELS[status] || status}
    </span>
  );
}

// Project type chip — Deliverables (purple) vs Retainer (olive), per wireframe
export function ProjectKindChip({ isRetainer }) {
  return isRetainer ? (
    <span className="badge bg-olive/10 text-olive border border-olive/30">Retainer</span>
  ) : (
    <span className="badge bg-bg-light text-purple-dark border border-border">Deliverables</span>
  );
}

// Right-hand slide-over form shell (same pattern as ProjectsPage)
export function SlideOver({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="section-title">{title}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-body">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

// Thin horizontal burn bar
export function BurnBar({ logged, forecast, state = 'ok', className = '' }) {
  const colors = burnColors(state);
  const pct = forecast ? Math.min((logged / forecast) * 100, 100) : 0;
  return (
    <div className={`h-2 bg-bg-light rounded-full overflow-hidden ${className}`}>
      <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
