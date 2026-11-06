import React, { useState } from 'react';
import { 
  Truck, Plus, Search, Download, Trash2, Calendar, FileText, Undo2,
} from 'lucide-react';
import { useApp, useFetch, PageHeader, Modal, Field, Loading, Empty, useSaver } from '../components/ui';
import { money, fmtDate, paymentOptions, parsePaymentChoice } from '../lib/format';
import { api } from '../lib/api';
import InvoiceModal from '../components/InvoiceModal';
import ReturnModal from '../components/ReturnModal';

export default function Purchases({ onNavigate }) {
  const { lookups, toast, confirm, loadLookups } = useApp();
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [newPurchaseModal, setNewPurchaseModal] = useState(false);
  const [activeBillId, setActiveBillId] = useState(null);
  const [returnModal, setReturnModal] = useState(false);
  const [runSave, saving] = useSaver();

  // New Purchase state
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendorBillNo, setVendorBillNo] = useState('');
  const [items, setItems] = useState([
    { product_id: '', qty: 1, unit_cost: 0, line_total: 0 }
  ]);
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentRef, setPaymentRef] = useState('');
  const [note, setNote] = useState('');

  const { data: purchases, loading, reload } = useFetch('/purchases', {
    vendor_id: vendorFilter || undefined,
    q: search || undefined
  });

  const handleProductChange = (idx, pid) => {
    const p = lookups.products.find((prod) => prod.id === Number(pid));
    const next = [...items];
    next[idx].product_id = pid;
    next[idx].unit_cost = p ? p.cost_price : 0;
    next[idx].line_total = next[idx].qty * (next[idx].unit_cost || 0);
    setItems(next);
  };

  const handleQtyChange = (idx, qty) => {
    const next = [...items];
    next[idx].qty = Number(qty) || 0;
    next[idx].line_total = next[idx].qty * (next[idx].unit_cost || 0);
    setItems(next);
  };

  const handleCostChange = (idx, cost) => {
    const next = [...items];
    next[idx].unit_cost = Number(cost) || 0;
    next[idx].line_total = next[idx].qty * next[idx].unit_cost;
    setItems(next);
  };

  const addItemRow = () => {
    setItems([...items, { product_id: '', qty: 1, unit_cost: 0, line_total: 0 }]);
  };

  const removeItemRow = (idx) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const subtotal = items.reduce((sum, it) => sum + (it.line_total || 0), 0);
  const grandTotal = Math.max(0, subtotal - (Number(discount) || 0) + (Number(tax) || 0));

  const handleCreatePurchase = async (e) => {
    e.preventDefault();
    if (!vendorId) {
      toast('Please select a vendor', 'error');
      return;
    }
    const cleanItems = items.filter((it) => it.product_id && it.qty > 0);
    if (!cleanItems.length) {
      toast('Please add at least one valid item', 'error');
      return;
    }

    await runSave(async () => {
      const res = await api.post('/purchases', {
        vendor_id: vendorId,
        date,
        vendor_bill_no: vendorBillNo,
        items: cleanItems.map((it) => ({
          product_id: it.product_id,
          qty: it.qty,
          unit_cost: it.unit_cost,
        })),
        discount: Number(discount) || 0,
        tax: Number(tax) || 0,
        paid_amount: Number(paidAmount) || 0,
        payment_method: parsePaymentChoice(paymentMethod, lookups.bank_accounts).method,
        payment_bank_account_id: parsePaymentChoice(paymentMethod, lookups.bank_accounts).bank_account_id,
        payment_reference: paymentRef,
        note,
      });

      toast(`Purchase ${res.purchase_no} recorded & stock updated!`);
      setNewPurchaseModal(false);
      reload();
      loadLookups();
      setActiveBillId(res.id);
    });
  };

  const handleDeletePurchase = async (p) => {
    const ok = await confirm({
      title: `Delete Purchase ${p.purchase_no}?`,
      message: 'This will revert inventory stock and adjust the vendor ledger. (Stock must still be in inventory)',
      okText: 'Delete Bill'
    });
    if (!ok) return;

    await runSave(async () => {
      await api.del(`/purchases/${p.id}`);
      toast('Purchase bill cancelled & inventory reversed');
      reload();
      loadLookups();
    });
  };

  const totalPurchasesAmount = purchases?.reduce((acc, p) => acc + p.total, 0) || 0;

  return (
    <div>
      <PageHeader 
        title="Purchases & Vendor Bills" 
        subtitle="Record inventory received from suppliers, update costs, post to vendor ledgers, and download bills"
      >
        <button className="btn" onClick={() => setReturnModal(true)}>
          <Undo2 size={16} /> Purchase Return
        </button>
        <button 
          className="btn btn-primary" 
          onClick={() => {
            setItems([{ product_id: '', qty: 1, unit_cost: 0, line_total: 0 }]);
            setVendorId('');
            setVendorBillNo('');
            setDiscount(0);
            setTax(0);
            setPaidAmount(0);
            setNewPurchaseModal(true);
          }}
        >
          <Plus size={16} /> Record Purchase
        </button>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-3 mb">
        <div className="card card-pad">
          <span className="muted small">Recorded Purchase Bills</span>
          <div className="stat-value" style={{ color: 'var(--sky)' }}>{purchases?.length || 0}</div>
          <span className="muted small">Total supplier purchases: {money(totalPurchasesAmount)}</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Automatic Stock Intake</span>
          <div style={{ marginTop: 6, fontSize: '13px', color: 'var(--text-2)' }}>
            Stock on hand increases immediately and weighted average unit cost is updated for accurate profit calculations.
          </div>
        </div>
        <div className="card card-pad">
          <span className="muted small">Vendor Reconciliation</span>
          <div style={{ marginTop: 6, fontSize: '13px', color: 'var(--text-2)' }}>
            Unpaid purchases automatically roll into the Vendor Ledger as money owed.
          </div>
        </div>
      </div>

      {/* Filters and List */}
      <div className="card mb">
        <div className="filters">
          <div className="search field wide">
            <Search size={16} />
            <input 
              placeholder="Search by purchase #, vendor bill #, or vendor name..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
              <option value="">All Vendors</option>
              {lookups.vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <Loading />
          ) : !purchases || purchases.length === 0 ? (
            <Empty title="No purchases recorded">
              <button className="btn btn-sm btn-primary mt" onClick={() => setNewPurchaseModal(true)}>
                Record first purchase
              </button>
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Purchase #</th>
                  <th>Date</th>
                  <th>Vendor / Supplier</th>
                  <th>Vendor Bill #</th>
                  <th>Items</th>
                  <th className="r">Subtotal</th>
                  <th className="r">Total Amount</th>
                  <th className="r">Paid to Vendor</th>
                  <th className="actions">Bill & Actions</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className={`badge ${p.is_return ? 'rose' : 'sky'} mono strong`} style={{ fontSize: '13px' }}>
                        {p.purchase_no}
                      </span>
                      {p.is_return && <div className="small neg" style={{ marginTop: 3 }}>Purchase return</div>}
                    </td>
                    <td>{fmtDate(p.date)}</td>
                    <td>
                      <div className="strong">{p.vendor_name}</div>
                    </td>
                    <td><span className="mono">{p.vendor_bill_no || '—'}</span></td>
                    <td>{p.item_count} item{p.item_count === 1 ? '' : 's'}</td>
                    <td className="r">{money(p.subtotal)}</td>
                    <td className="r strong big">{money(p.total)}</td>
                    <td className="r pos">{money(p.paid_on_bill)}</td>
                    <td className="actions">
                      <button 
                        className="btn btn-sm btn-primary" 
                        title="Download / View Purchase Bill PDF" 
                        onClick={() => setActiveBillId(p.id)}
                      >
                        <Download size={14} /> Bill PDF
                      </button>
                      <button 
                        className="btn btn-sm btn-ghost btn-icon btn-danger" 
                        title="Cancel Purchase" 
                        onClick={() => handleDeletePurchase(p)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Record Purchase Modal */}
      {newPurchaseModal && (
        <Modal
          title="Record Inventory Purchase Bill"
          onClose={() => setNewPurchaseModal(false)}
          size="xl"
        >
          <form onSubmit={handleCreatePurchase}>
            <div className="form-grid mb">
              <Field label="Vendor / Supplier Account *" className="full">
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
                  <option value="">Select Vendor...</option>
                  {lookups.vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} {v.phone ? `(${v.phone})` : ''}</option>
                  ))}
                </select>
              </Field>
              <Field label="Purchase Date *">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field label="Supplier's Bill / Invoice #">
                <input value={vendorBillNo} onChange={(e) => setVendorBillNo(e.target.value)} placeholder="e.g. INV-88921 from vendor" />
              </Field>
              <Field label="Purchase Remarks / Note" className="full">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Shipment received via cargo" />
              </Field>
            </div>

            {/* Line items table */}
            <div className="card mb" style={{ border: '1px solid var(--border)' }}>
              <div className="card-head">
                <h3 style={{ fontSize: '15px' }}>Purchased Raw Materials / Stock Items</h3>
                <button type="button" className="btn btn-sm btn-primary" onClick={addItemRow}>
                  <Plus size={14} /> Add Item Row
                </button>
              </div>
              <div className="table-wrap">
                <table className="table line-items">
                  <thead>
                    <tr>
                      <th style={{ width: '45%' }}>Material / Product *</th>
                      <th className="r" style={{ width: '15%' }}>Qty Received</th>
                      <th className="r" style={{ width: '20%' }}>Unit Cost (Rs)</th>
                      <th className="r" style={{ width: '15%' }}>Line Total</th>
                      <th style={{ width: '5%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, idx) => (
                      <tr key={idx}>
                        <td>
                          <select 
                            value={row.product_id} 
                            onChange={(e) => handleProductChange(idx, e.target.value)} 
                            required
                          >
                            <option value="">Select material or product...</option>
                            {lookups.products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} [{p.type}] — Current Unit: {p.unit}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="r">
                          <input 
                            type="number" 
                            step="any" 
                            min="0.01" 
                            className="num" 
                            value={row.qty} 
                            onChange={(e) => handleQtyChange(idx, e.target.value)} 
                            required 
                          />
                        </td>
                        <td className="r">
                          <input 
                            type="number" 
                            step="any" 
                            className="num" 
                            value={row.unit_cost} 
                            onChange={(e) => handleCostChange(idx, e.target.value)} 
                            required 
                          />
                        </td>
                        <td className="r strong mono" style={{ fontSize: '14px' }}>
                          {money(row.line_total)}
                        </td>
                        <td className="c">
                          <button 
                            type="button" 
                            className="btn btn-sm btn-ghost btn-icon btn-danger" 
                            onClick={() => removeItemRow(idx)}
                            disabled={items.length === 1}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Calculations & Payment made */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
              <div className="card-pad" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Payment Made at Receipt (Optional)</h4>
                <div className="form-grid">
                  <Field label="Amount Paid to Vendor (Rs)">
                    <input 
                      type="number" 
                      step="any" 
                      value={paidAmount} 
                      onChange={(e) => setPaidAmount(e.target.value)} 
                      placeholder="0 if bought on credit" 
                    />
                  </Field>
                  <Field label="Payment Method">
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                      {paymentOptions(lookups.bank_accounts).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Payment Reference #" className="full">
                    <input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Cheque # or bank slip #" />
                  </Field>
                </div>
              </div>

              <div className="summary-box">
                <div className="summary-line">
                  <span>Subtotal:</span>
                  <b>{money(subtotal)}</b>
                </div>
                <div className="summary-line">
                  <span>Discount:</span>
                  <input 
                    type="number" 
                    step="any" 
                    style={{ width: 110, padding: '4px 8px', textAlign: 'right' }} 
                    value={discount} 
                    onChange={(e) => setDiscount(e.target.value)} 
                  />
                </div>
                <div className="summary-line">
                  <span>Tax / Duties:</span>
                  <input 
                    type="number" 
                    step="any" 
                    style={{ width: 110, padding: '4px 8px', textAlign: 'right' }} 
                    value={tax} 
                    onChange={(e) => setTax(e.target.value)} 
                  />
                </div>
                <div className="summary-line total">
                  <span>Purchase Total:</span>
                  <b>{money(grandTotal)}</b>
                </div>
                <div className="summary-line" style={{ color: 'var(--green)' }}>
                  <span>Paid Upfront:</span>
                  <b>{money(paidAmount)}</b>
                </div>
                <div className="summary-line" style={{ fontSize: '15px', color: grandTotal - paidAmount > 0 ? 'var(--rose)' : 'var(--green)' }}>
                  <span>We Owe (Added to Vendor Ledger):</span>
                  <b>{money(grandTotal - paidAmount)}</b>
                </div>
              </div>
            </div>

            <div className="modal-foot" style={{ marginTop: 24, padding: '14px 0 0' }}>
              <button type="button" className="btn" onClick={() => setNewPurchaseModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Recording...' : 'Save & Receive Stock'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Bill Modal */}
      {returnModal && <ReturnModal kind="purchase" onClose={() => setReturnModal(false)} onSaved={reload} />}
      {activeBillId && (
        <InvoiceModal 
          type="purchase" 
          id={activeBillId} 
          onClose={() => setActiveBillId(null)} 
        />
      )}
    </div>
  );
}
