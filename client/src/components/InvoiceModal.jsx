import React, { useState, useEffect } from 'react';
import { Download, Printer, X, FileText, CheckCircle2, Copy } from 'lucide-react';
import { api } from '../lib/api';
import { money, moneySigned, fmtDate, amountInWords } from '../lib/format';
import { downloadSaleInvoice, downloadPurchaseBill } from '../lib/pdf';
import { useApp } from '../components/ui';

export default function InvoiceModal({ type = 'sale', id, onClose }) {
  const { settings, toast } = useApp();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    const endpoint = type === 'sale' ? `/sales/${id}` : `/purchases/${id}`;
    api.get(endpoint)
      .then(setDoc)
      .catch((err) => toast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [type, id, toast]);

  if (!id) return null;

  const isSale = type === 'sale';
  const party = isSale ? doc?.customer : doc?.vendor;
  const docNo = isSale ? doc?.invoice_no : doc?.purchase_no;
  const paid = isSale ? doc?.paid_on_invoice : doc?.paid_on_bill;
  const due = (doc?.total || 0) - (paid || 0);

  const handleDownload = () => {
    if (!doc) return;
    if (isSale) {
      downloadSaleInvoice(doc, settings);
    } else {
      downloadPurchaseBill(doc, settings);
    }
    toast(`${isSale ? 'Invoice' : 'Bill'} PDF downloaded`);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopySummary = () => {
    if (!doc) return;
    const text = `Invoice #${docNo} - ${party?.name}\nDate: ${fmtDate(doc.date)}\nTotal: ${money(doc.total)}\nPaid: ${money(paid)}\nDue: ${money(due)}`;
    navigator.clipboard.writeText(text);
    toast('Summary copied to clipboard');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal lg" style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-head">
          <div className="row" style={{ gap: '10px' }}>
            <div className="brand-logo" style={{ width: 32, height: 32 }}>
              <FileText size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '17px', margin: 0 }}>
                {isSale ? 'Sales Invoice' : 'Purchase Bill'} <span className="badge aqua" style={{ marginLeft: 8 }}>{docNo}</span>
              </h2>
              <span className="muted small">Recorded on {doc ? fmtDate(doc.date) : '...'}</span>
            </div>
          </div>
          <div className="row" style={{ gap: '8px' }}>
            <button className="btn btn-sm btn-primary" onClick={handleDownload} disabled={!doc}>
              <Download size={15} /> Download PDF
            </button>
            <button className="btn btn-sm" onClick={handlePrint} disabled={!doc}>
              <Printer size={15} /> Print
            </button>
            <button className="btn btn-sm btn-ghost btn-icon" onClick={handleCopySummary} title="Copy summary">
              <Copy size={16} />
            </button>
            <button className="btn btn-sm btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', padding: '24px 28px' }}>
          {loading ? (
            <div className="loading"><div className="spinner" /></div>
          ) : !doc ? (
            <p className="muted text-center">Document not found.</p>
          ) : (
            <div className="invoice-preview" style={{ background: 'var(--surface-solid)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '28px' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '20px', marginBottom: '20px' }}>
                <div>
                  <h1 style={{ fontSize: '22px', color: 'var(--aqua)', margin: '0 0 6px 0' }}>{settings.business_name || 'Aqua Home Appliance'}</h1>
                  <p className="muted small" style={{ margin: 0, lineHeight: 1.5 }}>
                    {settings.business_address || 'Main Commercial Market'}<br />
                    {settings.business_phone && <span>Phone: {settings.business_phone} · </span>}
                    {settings.business_email && <span>Email: {settings.business_email}</span>}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="badge aqua" style={{ fontSize: '13px', padding: '6px 14px', marginBottom: '8px' }}>
                    {isSale ? 'OFFICIAL INVOICE' : 'PURCHASE BILL'}
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 700 }}>{docNo}</div>
                  <div className="muted small">Date: {fmtDate(doc.date)}</div>
                </div>
              </div>

              {/* Party & Accounts Grid */}
              <div className="grid grid-2" style={{ marginBottom: '24px', gap: '16px' }}>
                <div className="card-pad" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
                  <span className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    {isSale ? 'Billed To (Customer)' : 'Supplier (Vendor)'}
                  </span>
                  <h3 style={{ margin: '6px 0 4px', fontSize: '16px' }}>{party?.name || 'Walk-in'}</h3>
                  <div className="muted small" style={{ lineHeight: 1.6 }}>
                    {party?.phone && <div>Phone: {party.phone}</div>}
                    {party?.address && <div>Address: {party.address}</div>}
                    {isSale && party?.cnic && <div>CNIC: {party.cnic}</div>}
                    {!isSale && party?.ntn && <div>NTN: {party.ntn}</div>}
                  </div>
                </div>

                <div className="card-pad" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
                  <span className="muted small" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                    Account Statement Summary
                  </span>
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
                    <div className="row-between">
                      <span className="muted">Previous Ledger Balance:</span>
                      <span>{money(doc.previous_balance)}</span>
                    </div>
                    <div className="row-between">
                      <span className="muted">This {isSale ? 'Invoice' : 'Bill'}:</span>
                      <span className="strong">{money(doc.total)}</span>
                    </div>
                    <div className="row-between">
                      <span className="muted">Paid at checkout:</span>
                      <span className="pos">-{money(paid)}</span>
                    </div>
                    <div className="divider" style={{ margin: '4px 0' }} />
                    <div className="row-between strong" style={{ fontSize: '14px' }}>
                      <span>Closing Ledger Balance:</span>
                      <span style={{ color: doc.balance_after > 0 ? 'var(--rose)' : 'var(--green)' }}>
                        {money(doc.balance_after)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <table className="table" style={{ marginBottom: '20px' }}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Product / Description</th>
                    <th className="r" style={{ width: 90 }}>Qty</th>
                    <th style={{ width: 80 }}>Unit</th>
                    <th className="r" style={{ width: 120 }}>Rate ({settings.currency || 'Rs'})</th>
                    <th className="r" style={{ width: 130 }}>Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.items?.map((it, idx) => (
                    <tr key={it.id || idx}>
                      <td>{idx + 1}</td>
                      <td>
                        <div className="strong">{it.product_name}</div>
                        {it.sku && <span className="muted small mono">SKU: {it.sku}</span>}
                      </td>
                      <td className="r strong">{it.qty}</td>
                      <td>{it.unit || 'pcs'}</td>
                      <td className="r">{money(isSale ? it.unit_price : it.unit_cost)}</td>
                      <td className="r strong">{money(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals & Notes */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px' }}>
                <div>
                  <div className="card-pad" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', marginBottom: '14px' }}>
                    <span className="muted small" style={{ fontWeight: 600 }}>AMOUNT IN WORDS:</span>
                    <div className="strong" style={{ marginTop: 4, color: 'var(--text)', fontSize: '13px' }}>
                      {amountInWords(doc.total)}
                    </div>
                  </div>
                  {doc.note && (
                    <div className="muted small" style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: 'var(--radius-sm)' }}>
                      <strong>Note: </strong>{doc.note}
                    </div>
                  )}
                  {settings.invoice_terms && (
                    <div className="muted small" style={{ marginTop: 10, fontSize: '11px', lineHeight: 1.4 }}>
                      <strong>Terms: </strong>{settings.invoice_terms}
                    </div>
                  )}
                </div>

                <div className="summary-box">
                  <div className="summary-line">
                    <span>Subtotal:</span>
                    <b>{money(doc.subtotal)}</b>
                  </div>
                  {doc.discount > 0 && (
                    <div className="summary-line" style={{ color: 'var(--rose)' }}>
                      <span>Discount:</span>
                      <b>-{money(doc.discount)}</b>
                    </div>
                  )}
                  {doc.tax > 0 && (
                    <div className="summary-line">
                      <span>Tax / VAT:</span>
                      <b>+{money(doc.tax)}</b>
                    </div>
                  )}
                  <div className="summary-line total">
                    <span>Grand Total:</span>
                    <b>{money(doc.total)}</b>
                  </div>
                  <div className="summary-line" style={{ color: 'var(--green)' }}>
                    <span>Amount Paid:</span>
                    <b>{money(paid)}</b>
                  </div>
                  <div className="summary-line" style={{ fontSize: '15px', color: due > 0 ? 'var(--rose)' : 'var(--green)' }}>
                    <span>Amount Due:</span>
                    <b>{money(due)}</b>
                  </div>
                </div>
              </div>

              {settings.invoice_footer && (
                <div style={{ textAlign: 'center', marginTop: '30px', paddingTop: '15px', borderTop: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '12px', fontStyle: 'italic' }}>
                  {settings.invoice_footer}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
