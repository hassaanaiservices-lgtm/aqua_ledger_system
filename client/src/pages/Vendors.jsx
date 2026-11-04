import React, { useState } from 'react';
import { 
  Truck, Plus, Search, Download, FileText, ArrowUpRight, 
  Phone, MapPin, Printer, History, Pencil, Trash2 
} from 'lucide-react';
import { useApp, useFetch, PageHeader, Modal, Field, Loading, Empty, useSaver } from '../components/ui';
import { money, fmtDate, PAYMENT_METHODS } from '../lib/format';
import { downloadLedgerStatement } from '../lib/pdf';
import { api } from '../lib/api';
import InvoiceModal from '../components/InvoiceModal';
import EditableLedgerModal from '../components/EditableLedgerModal';

export default function Vendors({ onNavigate }) {
  const { settings, toast, confirm, lookups } = useApp();
  const [search, setSearch] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [vendorModal, setVendorModal] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null);
  const [ledgerModal, setLedgerModal] = useState(null);
  const [dateFilter, setDateFilter] = useState({ from: '', to: '' });
  const [viewBillId, setViewBillId] = useState(null);
  const [runSave, saving] = useSaver();

  const { data: vendors, loading, reload } = useFetch('/vendors', { q: search, due: dueOnly ? '1' : undefined });
  const { data: ledgerData, reload: reloadLedger } = useFetch(
    ledgerModal ? `/vendors/${ledgerModal}/ledger` : null,
    { from: dateFilter.from || undefined, to: dateFilter.to || undefined }
  );

  const handleSaveVendor = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());

    await runSave(async () => {
      if (vendorModal?.id) {
        await api.put(`/vendors/${vendorModal.id}`, body);
        toast('Vendor profile updated');
      } else {
        await api.post('/vendors', body);
        toast('Vendor account created');
      }
      setVendorModal(null);
      reload();
    });
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.party_type = 'vendor';
    body.party_id = paymentModal.id;

    await runSave(async () => {
      await api.post('/payments', body);
      toast('Payment made to vendor recorded in ledger');
      setPaymentModal(null);
      reload();
      if (ledgerModal) reloadLedger();
    });
  };

  const handleDelete = async (v) => {
    const ok = await confirm({
      title: `Delete Vendor: ${v.name}?`,
      message: 'Vendors with recorded purchases or payments cannot be deleted to maintain ledger accounting integrity.',
      okText: 'Delete'
    });
    if (!ok) return;

    await runSave(async () => {
      await api.del(`/vendors/${v.id}`);
      toast('Vendor account deleted');
      reload();
    });
  };

  const handleDownloadStatement = () => {
    if (!ledgerData) return;
    downloadLedgerStatement(ledgerData, 'vendor', settings);
    toast('Vendor ledger statement downloaded (PDF)');
  };

  const totalPayables = vendors?.reduce((acc, v) => acc + (v.balance > 0 ? v.balance : 0), 0) || 0;
  const owingCount = vendors?.filter((v) => v.balance > 0.004).length || 0;

  return (
    <div>
      <PageHeader 
        title="Vendor & Supplier Ledgers" 
        subtitle="Maintain vendor accounts, monitor purchase bills, record supplier payments, and download statements"
      >
        <button className="btn btn-primary" onClick={() => setVendorModal({})}>
          <Plus size={16} /> Add Vendor / Supplier
        </button>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-3 mb">
        <div className="card card-pad">
          <span className="muted small">Total Vendor Dues (We Owe)</span>
          <div className="stat-value neg">{money(totalPayables)}</div>
          <span className="muted small">Outstanding balance across all supplier accounts</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Suppliers with Pending Payment</span>
          <div className="stat-value warn">{owingCount}</div>
          <span className="muted small">Out of {vendors?.length || 0} registered suppliers</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Purchase Reconciliation</span>
          <div style={{ marginTop: 6, fontSize: '13px', color: 'var(--text-2)' }}>
            Record supplier bill numbers, item costs, and trace every inventory intake back to the source bill.
          </div>
        </div>
      </div>

      {/* Filter and Table */}
      <div className="card mb">
        <div className="filters">
          <div className="search field wide">
            <Search size={16} />
            <input 
              placeholder="Search vendor by company name or phone..." 
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
            <span className="strong small">Show vendors we owe only</span>
          </label>
        </div>

        <div className="table-wrap">
          {loading ? (
            <Loading />
          ) : !vendors || vendors.length === 0 ? (
            <Empty title="No vendors found">
              <button className="btn btn-sm btn-primary mt" onClick={() => setVendorModal({})}>
                Add first vendor
              </button>
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Vendor / Supplier Name</th>
                  <th>Contact Details</th>
                  <th className="r">Total Purchases</th>
                  <th className="r">Total Paid</th>
                  <th className="r">Outstanding Balance</th>
                  <th className="actions">Ledger & Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <div className="strong" style={{ fontSize: '14.5px' }}>{v.name}</div>
                      {v.ntn && <span className="muted small mono">NTN / Tax ID: {v.ntn}</span>}
                    </td>
                    <td>
                      <div className="small">
                        {v.phone ? <span><Phone size={12} style={{ verticalAlign: -1, marginRight: 4 }} />{v.phone}</span> : '—'}
                      </div>
                      {v.address && <div className="muted small">{v.address}</div>}
                    </td>
                    <td className="r">{money(v.total_purchases)}</td>
                    <td className="r pos">{money(v.total_paid)}</td>
                    <td className="r">
                      <span className={`strong big ${v.balance > 0 ? 'neg' : v.balance < 0 ? 'pos' : 'muted'}`}>
                        {money(v.balance)}
                      </span>
                      {v.balance > 0 && <div className="small neg">We owe vendor</div>}
                      {v.balance < 0 && <div className="small pos">Advance paid</div>}
                    </td>
                    <td className="actions">
                      <button 
                        className="btn btn-sm btn-primary" 
                        title="View Full Ledger Statement" 
                        onClick={() => setLedgerModal(v.id)}
                      >
                        <FileText size={15} /> Ledger
                      </button>
                      <button 
                        className="btn btn-sm btn-danger" 
                        title="Record Payment Made to Vendor" 
                        onClick={() => setPaymentModal(v)}
                      >
                        <ArrowUpRight size={15} /> Make Payment
                      </button>
                      <button 
                        className="btn btn-sm btn-ghost btn-icon" 
                        title="Edit Vendor" 
                        onClick={() => setVendorModal(v)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button 
                        className="btn btn-sm btn-ghost btn-icon btn-danger" 
                        title="Delete Account" 
                        onClick={() => handleDelete(v)}
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

      {/* Vendor Excel-like Editable Ledger Modal */}
      {ledgerModal && (
        <EditableLedgerModal
          kind="vendor"
          partyId={ledgerModal}
          onClose={() => setLedgerModal(null)}
          onChanged={reload}
        />
      )}

      {/* Record Payment to Vendor Modal */}
      {paymentModal && (
        <Modal
          title={`Record Payment Made to ${paymentModal.name}`}
          onClose={() => setPaymentModal(null)}
        >
          <form onSubmit={handleRecordPayment}>
            <div className="card-pad mb" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
              <div className="row-between">
                <span className="muted">Current Balance We Owe:</span>
                <span className="strong big neg">{money(paymentModal.balance)}</span>
              </div>
            </div>

            <div className="form-grid">
              <Field label="Amount Paid (Rs) *" className="full">
                <input type="number" step="any" name="amount" defaultValue={paymentModal.balance > 0 ? paymentModal.balance : ''} required placeholder="Enter amount paid" />
              </Field>
              <Field label="Payment Date *">
                <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </Field>
              <Field label="Payment Method *">
                <select name="method" defaultValue="cash">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Bank Account" hint="used only when not cash">
                <select name="bank_account_id" defaultValue={lookups.bank_accounts?.[0]?.id ?? ''}>
                  {(lookups.bank_accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.owner_name ? `${a.name} (${a.owner_name})` : a.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Transaction / Cheque Reference #">
                <input name="reference" placeholder="e.g. Bank slip or Cheque #" />
              </Field>
              <Field label="Remarks / Note">
                <input name="note" placeholder="Optional notes" />
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

      {/* Add / Edit Vendor Modal */}
      {vendorModal && (
        <Modal
          title={vendorModal.id ? 'Edit Vendor' : 'Add New Vendor / Supplier'}
          onClose={() => setVendorModal(null)}
        >
          <form onSubmit={handleSaveVendor}>
            <div className="form-grid">
              <Field label="Vendor / Company Name *" className="full">
                <input name="name" defaultValue={vendorModal.name || ''} required placeholder="e.g. Karachi Filtration Parts Co." />
              </Field>
              <Field label="Phone / Mobile Number">
                <input name="phone" defaultValue={vendorModal.phone || ''} placeholder="0300-1234567" />
              </Field>
              <Field label="NTN / STRN / Tax Number">
                <input name="ntn" defaultValue={vendorModal.ntn || ''} placeholder="NTN or registration #" />
              </Field>
              <Field label="Email Address">
                <input type="email" name="email" defaultValue={vendorModal.email || ''} placeholder="vendor@supplier.com" />
              </Field>
              <Field label="Opening Balance (Rs)" hint="Positive if we owe them, negative if we paid in advance">
                <input type="number" step="any" name="opening_balance" defaultValue={vendorModal.opening_balance || ''} placeholder="0" />
              </Field>
              <Field label="Office / Factory Address" className="full">
                <textarea name="address" defaultValue={vendorModal.address || ''} placeholder="Address, city, market" />
              </Field>
              <Field label="Internal Notes" className="full">
                <input name="notes" defaultValue={vendorModal.notes || ''} placeholder="Product lines, payment terms" />
              </Field>
            </div>
            <div className="modal-foot" style={{ marginTop: 24, padding: '14px 0 0' }}>
              <button type="button" className="btn" onClick={() => setVendorModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Account'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Bill Viewer */}
      {viewBillId && (
        <InvoiceModal 
          type="purchase" 
          id={viewBillId} 
          onClose={() => setViewBillId(null)} 
        />
      )}
    </div>
  );
}
