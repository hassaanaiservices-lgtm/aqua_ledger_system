// Cash book: money movements that belong to no customer or vendor.
// Cash<->bank transfers, other income, owner capital, drawings and bank charges.
// Payments (party money) and expenses live elsewhere; together the three make
// the cash and bank books add up.
import { Router } from 'express';
import { all, get, run, r2, docNo, PAYMENT_METHODS, defaultBankAccountId } from '../db.js';
import { h, bad, notFound, num, str, today } from '../utils.js';

const r = Router();

export const CASH_BOOK_KINDS = {
  transfer: { label: 'Cash / Bank Transfer', needs: ['from_account', 'to_account'], effect: 'neutral' },
  income: { label: 'Other Income Receipt', needs: ['to_account'], effect: 'income' },
  capital: { label: 'Owner Capital Introduced', needs: ['to_account'], effect: 'capital_in' },
  drawings: { label: 'Owner Drawings', needs: ['from_account'], effect: 'capital_out' },
  bank_charge: { label: 'Bank Charges', needs: ['from_account'], effect: 'expense' },
};

const DATE_OPS = ['<', '=', '<='];

/** Cash/bank in & out from the cash book, for dates matching `op` against `date`. */
export async function cashBookFlows(op, date) {
  if (!DATE_OPS.includes(op)) throw new Error(`Unsupported date comparison: ${op}`);
  return await get(
    `SELECT
       COALESCE(SUM(CASE WHEN to_account   = 'cash' THEN amount ELSE 0 END),0) AS cash_in,
       COALESCE(SUM(CASE WHEN from_account = 'cash' THEN amount ELSE 0 END),0) AS cash_out,
       COALESCE(SUM(CASE WHEN to_account   = 'bank' THEN amount ELSE 0 END),0) AS bank_in,
       COALESCE(SUM(CASE WHEN from_account = 'bank' THEN amount ELSE 0 END),0) AS bank_out
     FROM cash_book WHERE date ${op} ?`,
    date
  );
}
/** Cash/bank in & out from the cash book, for dates from `from` to `to` inclusive. */
export async function cashBookFlowsRange(from, to) {
  return await get(
    `SELECT
       COALESCE(SUM(CASE WHEN to_account   = 'cash' THEN amount ELSE 0 END),0) AS cash_in,
       COALESCE(SUM(CASE WHEN from_account = 'cash' THEN amount ELSE 0 END),0) AS cash_out,
       COALESCE(SUM(CASE WHEN to_account   = 'bank' THEN amount ELSE 0 END),0) AS bank_in,
       COALESCE(SUM(CASE WHEN from_account = 'bank' THEN amount ELSE 0 END),0) AS bank_out
     FROM cash_book WHERE date BETWEEN ? AND ?`,
    from,
    to
  );
}

/** Totals per kind up to / on a date, used by the P&L and balance sheet. */
export async function cashBookKindTotals(op, date) {
  if (!DATE_OPS.includes(op)) throw new Error(`Unsupported date comparison: ${op}`);
  const rows = await all(
    `SELECT kind, COALESCE(SUM(amount),0) AS total FROM cash_book WHERE date ${op} ? GROUP BY kind`,
    date
  );
  const out = { transfer: 0, income: 0, capital: 0, drawings: 0, bank_charge: 0 };
  for (const row of rows) out[row.kind] = r2(row.total);
  return out;
}

/** Cash book rows always carry the names of the bank accounts they touch. */
export const CASH_BOOK_SELECT = `
  SELECT c.*, bf.name AS from_bank_name, bt.name AS to_bank_name
  FROM cash_book c
  LEFT JOIN bank_accounts bf ON bf.id = c.from_bank_id
  LEFT JOIN bank_accounts bt ON bt.id = c.to_bank_id`;

export function decorate(row) {
  const side = (account, name) => (account === 'bank' ? name || 'Bank' : account === 'cash' ? 'Cash in Hand' : null);
  return {
    ...row,
    ref: docNo.cashbook(row.id),
    kind_label: CASH_BOOK_KINDS[row.kind]?.label || row.kind,
    from_label: side(row.from_account, row.from_bank_name),
    to_label: side(row.to_account, row.to_bank_name),
  };
}

// ---------------------------------------------------------------- bank accounts

