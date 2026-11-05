import React from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Field, useApp } from './ui';
import { money, fmtDate, rangePresets } from '../lib/format';
import { exportCsv, exportXlsx } from '../lib/export';
import { downloadReportPdf } from '../lib/pdf';

const isNum = (c) => c.type === 'money' || c.type === 'number';

/** Any server report ({columns, rows, totals, note}) as a table. `onRowClick(row)` makes rows clickable. */
export function ReportTable({ report, onRowClick }) {
  return (
    <div>
      <table className="table">
        <thead>
          <tr>
            {report.columns.map((c) => (
              <th key={c.key} className={isNum(c) ? 'r' : ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row, idx) => (
            <tr key={idx} onClick={onRowClick ? () => onRowClick(row) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
              {report.columns.map((c) => {
                const val = row[c.key];
                return (
                  <td key={c.key} className={isNum(c) ? 'r' : ''}>
                    {c.type === 'money' ? <span className={val < 0 ? 'neg' : ''}>{money(val)}</span> : c.type === 'date' ? fmtDate(val) : val ?? '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {report.totals && (
          <tfoot>
            <tr>
              {report.columns.map((c, i) => {
                const val = report.totals[c.key];
                return (
                  <td key={c.key} className={isNum(c) ? 'r' : ''}>
                    {i === 0 ? 'TOTAL' : c.key in report.totals ? (c.type === 'money' ? money(val) : val != null ? Number(val).toLocaleString() : '') : ''}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
      {report.note && (
        <div className="muted small" style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', fontStyle: 'italic' }}>* {report.note}</div>
      )}
    </div>
  );
}

/** PDF / Excel / CSV buttons for a loaded report. */
export function ReportExportButtons({ report, loading, primary = true }) {
  const { settings, toast } = useApp();
  const disabled = !report || loading || !report.rows?.length;
  const run = (label, fn) => () => {
    try {
      fn();
      toast(`Report exported to ${label}`);
    } catch (err) {
      toast(`Failed to export ${label}: ${err.message}`, 'error');
    }
  };
  return (
    <>
      <button type="button" className={primary ? 'btn btn-primary' : 'btn'} disabled={disabled} onClick={run('PDF', () => downloadReportPdf(report, settings))}>
        <Download size={15} /> Export PDF
      </button>
      <button type="button" className="btn" disabled={disabled} onClick={run('Excel (.xlsx)', () => exportXlsx(report))}>
        <FileSpreadsheet size={15} /> Export Excel
      </button>
      <button type="button" className="btn" disabled={disabled} onClick={run('CSV', () => exportCsv(report))}>
        <FileText size={15} /> Export CSV
      </button>
    </>
  );
}

/** From / To calendar inputs plus one-click ranges like "Last 5 months". */
export function RangeFilter({ from, to, onChange }) {
  const presets = rangePresets();
  const active = presets.find((p) => p.from === from && p.to === to)?.id ?? '';
  return (
    <>
      <Field label="From Date">
        <input type="date" value={from} max={to} onChange={(e) => onChange({ from: e.target.value, to })} />
      </Field>
      <Field label="To Date">
        <input type="date" value={to} min={from} onChange={(e) => onChange({ from, to: e.target.value })} />
      </Field>
      <Field label="Quick Range">
        <select value={active} onChange={(e) => { const p = presets.find((x) => x.id === e.target.value); if (p) onChange({ from: p.from, to: p.to }); }}>
          <option value="">Custom…</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
    </>
  );
}
