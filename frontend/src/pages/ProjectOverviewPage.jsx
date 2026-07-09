import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import {
  Avatar, BurnRing, BurnBar, StateChip, ProjectKindChip, SlideOver, fmtDate, burnColors,
  PROJECT_STATUSES, ProjectStatusChip,
} from '../lib/ui';
import ClientTree from '../components/ClientTree';
import TaskBoard from '../components/TaskBoard';

function SectionCard({ no, title, aside, children, className = '' }) {
  return (
    <div className={`card p-4 flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold tracking-wider text-purple-dark uppercase">{no} · {title}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <p className="text-xs text-text-muted italic">{children}</p>;
}

// Burn banner (wireframe 2a): ring + headline + chip, retainer vs deliverables
function BurnBanner({ burn, status }) {
  const colors = burnColors(burn.state);
  const isRetainer = burn.mode === 'RETAINER';
  const noForecast = burn.forecast == null;
  const title = noForecast
    ? `${burn.logged}h logged — no forecast set`
    : isRetainer
      ? `${burn.logged} of ${burn.forecast} retainer hours used — ${burn.monthLabel}`
      : `${burn.logged} of ${burn.forecast} forecasted hours logged`;
  const sub = noForecast
    ? 'Set forecasted hours on the project to see burn.'
    : isRetainer
      ? `${burn.rollover ? 'Unused hours roll to next month' : 'Resets on the 1st'} · ${burn.remaining}h left`
      : `Computed live from time entries · ${burn.remaining >= 0 ? `${burn.remaining}h remaining` : `${Math.abs(burn.remaining)}h over`}`;
  const chip = noForecast
    ? null
    : burn.state === 'over'
      ? `+${Math.abs(burn.remaining)}h over`
      : burn.state === 'warn'
        ? (isRetainer ? 'near cap' : 'at risk')
        : 'on pace';
  return (
    <div className={`card p-4 flex items-center gap-4 ${noForecast ? '' : `${colors.bg} ${colors.border}`}`}>
      <BurnRing pct={burn.pct} state={burn.state} size={56} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-purple-darkest">{title}</div>
        <div className="text-xs text-text-muted">{sub}</div>
      </div>
      {chip && (
        <span className={`badge ${burn.state === 'ok' ? 'bg-olive/10 text-olive border border-olive/30' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
          {chip}
        </span>
      )}
      <ProjectStatusChip status={status} />
    </div>
  );
}

