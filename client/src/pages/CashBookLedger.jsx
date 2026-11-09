import React, { useState } from 'react';
import { ScrollText, Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader, Field, Loading, Empty, useFetch, useSaver, useApp } from '../components/ui';
import { ReportExportButtons, RangeFilter } from '../components/ReportView';
import CashBookModal from '../components/CashBookModal';
import { api } from '../lib/api';
import { money, fmtDate, rangePresets } from '../lib/format';

const CASH_BOOK_KIND_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'transfer', label: 'Cash / Bank Transfer' },
  { value: 'income', label: 'Other Income Receipt' },
  { value: 'capital', label: 'Owner Capital Introduced' },
  { value: 'drawings', label: 'Owner Drawings' },
  { value: 'bank_charge', label: 'Bank Charges' },
];

/**
 * The cash book's own ledger: every transfer, other-income receipt, capital
 * injection, drawing and bank charge ever recorded, browsable and editable
 * across any date range — unlike the Day Book, which only shows one day.
 */
export default function CashBookLedger() {
  const { confirm } = useApp();
  const [save] = useSaver();
  const [range, setRange] = useState(() => {
    const { from, to } = rangePresets().find((p) => p.id === '3m');
    return { from, to };
  });
  const [kind, setKind] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);

  const { data: kinds } = useFetch('/cash-book/kinds');
  const { data: bankData } = useFetch('/bank-accounts');
  const banks = (bankData?.accounts ?? []).filter((a) => a.active);

  const { data: rows, loading, reload } = useFetch('/cash-book', { from: range.from, to: range.to, kind: kind || undefined });
  const list = rows || [];

  const removeEntry = async (row) => {
    if (!(await confirm(`Delete cash book entry ${row.ref}?`))) return;
    const ok = await save(() => api.del(`/cash-book/${row.id}`), 'Entry deleted');
    if (ok) reload();
  };

  const grandTotal = list.reduce((a, r) => a + r.amount, 0);
  const totalsByKind = new Map();
  for (const r of list) totalsByKind.set(r.kind, (totalsByKind.get(r.kind) || 0) + r.amount);

  const report = {
    title: 'Cash Book Ledger',
    from: range.from,
    to: range.to,
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'ref', label: 'Ref' },
      { key: 'kind_label', label: 'Type' },
      { key: 'move', label: 'Movement' },
      { key: 'note', label: 'Note' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    rows: list.map((r) => ({
      date: r.date,
      ref: r.ref,
      kind_label: r.kind_label,
      move: `${r.from_label || '—'} → ${r.to_label || '—'}`,
      note: [r.category, r.reference, r.note].filter(Boolean).join(' · '),
      amount: r.amount,
    })),
    totals: { amount: grandTotal },
  };

  if (!kinds || !bankData) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Cash Book Ledger"
        subtitle="Every cash / bank transfer, other income, owner capital, drawing and bank charge ever recorded — any date range, editable, exportable"
      />
      <div className="card">
        <div className="card-head">
          <h3><ScrollText size={17} /> Cash Book Ledger</h3>
          <div className="row" style={{ gap: 8 }}>
            <ReportExportButtons report={report} loading={loading} primary={false} />
            <button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}><Plus size={14} /> Add Entry</button>
          </div>
        </div>
        <div className="filters">
          <RangeFilter from={range.from} to={range.to} onChange={setRange} />
          <Field label="Entry Type">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {CASH_BOOK_KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        {loading && !rows ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty title="No cash book entries in this period" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ref</th>
                    <th>Type</th>
                    <th>Movement</th>
                    <th>Note</th>
                    <th className="r">Amount</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(r.date)}</td>
                      <td><span className="mono">{r.ref}</span></td>
                      <td><span className="badge violet">{r.kind_label}</span></td>
                      <td className="small">{r.from_label || '—'} → {r.to_label || '—'}</td>
                      <td className="muted small">{[r.category, r.reference, r.note].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="r strong">{money(r.amount)}</td>
                      <td className="actions">
                        <button className="btn btn-sm btn-ghost btn-icon" title="Edit entry" onClick={() => setEditRow(r)}><Pencil size={14} /></button>
                        <button className="btn btn-sm btn-ghost btn-icon btn-danger" title="Delete entry" onClick={() => removeEntry(r)}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ fontWeight: 700 }}>TOTAL</td>
                    <td className="r strong">{money(grandTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="card-pad" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="row wrap" style={{ gap: 20 }}>
                {[...totalsByKind.entries()].map(([k, v]) => (
                  <span key={k} className="small">
                    <span className="muted">{kinds.find((x) => x.value === k)?.label || k}:</span> <b>{money(v)}</b>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {addOpen && (
        <CashBookModal date={range.to} kinds={kinds} banks={banks} onClose={() => setAddOpen(false)} onSaved={reload} />
      )}
      {editRow && (
        <CashBookModal date={range.to} kinds={kinds} banks={banks} entry={editRow} onClose={() => setEditRow(null)} onSaved={reload} />
      )}
    </div>
  );
}
