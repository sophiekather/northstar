import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => (n || 0).toFixed(1);
const fmtMoney = (n) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const PRESETS = [
  { label: 'This Week',   getDates: () => { const n=new Date(),d=n.getDay(),m=new Date(n); m.setDate(n.getDate()-(d===0?6:d-1)); return [m,new Date()]; } },
  { label: 'Last Week',   getDates: () => { const n=new Date(),d=n.getDay(),m=new Date(n); m.setDate(n.getDate()-(d===0?6:d-1)-7); const e=new Date(m); e.setDate(m.getDate()+6); return [m,e]; } },
  { label: 'This Month',  getDates: () => { const n=new Date(); return [new Date(n.getFullYear(),n.getMonth(),1),new Date()]; } },
  { label: 'Last Month',  getDates: () => { const n=new Date(); const s=new Date(n.getFullYear(),n.getMonth()-1,1); const e=new Date(n.getFullYear(),n.getMonth(),0); return [s,e]; } },
  { label: 'This Quarter',getDates: () => { const n=new Date(),q=Math.floor(n.getMonth()/3); return [new Date(n.getFullYear(),q*3,1),new Date()]; } },
  { label: 'This Year',   getDates: () => [new Date(new Date().getFullYear(),0,1), new Date()] },
];

function toISO(d) { return d instanceof Date ? d.toISOString().split('T')[0] : d; }

