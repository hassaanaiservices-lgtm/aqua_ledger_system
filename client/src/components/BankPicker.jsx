import React from 'react';
import { Field } from './ui';

/** Picker shown whenever money moves through a bank rather than the drawer. */
export default function BankPicker({ label, value, onChange, accounts, hint }) {
  return (
    <Field label={label} hint={hint}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Select bank account…</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.owner_name ? ` (${a.owner_name})` : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}
