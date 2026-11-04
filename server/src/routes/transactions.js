// Sales, purchases and expenses. Sales/purchases automatically write stock
// movements and (optionally) a linked payment, all inside one transaction.
import { Router } from 'express';
import { all, get, run, tx, r2, stockOf, avgCostOf, docNo, getSetting, EXPENSE_GROUPS, normalizeMethod, requireBankAccountId } from '../db.js';
import { h, bad, notFound, num, str, today } from '../utils.js';
import { buildLedger } from './parties.js';

const r = Router();

function filters(q, alias, partyCol) {
  const where = [];
  const params = [];
  if (q.from) where.push(`${alias}.date >= ?`) && params.push(q.from);
  if (q.to) where.push(`${alias}.date <= ?`) && params.push(q.to);
  if (q.party_id) where.push(`${alias}.${partyCol} = ?`) && params.push(q.party_id);
  if (q.product_id) {
    const itemTable = alias === 's' ? 'sale_items' : 'purchase_items';
    const fk = alias === 's' ? 'sale_id' : 'purchase_id';
    where.push(`EXISTS (SELECT 1 FROM ${itemTable} i WHERE i.${fk} = ${alias}.id AND i.product_id = ?)`);
    params.push(q.product_id);
  }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

async function cleanItems(items, priceKey) {
  if (!Array.isArray(items) || !items.length) throw bad('Add at least one item');
  return Promise.all(items.map(async (it, i) => {
    const product = await get('SELECT * FROM products WHERE id = ?', num(it.product_id));
    if (!product) throw bad(`Row ${i + 1}: select a product`);
    const qty = num(it.qty);
    if (qty <= 0) throw bad(`Row ${i + 1}: quantity must be greater than zero`);
    const price = num(it[priceKey]);
    if (price < 0) throw bad(`Row ${i + 1}: price cannot be negative`);
    return { product, qty, price, line: r2(qty * price) };
  }));
}

// ======================= SALES =======================
r.get(
  '/sales',
  h(async (req) => {
    const { where, params } = filters({ ...req.query, party_id: req.query.customer_id }, 's', 'customer_id');
    return (await all(
      `SELECT s.*, c.name AS customer_name,
         COALESCE((SELECT SUM(amount) FROM payments p WHERE p.sale_id = s.id),0) AS paid_on_invoice,
         (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS item_count
       FROM sales s JOIN customers c ON c.id = s.customer_id ${where}
       ORDER BY s.date DESC, s.id DESC LIMIT 2000`,
      ...params
    )).map((s) => ({ ...s, invoice_no: docNo.sale(s.id), profit: r2(s.total - s.cost_total) }));
  })
);

r.get(
  '/sales/:id',
  h(async (req) => {
    const s = await get('SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!s) throw notFound('Sale not found');
    const customer = await get('SELECT * FROM customers WHERE id = ?', s.customer_id);
    const items = await all(
      `SELECT i.*, p.name AS product_name, p.sku, p.unit FROM sale_items i JOIN products p ON p.id = i.product_id WHERE i.sale_id = ? ORDER BY i.id`,
      s.id
    );
    const payments = await all('SELECT * FROM payments WHERE sale_id = ? ORDER BY id', s.id);
    const paid = r2(payments.reduce((a, p) => a + p.amount, 0));

    // Balance context for the invoice, taken from the ledger so it always agrees.
    const ledger = await buildLedger('customer', s.customer_id);
    const idx = ledger.entries.findIndex((e) => e.type === 'sale' && e.doc_id === s.id);
    const previous = idx > 0 ? ledger.entries[idx - 1].balance : ledger.party.opening_balance;

    return {
      ...s,
      invoice_no: docNo.sale(s.id),
      customer,
      items,
      payments,
      paid_on_invoice: paid,
      invoice_due: r2(s.total - paid),
      previous_balance: r2(previous),
      balance_after: r2(previous + s.total - paid),
      current_balance: ledger.current_balance,
    };
  })
);

r.post(
  '/sales',
  h(async (req) => {
    const b = req.body;
    if (!await get('SELECT id FROM customers WHERE id = ?', num(b.customer_id))) throw bad('Select a customer');
    const items = await cleanItems(b.items, 'unit_price');
    const date = str(b.date) || today();

    // Validate stock (aggregate by product so repeated rows are handled).
    const need = {};
    for (const it of items) need[it.product.id] = (need[it.product.id] || 0) + it.qty;
    for (const [pid, q] of Object.entries(need)) {
      const have = await stockOf(pid);
      if (have < q) {
        const p = items.find((i) => i.product.id === Number(pid)).product;
        throw bad(`Not enough stock for "${p.name}". Available: ${r2(have)} ${p.unit}, required: ${q}`);
      }
    }

    const subtotal = r2(items.reduce((a, i) => a + i.line, 0));
    const discount = r2(b.discount);
    const tax = r2(b.tax);
    const total = r2(subtotal - discount + tax);
    if (total < 0) throw bad('Total cannot be negative');
    const paid = r2(b.paid_amount);
    const payMethod = normalizeMethod(b.payment_method);
    if (paid > 0 && !payMethod) throw bad('Select a valid payment method');
    const payBankId = paid > 0 ? await requireBankAccountId(payMethod, b.payment_bank_account_id) : null;

    return await tx(async () => {
      const info = await run(
        `INSERT INTO sales (customer_id,date,subtotal,discount,tax,total,note) VALUES (?,?,?,?,?,?,?)`,
        num(b.customer_id),
        date,
        subtotal,
        discount,
        tax,
        total,
        str(b.note)
      );
      const id = Number(info.lastInsertRowid);
      let costTotal = 0;
      for (const it of items) {
        const unitCost = await avgCostOf(it.product.id);
        costTotal += unitCost * it.qty;
        await run(
          `INSERT INTO sale_items (sale_id,product_id,qty,unit_price,unit_cost,line_total) VALUES (?,?,?,?,?,?)`,
          id,
          it.product.id,
          it.qty,
          it.price,
          unitCost,
          it.line
        );
        await run(
          `INSERT INTO stock_movements (product_id,date,qty,unit_cost,ref_type,ref_id,note) VALUES (?,?,?,?, 'sale', ?, ?)`,
          it.product.id,
          date,
          -it.qty,
          unitCost,
          id,
          `Sold on ${docNo.sale(id)}`
        );
      }
      await run('UPDATE sales SET cost_total = ? WHERE id = ?', r2(costTotal), id);
      if (paid > 0) {
        await run(
          `INSERT INTO payments (party_type,party_id,date,amount,method,bank_account_id,reference,sale_id,note) VALUES ('customer',?,?,?,?,?,?,?,?)`,
          num(b.customer_id),
          date,
          paid,
          payMethod,
          payBankId,
          str(b.payment_reference),
          id,
          'Paid at time of sale'
        );
      }
      return { id, invoice_no: docNo.sale(id) };
    });
  })
);

r.patch(
  '/sales/:id',
  h(async (req) => {
    const s = await get('SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!s) throw notFound();
    const b = req.body;
    const date = b.date !== undefined ? (str(b.date) || s.date) : s.date;
    const note = b.note !== undefined ? str(b.note) : s.note;
    return await tx(async () => {
      await run('UPDATE sales SET date = ?, note = ? WHERE id = ?', date, note, s.id);
      await run(`UPDATE stock_movements SET date = ? WHERE ref_type = 'sale' AND ref_id = ?`, date, s.id);
      await run('UPDATE payments SET date = ? WHERE sale_id = ?', date, s.id);
      return { ok: true, id: s.id };
    });
  })
);

r.delete(
  '/sales/:id',
  h(async (req) => {
    const s = await get('SELECT * FROM sales WHERE id = ?', req.params.id);
    if (!s) throw notFound();
    await tx(async () => {
      await run(`DELETE FROM stock_movements WHERE ref_type = 'sale' AND ref_id = ?`, s.id);
      await run('DELETE FROM payments WHERE sale_id = ?', s.id);
      await run('DELETE FROM sale_items WHERE sale_id = ?', s.id);
      await run('DELETE FROM sales WHERE id = ?', s.id);
    });
    return { ok: true };
  })
);

// ======================= PURCHASES =======================
r.get(
  '/purchases',
  h(async (req) => {
    const { where, params } = filters({ ...req.query, party_id: req.query.vendor_id }, 'pu', 'vendor_id');
    return (await all(
      `SELECT pu.*, v.name AS vendor_name,
         COALESCE((SELECT SUM(amount) FROM payments p WHERE p.purchase_id = pu.id),0) AS paid_on_bill,
         (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = pu.id) AS item_count
       FROM purchases pu JOIN vendors v ON v.id = pu.vendor_id ${where}
       ORDER BY pu.date DESC, pu.id DESC LIMIT 2000`,
      ...params
    )).map((p) => ({ ...p, purchase_no: docNo.purchase(p.id) }));
  })
);

r.get(
  '/purchases/:id',
  h(async (req) => {
    const p = await get('SELECT * FROM purchases WHERE id = ?', req.params.id);
    if (!p) throw notFound('Purchase not found');
    const vendor = await get('SELECT * FROM vendors WHERE id = ?', p.vendor_id);
    const items = await all(
      `SELECT i.*, pr.name AS product_name, pr.sku, pr.unit FROM purchase_items i JOIN products pr ON pr.id = i.product_id WHERE i.purchase_id = ? ORDER BY i.id`,
      p.id
    );
    const payments = await all('SELECT * FROM payments WHERE purchase_id = ? ORDER BY id', p.id);
    const paid = r2(payments.reduce((a, x) => a + x.amount, 0));
    const ledger = await buildLedger('vendor', p.vendor_id);
    const idx = ledger.entries.findIndex((e) => e.type === 'purchase' && e.doc_id === p.id);
    const previous = idx > 0 ? ledger.entries[idx - 1].balance : ledger.party.opening_balance;
    return {
      ...p,
      purchase_no: docNo.purchase(p.id),
      vendor,
      items,
      payments,
      paid_on_bill: paid,
      bill_due: r2(p.total - paid),
      previous_balance: r2(previous),
      balance_after: r2(previous + p.total - paid),
      current_balance: ledger.current_balance,
    };
  })
);

r.post(
  '/purchases',
  h(async (req) => {
    const b = req.body;
    if (!await get('SELECT id FROM vendors WHERE id = ?', num(b.vendor_id))) throw bad('Select a vendor');
    const items = await cleanItems(b.items, 'unit_cost');
    const date = str(b.date) || today();
    const subtotal = r2(items.reduce((a, i) => a + i.line, 0));
    const discount = r2(b.discount);
    const tax = r2(b.tax);
    const total = r2(subtotal - discount + tax);
    if (total < 0) throw bad('Total cannot be negative');
    const paid = r2(b.paid_amount);
    const payMethod = normalizeMethod(b.payment_method);
    if (paid > 0 && !payMethod) throw bad('Select a valid payment method');
    const payBankId = paid > 0 ? await requireBankAccountId(payMethod, b.payment_bank_account_id) : null;
    // Spread discount/tax proportionally into landed unit cost for accurate inventory valuation.
    const factor = subtotal > 0 ? total / subtotal : 1;

    return await tx(async () => {
      const info = await run(
        `INSERT INTO purchases (vendor_id,date,vendor_bill_no,subtotal,discount,tax,total,note) VALUES (?,?,?,?,?,?,?,?)`,
        num(b.vendor_id),
        date,
        str(b.vendor_bill_no),
        subtotal,
        discount,
        tax,
        total,
        str(b.note)
      );
      const id = Number(info.lastInsertRowid);
      for (const it of items) {
        await run(
          `INSERT INTO purchase_items (purchase_id,product_id,qty,unit_cost,line_total) VALUES (?,?,?,?,?)`,
          id,
          it.product.id,
          it.qty,
          it.price,
          it.line
        );
        await run(
          `INSERT INTO stock_movements (product_id,date,qty,unit_cost,ref_type,ref_id,note) VALUES (?,?,?,?, 'purchase', ?, ?)`,
          it.product.id,
          date,
          it.qty,
          r2(it.price * factor),
          id,
          `Purchased on ${docNo.purchase(id)}`
        );
      }
      if (paid > 0) {
        await run(
          `INSERT INTO payments (party_type,party_id,date,amount,method,bank_account_id,reference,purchase_id,note) VALUES ('vendor',?,?,?,?,?,?,?,?)`,
          num(b.vendor_id),
          date,
          paid,
          payMethod,
          payBankId,
          str(b.payment_reference),
          id,
          'Paid at time of purchase'
        );
      }
      return { id, purchase_no: docNo.purchase(id) };
    });
  })
);

r.patch(
  '/purchases/:id',
  h(async (req) => {
    const p = await get('SELECT * FROM purchases WHERE id = ?', req.params.id);
    if (!p) throw notFound();
    const b = req.body;
    const date = b.date !== undefined ? (str(b.date) || p.date) : p.date;
    const billNo = b.vendor_bill_no !== undefined ? str(b.vendor_bill_no) : p.vendor_bill_no;
    const note = b.note !== undefined ? str(b.note) : p.note;
    return await tx(async () => {
      await run('UPDATE purchases SET date = ?, vendor_bill_no = ?, note = ? WHERE id = ?', date, billNo, note, p.id);
      await run(`UPDATE stock_movements SET date = ? WHERE ref_type = 'purchase' AND ref_id = ?`, date, p.id);
      await run('UPDATE payments SET date = ? WHERE purchase_id = ?', date, p.id);
      return { ok: true, id: p.id };
    });
  })
);

r.delete(
  '/purchases/:id',
  h(async (req) => {
    const p = await get('SELECT * FROM purchases WHERE id = ?', req.params.id);
    if (!p) throw notFound();
    const items = await all('SELECT product_id, SUM(qty) q FROM purchase_items WHERE purchase_id = ? GROUP BY product_id', p.id);
    for (const it of items) {
      if (await stockOf(it.product_id) - it.q < -0.0001) {
        const name = (await get('SELECT name FROM products WHERE id = ?', it.product_id)).name;
        throw bad(`Cannot delete: stock of "${name}" from this purchase has already been used/sold.`);
      }
    }
    await tx(async () => {
      await run(`DELETE FROM stock_movements WHERE ref_type = 'purchase' AND ref_id = ?`, p.id);
      await run('DELETE FROM payments WHERE purchase_id = ?', p.id);
      await run('DELETE FROM purchase_items WHERE purchase_id = ?', p.id);
      await run('DELETE FROM purchases WHERE id = ?', p.id);
    });
    return { ok: true };
  })
);

// ======================= EXPENSES =======================
r.get(
  '/expenses',
  h(async (req) => {
    const { from, to, category, group } = req.query;
    const where = [];
    const params = [];
    if (from) where.push('e.date >= ?') && params.push(from);
    if (to) where.push('e.date <= ?') && params.push(to);
    if (category) where.push('e.category = ?') && params.push(category);
    if (group) where.push('COALESCE(c.group_name, ?) = ?') && params.push('Other Expense', group);
    return (await all(
      `SELECT e.*, COALESCE(c.group_name, 'Other Expense') AS group_name
       FROM expenses e LEFT JOIN expense_categories c ON c.name = e.category
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY e.date DESC, e.id DESC LIMIT 2000`,
      ...params
    )).map((e) => ({ ...e, ref: docNo.expense(e.id) }));
  })
);

r.get(
  '/expense-categories',
  h(async () => {
    const rows = await all(
      'SELECT id, name, group_name, sort FROM expense_categories WHERE active = 1 ORDER BY sort, name'
    );
    // Categories typed before they existed in the table still need to be selectable.
    const known = new Set(rows.map((c) => c.name));
    const orphans = (await all('SELECT DISTINCT category AS name FROM expenses WHERE category IS NOT NULL'))
      .filter((x) => !known.has(x.name))
      .map((x) => ({ id: null, name: x.name, group_name: 'Other Expense', sort: 999 }));
    return [...rows, ...orphans];
  })
);

r.post(
  '/expense-categories',
  h(async (req) => {
    const name = str(req.body.name);
    if (!name) throw bad('Category name is required');
    const group = str(req.body.group_name) || 'Other Expense';
    if (!EXPENSE_GROUPS.includes(group)) throw bad('Unknown expense group');
    if (await get('SELECT id FROM expense_categories WHERE LOWER(name) = LOWER(?)', name))
      throw bad(`Category "${name}" already exists`);
    const info = await run(
      'INSERT INTO expense_categories (name, group_name, sort) VALUES (?,?,?)',
      name,
      group,
      num(req.body.sort, 500)
    );
    return await get('SELECT id, name, group_name, sort FROM expense_categories WHERE id = ?', Number(info.lastInsertRowid));
  })
);

r.get('/expense-groups', h(async () => EXPENSE_GROUPS));

r.delete(
  '/expense-categories/:id',
  h(async (req) => {
    const cat = await get('SELECT * FROM expense_categories WHERE id = ?', num(req.params.id));
    if (!cat) throw notFound('Category not found');
    const used = (await get('SELECT COUNT(*) AS c FROM expenses WHERE category = ?', cat.name)).c;
    // Keep the name resolvable for existing expenses; just take it out of the picker.
    if (used) await run('UPDATE expense_categories SET active = 0 WHERE id = ?', cat.id);
    else await run('DELETE FROM expense_categories WHERE id = ?', cat.id);
    return { ok: true, deactivated: Boolean(used) };
  })
);

r.post(
  '/expenses',
  h(async (req) => {
    const b = req.body;
    if (!str(b.category)) throw bad('Category is required');
    if (num(b.amount) <= 0) throw bad('Amount must be greater than zero');
    const method = normalizeMethod(b.method);
    if (!method) throw bad('Select a valid payment method');
    const bankId = await requireBankAccountId(method, b.bank_account_id);
    const info = await run(
      'INSERT INTO expenses (date,category,amount,method,bank_account_id,note) VALUES (?,?,?,?,?,?)',
      str(b.date) || today(),
      str(b.category),
      r2(b.amount),
      method,
      bankId,
      str(b.note)
    );
    return { id: Number(info.lastInsertRowid) };
  })
);

r.delete(
  '/expenses/:id',
  h(async (req) => {
    if (!(await run('DELETE FROM expenses WHERE id = ?', req.params.id)).changes) throw notFound();
    return { ok: true };
  })
);

export default r;