/** Money in and out of every bank account, for dates matching `op`. */
async function bankFlows(op, date) {
  if (!DATE_OPS.includes(op)) throw new Error(`Unsupported date comparison: ${op}`);
  return await all(
    `SELECT a.id,
       COALESCE((SELECT SUM(amount) FROM payments p
                 WHERE p.bank_account_id = a.id AND p.party_type = 'customer' AND p.date ${op} ?),0)
       + COALESCE((SELECT SUM(amount) FROM cash_book c WHERE c.to_bank_id = a.id AND c.date ${op} ?),0) AS inflow,
       COALESCE((SELECT SUM(amount) FROM payments p
                 WHERE p.bank_account_id = a.id AND p.party_type = 'vendor' AND p.date ${op} ?),0)
       + COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.bank_account_id = a.id AND e.date ${op} ?),0)
       + COALESCE((SELECT SUM(amount) FROM cash_book c WHERE c.from_bank_id = a.id AND c.date ${op} ?),0) AS outflow
     FROM bank_accounts a ORDER BY a.sort, a.id`,
    date, date, date, date, date
  );
}

/** Same as bankFlows, but summed over a date range instead of against one op/date. */
async function bankFlowsRange(from, to) {
  return await all(
    `SELECT a.id,
       COALESCE((SELECT SUM(amount) FROM payments p
                 WHERE p.bank_account_id = a.id AND p.party_type = 'customer' AND p.date BETWEEN ? AND ?),0)
       + COALESCE((SELECT SUM(amount) FROM cash_book c WHERE c.to_bank_id = a.id AND c.date BETWEEN ? AND ?),0) AS inflow,
       COALESCE((SELECT SUM(amount) FROM payments p
                 WHERE p.bank_account_id = a.id AND p.party_type = 'vendor' AND p.date BETWEEN ? AND ?),0)
       + COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.bank_account_id = a.id AND e.date BETWEEN ? AND ?),0)
       + COALESCE((SELECT SUM(amount) FROM cash_book c WHERE c.from_bank_id = a.id AND c.date BETWEEN ? AND ?),0) AS outflow
     FROM bank_accounts a ORDER BY a.sort, a.id`,
    from, to, from, to, from, to, from, to, from, to
  );
}

/**
 * Per-account bank books for the window from `from` to `to` (both default to
 * the same day), plus the combined position. This is the single source of
 * truth for the bank side, so the combined total can never disagree with the
 * sum of the individual accounts.
 */
export async function bankBooks(to, from = to) {
  const accounts = await all('SELECT * FROM bank_accounts ORDER BY sort, id');
  const before = new Map((await bankFlows('<', from)).map((x) => [x.id, x]));
  const onDay = new Map((await bankFlowsRange(from, to)).map((x) => [x.id, x]));

  const rows = accounts.map((a) => {
    const b = before.get(a.id) || { inflow: 0, outflow: 0 };
    const o = onDay.get(a.id) || { inflow: 0, outflow: 0 };
    const opening = r2(a.opening_balance + b.inflow - b.outflow);
    return {
      id: a.id,
      name: a.name,
      owner_name: a.owner_name,
      bank_name: a.bank_name,
      account_number: a.account_number,
      active: a.active,
      opening_balance: a.opening_balance,
      sort: a.sort,
      note: a.note,
      opening,
      inflow: r2(o.inflow),
      outflow: r2(o.outflow),
      closing: r2(opening + o.inflow - o.outflow),
    };
  });

  const sum = (key) => r2(rows.reduce((t, x) => t + x[key], 0));
  return {
    accounts: rows,
    total: { opening: sum('opening'), inflow: sum('inflow'), outflow: sum('outflow'), closing: sum('closing') },
  };
}

/** Throws unless `id` is a usable bank account; returns the numeric id. */
async function requireBankAccount(id, label) {
  const n = num(id);
  if (!n) throw bad(`${label}: choose a bank account`);
  const row = await get('SELECT id, active FROM bank_accounts WHERE id = ?', n);
  if (!row) throw bad(`${label}: that bank account does not exist`);
  if (!row.active) throw bad(`${label}: that bank account is closed`);
  return n;
}

r.get(
  '/bank-accounts',
  h(async (req) => bankBooks(req.query.as_of || today()))
);

