import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Civic North brand (per brand guidelines) ─────────────────────────────────
const CN = {
  primaryDark: [59, 18, 89],    // #3b1259
  primary:     [92, 38, 128],   // #5c2680
  secondary:   [130, 77, 186],  // #824dba
  accentLilac: [153, 143, 222], // #998fde
  accentOlive: [135, 169, 62],  // #87a93e
  ink:         [42, 42, 51],
  inkMuted:    [120, 116, 130],
  rowTint:     [246, 243, 250], // light purple wash for alternate rows
  totalTint:   [240, 243, 230], // light olive wash for totals row
};

// Pastel honeycomb tones sampled from the brand banner
const HONEY = [
  [223, 232, 204], // pale olive
  [231, 226, 242], // pale lilac
  [204, 195, 219], // lilac gray
  [186, 172, 206], // mauve
];

const WEBSITE = 'civicnorthconsulting.com';
const WEBSITE_URL = 'https://civicnorthconsulting.com';

const PAGE_W = 297; // A4 landscape (mm)
const PAGE_H = 210;
const MARGIN = 16;
const HEADER_H = 32;

// The logo ships in frontend/public/cn-logo.png; wordmark is the fallback if
// it ever goes missing.
async function loadLogo() {
  try {
    const res = await fetch('/cn-logo.png');
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return null; // SPA fallback serves HTML for missing files
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    // Flatten onto white as JPEG — the logo sits on a white panel, and jsPDF
    // stores alpha-channel PNGs uncompressed (~2MB per export otherwise).
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.92), format: 'JPEG', w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  }
}

async function registerFonts(doc) {
  // Lazy-loaded: ~630KB of font data stays out of the main bundle
  const { poppinsLight, poppinsSemiBold, poppinsBold } = await import('./poppinsFonts.js');
  doc.addFileToVFS('Poppins-Light.ttf', poppinsLight);
  doc.addFont('Poppins-Light.ttf', 'Poppins', 'normal');
  doc.addFileToVFS('Poppins-SemiBold.ttf', poppinsSemiBold);
  doc.addFont('Poppins-SemiBold.ttf', 'Poppins', 'semibold');
  doc.addFileToVFS('Poppins-Bold.ttf', poppinsBold);
  doc.addFont('Poppins-Bold.ttf', 'Poppins', 'bold');
}

// Right-align columns whose every value reads as a number/amount/percentage
function numericColumns(columns, rows) {
  const numeric = {};
  for (let c = 1; c < columns.length; c++) {
    const allNumeric = rows.length > 0 && rows.every((r) => {
      const v = String(r[c] ?? '').trim();
      return v === '' || /^[-$0-9.,%h\s]+$/.test(v);
    });
    if (allNumeric) numeric[c] = { halign: 'right' };
  }
  return numeric;
}

// Pointy-top hexagon, filled
function hex(doc, cx, cy, r, color, opacity) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity }));
  doc.setFillColor(...color);
  doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'F', true);
  doc.restoreGraphicsState();
}

// Honeycomb band across the top of the header, between the logo and the title
// area — bleeds off the top edge, full top row with a sparse second row
function drawHeaderHexBand(doc) {
  const r = 7.5;
  const dx = r * Math.sqrt(3);
  const x0 = 86, x1 = 195;
  const topColors = [1, 0, 2, 1, 3, 0, 1, 2, 0];
  let i = 0;
  for (let cx = x0; cx <= x1; cx += dx, i++) {
    hex(doc, cx, 2, r, HONEY[topColors[i % topColors.length]], 0.5);
  }
  const second = [[0, 2], [2, 0], [3, 1], [5, 3], [7, 1]]; // [column, color]
  for (const [c, ci] of second) {
    hex(doc, x0 + dx / 2 + c * dx, 13, r, HONEY[ci], 0.4);
  }
}

