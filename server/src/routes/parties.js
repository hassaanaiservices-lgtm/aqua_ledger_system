// Customers, vendors, their ledgers and payments.
// Customer balance = opening + sales - payments received  (positive => customer owes us)
// Vendor balance   = opening + purchases - payments made  (positive => we owe vendor)
import { Router } from 'express';
import { all, get, run, tx, r2, CUSTOMER_BAL_SQL, VENDOR_BAL_SQL, customerBalance, vendorBalance, docNo, saleNo, purchaseNo, normalizeMethod, requireBankAccountId, PAYMENT_METHODS } from '../db.js';
import { h, bad, notFound, num, str, today } from '../utils.js';

const r = Router();

const CFG = {
  customer: {
    table: 'customers',
    listSql: CUSTOMER_BAL_SQL,
    alias: 'c',
    docTable: 'sales',
    docFk: 'customer_id',
    docType: 'sale',
    docLabel: 'Sale',
    extra: 'cnic',
    balance: customerBalance,
  },
  vendor: {
    table: 'vendors',
    listSql: VENDOR_BAL_SQL,
    alias: 'v',
    docTable: 'purchases',
    docFk: 'vendor_id',
    docType: 'purchase',
    docLabel: 'Purchase',
    extra: 'ntn',
    balance: vendorBalance,
  },
};

/**
 * Builds a ledger with running balance.
 * Each entry: { date, type, ref, doc_id, description, charge, payment, balance }
 * charge  = increases balance (sale for customer / purchase for vendor)
 * payment = decreases balance (payment received / payment made)
 */
export async function buildLedger(kind, id, from, to) {
  const c = CFG[kind];
  const party = await get(`SELECT * FROM ${c.table} WHERE id = ?`, id);
  if (!party) throw notFound();

  const docs = await all(
    `SELECT id, date, total, note, created_at ${kind === 'vendor' ? ', vendor_bill_no' : ''},
       (SELECT COUNT(*) FROM ${kind === 'customer' ? 'sale_items' : 'purchase_items'} i WHERE i.${kind === 'customer' ? 'sale_id' : 'purchase_id'} = d.id) AS item_count
     FROM ${c.docTable} d WHERE ${c.docFk} = ?`,
    id
  );
  const pays = await all(
    `SELECT p.*, b.name AS bank_name, b.owner_name AS bank_owner FROM payments p
     LEFT JOIN bank_accounts b ON b.id = p.bank_account_id
     WHERE p.party_type = ? AND p.party_id = ?`,
    kind,
    id
  );
  // The ledger names where the money went, nothing else: free-text notes go
  // stale when the method is changed later, so they ride along separately.
  const payLabel = (p) =>
    p.method === 'bank' && p.bank_name
      ? (p.bank_owner ? `${p.bank_name} (${p.bank_owner})` : p.bank_name)
      : PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method;

  const docKey = {};
  for (const d of docs) docKey[d.id] = `${d.date} ${d.created_at} a${String(d.id).padStart(8, '0')}`;
  const linkedId = (p) => (kind === 'customer' ? p.sale_id : p.purchase_id);

  let entries = [
    ...docs.map((d) => ({
      date: d.date,
      sort: docKey[d.id],
      type: c.docType,
      doc_id: d.id,
      ref: kind === 'customer' ? saleNo(d) : purchaseNo(d),
      description:
        `${d.total < 0 ? `${c.docLabel} Return` : c.docLabel} (${d.item_count} item${d.item_count === 1 ? '' : 's'})` +
        (d.vendor_bill_no ? ` · Bill #${d.vendor_bill_no}` : '') +
        (d.note ? ` · ${d.note}` : ''),
      charge: r2(d.total),
      payment: 0,
    })),
    ...pays.map((p) => ({
      date: p.date,
      // payments made with an invoice sort right after that invoice
      sort: linkedId(p) && docKey[linkedId(p)]
        ? `${docKey[linkedId(p)]} b${String(p.id).padStart(8, '0')}`
        : `${p.date} ${p.created_at} c${String(p.id).padStart(8, '0')}`,
      type: 'payment',
      doc_id: p.id,
      ref: docNo.payment(p.id),
      method: p.method,
      bank_account_id: p.bank_account_id,
      linked_ref: p.sale_id ? docNo.sale(p.sale_id) : p.purchase_id ? docNo.purchase(p.purchase_id) : null,
      description:
        payLabel(p) +
        (p.reference ? ` · Ref ${p.reference}` : '') +
        (p.sale_id ? ` · against ${docNo.sale(p.sale_id)}` : '') +
        (p.purchase_id ? ` · against ${docNo.purchase(p.purchase_id)}` : ''),
      note: p.note,
      charge: 0,
      payment: r2(p.amount),
    })),
  ].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));

  let bal = party.opening_balance;
  // Entries before `from` roll up into the opening line.
  const before = from ? entries.filter((e) => e.date < from) : [];
  for (const e of before) bal += e.charge - e.payment;
  entries = entries.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));

  const opening = r2(bal);
  let totalCharge = 0;
  let totalPayment = 0;
  for (const e of entries) {
    bal += e.charge - e.payment;
    e.balance = r2(bal);
    totalCharge += e.charge;
    totalPayment += e.payment;
    delete e.sort;
  }
  return {
    party,
    from: from || null,
    to: to || null,
    opening_balance: opening,
    entries,
    total_charge: r2(totalCharge),
    total_payment: r2(totalPayment),
    closing_balance: r2(bal),
    current_balance: r2(await c.balance(id)),
  };
}

