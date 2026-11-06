import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Undo2 } from 'lucide-react';
import { Modal, Field, useApp, useSaver } from './ui';
import { api } from '../lib/api';
import { money, fmtDate, today } from '../lib/format';

/**
 * Sales return (customer gives goods back) or purchase return (we send goods
 * back to the vendor). Picking the original invoice/bill fills in the items at
 * the price that was charged; without one, items are entered by hand.
 */
export default function ReturnModal({ kind, onClose, onSaved }) {
  const isSale = kind === 'sale';
  const { lookups, toast, loadLookups } = useApp();
  const [runSave, saving] = useSaver();
  const [partyId, setPartyId] = useState('');
  const [docs, setDocs] = useState([]);
  const [docId, setDocId] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [rows, setRows] = useState([{ product_id: '', qty: '', price: '' }]);

  const priceKey = isSale ? 'unit_price' : 'unit_cost';
  const parties = isSale ? lookups.customers : lookups.vendors;
  const docLabel = isSale ? 'invoice' : 'bill';

  useEffect(() => {
    setDocId('');
    setDocs([]);
    if (!partyId) return;
    api
      .get(isSale ? '/sales' : '/purchases', isSale ? { customer_id: partyId } : { vendor_id: partyId })
      .then((list) => setDocs(list.filter((d) => !d.is_return)))
      .catch((e) => toast(e.message, 'error'));
  }, [partyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!docId) {
      setRows([{ product_id: '', qty: '', price: '' }]);
      return;
    }
    api
      .get(`${isSale ? '/sales' : '/purchases'}/${docId}`)
      .then((d) => setRows(d.items.map((i) => ({ product_id: i.product_id, name: i.product_name, unit: i.unit, had: i.qty, qty: '', price: i[priceKey] }))))
      .catch((e) => toast(e.message, 'error'));
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickProduct = (i, id) => {
    const p = lookups.products.find((x) => x.id === Number(id));
    setRow(i, { product_id: id, price: p ? (isSale ? p.sale_price : p.avg_cost ?? p.cost_price) : '' });
  };
  const total = rows.reduce((t, r) => t + (Number(r.qty) || 0) * (Number(r.price) || 0), 0);

  const submit = (e) => {
    e.preventDefault();
    const items = rows
      .filter((r) => r.product_id && Number(r.qty) > 0)
      .map((r) => ({ product_id: Number(r.product_id), qty: Number(r.qty), [priceKey]: Number(r.price) || 0 }));
    if (!partyId) return toast(`Select a ${isSale ? 'customer' : 'vendor'}`, 'error');
    if (!items.length) return toast('Enter the quantity being returned', 'error');
    runSave(async () => {
      const res = await api.post(isSale ? '/sales/returns' : '/purchases/returns', {
        [isSale ? 'customer_id' : 'vendor_id']: Number(partyId),
        [isSale ? 'sale_id' : 'purchase_id']: docId ? Number(docId) : undefined,
        date,
        note,
        items,
      });
      toast(`${isSale ? 'Sales' : 'Purchase'} return ${res.invoice_no || res.purchase_no} saved — stock and ledger updated`);
      loadLookups();
      onSaved?.();
      onClose();
    });
  };

  return (
    <Modal
      title={isSale ? 'Sales Return (customer returns goods)' : 'Purchase Return (goods back to vendor)'}
      icon={<Undo2 size={18} />}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto' }}>
            Return total: <b style={{ color: 'var(--text)' }}>{money(total)}</b>
          </span>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : 'Save Return'}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label={`${isSale ? 'Customer' : 'Vendor'} *`}>
            <select value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
              <option value="">Select…</option>
              {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={`Original ${docLabel}`} hint="fills the items and their prices">
            <select value={docId} onChange={(e) => setDocId(e.target.value)} disabled={!partyId}>
              <option value="">No {docLabel} — enter items by hand</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.invoice_no || d.purchase_no} · {fmtDate(d.date)} · {money(d.total)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Return Date *">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Reason / Note">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. damaged motor" />
          </Field>
        </div>

        <div className="table-wrap" style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <table className="table compact">
            <thead>
              <tr>
                <th>Product</th>
                {docId && <th className="r">On {docLabel}</th>}
                <th className="r" style={{ width: 120 }}>Return Qty</th>
                <th className="r" style={{ width: 140 }}>{isSale ? 'Price' : 'Cost'} (Rs)</th>
                <th className="r">Amount</th>
                {!docId && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {docId ? (
                      <span className="strong">{r.name}</span>
                    ) : (
                      <select value={r.product_id} onChange={(e) => pickProduct(i, e.target.value)}>
                        <option value="">Select product…</option>
                        {lookups.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                  </td>
                  {docId && <td className="r muted">{r.had} {r.unit}</td>}
                  <td className="r">
                    <input type="number" min="0" step="any" max={docId ? r.had : undefined} className="num" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} placeholder="0" />
                  </td>
                  <td className="r">
                    <input type="number" min="0" step="any" className="num" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} />
                  </td>
                  <td className="r strong">{money((Number(r.qty) || 0) * (Number(r.price) || 0))}</td>
                  {!docId && (
                    <td className="c">
                      <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!docId && (
          <button type="button" className="btn btn-sm mt" onClick={() => setRows([...rows, { product_id: '', qty: '', price: '' }])}>
            <Plus size={14} /> Add item
          </button>
        )}
        <p className="muted small" style={{ marginTop: 12 }}>
          {isSale
            ? 'Returned items go back into stock and the amount is taken off what the customer owes. Profit on them is reversed.'
            : 'Returned items leave stock and the amount is taken off what we owe the vendor.'}
        </p>
      </form>
    </Modal>
  );
}
