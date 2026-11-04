// CSV / Excel export for any report-shaped object: { title, columns:[{key,label,type}], rows, totals }
import * as XLSX from 'xlsx';

const stamp = () => new Date().toISOString().slice(0, 10);
const safe = (s) => String(s || 'report').replace(/[^\w]+/g, '_');

function matrix(report) {
  const head = report.columns.map((c) => c.label);
  const body = report.rows.map((r) =>
    report.columns.map((c) => {
      const v = r[c.key];
      if (c.type === 'money' || c.type === 'number') return v === '' || v == null ? '' : Number(v);
      return v ?? '';
    })
  );
  if (report.totals) body.push(report.columns.map((c, i) => (i === 0 ? 'TOTAL' : c.key in report.totals ? Number(report.totals[c.key]) : '')));
  return [head, ...body];
}

export function exportCsv(report) {
  const rows = matrix(report);
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safe(report.title)}_${stamp()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportXlsx(report) {
  const rows = matrix(report);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = report.columns.map((c) => ({ wch: Math.max(c.label.length + 2, c.type === 'money' ? 14 : c.type === 'text' ? 22 : 12) }));
  // number format for money columns
  report.columns.forEach((c, ci) => {
    if (c.type !== 'money') return;
    for (let ri = 1; ri < rows.length; ri++) {
      const ref = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '#,##0.00';
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, safe(report.title).slice(0, 31));
  XLSX.writeFile(wb, `${safe(report.title)}_${stamp()}.xlsx`);
}