for (const kind of ['customer', 'vendor']) {
  const c = CFG[kind];
  const base = `/${c.table}`;

  r.get(
    base,
    h(async (req) => {
      const { q, due } = req.query;
      let rows = await all(
        `SELECT * FROM (${c.listSql}) x ${q ? 'WHERE x.name LIKE ? OR x.phone LIKE ?' : ''} ORDER BY x.name`,
        ...(q ? [`%${q}%`, `%${q}%`] : [])
      );
      if (due === '1') rows = rows.filter((x) => x.balance > 0.004);
      return rows.map((x) => ({ ...x, balance: r2(x.balance) }));
    })
  );

  r.get(
    `${base}/:id`,
    h(async (req) => {
      const row = await get(`SELECT * FROM (${c.listSql}) x WHERE x.id = ?`, req.params.id);
      if (!row) throw notFound();
      return { ...row, balance: r2(row.balance) };
    })
  );

  r.get(
    `${base}/:id/ledger`,
    h(async (req) => buildLedger(kind, req.params.id, req.query.from, req.query.to))
  );

  const fields = (b) => {
    if (!str(b.name)) throw bad('Name is required');
    return [str(b.name), str(b.phone), str(b.email), str(b.address), str(b[c.extra]), num(b.opening_balance), str(b.notes)];
  };

  r.post(
    base,
    h(async (req) => {
      const info = await run(
        `INSERT INTO ${c.table} (name,phone,email,address,${c.extra},opening_balance,notes) VALUES (?,?,?,?,?,?,?)`,
        ...fields(req.body)
      );
      return { id: Number(info.lastInsertRowid) };
    })
  );

  r.put(
    `${base}/:id`,
    h(async (req) => {
      if (!await get(`SELECT id FROM ${c.table} WHERE id = ?`, req.params.id)) throw notFound();
      await run(
        `UPDATE ${c.table} SET name=?,phone=?,email=?,address=?,${c.extra}=?,opening_balance=?,notes=? WHERE id=?`,
        ...fields(req.body),
        req.params.id
      );
      return { ok: true };
    })
  );

  r.delete(
    `${base}/:id`,
    h(async (req) => {
      const id = req.params.id;
      const n =
        (await get(`SELECT COUNT(*) c FROM ${c.docTable} WHERE ${c.docFk} = ?`, id)).c +
        (await get(`SELECT COUNT(*) c FROM payments WHERE party_type = ? AND party_id = ?`, kind, id)).c;
      if (n > 0) throw bad(`Cannot delete: this ${kind} has ${n} recorded transaction(s).`);
      await run(`DELETE FROM ${c.table} WHERE id = ?`, id);
      return { ok: true };
    })
  );
}

