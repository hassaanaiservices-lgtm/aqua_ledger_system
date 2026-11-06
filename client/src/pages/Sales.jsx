import React, { useState } from 'react';
import { 
  ShoppingCart, Plus, Search, Download, Eye, Trash2, 
  UserPlus, Calendar, CreditCard, DollarSign, FileText, CheckCircle2, Undo2
} from 'lucide-react';
import { useApp, useFetch, PageHeader, Modal, Field, Loading, Empty, useSaver } from '../components/ui';
import { money, fmtDate, paymentOptions, parsePaymentChoice } from '../lib/format';
import { api } from '../lib/api';
import InvoiceModal from '../components/InvoiceModal';
import ReturnModal from '../components/ReturnModal';

export default function Sales({ onNavigate }) {
  const { lookups, toast, confirm, loadLookups } = useApp();
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [newSaleModal, setNewSaleModal] = useState(false);
  const [activeInvoiceId, setActiveInvoiceId] = useState(null);
  const [returnModal, setReturnModal] = useState(false);
  const [runSave, saving] = useSaver();

  // New Sale Form state
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState([
    { product_id: '', qty: 1, unit_price: 0, line_total: 0, available: 0 }
  ]);
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentRef, setPaymentRef] = useState('');
  const [note, setNote] = useState('');

  const { data: sales, loading, reload } = useFetch('/sales', { 
    customer_id: customerFilter || undefined,
    q: search || undefined
  });

  const handleProductChange = (idx, pid) => {
    const p = lookups.products.find((prod) => prod.id === Number(pid));
    const next = [...items];
    next[idx].product_id = pid;
    next[idx].unit_price = p ? p.sale_price : 0;
    next[idx].line_total = next[idx].qty * (next[idx].unit_price || 0);
    // Fetch live stock for validation feedback
    if (pid) {
      api.get(`/products/${pid}`).then((full) => {
        setItems((cur) => {
          const updated = [...cur];
          if (updated[idx]) updated[idx].available = full.stock;
          return updated;
        });
      }).catch(() => {});
    }
    setItems(next);
  };

  const handleQtyChange = (idx, qty) => {
    const next = [...items];
    next[idx].qty = Number(qty) || 0;
    next[idx].line_total = next[idx].qty * (next[idx].unit_price || 0);
    setItems(next);
  };

  const handlePriceChange = (idx, price) => {
    const next = [...items];
    next[idx].unit_price = Number(price) || 0;
    next[idx].line_total = next[idx].qty * next[idx].unit_price;
    setItems(next);
  };

  const addItemRow = () => {
    setItems([...items, { product_id: '', qty: 1, unit_price: 0, line_total: 0, available: 0 }]);
  };

  const removeItemRow = (idx) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const subtotal = items.reduce((sum, it) => sum + (it.line_total || 0), 0);
  const grandTotal = Math.max(0, subtotal - (Number(discount) || 0) + (Number(tax) || 0));

  const handleCreateSale = async (e) => {
    e.preventDefault();
    if (!customerId) {
      toast('Please select a customer', 'error');
      return;
    }
    const cleanItems = items.filter((it) => it.product_id && it.qty > 0);
    if (!cleanItems.length) {
      toast('Please add at least one valid item', 'error');
      return;
    }

    await runSave(async () => {
      const res = await api.post('/sales', {
        customer_id: customerId,
        date,
        items: cleanItems.map((it) => ({
          product_id: it.product_id,
          qty: it.qty,
          unit_price: it.unit_price,
        })),
        discount: Number(discount) || 0,
        tax: Number(tax) || 0,
        paid_amount: Number(paidAmount) || 0,
        payment_method: parsePaymentChoice(paymentMethod, lookups.bank_accounts).method,
        payment_bank_account_id: parsePaymentChoice(paymentMethod, lookups.bank_accounts).bank_account_id,
        payment_reference: paymentRef,
        note,
      });

      toast(`Sale Invoice ${res.invoice_no} created successfully!`);
      setNewSaleModal(false);
      reload();
      loadLookups();
      // Open invoice modal immediately so user can download/print
      setActiveInvoiceId(res.id);
    });
  };

  const handleDeleteSale = async (s) => {
    const ok = await confirm({
      title: `Delete Invoice ${s.invoice_no}?`,
      message: 'This will restore the products back to stock and remove the charge and payments from the customer ledger.',
      okText: 'Delete Invoice'
    });
    if (!ok) return;

    await runSave(async () => {
      await api.del(`/sales/${s.id}`);
      toast('Sale invoice cancelled & stock restored');
      reload();
      loadLookups();
    });
  };

  const totalSalesRevenue = sales?.reduce((acc, s) => acc + s.total, 0) || 0;
  const totalSalesProfit = sales?.reduce((acc, s) => acc + (s.profit || 0), 0) || 0;

  return (
    <div>
      <PageHeader 
        title="Sales & Invoicing" 
        subtitle="Create sales invoices, deduct inventory automatically, post to customer ledgers, and download PDFs"
      >
        <button className="btn" onClick={() => setReturnModal(true)}>
          <Undo2 size={16} /> Sales Return
        </button>
        <button 
          className="btn btn-primary" 
          onClick={() => {
            setItems([{ product_id: '', qty: 1, unit_price: 0, line_total: 0, available: 0 }]);
            setCustomerId('');
            setDiscount(0);
            setTax(0);
            setPaidAmount(0);
            setNewSaleModal(true);
          }}
        >
          <Plus size={16} /> New Sale Invoice
        </button>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-3 mb">
        <div className="card card-pad">
          <span className="muted small">Recorded Sales Invoices</span>
          <div className="stat-value" style={{ color: 'var(--green)' }}>{sales?.filter((s) => !s.is_return).length || 0}</div>
          <span className="muted small">Total billing: {money(totalSalesRevenue)}</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Estimated Gross Margin</span>
          <div className="stat-value" style={{ color: 'var(--aqua)' }}>{money(totalSalesProfit)}</div>
          <span className="muted small">Sales minus COGS valuation</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Downloadable Customer Invoices</span>
          <div style={{ marginTop: 6, fontSize: '13px', color: 'var(--text-2)' }}>
            Each invoice includes previous ledger balance, current charges, payments, and remaining due.
          </div>
        </div>
      </div>

      {/* Filters and List */}
      <div className="card mb">
        <div className="filters">
          <div className="search field wide">
            <Search size={16} />
            <input 
              placeholder="Search by invoice number or customer name..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
              <option value="">All Customers</option>
              {lookups.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <Loading />
          ) : !sales || sales.length === 0 ? (
            <Empty title="No sales invoices found">
              <button className="btn btn-sm btn-primary mt" onClick={() => setNewSaleModal(true)}>
                Create first invoice
              </button>
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th className="r">Subtotal</th>
                  <th className="r">Discount</th>
                  <th className="r">Invoice Total</th>
                  <th className="r">Paid Upfront</th>
                  <th className="actions">Invoice & Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className={`badge ${s.is_return ? 'rose' : 'green'} mono strong`} style={{ fontSize: '13px' }}>
                        {s.invoice_no}
                      </span>
                      {s.is_return && <div className="small neg" style={{ marginTop: 3 }}>Sales return</div>}
                    </td>
                    <td>{fmtDate(s.date)}</td>
                    <td>
                      <div className="strong">{s.customer_name}</div>
                    </td>
                    <td>{s.item_count} item{s.item_count === 1 ? '' : 's'}</td>
                    <td className="r">{money(s.subtotal)}</td>
                    <td className="r">{s.discount > 0 ? `-${money(s.discount)}` : '—'}</td>
                    <td className="r strong big" style={{ color: 'var(--text)' }}>
                      {money(s.total)}
                    </td>
                    <td className="r pos">{money(s.paid_on_invoice)}</td>
                    <td className="actions">
                      <button 
                        className="btn btn-sm btn-primary" 
                        title="Download / View Official Invoice PDF" 
                        onClick={() => setActiveInvoiceId(s.id)}
                      >
                        <Download size={14} /> Invoice PDF
                      </button>
                      <button 
                        className="btn btn-sm btn-ghost btn-icon btn-danger" 
                        title="Cancel / Delete Invoice" 
                        onClick={() => handleDeleteSale(s)}
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

      {/* Create Sale Invoice Modal */}
      {newSaleModal && (
        <Modal
          title="Create New Sales Invoice"
          onClose={() => setNewSaleModal(false)}
          size="xl"
        >
          <form onSubmit={handleCreateSale}>
            {/* Header info */}
            <div className="form-grid mb">
              <Field label="Customer Account *" className="full">
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                  <option value="">Select Customer...</option>
                  {lookups.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>
                  ))}
                </select>
              </Field>
              <Field label="Invoice Date *">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field label="Invoice Note / Order Ref">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivery to office" />
              </Field>
            </div>

            {/* Line items table */}
            <div className="card mb" style={{ border: '1px solid var(--border)' }}>
              <div className="card-head">
                <h3 style={{ fontSize: '15px' }}>Invoice Line Items</h3>
                <button type="button" className="btn btn-sm btn-primary" onClick={addItemRow}>
                  <Plus size={14} /> Add Item Row
                </button>
              </div>
              <div className="table-wrap">
                <table className="table line-items">
                  <thead>
                    <tr>
                      <th style={{ width: '45%' }}>Product / Assembled Unit *</th>
                      <th className="r" style={{ width: '15%' }}>Qty</th>
                      <th className="r" style={{ width: '20%' }}>Unit Price (Rs)</th>
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
                            <option value="">Select product...</option>
                            {lookups.products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} [{p.type}] — Stock: {p.unit}
                              </option>
                            ))}
                          </select>
                          {row.product_id && (
                            <div className="muted small" style={{ marginTop: 2 }}>
                              Available Stock: <strong className={row.available < row.qty ? 'neg' : 'pos'}>{row.available}</strong>
                              {row.available < row.qty && <span className="neg" style={{ marginLeft: 6 }}>⚠️ Exceeds stock!</span>}
                            </div>
                          )}
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
                            value={row.unit_price} 
                            onChange={(e) => handlePriceChange(idx, e.target.value)} 
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

            {/* Calculations & Upfront payment */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
              <div className="card-pad" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Instant Upfront Payment (Optional)</h4>
                <div className="form-grid">
                  <Field label="Amount Paid at Checkout (Rs)">
                    <input 
                      type="number" 
                      step="any" 
                      value={paidAmount} 
                      onChange={(e) => setPaidAmount(e.target.value)} 
                      placeholder="0 if on credit / due" 
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
                    <input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Receipt / Cheque #" />
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
                  <span>Tax / VAT:</span>
                  <input 
                    type="number" 
                    step="any" 
                    style={{ width: 110, padding: '4px 8px', textAlign: 'right' }} 
                    value={tax} 
                    onChange={(e) => setTax(e.target.value)} 
                  />
                </div>
                <div className="summary-line total">
                  <span>Invoice Total:</span>
                  <b>{money(grandTotal)}</b>
                </div>
                <div className="summary-line" style={{ color: 'var(--green)' }}>
                  <span>Upfront Paid:</span>
                  <b>{money(paidAmount)}</b>
                </div>
                <div className="summary-line" style={{ fontSize: '15px', color: grandTotal - paidAmount > 0 ? 'var(--rose)' : 'var(--green)' }}>
                  <span>Remaining Due on Ledger:</span>
                  <b>{money(grandTotal - paidAmount)}</b>
                </div>
              </div>
            </div>

            <div className="modal-foot" style={{ marginTop: 24, padding: '14px 0 0' }}>
              <button type="button" className="btn" onClick={() => setNewSaleModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Creating Invoice...' : 'Generate & Save Invoice'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Invoice Modal for View / Download */}
      {returnModal && <ReturnModal kind="sale" onClose={() => setReturnModal(false)} onSaved={reload} />}
      {activeInvoiceId && (
        <InvoiceModal 
          type="sale" 
          id={activeInvoiceId} 
          onClose={() => setActiveInvoiceId(null)} 
        />
      )}
    </div>
  );
}