function BarFill({ pct, over }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
      <div
        className={`h-2 rounded-full transition-all ${over ? 'bg-red-400' : pct > 80 ? 'bg-yellow-400' : 'bg-olive'}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r =>
    headers.map(h => {
      const v = r[h] ?? '';
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
    }).join(',')
  )].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ── PDF export ────────────────────────────────────────────────────────────────
function exportPDF({ title, subtitle, columns, rows, totalsRow }) {
  const doc = new jsPDF({ orientation: 'landscape' });

  // Brand header
  doc.setFillColor(74, 82, 64); // olive / #4a5240
  doc.rect(0, 0, 297, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('NorthStar', 14, 13);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Civic North Consulting', 50, 13);

  // Title
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 32);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(subtitle, 14, 39);
  }

  autoTable(doc, {
    startY: subtitle ? 44 : 38,
    head: [columns],
    body: rows,
    foot: totalsRow ? [totalsRow] : [],
    headStyles: { fillColor: [74, 82, 64], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    footStyles: { fillColor: [240, 240, 235], textColor: 40, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    alternateRowStyles: { fillColor: [250, 250, 248] },
    styles: { cellPadding: 3 },
  });

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text(`Generated ${new Date().toLocaleDateString()} · Page ${i} of ${pageCount}`, 14, doc.internal.pageSize.height - 8);
  }

  doc.save(`${title.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [tab, setTab] = useState('time');
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);

  // Filters
  const [preset, setPreset] = useState('This Month');
  const [startDate, setStartDate] = useState(() => toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [endDate, setEndDate] = useState(() => toISO(new Date()));
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');

  // Data
  const [timeSummary, setTimeSummary] = useState(null);
  const [groupBy, setGroupBy] = useState('client');
  const [billable, setBillable] = useState(null);
  const [billableGroupBy, setBillableGroupBy] = useState('task');
  const [retainer, setRetainer] = useState(null);
  const [retainerMonth, setRetainerMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [entries, setEntries] = useState(null);
  const [customFilters, setCustomFilters] = useState({ isBillable: '', taskTypeId: '' });
  const [customGroupBy, setCustomGroupBy] = useState('');
  const [taskTypes, setTaskTypes] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/reports/clients').then(r => setClients(r.data));
    api.get('/reports/projects').then(r => setProjects(r.data));
    api.get('/reports/users').then(r => setUsers(r.data));
    api.get('/task-types').then(r => setTaskTypes(r.data));
  }, []);

  const applyPreset = (label) => {
    const p = PRESETS.find(p => p.label === label);
    if (!p) return;
    const [s, e] = p.getDates();
    setStartDate(toISO(s));
    setEndDate(toISO(e));
    setPreset(label);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ start: startDate, end: endDate });
      if (clientId) params.set('clientId', clientId);
      if (projectId) params.set('projectId', projectId);
      if (userId) params.set('userId', userId);

      if (tab === 'time') {
        params.set('groupBy', groupBy);
        const r = await api.get(`/reports/time-summary?${params}`);
        setTimeSummary(r.data);
      } else if (tab === 'billable') {
        params.set('groupBy', billableGroupBy);
        const r = await api.get(`/reports/billable-breakdown?${params}`);
        setBillable(r.data);
      } else if (tab === 'retainer') {
        const r = await api.get(`/reports/retainer-burn?month=${retainerMonth}`);
        setRetainer(r.data);
      } else if (tab === 'custom') {
        if (customFilters.isBillable !== '') params.set('isBillable', customFilters.isBillable);
        if (customFilters.taskTypeId) params.set('taskTypeId', customFilters.taskTypeId);
        const r = await api.get(`/reports/entries?${params}`);
        setEntries(r.data);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, startDate, endDate, clientId, projectId, userId, groupBy, billableGroupBy, retainerMonth, customFilters]);

  useEffect(() => { load(); }, [load]);

  const tabs = [
    { id: 'time',     label: 'Time Summary' },
    { id: 'billable', label: 'Billable Breakdown' },
    { id: 'retainer', label: 'Retainer Burn' },
    { id: 'custom',   label: 'Custom Report' },
  ];

  const dateLabel = `${fmtDate(startDate)} – ${fmtDate(endDate)}`;
  const clientLabel = clients.find(c => c.id === clientId)?.name || 'All Clients';
  const billableGroupLabel = { task: 'Task Type', person: 'Person', project: 'Project', client: 'Client' }[billableGroupBy] || 'Task Type';
  const subtitle = [
    dateLabel,
    clientLabel,
    projectId ? projects.find(p => p.id === projectId)?.name : null,
    userId ? users.find(u => u.id === userId)?.name : null,
  ].filter(Boolean).join(' · ');

  // Client-side grouping for the custom report
  const customGroups = entries && customGroupBy
    ? Object.values(entries.reduce((acc, e) => {
        const key = customGroupBy === 'project' ? `${e.client} — ${e.project}`
          : customGroupBy === 'client' ? e.client
          : e.person;
        if (!acc[key]) acc[key] = { name: key, rows: [], hours: 0, amount: 0 };
        acc[key].rows.push(e);
        acc[key].hours += e.hours;
        acc[key].amount += e.amount;
        return acc;
      }, {})).sort((a, b) => b.hours - a.hours)
    : null;

  return (
    <div className="max-w-5xl">
      <h1 className="page-title mb-6">Reports</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-olive text-olive' : 'border-transparent text-text-muted hover:text-text-body'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Global filters (not shown for retainer) */}
      {tab !== 'retainer' && (
        <div className="card p-4 mb-6">
          <div className="flex flex-wrap gap-3 items-end">
            {/* Presets */}
            <div>
              <label className="form-label">Date Range</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => applyPreset(p.label)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${preset === p.label ? 'bg-olive text-white border-olive' : 'border-border text-text-muted hover:border-olive'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input type="date" className="form-input text-sm py-1" value={startDate}
                  onChange={e => { setStartDate(e.target.value); setPreset(''); }} />
                <span className="self-center text-text-muted text-sm">to</span>
                <input type="date" className="form-input text-sm py-1" value={endDate}
                  onChange={e => { setEndDate(e.target.value); setPreset(''); }} />
              </div>
            </div>

            {/* Client filter */}
            <div>
              <label className="form-label">Client</label>
              <select className="form-input text-sm py-1" value={clientId}
                onChange={e => { setClientId(e.target.value); setProjectId(''); }}>
                <option value="">All Clients</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Project filter */}
            <div>
              <label className="form-label">Project</label>
              <select className="form-input text-sm py-1" value={projectId} onChange={e => setProjectId(e.target.value)}>
                <option value="">All Projects</option>
                {projects.filter(p => !clientId || p.clientId === clientId).map(p => (
                  <option key={p.id} value={p.id}>{p.client?.name} — {p.name}</option>
                ))}
              </select>
            </div>

            {/* Person filter */}
            <div>
              <label className="form-label">Person</label>
              <select className="form-input text-sm py-1" value={userId} onChange={e => setUserId(e.target.value)}>
                <option value="">Everyone</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            {/* Group by (time tab) */}
            {tab === 'time' && (
              <div>
                <label className="form-label">Group By</label>
                <select className="form-input text-sm py-1" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                  <option value="client">Client</option>
                  <option value="project">Project</option>
                  <option value="person">Person</option>
                </select>
              </div>
            )}

            {/* Group by (billable tab) */}
            {tab === 'billable' && (
              <div>
                <label className="form-label">Group By</label>
                <select className="form-input text-sm py-1" value={billableGroupBy} onChange={e => setBillableGroupBy(e.target.value)}>
                  <option value="task">Task Type</option>
                  <option value="person">Person</option>
                  <option value="project">Project</option>
                  <option value="client">Client</option>
                </select>
              </div>
            )}

            {/* Group by (custom tab) */}
            {tab === 'custom' && (
              <div>
                <label className="form-label">Group By</label>
                <select className="form-input text-sm py-1" value={customGroupBy} onChange={e => setCustomGroupBy(e.target.value)}>
                  <option value="">None</option>
                  <option value="project">Project</option>
                  <option value="client">Client</option>
                  <option value="person">Person</option>
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {loading && <div className="text-text-muted text-sm py-8 text-center">Loading…</div>}

      {/* ── TIME SUMMARY ── */}
      {tab === 'time' && timeSummary && !loading && (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total Hours', value: fmt(timeSummary.totals.totalHours) + 'h' },
              { label: 'Billable Hours', value: fmt(timeSummary.totals.billableHours) + 'h' },
              { label: 'Non-Billable', value: fmt(timeSummary.totals.nonBillableHours) + 'h' },
              { label: 'Billable Amount', value: fmtMoney(timeSummary.totals.amount) },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <div className="text-xs text-text-muted mb-1">{s.label}</div>
                <div className="text-xl font-bold text-text-body">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead className="bg-bg-light">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-text-muted text-xs uppercase">
                    {groupBy === 'client' ? 'Client' : groupBy === 'project' ? 'Project' : 'Person'}
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-text-muted text-xs uppercase">Total</th>
                  <th className="text-right px-4 py-3 font-semibold text-text-muted text-xs uppercase">Billable</th>
                  <th className="text-right px-4 py-3 font-semibold text-text-muted text-xs uppercase">Non-Bill.</th>
                  <th className="text-right px-4 py-3 font-semibold text-text-muted text-xs uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {timeSummary.rows.map(r => (
                  <tr key={r.id} className="hover:bg-bg-light/50">
                    <td className="px-4 py-3 font-medium text-text-body">{r.label}</td>
                    <td className="px-4 py-3 text-right">{fmt(r.totalHours)}h</td>
                    <td className="px-4 py-3 text-right text-olive">{fmt(r.billableHours)}h</td>
                    <td className="px-4 py-3 text-right text-text-muted">{fmt(r.nonBillableHours)}h</td>
                    <td className="px-4 py-3 text-right font-medium">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-bg-light font-bold">
                <tr>
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right">{fmt(timeSummary.totals.totalHours)}h</td>
                  <td className="px-4 py-3 text-right text-olive">{fmt(timeSummary.totals.billableHours)}h</td>
                  <td className="px-4 py-3 text-right text-text-muted">{fmt(timeSummary.totals.nonBillableHours)}h</td>
                  <td className="px-4 py-3 text-right">{fmtMoney(timeSummary.totals.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={() => exportCSV(timeSummary.rows.map(r => ({ [groupBy]: r.label, total_hours: fmt(r.totalHours), billable_hours: fmt(r.billableHours), non_billable_hours: fmt(r.nonBillableHours), amount: fmtMoney(r.amount) })), `time-summary-${startDate}.csv`)}
              className="btn-secondary text-sm">Export CSV</button>
            <button onClick={() => exportPDF({
              title: 'Time Summary',
              subtitle,
              columns: [groupBy === 'client' ? 'Client' : groupBy === 'project' ? 'Project' : 'Person', 'Total Hours', 'Billable', 'Non-Billable', 'Amount'],
              rows: timeSummary.rows.map(r => [r.label, fmt(r.totalHours)+'h', fmt(r.billableHours)+'h', fmt(r.nonBillableHours)+'h', fmtMoney(r.amount)]),
              totalsRow: ['TOTAL', fmt(timeSummary.totals.totalHours)+'h', fmt(timeSummary.totals.billableHours)+'h', fmt(timeSummary.totals.nonBillableHours)+'h', fmtMoney(timeSummary.totals.amount)],
            })} className="btn-secondary text-sm">Export PDF</button>
          </div>
        </div>
      )}

      {/* ── BILLABLE BREAKDOWN ── */}
      {tab === 'billable' && billable && !loading && (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total Hours', value: fmt(billable.totalHours) + 'h' },
              { label: 'Billable', value: fmt(billable.billableHours) + 'h', sub: `${billable.billablePct}%` },
              { label: 'Non-Billable', value: fmt(billable.nonBillableHours) + 'h', sub: `${100 - billable.billablePct}%` },
              { label: 'Billable Revenue', value: fmtMoney(billable.billableAmount) },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <div className="text-xs text-text-muted mb-1">{s.label}</div>
                <div className="text-xl font-bold text-text-body">{s.value}</div>
                {s.sub && <div className="text-xs text-olive font-semibold mt-1">{s.sub} of total</div>}
              </div>
            ))}
          </div>

          {/* Visual split */}
          <div className="card p-6 mb-6">
            <div className="flex justify-between text-sm font-semibold mb-2">
              <span className="text-olive">Billable {billable.billablePct}%</span>
              <span className="text-text-muted">Non-Billable {100 - billable.billablePct}%</span>
            </div>
            <div className="flex h-4 rounded-full overflow-hidden bg-gray-100">
              <div className="bg-olive transition-all" style={{ width: `${billable.billablePct}%` }} />
              <div className="bg-gray-200 flex-1" />
            </div>
          </div>

          <div className="card overflow-hidden mb-4">
            <div className="px-4 py-3 bg-bg-light text-xs font-semibold text-text-muted uppercase">Hours by {billableGroupLabel}</div>
            <table className="w-full text-sm">
              <thead className="bg-bg-light border-t border-border">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold text-text-muted text-xs">{billableGroupLabel}</th>
                  <th className="text-right px-4 py-2 font-semibold text-text-muted text-xs">Total</th>
                  <th className="text-right px-4 py-2 font-semibold text-text-muted text-xs">Billable</th>
                  <th className="text-right px-4 py-2 font-semibold text-text-muted text-xs">Non-Bill.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(billable.groups || billable.byTask).map(t => (
                  <tr key={t.name} className="hover:bg-bg-light/50">
                    <td className="px-4 py-3 font-medium">{t.name}</td>
                    <td className="px-4 py-3 text-right">{fmt(t.hours)}h</td>
                    <td className="px-4 py-3 text-right text-olive">{fmt(t.billable)}h</td>
                    <td className="px-4 py-3 text-right text-text-muted">{fmt(t.hours - t.billable)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button onClick={() => exportCSV((billable.groups || billable.byTask).map(t => ({ [billableGroupBy]: t.name, total_hours: fmt(t.hours), billable_hours: fmt(t.billable), non_billable_hours: fmt(t.hours - t.billable) })), `billable-breakdown-${startDate}.csv`)}
              className="btn-secondary text-sm">Export CSV</button>
            <button onClick={() => exportPDF({
              title: 'Billable Breakdown',
              subtitle: `${subtitle} · ${billable.billablePct}% billable`,
              columns: [billableGroupLabel, 'Total Hours', 'Billable', 'Non-Billable'],
              rows: (billable.groups || billable.byTask).map(t => [t.name, fmt(t.hours)+'h', fmt(t.billable)+'h', fmt(t.hours - t.billable)+'h']),
            })} className="btn-secondary text-sm">Export PDF</button>
          </div>
        </div>
      )}

      {/* ── RETAINER BURN ── */}
      {tab === 'retainer' && (
        <div>
          <div className="card p-4 mb-6 flex items-end gap-4">
            <div>
              <label className="form-label">Month</label>
              <input type="month" className="form-input text-sm py-1" value={retainerMonth}
                onChange={e => setRetainerMonth(e.target.value)} />
            </div>
          </div>

          {retainer && !loading && (
            retainer.retainers.length === 0
              ? <div className="card p-8 text-center text-text-muted">No retainer clients configured.</div>
              : <div className="space-y-4">
                {retainer.retainers.map(r => (
                  <div key={r.projectId} className="card p-6">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="font-bold text-text-body text-lg">{r.clientName}</div>
                        <div className="text-sm text-text-muted">{r.projectName}</div>
                      </div>
                      <div className={`text-sm font-bold px-3 py-1 rounded-full ${r.overBudget ? 'bg-red-100 text-red-600' : r.pct > 80 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                        {r.overBudget ? `${fmt(r.overBy)}h over` : `${fmt(r.hoursRemaining)}h left`}
                      </div>
                    </div>
                    <div className="flex justify-between text-sm text-text-muted mb-1">
                      <span>{fmt(r.hoursUsed)}h used</span>
                      <span>{r.monthlyHours}h budget</span>
                    </div>
                    <BarFill pct={r.pct} over={r.overBudget} />
                    <div className="text-xs text-text-muted mt-2">{r.pct}% of monthly retainer used</div>
                  </div>
                ))}

                <div className="flex gap-2">
                  <button onClick={() => exportCSV(retainer.retainers.map(r => ({ client: r.clientName, project: r.projectName, budget_hours: r.monthlyHours, hours_used: fmt(r.hoursUsed), hours_remaining: fmt(r.hoursRemaining), pct_used: r.pct+'%', over_budget: r.overBudget ? 'Yes' : 'No' })), `retainer-burn-${retainerMonth}.csv`)}
                    className="btn-secondary text-sm">Export CSV</button>
                  <button onClick={() => exportPDF({
                    title: 'Retainer Burn Report',
                    subtitle: `Month: ${retainerMonth}`,
                    columns: ['Client', 'Project', 'Budget (hrs)', 'Used (hrs)', 'Remaining', '% Used', 'Over Budget'],
                    rows: retainer.retainers.map(r => [r.clientName, r.projectName, r.monthlyHours, fmt(r.hoursUsed), fmt(r.hoursRemaining), r.pct+'%', r.overBudget ? 'YES' : 'No']),
                  })} className="btn-secondary text-sm">Export PDF</button>
                </div>
              </div>
          )}
        </div>
      )}

      {/* ── CUSTOM REPORT ── */}
      {tab === 'custom' && (
        <div>
          <div className="card p-4 mb-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="form-label">Billable</label>
                <select className="form-input text-sm py-1" value={customFilters.isBillable}
                  onChange={e => setCustomFilters(f => ({ ...f, isBillable: e.target.value }))}>
                  <option value="">All</option>
                  <option value="true">Billable only</option>
                  <option value="false">Non-billable only</option>
                </select>
              </div>
              <div>
                <label className="form-label">Task Type</label>
                <select className="form-input text-sm py-1" value={customFilters.taskTypeId}
                  onChange={e => setCustomFilters(f => ({ ...f, taskTypeId: e.target.value }))}>
                  <option value="">All Tasks</option>
                  {taskTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {entries && !loading && (
            <>
              <div className="text-sm text-text-muted mb-3">
                {entries.length} entries · {fmt(entries.reduce((s, e) => s + e.hours, 0))}h total
              </div>
              {(customGroups || [{ name: null, rows: entries, hours: 0, amount: 0 }]).map((g, gi) => (
                <div key={g.name ?? gi} className="card overflow-hidden mb-4">
                  {g.name && (
                    <div className="px-4 py-3 bg-bg-light flex items-center justify-between">
                      <span className="text-sm font-bold text-text-body">{g.name}</span>
                      <span className="text-xs text-text-muted font-semibold">
                        {fmt(g.hours)}h · {fmtMoney(g.amount)}
                      </span>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className={`bg-bg-light ${g.name ? 'border-t border-border' : ''}`}>
                        <tr>
                          {['Date','Person','Client','Project','Task','Hours','Billable','Amount','Note'].map(h => (
                            <th key={h} className="text-left px-3 py-3 font-semibold text-text-muted text-xs uppercase whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {g.rows.map((e, i) => (
                          <tr key={i} className="hover:bg-bg-light/50">
                            <td className="px-3 py-2 whitespace-nowrap">{new Date(e.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{e.person}</td>
                            <td className="px-3 py-2">{e.client}</td>
                            <td className="px-3 py-2">{e.project}</td>
                            <td className="px-3 py-2">{e.task}</td>
                            <td className="px-3 py-2 text-right font-medium">{fmt(e.hours)}h</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${e.billable ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {e.billable ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">{fmtMoney(e.amount)}</td>
                            <td className="px-3 py-2 text-text-muted max-w-xs truncate">{e.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={() => exportCSV(entries.map(e => ({ ...e, date: new Date(e.date).toLocaleDateString(), billable: e.billable ? 'Yes' : 'No' })), `custom-report-${startDate}.csv`)}
                  className="btn-secondary text-sm">Export CSV</button>
                <button onClick={() => exportPDF({
                  title: 'Custom Time Report',
                  subtitle,
                  columns: ['Date','Person','Client','Project','Task','Hours','Billable','Amount'],
                  rows: entries.map(e => [new Date(e.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),e.person,e.client,e.project,e.task,fmt(e.hours)+'h',e.billable?'Yes':'No',fmtMoney(e.amount)]),
                  totalsRow: ['','','','','TOTAL', fmt(entries.reduce((s,e)=>s+e.hours,0))+'h','',fmtMoney(entries.reduce((s,e)=>s+e.amount,0))],
                })} className="btn-secondary text-sm">Export PDF</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