// ---- Payments ----
r.get(
  '/payments',
  h(async (req) => {
    const { party_type, party_id, from, to } = req.query;
    const where = [];
    const params = [];
    if (party_type) where.push('p.party_type = ?') && params.push(party_type);
    if (party_id) where.push('p.party_id = ?') && params.push(party_id);
    if (from) where.push('p.date >= ?') && params.push(from);
    if (to) where.push('p.date <= ?') && params.push(to);
    return (await all(
      `SELECT p.*, CASE p.party_type WHEN 'customer' THEN c.name ELSE v.name END AS party_name
       FROM payments p
       LEFT JOIN customers c ON p.party_type='customer' AND c.id = p.party_id
       LEFT JOIN vendors v ON p.party_type='vendor' AND v.id = p.party_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.date DESC, p.id DESC LIMIT 2000`,
      ...params
    )).map((p) => ({ ...p, ref: docNo.payment(p.id) }));
  })
);

r.post(
  '/payments',
  h(async (req) => {
    const b = req.body;
    const kind = b.party_type;
    if (!CFG[kind]) throw bad('Invalid party type');
    if (!await get(`SELECT id FROM ${CFG[kind].table} WHERE id = ?`, b.party_id)) throw bad(`Select a ${kind}`);
    const amount = r2(b.amount);
    if (amount <= 0) throw bad('Amount must be greater than zero');
    const method = normalizeMethod(b.method);
    if (!method) throw bad('Select a valid payment method');
    const bankId = await requireBankAccountId(method, b.bank_account_id);
    const info = await run(
      `INSERT INTO payments (party_type,party_id,date,amount,method,bank_account_id,reference,note) VALUES (?,?,?,?,?,?,?,?)`,
      kind,
      num(b.party_id),
      str(b.date) || today(),
      amount,
      method,
      bankId,
      str(b.reference),
      str(b.note)
    );
    return { id: Number(info.lastInsertRowid) };
  })
);

r.put(
  '/payments/:id',
  h(async (req) => {
    const p = await get('SELECT * FROM payments WHERE id = ?', req.params.id);
    if (!p) throw notFound('Payment not found');
    const b = req.body;
    const amount = b.amount !== undefined ? r2(b.amount) : p.amount;
    if (amount <= 0) throw bad('Amount must be greater than zero');
    const date = b.date !== undefined ? (str(b.date) || p.date) : p.date;
    const method = b.method !== undefined ? normalizeMethod(b.method, p.method) : p.method;
    if (!method) throw bad('Select a valid payment method');
    const reference = b.reference !== undefined ? str(b.reference) : p.reference;
    const note = b.note !== undefined ? str(b.note) : p.note;

    const bankId = await requireBankAccountId(
      method,
      b.bank_account_id !== undefined ? b.bank_account_id : p.bank_account_id
    );
    await run(
      `UPDATE payments SET date = ?, amount = ?, method = ?, bank_account_id = ?, reference = ?, note = ? WHERE id = ?`,
      date,
      amount,
      method,
      bankId,
      reference,
      note,
      p.id
    );
    return { ok: true, id: p.id };
  })
);

r.patch(
  '/:table(customers|vendors)/:id/opening-balance',
  h(async (req) => {
    const table = req.params.table;
    const row = await get(`SELECT id FROM ${table} WHERE id = ?`, req.params.id);
    if (!row) throw notFound();
    const bal = r2(req.body.opening_balance);
    await run(`UPDATE ${table} SET opening_balance = ? WHERE id = ?`, bal, req.params.id);
    return { ok: true, opening_balance: bal };
  })
);

r.delete(
  '/payments/:id',
  h(async (req) => {
    const info = await run('DELETE FROM payments WHERE id = ?', req.params.id);
    if (!info.changes) throw notFound();
    return { ok: true };
  })
);

export default r;