// Mini milestone strip for section 03 (dots + connecting bars)
function MiniTimeline({ milestones }) {
  if (milestones.length === 0) return <Empty>No milestones yet — open the board to add them.</Empty>;
  const shown = milestones.slice(0, 5);
  return (
    <div>
      <div className="flex items-center my-1.5">
        {shown.map((m, i) => (
          <span key={m.id} className="flex items-center flex-1 last:flex-none">
            <span
              className={`w-2.5 h-2.5 rounded-full border-2 shrink-0 ${
                m.status === 'DONE'
                  ? 'bg-purple-dark border-purple-dark'
                  : m.atRisk || m.status === 'IN_PROGRESS'
                    ? 'bg-white border-amber-600 ring-2 ring-amber-100'
                    : 'bg-white border-purple-dark/50'
              }`}
            />
            {i < shown.length - 1 && (
              <span className={`flex-1 h-0.5 ${m.status === 'DONE' ? 'bg-purple-dark' : 'bg-bg-light'}`} />
            )}
          </span>
        ))}
      </div>
      <div className="flex justify-between gap-1">
        {shown.map((m) => (
          <div key={m.id} className="min-w-0">
            <div className={`text-[10px] truncate ${m.atRisk && m.status !== 'DONE' ? 'text-amber-700 font-semibold' : 'text-text-body'}`}>
              {m.name}{m.atRisk && m.status !== 'DONE' ? ' ●' : ''}
            </div>
            <div className="text-[10px] text-text-muted">
              {fmtDate(m.status === 'DONE' ? m.completedAt || m.dueDate : m.dueDate)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProjectOverviewPage() {
  const { clientId, projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'overview';
  const [data, setData] = useState(null);
  const [timeData, setTimeData] = useState(null);
  const [editing, setEditing] = useState(null); // 'scope'|'notes'|'contact'|'payment'|'file'|'call'|null
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    api.get(`/projects/${projectId}/overview`).then((r) => setData(r.data));
  }, [projectId]);
  useEffect(() => { setData(null); load(); }, [load]);

  useEffect(() => {
    if (tab === 'time') api.get(`/projects/${projectId}`).then((r) => setTimeData(r.data));
  }, [tab, projectId]);

  function openForm(kind, item = null) {
    setEditing(kind);
    setEditItem(item);
    setFormError('');
    if (kind === 'scope') setForm({ scopeOfWork: data.scopeOfWork || '', sowNumber: data.sowNumber || '' });
    else if (kind === 'notes') setForm({ notes: data.notes || '' });
    else if (kind === 'contact') setForm(item ? { name: item.name, email: item.email || '', role: item.role || '', isPrimary: item.isPrimary } : { name: '', email: '', role: '', isPrimary: false });
    else if (kind === 'payment') setForm(item
      ? { label: item.label, amount: item.amount, dueDate: item.dueDate ? item.dueDate.slice(0, 10) : '', payeeType: item.payeeType, payeeName: item.payeeName || '' }
      : { label: '', amount: '', dueDate: '', payeeType: 'CLIENT', payeeName: '' });
    else if (kind === 'file') setForm({ label: '', url: '' });
    else if (kind === 'call') setForm(item
      ? { title: item.title, date: item.date.slice(0, 10), summary: item.summary || '' }
      : { title: '', date: new Date().toISOString().slice(0, 10), summary: '' });
    else if (kind === 'forecast') setForm({ deliverables: data.deliverables.map((d) => ({ id: d.id, name: d.taskType?.name, forecastHours: d.forecastHours ?? '' })) });
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing === 'scope') await api.patch(`/projects/${projectId}/scope`, { scopeOfWork: form.scopeOfWork, sowNumber: form.sowNumber });
      else if (editing === 'notes') await api.patch(`/projects/${projectId}/scope`, { notes: form.notes });
      else if (editing === 'contact') {
        if (editItem) await api.put(`/clients/${data.clientId}/contacts/${editItem.id}`, form);
        else await api.post(`/clients/${data.clientId}/contacts`, form);
      } else if (editing === 'payment') {
        if (editItem) await api.put(`/projects/${projectId}/payments/${editItem.id}`, form);
        else await api.post(`/projects/${projectId}/payments`, form);
      } else if (editing === 'file') await api.post(`/projects/${projectId}/file-links`, form);
      else if (editing === 'call') {
        if (editItem) await api.put(`/projects/${projectId}/call-logs/${editItem.id}`, form);
        else await api.post(`/projects/${projectId}/call-logs`, form);
      } else if (editing === 'forecast') {
        await Promise.all(form.deliverables.map((d) =>
          api.patch(`/projects/${projectId}/deliverables/${d.id}`, { forecastHours: d.forecastHours })
        ));
      }
      setEditing(null);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(kind, item) {
    const urls = {
      payment: `/projects/${projectId}/payments/${item.id}`,
      file: `/projects/${projectId}/file-links/${item.id}`,
      call: `/projects/${projectId}/call-logs/${item.id}`,
      contact: `/clients/${data.clientId}/contacts/${item.id}`,
    };
    if (!confirm('Delete this item?')) return;
    await api.delete(urls[kind]);
    load();
  }

  async function togglePaid(p) {
    await api.put(`/projects/${projectId}/payments/${p.id}`, { isPaid: !p.isPaid });
    setData((d) => ({
      ...d,
      payments: d.payments.map((x) => (x.id === p.id ? { ...x, isPaid: !p.isPaid } : x)),
    }));
  }

  if (!data) return <div className="text-text-muted text-sm">Loading…</div>;

  const paidCount = data.payments.filter((p) => p.isPaid).length;
  const clientPayments = data.payments.filter((p) => p.payeeType === 'CLIENT');
  const subPayments = data.payments.filter((p) => p.payeeType === 'SUBCONTRACTOR');
  const accentBar = data.isRetainer ? 'bg-olive' : 'bg-purple-dark';

  return (
    <div className="lg:grid lg:grid-cols-[260px,1fr] lg:gap-6 lg:items-start">
      <aside className="hidden lg:block"><ClientTree /></aside>

      <div className="min-w-0">
        {/* project-type accent bar (wireframe: 5px type strip) */}
        <div className={`h-1 rounded-full mb-3 ${accentBar}`} />

        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted mb-1">
          <Link to={`/clients/${clientId}`} className="hover:underline">{data.client?.name}</Link>
          {' / '}{data.name}{data.sowNumber ? ` · ${data.sowNumber}` : ''}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link to={`/clients/${clientId}`} className="lg:hidden text-sm font-semibold text-purple-mid">‹</Link>
            <h1 className="page-title truncate">{data.name}</h1>
            <ProjectKindChip isRetainer={data.isRetainer} />
            {data.burn.forecast != null && <StateChip state={data.atRisk ? 'warn' : 'ok'} />}
            <select
              className="badge bg-white text-text-body border border-border cursor-pointer hover:border-purple-mid focus:outline-none"
              value={data.status || 'OPEN'}
              onChange={async (e) => {
                const status = e.target.value;
                setData((d) => ({ ...d, status }));
                await api.patch(`/projects/${projectId}/status`, { status });
              }}
            >
              {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="flex gap-1.5">
            {[['overview', 'Overview'], ['tasks', 'Tasks'], ['time', 'Time']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSearchParams(key === 'overview' ? {} : { tab: key })}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  tab === key ? 'bg-purple-dark text-white border-purple-dark' : 'bg-white text-text-muted border-border hover:border-purple-mid'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {data.alert && (
          <div className="card p-3 mb-3 flex items-center gap-2.5 bg-amber-50 border-amber-200">
            <span className="w-2 h-2 rounded-full bg-amber-600 shrink-0" />
            <span className="text-sm text-amber-700"><b>{data.alert.title}</b> · {data.alert.message}</span>
          </div>
        )}

        <div className="mb-4"><BurnBanner burn={data.burn} status={data.status} /></div>

        {tab === 'tasks' && <TaskBoard lockedProjectId={projectId} />}

        {tab === 'time' && (
          <div className="card divide-y divide-border">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="font-semibold text-sm text-purple-darkest">Time captured against this project</span>
              <span className="text-xs text-text-muted">{timeData ? `${timeData.hoursSpent.toFixed(1)}h confirmed` : '…'}</span>
            </div>
            {timeData?.timeEntries?.length === 0 && <div className="px-4 py-6 text-center text-xs text-text-muted italic">No time logged yet.</div>}
            {timeData?.timeEntries?.map((e) => (
              <div key={e.id} className="px-4 py-2.5 flex items-center gap-3">
                <Avatar name={e.user?.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-body truncate">{e.taskType?.name}{e.note ? ` — ${e.note}` : ''}</div>
                  <div className="text-xs text-text-muted">{e.user?.name} · {fmtDate(e.date)}</div>
                </div>
                <span className={e.isBillable ? 'badge-billable' : 'badge-non-billable'}>{e.hours}h</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'overview' && (
          <div className="grid md:grid-cols-2 gap-4">
            {/* 01 Client info */}
            <SectionCard no="01" title="Client Info" aside={
              <span className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">{data.client?.isInternal ? 'Internal' : 'HubSpot'}</span>
                <button onClick={() => openForm('contact')} className="text-xs text-purple-mid hover:underline">+ Contact</button>
              </span>
            }>
              {data.client?.contacts?.length ? data.client.contacts.map((ct) => (
                <div key={ct.id} className="flex items-center justify-between gap-2 group">
                  <span className="text-sm text-text-body">
                    {ct.name}{ct.isPrimary ? ' (primary)' : ''}{ct.email ? <span className="text-text-muted text-xs"> · {ct.email}</span> : ''}
                  </span>
                  <span className="opacity-0 group-hover:opacity-100 flex gap-2">
                    <button onClick={() => openForm('contact', ct)} className="text-xs text-purple-mid">Edit</button>
                    <button onClick={() => deleteItem('contact', ct)} className="text-xs text-red-500">×</button>
                  </span>
                </div>
              )) : <Empty>No contacts captured yet.</Empty>}
            </SectionCard>

            {/* 02 Scope of work */}
            <SectionCard no="02" title="Scope of Work" aside={
              <button onClick={() => openForm('scope')} className="text-xs text-purple-mid hover:underline">Edit</button>
            }>
              {data.scopeOfWork
                ? <p className="text-sm text-text-body whitespace-pre-wrap line-clamp-6">{data.scopeOfWork}</p>
                : <Empty>No scope captured yet — pull it from the SOW.</Empty>}
            </SectionCard>

            {/* 03 Timeline & milestones */}
            <SectionCard no="03" title="Timeline & Milestones" aside={
              <Link to={`/clients/${clientId}/projects/${projectId}/timeline`} className="badge bg-bg-light text-purple-dark border border-border hover:bg-purple-dark hover:text-white transition-colors">
                Open board →
              </Link>
            }>
              <MiniTimeline milestones={data.milestones} />
            </SectionCard>

            {/* 04 Payment schedule */}
            <SectionCard no="04" title="Payment Schedule" aside={
              <span className="flex items-center gap-2">
                {data.payments.length > 0 && (
                  <span className="badge bg-bg-light text-text-muted border border-border">{paidCount} / {data.payments.length} paid</span>
                )}
                <button onClick={() => openForm('payment')} className="text-xs text-purple-mid hover:underline">+ Add</button>
              </span>
            }>
              {data.payments.length === 0 && <Empty>No payment schedule yet — capture it from the SOW.</Empty>}
              {clientPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 group">
                  <span className="text-sm text-text-body truncate">{p.label} · ${p.amount.toLocaleString()}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="opacity-0 group-hover:opacity-100 flex gap-2">
                      <button onClick={() => openForm('payment', p)} className="text-xs text-purple-mid">Edit</button>
                      <button onClick={() => deleteItem('payment', p)} className="text-xs text-red-500">×</button>
                    </span>
                    <button
                      onClick={() => togglePaid(p)}
                      className={`badge ${p.isPaid ? 'bg-olive/10 text-olive border border-olive/30' : 'bg-amber-50 text-amber-700 border border-amber-200'} hover:opacity-70`}
                      title="Toggle paid"
                    >
                      {p.isPaid ? 'Paid' : p.dueDate ? `Due ${fmtDate(p.dueDate)}` : 'Unpaid'}
                    </button>
                  </span>
                </div>
              ))}
              {subPayments.length > 0 && (
                <>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted pt-1 border-t border-dashed border-border">Subcontractor SOW</div>
                  {subPayments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 group">
                      <span className="text-sm text-text-body truncate">{p.payeeName ? `${p.payeeName} · ` : ''}{p.label} · ${p.amount.toLocaleString()}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="opacity-0 group-hover:opacity-100 flex gap-2">
                          <button onClick={() => openForm('payment', p)} className="text-xs text-purple-mid">Edit</button>
                          <button onClick={() => deleteItem('payment', p)} className="text-xs text-red-500">×</button>
                        </span>
                        <button onClick={() => togglePaid(p)} className={`badge ${p.isPaid ? 'bg-olive/10 text-olive border border-olive/30' : 'bg-amber-50 text-amber-700 border border-amber-200'} hover:opacity-70`}>
                          {p.isPaid ? 'Paid' : p.dueDate ? `Due ${fmtDate(p.dueDate)}` : 'Unpaid'}
                        </button>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </SectionCard>

            {/* 05 Deliverables */}
            <SectionCard no="05" title="Deliverables" aside={
              <span className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">{data.deliverables.length} {data.deliverables.length === 1 ? 'item' : 'items'}</span>
                {data.deliverables.length > 0 && (
                  <button onClick={() => openForm('forecast')} className="text-xs text-purple-mid hover:underline">Forecasts</button>
                )}
              </span>
            }>
              {data.deliverables.length === 0 && <Empty>No deliverables — assign task types to this project.</Empty>}
              {data.deliverables.map((d) => {
                const uniquePeople = [...new Map(d.contributors.map((c) => [c.name, c])).values()];
                return (
                  <Link
                    key={d.id}
                    to={`/clients/${clientId}/projects/${projectId}/deliverables/${d.id}`}
                    className="flex items-center justify-between gap-3 -mx-1.5 px-1.5 py-1 rounded-lg hover:bg-bg-page"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-text-body truncate">{d.taskType?.name}</span>
                      <span className="flex -space-x-1.5">
                        {uniquePeople.slice(0, 3).map((c, i) => (
                          <Avatar key={i} name={c.name} size="xs" sub={c.type === 'sub'} />
                        ))}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {d.forecastHours ? (
                        <>
                          <BurnBar logged={d.loggedHours} forecast={d.forecastHours} state={d.health?.state || 'ok'} className="w-16" />
                          <span className="text-xs text-text-muted whitespace-nowrap">{d.loggedHours}/{d.forecastHours}h ›</span>
                        </>
                      ) : (
                        <span className="text-xs text-text-muted whitespace-nowrap">{d.loggedHours}h ›</span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </SectionCard>

            {/* 06 File links */}
            <SectionCard no="06" title="File Links" aside={
              <span className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted">Drive</span>
                <button onClick={() => openForm('file')} className="text-xs text-purple-mid hover:underline">+ Link</button>
              </span>
            }>
              {data.fileLinks.length === 0 && <Empty>No file links yet — files live in Drive, links live here.</Empty>}
              <div className="flex flex-wrap gap-1.5">
                {data.fileLinks.map((f) => (
                  <span key={f.id} className="badge bg-bg-light text-text-body border border-border group inline-flex items-center gap-1">
                    <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline">{f.label}</a>
                    <button onClick={() => deleteItem('file', f)} className="text-red-400 opacity-0 group-hover:opacity-100">×</button>
                  </span>
                ))}
              </div>
            </SectionCard>

            {/* 07 Call logs */}
            <SectionCard no="07" title="Call Logs" aside={
              <span className="flex items-center gap-2">
                <span className="badge bg-bg-light text-purple-dark border border-border">Granola</span>
                <button onClick={() => openForm('call')} className="text-xs text-purple-mid hover:underline">+ Log</button>
              </span>
            }>
              {data.callLogs.length === 0 && <Empty>No calls logged yet — Granola sync lands in Phase 2.</Empty>}
              {data.callLogs.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 group">
                  <span className="text-sm text-text-body truncate">{c.title} · {fmtDate(c.date)}</span>
                  <span className="opacity-0 group-hover:opacity-100 flex gap-2 shrink-0">
                    <button onClick={() => openForm('call', c)} className="text-xs text-purple-mid">Edit</button>
                    <button onClick={() => deleteItem('call', c)} className="text-xs text-red-500">×</button>
                  </span>
                </div>
              ))}
            </SectionCard>

            {/* 08 Notes */}
            <SectionCard no="08" title="Notes" className="md:col-span-2" aside={
              <button onClick={() => openForm('notes')} className="text-xs text-purple-mid hover:underline">Edit</button>
            }>
              {data.notes
                ? <p className="text-sm text-text-body whitespace-pre-wrap">{data.notes}</p>
                : <Empty>No notes yet.</Empty>}
            </SectionCard>
          </div>
        )}

        {editing && (
          <SlideOver
            title={{
              scope: 'Scope of Work', notes: 'Project Notes',
              contact: editItem ? 'Edit Contact' : 'New Contact',
              payment: editItem ? 'Edit Payment' : 'New Payment',
              file: 'New File Link', call: editItem ? 'Edit Call Log' : 'New Call Log',
              forecast: 'Deliverable Forecasts',
            }[editing]}
            onClose={() => setEditing(null)}
          >
            <form onSubmit={handleSave} className="space-y-4">
              {editing === 'scope' && (
                <>
                  <div>
                    <label className="form-label">SOW number</label>
                    <input type="text" className="form-input" placeholder='e.g. SOW #HC-02' value={form.sowNumber} onChange={(e) => setForm((f) => ({ ...f, sowNumber: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Scope of work</label>
                    <textarea className="form-input" rows={10} value={form.scopeOfWork} onChange={(e) => setForm((f) => ({ ...f, scopeOfWork: e.target.value }))} />
                  </div>
                </>
              )}
              {editing === 'notes' && (
                <div>
                  <label className="form-label">Notes</label>
                  <textarea className="form-input" rows={10} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
              )}
              {editing === 'contact' && (
                <>
                  <div>
                    <label className="form-label">Name *</label>
                    <input type="text" className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="form-label">Email</label>
                    <input type="email" className="form-input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Role</label>
                    <input type="text" className="form-input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-text-body cursor-pointer">
                    <input type="checkbox" className="rounded" checked={form.isPrimary} onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} />
                    Primary contact
                  </label>
                </>
              )}
              {editing === 'payment' && (
                <>
                  <div>
                    <label className="form-label">Label *</label>
                    <input type="text" className="form-input" placeholder="e.g. M3 · Milestone 3" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Amount ($) *</label>
                      <input type="number" step="0.01" min="0" className="form-input" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
                    </div>
                    <div>
                      <label className="form-label">Due date</label>
                      <input type="date" className="form-input" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Payee</label>
                    <select className="form-select" value={form.payeeType} onChange={(e) => setForm((f) => ({ ...f, payeeType: e.target.value }))}>
                      <option value="CLIENT">Client pays us</option>
                      <option value="SUBCONTRACTOR">We pay subcontractor</option>
                    </select>
                  </div>
                  {form.payeeType === 'SUBCONTRACTOR' && (
                    <div>
                      <label className="form-label">Subcontractor name</label>
                      <input type="text" className="form-input" value={form.payeeName} onChange={(e) => setForm((f) => ({ ...f, payeeName: e.target.value }))} />
                    </div>
                  )}
                </>
              )}
              {editing === 'file' && (
                <>
                  <div>
                    <label className="form-label">Label *</label>
                    <input type="text" className="form-input" placeholder="e.g. Brief.pdf" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="form-label">Drive URL *</label>
                    <input type="url" className="form-input" placeholder="https://drive.google.com/…" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required />
                  </div>
                </>
              )}
              {editing === 'call' && (
                <>
                  <div>
                    <label className="form-label">Title *</label>
                    <input type="text" className="form-input" placeholder="e.g. Design review" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="form-label">Date *</label>
                    <input type="date" className="form-input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="form-label">Summary</label>
                    <textarea className="form-input" rows={5} value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} />
                  </div>
                </>
              )}
              {editing === 'forecast' && (
                <div className="space-y-3">
                  <p className="text-xs text-text-muted">Forecasted hours per deliverable. Project-level forecast lives on the project (budget hours).</p>
                  {form.deliverables.map((d, i) => (
                    <div key={d.id} className="flex items-center gap-3">
                      <span className="flex-1 text-sm text-text-body">{d.name}</span>
                      <input
                        type="number" step="0.5" min="0" className="form-input !w-28"
                        value={d.forecastHours}
                        onChange={(e) => setForm((f) => {
                          const next = [...f.deliverables];
                          next[i] = { ...next[i], forecastHours: e.target.value };
                          return { ...f, deliverables: next };
                        })}
                      />
                      <span className="text-xs text-text-muted">h</span>
                    </div>
                  ))}
                </div>
              )}
              {formError && <p className="text-red-600 text-sm">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </SlideOver>
        )}
      </div>
    </div>
  );
}