r.post(
  '/bank-accounts',
  h(async (req) => {
    const b = req.body;
    const name = str(b.name);
    if (!name) throw bad('Account name is required');
    const info = await run(
      `INSERT INTO bank_accounts (name, owner_name, bank_name, account_number, opening_balance, sort, note)
       VALUES (?,?,?,?,?,?,?)`,
      name,
      str(b.owner_name),
      str(b.bank_name),
      str(b.account_number),
      r2(b.opening_balance),
      num(b.sort, 100),
      str(b.note)
    );
    return await get('SELECT * FROM bank_accounts WHERE id = ?', Number(info.lastInsertRowid));
  })
);

r.put(
  '/bank-accounts/:id',
  h(async (req) => {
    const acc = await get('SELECT * FROM bank_accounts WHERE id = ?', num(req.params.id));
    if (!acc) throw notFound('Bank account not found');
    const b = req.body;
    const pick = (key, fallback) => (b[key] !== undefined ? b[key] : fallback);
    const name = str(pick('name', acc.name));
    if (!name) throw bad('Account name is required');
    await run(
      `UPDATE bank_accounts SET name = ?, owner_name = ?, bank_name = ?, account_number = ?,
         opening_balance = ?, sort = ?, note = ?, active = ? WHERE id = ?`,
      name,
      str(pick('owner_name', acc.owner_name)),
      str(pick('bank_name', acc.bank_name)),
      str(pick('account_number', acc.account_number)),
      r2(pick('opening_balance', acc.opening_balance)),
      num(pick('sort', acc.sort), acc.sort),
      str(pick('note', acc.note)),
      pick('active', acc.active) ? 1 : 0,
      acc.id
    );
    return await get('SELECT * FROM bank_accounts WHERE id = ?', acc.id);
  })
);

r.delete(
  '/bank-accounts/:id',
  h(async (req) => {
    const acc = await get('SELECT * FROM bank_accounts WHERE id = ?', num(req.params.id));
    if (!acc) throw notFound('Bank account not found');
    const used =
      (await get('SELECT COUNT(*) AS c FROM payments WHERE bank_account_id = ?', acc.id)).c +
      (await get('SELECT COUNT(*) AS c FROM expenses WHERE bank_account_id = ?', acc.id)).c +
      (await get('SELECT COUNT(*) AS c FROM cash_book WHERE from_bank_id = ? OR to_bank_id = ?', acc.id, acc.id)).c;
    const others = (await get('SELECT COUNT(*) AS c FROM bank_accounts WHERE id <> ? AND active = 1', acc.id)).c;
    if (!others) throw bad('At least one bank account must stay open');
    // Closing an account that carries history would orphan those amounts, so it
    // is only hidden from the pickers and its balance stays on the books.
    if (used) await run('UPDATE bank_accounts SET active = 0 WHERE id = ?', acc.id);
    else await run('DELETE FROM bank_accounts WHERE id = ?', acc.id);
    return { ok: true, closed: Boolean(used) };
  })
);

r.get('/payment-methods', h(async () => PAYMENT_METHODS));

r.get(
  '/cash-book',
  h(async (req) => {
    const { from, to, kind, account, bank_account_id } = req.query;
    const where = [];
    const params = [];
    if (from) where.push('c.date >= ?') && params.push(from);
    if (to) where.push('c.date <= ?') && params.push(to);
    if (kind) where.push('c.kind = ?') && params.push(kind);
    if (account) where.push('(c.from_account = ? OR c.to_account = ?)') && params.push(account, account);
    if (bank_account_id) where.push('(c.from_bank_id = ? OR c.to_bank_id = ?)') && params.push(bank_account_id, bank_account_id);
    return (await all(
      `${CASH_BOOK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY c.date DESC, c.id DESC LIMIT 2000`,
      ...params
    )).map(decorate);
  })
);

r.get(
  '/cash-book/kinds',
  h(async () =>
    Object.entries(CASH_BOOK_KINDS).map(([value, meta]) => ({
      value,
      label: meta.label,
      needs: meta.needs,
    }))
  )
);

