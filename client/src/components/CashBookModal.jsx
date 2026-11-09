import React, { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Modal, Field, useSaver } from './ui';
import BankPicker from './BankPicker';
import { api } from '../lib/api';

/** Records a transfer / income / capital / drawing / bank-charge entry, or — with `entry` — edits an existing one in place. */
export default function CashBookModal({ date, kinds, banks, onClose, entry, onSaved }) {
  const [save, busy] = useSaver();
  const [form, setForm] = useState(() => entry ? {
    date: entry.date,
    kind: entry.kind,
    from_account: entry.from_account || '',
    to_account: entry.to_account || '',
    from_bank_id: entry.from_bank_id ?? (banks[0]?.id ?? ''),
    to_bank_id: entry.to_bank_id ?? (banks[0]?.id ?? ''),
    amount: entry.amount,
    category: entry.category || '',
    reference: entry.reference || '',
    note: entry.note || '',
  } : {
    date, kind: 'transfer', from_account: 'cash', to_account: 'bank',
    from_bank_id: banks[0]?.id ?? '', to_bank_id: banks[0]?.id ?? '',
    amount: '', category: '', reference: '', note: '',
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const kind = kinds.find((k) => k.value === form.kind);
  const needsFrom = kind?.needs.includes('from_account');
  const needsTo = kind?.needs.includes('to_account');

  const changeKind = (e) => {
    const next = kinds.find((k) => k.value === e.target.value);
    setForm({
      ...form,
      kind: e.target.value,
      from_account: next?.needs.includes('from_account') ? (form.from_account || 'cash') : '',
      to_account: next?.needs.includes('to_account') ? (form.to_account || 'bank') : '',
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    const ok = await save(
      () => (entry ? api.patch(`/cash-book/${entry.id}`, form) : api.post('/cash-book', form)),
      entry ? 'Cash book entry updated' : 'Cash book entry saved'
    );
    if (ok) {
      onClose();
      onSaved?.();
    }
  };

  const accountOptions = [
    { value: 'cash', label: 'Cash in Hand' },
    { value: 'bank', label: 'Bank Account' },
  ];

  return (
    <Modal title={entry ? 'Edit Cash / Bank Entry' : 'Cash / Bank Entry'} icon={<ArrowRightLeft size={18} />} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : entry ? 'Save Changes' : 'Save Entry'}</button>
      </>}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Entry Type *" className="full">
            <select value={form.kind} onChange={changeKind}>
              {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Amount (Rs) *">
            <input type="number" step="any" min="0" value={form.amount} onChange={set('amount')} required placeholder="0" />
          </Field>
          <Field label="Date *">
            <input type="date" value={form.date} onChange={set('date')} required />
          </Field>
          {needsFrom && (
            <Field label="Money Out Of *">
              <select value={form.from_account} onChange={set('from_account')}>
                {accountOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          )}
          {needsFrom && form.from_account === 'bank' && (
            <BankPicker
              label="From Which Bank *"
              value={form.from_bank_id}
              onChange={(v) => setForm({ ...form, from_bank_id: v })}
              accounts={banks}
            />
          )}
          {needsTo && (
            <Field label="Money Into *">
              <select value={form.to_account} onChange={set('to_account')}>
                {accountOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          )}
          {needsTo && form.to_account === 'bank' && (
            <BankPicker
              label="Into Which Bank *"
              value={form.to_bank_id}
              onChange={(v) => setForm({ ...form, to_bank_id: v })}
              accounts={banks}
            />
          )}
          <Field label="Description" className="full">
            <input value={form.category} onChange={set('category')} placeholder="e.g. Scrap sale, Rent received" />
          </Field>
          <Field label="Reference #">
            <input value={form.reference} onChange={set('reference')} placeholder="Slip / cheque no." />
          </Field>
          <Field label="Note">
            <input value={form.note} onChange={set('note')} placeholder="Optional" />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
