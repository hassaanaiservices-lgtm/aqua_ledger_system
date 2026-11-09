import React, { useState } from 'react';
import { Receipt } from 'lucide-react';
import { Modal, Field, useSaver } from './ui';
import { api } from '../lib/api';
import { paymentOptions, parsePaymentChoice, paymentChoice } from '../lib/format';

/** Records a new expense, or — with `entry` — edits an existing one in place. */
export default function ExpenseModal({ date, categories, banks, onClose, entry, onSaved }) {
  const [save, busy] = useSaver();
  const [form, setForm] = useState(() => entry ? {
    date: entry.date,
    category: entry.category || '',
    amount: entry.amount,
    payment: paymentChoice(entry.method, entry.bank_account_id),
    note: entry.note || '',
  } : {
    date, category: '', amount: '', payment: 'cash', note: '',
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const groups = [...new Set(categories.map((c) => c.group_name))];

  const submit = async (e) => {
    e.preventDefault();
    const body = { ...form, ...parsePaymentChoice(form.payment, banks) };
    const ok = await save(
      () => (entry ? api.patch(`/expenses/${entry.id}`, body) : api.post('/expenses', body)),
      entry ? 'Expense updated' : 'Expense recorded'
    );
    if (ok) {
      onClose();
      onSaved?.();
    }
  };

  return (
    <Modal title={entry ? 'Edit Expense' : 'Record Expense'} icon={<Receipt size={18} />} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : entry ? 'Save Changes' : 'Save Expense'}</button>
      </>}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Expense Category *" className="full">
            <select value={form.category} onChange={set('category')} required>
              <option value="">Select category…</option>
              {groups.map((g) => (
                <optgroup key={g} label={g}>
                  {categories.filter((c) => c.group_name === g).map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Amount (Rs) *">
            <input type="number" step="any" min="0" value={form.amount} onChange={set('amount')} required placeholder="0" />
          </Field>
          <Field label="Date *">
            <input type="date" value={form.date} onChange={set('date')} required />
          </Field>
          <Field label="Paid From *" hint="cash drawer or bank">
            <select value={form.payment} onChange={set('payment')}>
              {paymentOptions(banks).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Note" className="full">
            <input value={form.note} onChange={set('note')} placeholder="Optional detail, e.g. October electricity bill" />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
