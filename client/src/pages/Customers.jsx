import React, { useState } from 'react';
import { 
  Users, Plus, Search, Download, CreditCard, Eye, FileText, 
  ArrowDownLeft, Phone, MapPin, Printer, History, Pencil, Trash2
} from 'lucide-react';
import { useApp, useFetch, PageHeader, Modal, Field, Loading, Empty, useSaver } from '../components/ui';
import { money, moneySigned, fmtDate, paymentOptions, parsePaymentChoice } from '../lib/format';
import { downloadLedgerStatement } from '../lib/pdf';
import { api } from '../lib/api';
import InvoiceModal from '../components/InvoiceModal';
import EditableLedgerModal from '../components/EditableLedgerModal';

export default function Customers({ onNavigate }) {
  const { settings, toast, confirm, lookups } = useApp();
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [customerModal, setCustomerModal] = useState(null); // null or object
  const [paymentModal, setPaymentModal] = useState(null); // null or customer object
  const [ledgerModal, setLedgerModal] = useState(null); // null or customer id
  const [dateFilter, setDateFilter] = useState({ from: '', to: '' });
  const [viewInvoiceId, setViewInvoiceId] = useState(null);
  const [runSave, saving] = useSaver();

  const { data: customers, loading, reload } = useFetch('/customers', { q: search, due: dueOnly ? '1' : undefined });
  const { data: ledgerData, reload: reloadLedger } = useFetch(
    ledgerModal ? `/customers/${ledgerModal}/ledger` : null, 
    { from: dateFilter.from || undefined, to: dateFilter.to || undefined }
  );

  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());

    await runSave(async () => {
      if (customerModal?.id) {
        await api.put(`/customers/${customerModal.id}`, body);
        toast('Customer profile updated');
      } else {
        await api.post('/customers', body);
        toast('Customer account created');
      }
      setCustomerModal(null);
      reload();
    });
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { payment, ...body } = Object.fromEntries(fd.entries());
    Object.assign(body, parsePaymentChoice(payment, lookups.bank_accounts));
    body.party_type = 'customer';
    body.party_id = paymentModal.id;

    await runSave(async () => {
      await api.post('/payments', body);
      toast('Payment received recorded in ledger');
      setPaymentModal(null);
      reload();
      if (ledgerModal) reloadLedger();
    });
  };

  const handleDelete = async (c) => {
    const ok = await confirm({
      title: `Delete Customer: ${c.name}?`,
      message: 'Customers with recorded sales or payments cannot be deleted to maintain accounting ledger integrity.',
      okText: 'Delete'
    });
    if (!ok) return;

    await runSave(async () => {
      await api.del(`/customers/${c.id}`);
      toast('Customer account deleted');
      reload();
    });
  };

  const handleDownloadStatement = () => {
    if (!ledgerData) return;
    downloadLedgerStatement(ledgerData, 'customer', settings);
    toast('Customer ledger statement downloaded (PDF)');
  };

  const totalReceivables = customers?.reduce((acc, c) => acc + (c.balance > 0 ? c.balance : 0), 0) || 0;
  const owingCount = customers?.filter((c) => c.balance > 0.004).length || 0;

  return (
    <div>
      <PageHeader 
        title="Customer Accounts & Ledgers" 
        subtitle="Manage customer profiles, sales balances, payment receipts, and download statements"
      >
        <button className="btn btn-primary" onClick={() => setCustomerModal({})}>
          <Plus size={16} /> Add Customer
        </button>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-3 mb">
        <div className="card card-pad">
          <span className="muted small">Total Outstanding Customer Dues</span>
          <div className="stat-value neg">{money(totalReceivables)}</div>
          <span className="muted small">Owed to business across all customer ledgers</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Customers with Unpaid Balance</span>
          <div className="stat-value warn">{owingCount}</div>
          <span className="muted small">Out of {customers?.length || 0} registered accounts</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Ledger & Invoice Integration</span>
          <div style={{ marginTop: 6, fontSize: '13px', color: 'var(--text-2)' }}>
            Every sale and receipt is recorded automatically in the customer ledger with instant PDF generation.
          </div>
        </div>
      </div>

      {/* Filter and Table */}
      <div className="card mb">
        <div className="filters">
          <div className="search field wide">
            <Search size={16} />
            <input 
              placeholder="Search customer by name or phone..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>
          <label className="row" style={{ cursor: 'pointer', paddingBottom: 6 }}>
            <input 
              type="checkbox" 
              checked={dueOnly} 
              onChange={(e) => setDueOnly(e.target.checked)} 
              style={{ width: 'auto' }} 
            />
            <span className="strong small">Show with outstanding balance only</span>
          </label>
        </div>

        <div className="table-wrap">
          {loading ? (
            <Loading />
          ) : !customers || customers.length === 0 ? (
            <Empty title="No customers found">
              <button className="btn btn-sm btn-primary mt" onClick={() => setCustomerModal({})}>
                Add first customer
              </button>
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Customer Profile</th>
                  <th>Contact Details</th>
                  <th className="r">Total Sales</th>
                  <th className="r">Total Paid</th>
                  <th className="r">Current Balance</th>
                  <th className="actions">Ledger & Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="strong" style={{ fontSize: '14.5px' }}>{c.name}</div>
                      {c.cnic && <span className="muted small mono">CNIC: {c.cnic}</span>}
                    </td>
                    <td>
                      <div className="small">
                        {c.phone ? <span><Phone size={12} style={{ verticalAlign: -1, marginRight: 4 }} />{c.phone}</span> : '—'}
                      </div>
                      {c.address && <div className="muted small">{c.address}</div>}
                    </td>
                    <td className="r">{money(c.total_sales)}</td>
                    <td className="r pos">{money(c.total_paid)}</td>
                    <td className="r">
                      <span className={`strong big ${c.balance > 0 ? 'neg' : c.balance < 0 ? 'pos' : 'muted'}`}>
                        {money(c.balance)}
                      </span>
                      {c.balance > 0 && <div className="small warn">Customer owes</div>}
                      {c.balance < 0 && <div className="small pos">Advance balance</div>}
                    </td>
                    <td className="actions">
                      <button 
                        className="btn btn-sm btn-primary" 
                        title="View Full Ledger Statement" 
                        onClick={() => setLedgerModal(c.id)}
                      >
                        <FileText size={15} /> Ledger
                      </button>
                      <button 
                        className="btn btn-sm btn-success" 
                        title="Record Payment Received" 
                        onClick={() => setPaymentModal(c)}
                      >
                        <ArrowDownLeft size={15} /> Receive Payment
                      </button>
                      <button 
                        className="btn btn-sm btn-ghost btn-icon" 
                        title="Edit Customer" 
                        onClick={() => setCustomerModal(c)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button 
                        className="btn btn-sm btn-ghost btn-icon btn-danger" 
                        title="Delete Account" 
                        onClick={() => handleDelete(c)}
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

      {/* Customer Excel-like Editable Ledger Modal */}
      {ledgerModal && (
        <EditableLedgerModal
          kind="customer"
          partyId={ledgerModal}
          onClose={() => setLedgerModal(null)}
          onChanged={reload}
        />
      )}

      {/* Record Payment Modal */}
      {paymentModal && (
        <Modal
          title={`Record Payment from ${paymentModal.name}`}
          onClose={() => setPaymentModal(null)}
        >
          <form onSubmit={handleRecordPayment}>
            <div className="card-pad mb" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
              <div className="row-between">
                <span className="muted">Current Balance Owed:</span>
                <span className="strong big neg">{money(paymentModal.balance)}</span>
              </div>
            </div>

            <div className="form-grid">
              <Field label="Amount Received (Rs) *" className="full">
                <input type="number" step="any" name="amount" defaultValue={paymentModal.balance > 0 ? paymentModal.balance : ''} required placeholder="Enter amount received" />
              </Field>
              <Field label="Payment Date *">
                <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </Field>
              <Field label="Payment Method *">
                <select name="payment" defaultValue="cash">
                  {paymentOptions(lookups.bank_accounts).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Transaction / Cheque Reference #">
                <input name="reference" placeholder="e.g. Chq# 489102 or Bank Ref" />
              </Field>
              <Field label="Remarks / Note">
                <input name="note" placeholder="Optional payment note" />
              </Field>
            </div>

            <div className="modal-foot" style={{ marginTop: 24, padding: '14px 0 0' }}>
              <button type="button" className="btn" onClick={() => setPaymentModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Recording...' : 'Save Payment'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add / Edit Customer Profile Modal */}
      {customerModal && (
        <Modal
          title={customerModal.id ? 'Edit Customer' : 'Add New Customer Account'}
          onClose={() => setCustomerModal(null)}
        >
          <form onSubmit={handleSaveCustomer}>
            <div className="form-grid">
              <Field label="Customer / Business Name *" className="full">
                <input name="name" defaultValue={customerModal.name || ''} required placeholder="e.g. Ali Traders / Muhammad Bilal" />
              </Field>
              <Field label="Phone / Mobile Number">
                <input name="phone" defaultValue={customerModal.phone || ''} placeholder="0300-1234567" />
              </Field>
              <Field label="CNIC / National ID">
                <input name="cnic" defaultValue={customerModal.cnic || ''} placeholder="35201-xxxxxxx-x" />
              </Field>
              <Field label="Email Address">
                <input type="email" name="email" defaultValue={customerModal.email || ''} placeholder="customer@domain.com" />
              </Field>
              <Field label="Opening Balance (Rs)" hint="Positive if they owe us, negative if advance">
                <input type="number" step="any" name="opening_balance" defaultValue={customerModal.opening_balance || ''} placeholder="0" />
              </Field>
              <Field label="Complete Address" className="full">
                <textarea name="address" defaultValue={customerModal.address || ''} placeholder="Street, Market, City" />
              </Field>
              <Field label="Internal Notes" className="full">
                <input name="notes" defaultValue={customerModal.notes || ''} placeholder="Credit terms, special notes" />
              </Field>
            </div>
            <div className="modal-foot" style={{ marginTop: 24, padding: '14px 0 0' }}>
              <button type="button" className="btn" onClick={() => setCustomerModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Account'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Direct Invoice Viewer / Downloader */}
      {viewInvoiceId && (
        <InvoiceModal 
          type="sale" 
          id={viewInvoiceId} 
          onClose={() => setViewInvoiceId(null)} 
        />
      )}
    </div>
  );
}
