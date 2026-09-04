// Dev-only: render sample report PDFs from real data using the SAME builder the
// app ships (src/lib/brandedPdf.js), so a design review sees the real output.
// Not wired to any build.
//   node scripts/gen-pdf-samples.mjs <entries.json> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportDoc, withNoteRows } from '../src/lib/brandedPdf.js';

const [, , dataPath, outDir] = process.argv;
const entriesAll = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const fmt = (n) => (n || 0).toFixed(1);
const fmtMoney = (n) => `$${(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// The logo the app serves from /cn-logo.png (PNG kept as-is; the browser path
// flattens it to JPEG purely to keep exported file size down).
function loadLogo() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cn-logo.png');
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  return {
    dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
    format: 'PNG',
    w: buf.readUInt32BE(16),
    h: buf.readUInt32BE(20),
  };
}

const logo = loadLogo();
const NOTES = process.env.PDF_NOTES || 'client';
const notesFootnote = NOTES === 'all'
  ? 'Includes internal notes — review before sending to a client.'
  : NOTES === 'client'
    ? 'Notes shown are the ones marked client-facing in NorthStar.'
    : null;

async function save(doc, name) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(doc.output('arraybuffer')));
  console.log('wrote', name);
}

// ── Custom Time Report (mirrors ReportsPage custom-tab export) ───────────────
{
  const entries = entriesAll
    .filter((e) => e.project.client.name === 'SFCC')
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((e) => ({
      date: e.date,
      person: e.user.name,
      client: e.project.client.name,
      project: e.project.name,
      task: e.taskType.name,
      hours: e.hours,
      billable: e.isBillable,
      amount: e.isBillable ? e.hours * e.hourlyRate : 0,
      note: e.note || '',
      noteClientVisible: e.noteClientVisible,
    }));

  const doc = await buildReportDoc({
    title: 'Custom Time Report',
    subtitle: 'Aug 1, 2026 – Aug 31, 2026 · SFCC',
    preparedFor: 'SFCC',
    columns: ['Date', 'Person', 'Client', 'Project', 'Task', 'Hours', 'Billable', 'Amount'],
    detailBody: true,
    rows: withNoteRows(entries.map((e) => ({
      row: [fmtDate(e.date), e.person, e.client, e.project, e.task, fmt(e.hours) + 'h', e.billable ? 'Yes' : 'No', fmtMoney(e.amount)],
      note: e.note,
      noteClientVisible: e.noteClientVisible,
    })), 8, NOTES),
    totalsRow: ['', '', '', '', 'TOTAL', fmt(entries.reduce((s, e) => s + e.hours, 0)) + 'h', '', fmtMoney(entries.reduce((s, e) => s + e.amount, 0))],
    note: notesFootnote,
  }, logo);
  await save(doc, '5-custom-report-with-notes.pdf');
}

// ── Retainer Burn (mirrors ReportsPage retainer-tab export) ──────────────────
{
  const monthlyHours = 20;
  const rows = entriesAll
    .filter((e) => e.project.name === 'Durabook Retainer Client')
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const hoursUsed = rows.reduce((s, e) => s + e.hours, 0);
  const r = {
    clientName: 'Durabook',
    projectName: 'Durabook Retainer Client',
    monthlyHours,
    hoursUsed,
    hoursRemaining: Math.max(0, monthlyHours - hoursUsed),
    pct: Math.min(Math.round((hoursUsed / monthlyHours) * 100), 100),
    overBudget: hoursUsed > monthlyHours,
    overBy: Math.max(0, hoursUsed - monthlyHours),
    entries: rows.map((e) => ({
      date: e.date, person: e.user.name, task: e.taskType.name,
      hours: e.hours, note: e.note || '', noteClientVisible: e.noteClientVisible,
    })),
  };

  const doc = await buildReportDoc({
    title: 'Retainer Burn Report',
    subtitle: 'August 2026',
    preparedFor: 'Retainer Clients',
    columns: ['Client', 'Project', 'Budget (hrs)', 'Used (hrs)', 'Remaining', '% Used', 'Over Budget'],
    rows: [[r.clientName, r.projectName, r.monthlyHours, fmt(r.hoursUsed), fmt(r.hoursRemaining), r.pct + '%', r.overBudget ? 'YES' : 'No']],
    sections: [{
      title: `${r.clientName} · ${r.projectName}`,
      meta: `${fmt(r.hoursUsed)}h of ${r.monthlyHours}h · ${r.overBudget ? `${fmt(r.overBy)}h over` : `${fmt(r.hoursRemaining)}h remaining`}`,
      columns: ['Date', 'Person', 'Task', 'Hours'],
      rows: withNoteRows(r.entries.map((e) => ({
        row: [fmtDate(e.date), e.person, e.task, fmt(e.hours) + 'h'],
        note: e.note,
        noteClientVisible: e.noteClientVisible,
      })), 4, NOTES),
    }],
    note: notesFootnote,
  }, logo);
  await save(doc, '6-retainer-burn-with-detail.pdf');
}
