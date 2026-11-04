import React, { useState, useEffect } from 'react';
import { 
  Download, FileSpreadsheet, X, Plus, Trash2, Pencil, Check, 
  RefreshCw, FileText, ArrowDownLeft, ArrowUpRight, Calculator, AlertTriangle
} from 'lucide-react';
import { api } from '../lib/api';
import { money, moneySigned, fmtDate, PAYMENT_METHODS } from '../lib/format';
import { downloadLedgerStatement } from '../lib/pdf';
import { exportXlsx } from '../lib/export';
import { useApp } from './ui';
import InvoiceModal from './InvoiceModal';

export default function EditableLedgerModal({ kind = 'vendor', partyId, onClose, onChanged }) {
  const { settings, toast, confirm, lookups } = useApp();
  const banks = lookups.bank_accounts ?? [];
  const isBankMethod = (m) => PAYMENT_METHODS.find((x) => x.value === m)?.account === 'bank';
  const bankName = (id) => banks.find((b) => b.id === id)?.name;
  const [ledgerData, setLedgerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState({ from: '', to: '' });
  const [viewDocId, setViewDocId] = useState(null); // { type: 'sale' | 'purchase', id }

  // Inline editing of Opening Balance
  const [editingOpening, setEditingOpening] = useState(false);
  const [openingInput, setOpeningInput] = useState('');

  // Inline editing of an existing row
  // rowKey: 'pay-{id}', 'sale-{id}', 'purchase-{id}'
  const [editingRowKey, setEditingRowKey] = useState(null);
  const [editFields, setEditFields] = useState({});

  // Excel-like "+ Add New Row" draft
  const [newRow, setNewRow] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: kind === 'customer' ? 'payment' : 'payment',
    amount: '',
    method: 'cash',
    bank_account_id: '',
  });
  const [addingRow, setAddingRow] = useState(false);

  const isCustomer = kind === 'customer';
  const table = isCustomer ? 'customers' : 'vendors';
  const chargeColName = isCustomer ? 'Sale (Debit +)' : 'Purchase (Credit +)';
  const payColName = isCustomer ? 'Payment (Credit -)' : 'Payment (Debit -)';
  const balColName = isCustomer ? 'Customer Balance' : 'Balance We Owe';

  const loadLedger = async () => {
    if (!partyId) return;
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (dateFilter.from) q.set('from', dateFilter.from);
      if (dateFilter.to) q.set('to', dateFilter.to);
      const url = `/${table}/${partyId}/ledger${q.toString() ? '?' + q.toString() : ''}`;
      const data = await api.get(url);
      setLedgerData(data);
      setOpeningInput(String(data.opening_balance ?? 0));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLedger();
  }, [partyId, dateFilter.from, dateFilter.to]);

  // 1. Save Opening Balance
  const handleSaveOpening = async () => {
    const val = Number(openingInput);
    if (isNaN(val)) {
      toast('Please enter a valid numeric opening balance', 'error');
      return;
    }
    try {
      await api.patch(`/${table}/${partyId}/opening-balance`, { opening_balance: val });
      toast('Opening balance updated & ledger recalculated');
      setEditingOpening(false);
      loadLedger();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // 2. Start inline editing an existing row
  const startEditRow = (entry) => {
    setEditingRowKey(`${entry.type}-${entry.doc_id}`);
    setEditFields({
      date: entry.date,
      description: entry.description,
      amount: entry.payment || entry.charge || 0,
      method: entry.method || 'cash',
      bank_account_id: entry.bank_account_id ?? banks[0]?.id ?? '',
    });
  };

  // 3. Save edited row
  const handleSaveRow = async (entry) => {
    try {
      if (entry.type === 'payment') {
        const amt = Number(editFields.amount);
        if (isNaN(amt) || amt <= 0) {
          toast('Payment amount must be greater than zero', 'error');
          return;
        }
        await api.put(`/payments/${entry.doc_id}`, {
          date: editFields.date,
          amount: amt,
          method: editFields.method || 'cash',
          bank_account_id: isBankMethod(editFields.method) ? Number(editFields.bank_account_id) || null : null,
        });
        toast('Payment updated & ledger balance refreshed');
      } else if (entry.type === 'sale') {
        await api.patch(`/sales/${entry.doc_id}`, {
          date: editFields.date,
          note: editFields.description
        });
        toast('Sale entry updated');
      } else if (entry.type === 'purchase') {
        await api.patch(`/purchases/${entry.doc_id}`, {
          date: editFields.date,
          note: editFields.description
        });
        toast('Purchase entry updated');
      }
      setEditingRowKey(null);
      loadLedger();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // 4. Delete an existing entry
  const handleDeleteRow = async (entry) => {
    const ok = await confirm({
      title: `Delete ${entry.ref}?`,
      message: entry.type === 'payment'
        ? `Remove payment of ${money(entry.payment)}? The ledger balance will recalculate automatically.`
        : `Remove ${entry.type === 'sale' ? 'Sale Invoice' : 'Purchase Bill'} ${entry.ref}? Inventory stock and ledger will revert.`,
      okText: 'Delete'
    });
    if (!ok) return;

    try {
      if (entry.type === 'payment') {
        await api.del(`/payments/${entry.doc_id}`);
        toast('Payment deleted from ledger');
      } else if (entry.type === 'sale') {
        await api.del(`/sales/${entry.doc_id}`);
        toast('Sale invoice deleted & stock restored');
      } else if (entry.type === 'purchase') {
        await api.del(`/purchases/${entry.doc_id}`);
        toast('Purchase bill deleted & stock reverted');
      }
      loadLedger();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // 5. Add New Row directly in spreadsheet
  const handleAddNewRow = async (e) => {
    e?.preventDefault();
    const amt = Number(newRow.amount);
    if (!amt || amt <= 0) {
      toast('Please enter a valid amount greater than 0', 'error');
      return;
    }

    setAddingRow(true);
    try {
      await api.post('/payments', {
        party_type: kind,
        party_id: partyId,
        date: newRow.date || new Date().toISOString().slice(0, 10),
        amount: amt,
        method: newRow.method || 'cash',
        bank_account_id: isBankMethod(newRow.method) ? Number(newRow.bank_account_id) || banks[0]?.id : null,
      });

      toast(`Added row: ${money(amt)} recorded in ledger!`);
      setNewRow({
        date: new Date().toISOString().slice(0, 10),
        amount: '',
        method: 'cash',
        bank_account_id: '',
      });
      loadLedger();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setAddingRow(false);
    }
  };

  // Export to Excel sheet
  const handleExportExcel = () => {
    if (!ledgerData) return;
    const reportObj = {
      title: `${ledgerData.party.name}_Ledger`,
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'ref', label: 'Doc / Ref #', type: 'text' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'charge', label: chargeColName, type: 'money' },
        { key: 'payment', label: payColName, type: 'money' },
        { key: 'balance', label: 'Balance', type: 'money' },
      ],
      rows: [
        {
          date: ledgerData.from || '',
          ref: 'OPENING',
          description: 'Opening Balance',
          charge: '',
          payment: '',
          balance: ledgerData.opening_balance,
        },
        ...ledgerData.entries.map((e) => ({
          date: e.date,
          ref: e.ref,
          description: e.description,
          charge: e.charge || '',
          payment: e.payment || '',
          balance: e.balance,
        })),
      ],
      totals: {
        charge: ledgerData.total_charge,
        payment: ledgerData.total_payment,
        balance: ledgerData.closing_balance,
      },
    };
    exportXlsx(reportObj);
    toast('Ledger exported to Excel (.xlsx)');
  };

  // Download PDF statement
  const handleDownloadPdf = () => {
    if (!ledgerData) return;
    downloadLedgerStatement(ledgerData, kind, settings);
    toast('Account statement PDF downloaded');
  };

  const p = ledgerData?.party;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal xl" style={{ maxHeight: '94vh', display: 'flex', flexDirection: 'column' }}>
        {/* Modal Header */}
        <div className="modal-head" style={{ padding: '14px 22px' }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="brand-logo" style={{ width: 34, height: 34, background: isCustomer ? 'var(--grad)' : 'linear-gradient(135deg, var(--sky), var(--indigo))' }}>
              <FileSpreadsheet size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '17px', margin: 0 }}>
                {isCustomer ? 'Customer' : 'Vendor'} Ledger Sheet: <span style={{ color: 'var(--aqua)' }}>{p?.name || '...'}</span>
              </h2>
              <div className="row" style={{ gap: 8, marginTop: 2 }}>
                <span className="badge green" style={{ fontSize: '11px', padding: '2px 8px' }}>
                  ● Excel Spreadsheet Mode (Editable)
                </span>
                <span className="muted small">Click any cell or edit button to update</span>
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={handleExportExcel} disabled={!ledgerData} title="Export this ledger directly into Microsoft Excel">
              <FileSpreadsheet size={15} /> Export Excel
            </button>
            <button className="btn btn-sm" onClick={handleDownloadPdf} disabled={!ledgerData} title="Download printable PDF account statement">
              <Download size={15} /> Statement (PDF)
            </button>
            <button className="btn btn-sm btn-ghost btn-icon" onClick={loadLedger} title="Reload Ledger">
              <RefreshCw size={15} />
            </button>
            <button className="btn btn-sm btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ overflowY: 'auto', padding: '16px 22px' }}>
          {loading && !ledgerData ? (
            <div className="loading"><div className="spinner" /></div>
          ) : !ledgerData ? (
            <p className="muted text-center">Ledger not found.</p>
          ) : (
            <div>
              {/* Account KPI Ribbon & Inline Editable Opening Balance */}
              <div className="card-pad mb" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <div className="row-between wrap" style={{ gap: 14 }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{p.name}</h3>
                    <div className="muted small">
                      {p.phone && <span>Phone: {p.phone} · </span>}
                      {p.address && <span>{p.address}</span>}
                    </div>
                  </div>

                  <div className="row wrap" style={{ gap: 16, alignItems: 'center' }}>
                    {/* Editable Opening Balance Tag */}
                    <div className="card-pad" style={{ padding: '6px 12px', background: 'rgba(10, 18, 34, 0.6)', borderRadius: 8, border: '1px dashed var(--border-strong)' }}>
                      <span className="muted small" style={{ display: 'block', fontSize: '11px' }}>Opening Balance:</span>
                      {editingOpening ? (
                        <div className="row" style={{ gap: 4, marginTop: 3 }}>
                          <input 
                            type="number" 
                            step="any" 
                            className="num" 
                            style={{ width: 100, padding: '3px 6px', height: 26, fontSize: '13px' }}
                            value={openingInput} 
                            onChange={(e) => setOpeningInput(e.target.value)} 
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveOpening()}
                            autoFocus
                          />
                          <button className="btn btn-sm btn-success btn-icon" style={{ width: 26, height: 26 }} onClick={handleSaveOpening} title="Save Opening Balance">
                            <Check size={14} />
                          </button>
                          <button className="btn btn-sm btn-ghost btn-icon" style={{ width: 26, height: 26 }} onClick={() => setEditingOpening(false)}>
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <strong className="mono" style={{ fontSize: '14px' }}>{money(ledgerData.opening_balance)}</strong>
                          <button 
                            className="btn btn-sm btn-ghost btn-icon" 
                            style={{ width: 22, height: 22, padding: 2 }} 
                            onClick={() => setEditingOpening(true)} 
                            title="Click to edit Opening Balance"
                          >
                            <Pencil size={12} color="var(--aqua)" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div>
                      <span className="muted small" style={{ display: 'block', fontSize: '11px' }}>
                        {isCustomer ? 'Total Sales' : 'Total Purchases'}:
                      </span>
                      <strong className="mono" style={{ fontSize: '14px' }}>{money(ledgerData.total_charge)}</strong>
                    </div>

                    <div>
                      <span className="muted small" style={{ display: 'block', fontSize: '11px' }}>
                        {isCustomer ? 'Total Received' : 'Total Paid'}:
                      </span>
                      <strong className="mono pos" style={{ fontSize: '14px' }}>{money(ledgerData.total_payment)}</strong>
                    </div>

                    <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 14 }}>
                      <span className="muted small" style={{ display: 'block', fontSize: '11px' }}>Closing Balance:</span>
                      <strong className="mono big" style={{ color: ledgerData.closing_balance > 0 ? 'var(--rose)' : 'var(--green)' }}>
                        {money(ledgerData.closing_balance)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Date Filters & Excel Tips */}
              <div className="row-between wrap mb" style={{ gap: 10 }}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="muted small">Filter From:</span>
                    <input 
                      type="date" 
                      value={dateFilter.from} 
                      onChange={(e) => setDateFilter((d) => ({ ...d, from: e.target.value }))}
                      style={{ width: 'auto', padding: '5px 8px', fontSize: '12.5px' }} 
                    />
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="muted small">To:</span>
                    <input 
                      type="date" 
                      value={dateFilter.to} 
                      onChange={(e) => setDateFilter((d) => ({ ...d, to: e.target.value }))}
                      style={{ width: 'auto', padding: '5px 8px', fontSize: '12.5px' }} 
                    />
                  </div>
                  {(dateFilter.from || dateFilter.to) && (
                    <button className="btn btn-sm btn-ghost" onClick={() => setDateFilter({ from: '', to: '' })}>
                      Clear Filter
                    </button>
                  )}
                </div>

                <div className="row" style={{ gap: 6 }}>
                  <span className="muted small">💡 Tip: You can edit dates, descriptions, payments, or add entries below.</span>
                </div>
              </div>

              {/* Spreadsheet Table with Excel-like Cell Editing */}
              <div className="table-wrap" style={{ border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-solid)' }}>
                <table className="table compact excel-table" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th style={{ width: 110 }}>DATE</th>
                      <th style={{ width: 110 }}>DOC / REF #</th>
                      <th>DESCRIPTION</th>
                      <th className="r" style={{ width: 130 }}>{chargeColName}</th>
                      <th className="r" style={{ width: 140 }}>{payColName}</th>
                      <th className="r" style={{ width: 140 }}>{balColName}</th>
                      <th style={{ width: 95 }} className="c">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Row 1: Opening Balance Row (Clickable to Edit) */}
                    <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border)' }}>
                      <td>{ledgerData.from ? fmtDate(ledgerData.from) : '—'}</td>
                      <td><span className="badge" style={{ fontSize: '11px' }}>OPENING</span></td>
                      <td className="muted">
                        Initial Account Opening Balance
                        <button 
                          className="btn btn-sm btn-ghost" 
                          style={{ padding: '1px 6px', fontSize: '11px', marginLeft: 8 }}
                          onClick={() => setEditingOpening(true)}
                        >
                          <Pencil size={11} /> Edit
                        </button>
                      </td>
                      <td className="r">—</td>
                      <td className="r">—</td>
                      <td className="r strong mono" style={{ fontSize: '14px' }}>
                        {money(ledgerData.opening_balance)}
                      </td>
                      <td className="c">—</td>
                    </tr>

                    {/* Transaction Rows: Editable in-place */}
                    {ledgerData.entries?.map((e) => {
                      const rowKey = `${e.type}-${e.doc_id}`;
                      const isEditing = editingRowKey === rowKey;

                      if (isEditing) {
                        return (
                          <tr key={rowKey} style={{ background: 'rgba(34, 211, 238, 0.08)', outline: '2px solid var(--aqua)' }}>
                            <td>
                              <input 
                                type="date" 
                                value={editFields.date} 
                                onChange={(ev) => setEditFields({ ...editFields, date: ev.target.value })}
                                style={{ padding: '4px 6px', fontSize: '12px' }}
                              />
                            </td>
                            <td>
                              <span className="badge mono">{e.ref}</span>
                            </td>
                            <td>
                              {e.type === 'payment' ? (
                              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                                <select value={editFields.method} onChange={(ev) => setEditFields({ ...editFields, method: ev.target.value })} style={{ padding: '4px 6px', fontSize: '12.5px', width: 'auto' }}>
                                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                                {isBankMethod(editFields.method) && (
                                  <select value={editFields.bank_account_id || banks[0]?.id || ''} onChange={(ev) => setEditFields({ ...editFields, bank_account_id: ev.target.value })} style={{ padding: '4px 6px', fontSize: '12.5px', width: 'auto' }}>
                                    {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                  </select>
                                )}
                              </div>
                              ) : (
                              <input 
                                type="text" 
                                value={editFields.description} 
                                onChange={(ev) => setEditFields({ ...editFields, description: ev.target.value })}
                                placeholder="Edit note..."
                                style={{ padding: '4px 8px', fontSize: '13px' }}
                                autoFocus
                              />
                              )}
                            </td>
                            <td className="r">
                              {e.charge ? money(e.charge) : '—'}
                            </td>
                            <td className="r">
                              {e.type === 'payment' ? (
                                <input 
                                  type="number" 
                                  step="any" 
                                  className="num" 
                                  value={editFields.amount} 
                                  onChange={(ev) => setEditFields({ ...editFields, amount: ev.target.value })}
                                  style={{ padding: '4px 8px', fontSize: '13px', textAlign: 'right' }}
                                />
                              ) : '—'}
                            </td>
                            <td className="r muted mono">Recalculating...</td>
                            <td className="c">
                              <div className="row" style={{ justifyContent: 'center', gap: 4 }}>
                                <button className="btn btn-sm btn-success btn-icon" onClick={() => handleSaveRow(e)} title="Save changes">
                                  <Check size={14} />
                                </button>
                                <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setEditingRowKey(null)} title="Cancel">
                                  <X size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={rowKey} className="table-row-hover" style={{ borderBottom: '1px solid var(--border)' }}>
                          <td>{fmtDate(e.date)}</td>
                          <td>
                            <span className={`badge ${e.type === 'sale' ? 'green' : e.type === 'purchase' ? 'sky' : 'aqua'}`} style={{ fontSize: '11px' }}>
                              {e.ref}
                            </span>
                          </td>
                          <td>
                            <span 
                              className="editable-cell" 
                              onClick={() => startEditRow(e)} 
                              title="Click to edit row"
                              style={{ cursor: 'pointer', borderBottom: '1px dotted rgba(255,255,255,0.2)' }}
                            >
                              {e.type === 'payment' && e.bank_account_id && bankName(e.bank_account_id)
                                ? `${e.description} · ${bankName(e.bank_account_id)}`
                                : e.description}
                            </span>
                          </td>
                          <td className="r">{e.charge ? money(e.charge) : '—'}</td>
                          <td className="r pos strong mono">
                            {e.payment ? (
                              <span 
                                onClick={() => startEditRow(e)} 
                                title="Click to edit payment amount" 
                                style={{ cursor: 'pointer', padding: '2px 4px', borderRadius: 4, background: 'rgba(34, 197, 94, 0.1)' }}
                              >
                                {money(e.payment)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="r strong mono" style={{ fontSize: '13.5px', color: e.balance > 0 ? 'var(--rose)' : 'var(--green)' }}>
                            {money(e.balance)}
                          </td>
                          <td className="c">
                            <div className="row" style={{ justifyContent: 'center', gap: 4 }}>
                              {/* Direct Invoice/Bill Link */}
                              {(e.type === 'sale' || e.type === 'purchase') && (
                                <button 
                                  className="btn btn-sm btn-ghost btn-icon" 
                                  title={`Download / View ${e.type === 'sale' ? 'Invoice' : 'Bill'} PDF`}
                                  onClick={() => setViewDocId({ type: e.type, id: e.doc_id })}
                                >
                                  <Download size={13} color="var(--aqua)" />
                                </button>
                              )}
                              <button 
                                className="btn btn-sm btn-ghost btn-icon" 
                                title="Edit Row" 
                                onClick={() => startEditRow(e)}
                              >
                                <Pencil size={13} />
                              </button>
                              <button 
                                className="btn btn-sm btn-ghost btn-icon btn-danger" 
                                title="Delete Row" 
                                onClick={() => handleDeleteRow(e)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {/* Excel-style "+ Add New Row" Interactive Form directly inside the Grid */}
                    <tr style={{ background: 'rgba(99, 102, 241, 0.06)', borderTop: '2px solid var(--indigo)' }}>
                      <td>
                        <input 
                          type="date" 
                          value={newRow.date} 
                          onChange={(e) => setNewRow({ ...newRow, date: e.target.value })}
                          style={{ padding: '5px 8px', fontSize: '12px' }}
                        />
                      </td>
                      <td>
                        <span className="badge indigo">+ NEW ENTRY</span>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                                <select value={newRow.method} onChange={(ev) => setNewRow({ ...newRow, method: ev.target.value })} style={{ padding: '4px 6px', fontSize: '12.5px', width: 'auto' }}>
                                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                                {isBankMethod(newRow.method) && (
                                  <select value={newRow.bank_account_id || banks[0]?.id || ''} onChange={(ev) => setNewRow({ ...newRow, bank_account_id: ev.target.value })} style={{ padding: '4px 6px', fontSize: '12.5px', width: 'auto' }}>
                                    {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                                  </select>
                                )}
                              </div>
                      </td>
                      <td className="r muted">—</td>
                      <td className="r">
                        <input 
                          type="number" 
                          step="any" 
                          className="num" 
                          placeholder="Amount (Rs)" 
                          value={newRow.amount}
                          onChange={(e) => setNewRow({ ...newRow, amount: e.target.value })}
                          style={{ padding: '5px 8px', fontSize: '13px', textAlign: 'right', fontWeight: 600 }}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddNewRow()}
                        />
                      </td>
                      <td className="r muted mono">
                        {newRow.amount ? `Auto-calculates` : '—'}
                      </td>
                      <td className="c">
                        <button 
                          className="btn btn-sm btn-primary" 
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={handleAddNewRow}
                          disabled={addingRow || !newRow.amount}
                        >
                          <Plus size={14} /> Add Row
                        </button>
                      </td>
                    </tr>
                  </tbody>

                  {/* Excel Formula-style Totals Bar */}
                  <tfoot>
                    <tr style={{ background: 'var(--surface-2)', borderTop: '2px solid var(--border-strong)' }}>
                      <td colSpan={3} style={{ fontWeight: 700, letterSpacing: '0.04em' }}>
                        PERIOD FORMULA TOTALS (SUM):
                      </td>
                      <td className="r strong mono" style={{ fontSize: '14px' }}>
                        {money(ledgerData.total_charge)}
                      </td>
                      <td className="r strong mono pos" style={{ fontSize: '14px' }}>
                        {money(ledgerData.total_payment)}
                      </td>
                      <td className="r strong mono big" style={{ color: ledgerData.closing_balance > 0 ? 'var(--rose)' : 'var(--green)' }}>
                        {money(ledgerData.closing_balance)}
                      </td>
                      <td className="c">
                        <span className="badge green" style={{ fontSize: '10px' }}>Balanced</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-foot" style={{ padding: '12px 22px', justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="muted small">Account Net Balance:</span>
            <span className="strong big" style={{ color: ledgerData?.closing_balance > 0 ? 'var(--rose)' : 'var(--green)' }}>
              {money(ledgerData?.closing_balance)}
            </span>
            <span className="muted small" style={{ marginLeft: 6 }}>
              ({ledgerData?.closing_balance > 0 ? (isCustomer ? 'Customer Owes' : 'We Owe Vendor') : 'Settled / Advance'})
            </span>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={handleDownloadPdf} disabled={!ledgerData}>
              <Download size={15} /> Download Statement (PDF)
            </button>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Invoice/Bill preview from ledger link */}
      {viewDocId && (
        <InvoiceModal 
          type={viewDocId.type} 
          id={viewDocId.id} 
          onClose={() => setViewDocId(null)} 
        />
      )}
    </div>
  );
}