// Client-facing, Civic North branded report PDF.
// { title, subtitle, columns, rows, totalsRow?, preparedFor? }
export async function exportPDF({ title, subtitle, columns, rows, totalsRow, preparedFor }) {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
  await registerFonts(doc);
  const logo = await loadLogo();

  // ── Header: logo on clean white, no band ──
  drawHeaderHexBand(doc);

  if (logo) {
    const h = 22;
    const w = (logo.w / logo.h) * h;
    doc.addImage(logo.dataUrl, logo.format || 'PNG', MARGIN, 5, w, h);
  } else {
    doc.setTextColor(...CN.primaryDark);
    doc.setFont('Poppins', 'bold');
    doc.setFontSize(17);
    doc.text('CIVIC NORTH', MARGIN, 15);
    doc.setFont('Poppins', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...CN.secondary);
    doc.text('C O N S U L T I N G', MARGIN, 21.5);
  }

  // Title block, right-aligned in brand purple
  doc.setTextColor(...CN.primaryDark);
  doc.setFont('Poppins', 'bold');
  doc.setFontSize(19);
  doc.text(title, PAGE_W - MARGIN, 16, { align: 'right' });
  if (subtitle) {
    doc.setFont('Poppins', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...CN.secondary);
    doc.text(subtitle, PAGE_W - MARGIN, 23, { align: 'right' });
  }

  // Olive accent rule under the header
  doc.setFillColor(...CN.accentOlive);
  doc.rect(0, HEADER_H, PAGE_W, 1.6, 'F');

  // ── Meta block ──
  const metaY = HEADER_H + 12;
  const metaCols = [
    ['PREPARED FOR', preparedFor || 'All Clients'],
    ['PREPARED BY', 'Civic North Consulting'],
    ['DATE', new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })],
  ];
  metaCols.forEach(([label, value], i) => {
    const x = MARGIN + i * 90;
    doc.setFont('Poppins', 'semibold');
    doc.setFontSize(6.5);
    doc.setTextColor(...CN.inkMuted);
    doc.text(label.split('').join(' '), x, metaY); // letterspaced label
    doc.setFont('Poppins', 'semibold');
    doc.setFontSize(11);
    doc.setTextColor(...CN.primaryDark);
    doc.text(value, x, metaY + 6);
  });

  // ── Table ──
  const numCols = numericColumns(columns, rows);
  autoTable(doc, {
    startY: metaY + 14,
    margin: { left: MARGIN, right: MARGIN, top: 40, bottom: 26 },
    head: [columns],
    body: rows,
    foot: totalsRow ? [totalsRow] : [],
    styles: { font: 'Poppins', fontStyle: 'normal', fontSize: 8.5, cellPadding: 3, textColor: CN.ink },
    headStyles: { fillColor: CN.primary, textColor: 255, font: 'Poppins', fontStyle: 'bold', fontSize: 8.5 },
    footStyles: { fillColor: CN.totalTint, textColor: CN.primaryDark, font: 'Poppins', fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: CN.rowTint },
    columnStyles: numCols,
    // columnStyles only reach body cells — align head/foot down the same edge
    didParseCell: (data) => {
      if (data.section !== 'body' && numCols[data.column.index]) data.cell.styles.halign = 'right';
    },
    showFoot: 'lastPage',
  });

  // ── Footer (every page): rule, name · website link · page number ──
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...CN.primaryDark);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14);
    doc.setFont('Poppins', 'semibold');
    doc.setFontSize(8);
    doc.setTextColor(...CN.primaryDark);
    doc.text('Civic North Consulting', MARGIN, PAGE_H - 9);
    doc.setTextColor(...CN.secondary);
    doc.textWithLink(WEBSITE, PAGE_W / 2, PAGE_H - 9, { url: WEBSITE_URL, align: 'center' });
    doc.setFont('Poppins', 'normal');
    doc.setTextColor(...CN.inkMuted);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 9, { align: 'right' });
  }

  doc.save(`${title.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