r.post(
  '/cash-book',
  h(async (req) => {
    const b = req.body;
    const kind = str(b.kind);
    const meta = CASH_BOOK_KINDS[kind];
    if (!meta) throw bad('Select a valid cash book entry type');

    const amount = r2(b.amount);
    if (amount <= 0) throw bad('Amount must be greater than zero');

    const fromAccount = meta.needs.includes('from_account') ? str(b.from_account) : null;
    const toAccount = meta.needs.includes('to_account') ? str(b.to_account) : null;

    for (const field of meta.needs) {
      const v = field === 'from_account' ? fromAccount : toAccount;
      if (v !== 'cash' && v !== 'bank') {
        throw bad(`${meta.label}: choose a valid ${field === 'from_account' ? 'source' : 'destination'} account (Cash or Bank)`);
      }
    }

    // A bank side always names the actual account the money sits in.
    const fromBankId = fromAccount === 'bank' ? await requireBankAccount(b.from_bank_id, `${meta.label} (from)`) : null;
    const toBankId = toAccount === 'bank' ? await requireBankAccount(b.to_bank_id, `${meta.label} (to)`) : null;

    if (kind === 'transfer') {
      const sameCash = fromAccount === 'cash' && toAccount === 'cash';
      const sameBank = fromAccount === 'bank' && toAccount === 'bank' && fromBankId === toBankId;
      if (sameCash || sameBank) throw bad('A transfer must move money between two different accounts');
    }

    const info = await run(
      `INSERT INTO cash_book (date, kind, from_account, to_account, from_bank_id, to_bank_id, amount, category, reference, note)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      str(b.date) || today(),
      kind,
      fromAccount,
      toAccount,
      fromBankId,
      toBankId,
      amount,
      str(b.category),
      str(b.reference),
      str(b.note)
    );
    const id = Number(info.lastInsertRowid);
    return decorate(await get(`${CASH_BOOK_SELECT} WHERE c.id = ?`, id));
  })
);

r.patch(
  '/cash-book/:id',
  h(async (req) => {
    const existing = await get('SELECT * FROM cash_book WHERE id = ?', num(req.params.id));
    if (!existing) throw notFound();
    const b = req.body;
    const pick = (key) => (b[key] !== undefined ? b[key] : existing[key]);

    const kind = str(pick('kind'));
    const meta = CASH_BOOK_KINDS[kind];
    if (!meta) throw bad('Select a valid cash book entry type');

    const amount = r2(pick('amount'));
    if (amount <= 0) throw bad('Amount must be greater than zero');

    const fromAccount = meta.needs.includes('from_account') ? str(pick('from_account')) : null;
    const toAccount = meta.needs.includes('to_account') ? str(pick('to_account')) : null;

    for (const field of meta.needs) {
      const v = field === 'from_account' ? fromAccount : toAccount;
      if (v !== 'cash' && v !== 'bank') {
        throw bad(`${meta.label}: choose a valid ${field === 'from_account' ? 'source' : 'destination'} account (Cash or Bank)`);
      }
    }

    const fromBankId = fromAccount === 'bank' ? await requireBankAccount(pick('from_bank_id'), `${meta.label} (from)`) : null;
    const toBankId = toAccount === 'bank' ? await requireBankAccount(pick('to_bank_id'), `${meta.label} (to)`) : null;

    if (kind === 'transfer') {
      const sameCash = fromAccount === 'cash' && toAccount === 'cash';
      const sameBank = fromAccount === 'bank' && toAccount === 'bank' && fromBankId === toBankId;
      if (sameCash || sameBank) throw bad('A transfer must move money between two different accounts');
    }

    await run(
      `UPDATE cash_book SET date=?, kind=?, from_account=?, to_account=?, from_bank_id=?, to_bank_id=?, amount=?, category=?, reference=?, note=? WHERE id=?`,
      str(pick('date')) || existing.date,
      kind,
      fromAccount,
      toAccount,
      fromBankId,
      toBankId,
      amount,
      str(pick('category')),
      str(pick('reference')),
      str(pick('note')),
      existing.id
    );
    return decorate(await get(`${CASH_BOOK_SELECT} WHERE c.id = ?`, existing.id));
  })
);

r.delete(
  '/cash-book/:id',
  h(async (req) => {
    if (!(await run('DELETE FROM cash_book WHERE id = ?', num(req.params.id))).changes) throw notFound();
    return { ok: true };
  })
);

export default r;
