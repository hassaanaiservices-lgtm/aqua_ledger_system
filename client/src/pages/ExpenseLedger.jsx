import React, { useState } from 'react';
import { Receipt, Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader, Field, Loading, Empty, useFetch, useSaver, useApp } from '../components/ui';
import { ReportExportButtons, RangeFilter } from '../components/ReportView';
import ExpenseModal from '../components/ExpenseModal';
import { api } from '../lib/api';
import { money, fmtDate, rangePresets } from '../lib/format';

const methodBadge = (m) => {
  const cash = String(m || 'cash').toLowerCase() === 'cash';
  return <span className={`badge ${cash ? 'green' : 'sky'}`}>{cash ? 'Cash' : String(m || '').toUpperCase()}</span>;
};
/** Names the real account an amount left through, falling back to the method. */
const accountCell = (r) =>
  r.bank_account_name ? (
    <span className="badge sky" title={r.method || ''}>{r.bank_account_name}</span>
  ) : (
    methodBadge(r.method)
  );

/**
 * The expense book's own ledger: every operating expense ever recorded,
 * browsable and editable across any date range, with export — unlike the Day
 * Book or Profit & Loss tab, which only ever show one day or period at a time.
 */
export default function ExpenseLedger() {
  const { confirm } = useApp();
  const [save] = useSaver();
  const [range, setRange] = useState(() => {
    const { from, to } = rangePresets().find((p) => p.id === '3m');
    return { from, to };
  });
  const [group, setGroup] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);

  const { data: categories } = useFetch('/expense-categories');
  const { data: bankData } = useFetch('/bank-accounts');
  const banks = (bankData?.accounts ?? []).filter((a) => a.active);
  const groups = categories ? [...new Set(categories.map((c) => c.group_name))] : [];

  const { data: rows, loading, reload } = useFetch('/expenses', { from: range.from, to: range.to, group: group || undefined });
  const list = rows || [];

  const removeEntry = async (row) => {
    if (!(await confirm(`Delete expense ${row.ref} — ${row.category} ${money(row.amount)}?`))) return;
    const ok = await save(() => api.del(`/expenses/${row.id}`), 'Expense deleted');
    if (ok) reload();
  };

  const grandTotal = list.reduce((a, r) => a + r.amount, 0);
  const totalsByGroup = new Map();
  for (const r of list) totalsByGroup.set(r.group_name, (totalsByGroup.get(r.group_name) || 0) + r.amount);

  const report = {
    title: 'Expense Ledger',
    from: range.from,
    to: range.to,
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'ref', label: 'Ref' },
      { key: 'category', label: 'Category' },
      { key: 'group_name', label: 'Group' },
      { key: 'paid_from', label: 'Paid From' },
      { key: 'note', label: 'Note' },
      { key: 'amount', label: 'Amount', type: 'money' },
    ],
    rows: list.map((r) => ({
      date: r.date,
      ref: r.ref,
      category: r.category,
      group_name: r.group_name,
      paid_from: r.bank_account_name || (String(r.method || 'cash').toLowerCase() === 'cash' ? 'Cash' : String(r.method || '').toUpperCase()),
      note: r.note || '',
      amount: r.amount,
    })),
    totals: { amount: grandTotal },
  };

  if (!categories || !bankData) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Expense Ledger"
        subtitle="Every operating expense ever recorded — any date range, editable, exportable"
      />
      <div className="card">
        <div className="card-head">
          <h3><Receipt size={17} /> Expense Ledger</h3>
          <div className="row" style={{ gap: 8 }}>
            <ReportExportButtons report={report} loading={loading} primary={false} />
            <button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}><Plus size={14} /> Add Expense</button>
          </div>
        </div>
        <div className="filters">
          <RangeFilter from={range.from} to={range.to} onChange={setRange} />
          <Field label="Expense Group">
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">All groups</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
        </div>
        {loading && !rows ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty title="No expenses in this period" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ref</th>
                    <th>Category</th>
                    <th>Group</th>
                    <th>Paid From</th>
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
                      <td><span className="strong">{r.category}</span></td>
                      <td><span className="badge amber">{r.group_name}</span></td>
                      <td>{accountCell(r)}</td>
                      <td className="muted small">{r.note || '—'}</td>
                      <td className="r strong neg">{money(r.amount)}</td>
                      <td className="actions">
                        <button className="btn btn-sm btn-ghost btn-icon" title="Edit expense" onClick={() => setEditRow(r)}><Pencil size={14} /></button>
                        <button className="btn btn-sm btn-ghost btn-icon btn-danger" title="Delete expense" onClick={() => removeEntry(r)}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ fontWeight: 700 }}>TOTAL</td>
                    <td className="r strong">{money(grandTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="card-pad" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="row wrap" style={{ gap: 20 }}>
                {[...totalsByGroup.entries()].map(([g, v]) => (
                  <span key={g} className="small"><span className="muted">{g}:</span> <b>{money(v)}</b></span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {addOpen && (
        <ExpenseModal date={range.to} categories={categories} banks={banks} onClose={() => setAddOpen(false)} onSaved={reload} />
      )}
      {editRow && (
        <ExpenseModal date={range.to} categories={categories} banks={banks} entry={editRow} onClose={() => setEditRow(null)} onSaved={reload} />
      )}
    </div>
  );
}
