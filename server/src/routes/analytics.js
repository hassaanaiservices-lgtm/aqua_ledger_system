// Dashboard analytics, calendar activity feed and reports.
import { Router } from 'express';
import { all, get, r2, PRODUCT_STOCK_SQL, CUSTOMER_BAL_SQL, VENDOR_BAL_SQL, docNo } from '../db.js';
import { h, bad, today, periodRange, buckets, addDays, startOfMonth, endOfMonth } from '../utils.js';

const r = Router();

// ---------- unified activity feed ----------
const ACTIVITY_SQL = `
  SELECT 'sale' AS type, s.id, s.date, s.created_at, c.name AS party, s.total AS amount, NULL AS qty,
         (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) || ' item(s)' AS detail, s.customer_id AS party_id
    FROM sales s JOIN customers c ON c.id = s.customer_id
  UNION ALL
  SELECT 'purchase', pu.id, pu.date, pu.created_at, v.name, pu.total, NULL,
         (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = pu.id) || ' item(s)' ||
         COALESCE(' · Bill #' || pu.vendor_bill_no, ''), pu.vendor_id
    FROM purchases pu JOIN vendors v ON v.id = pu.vendor_id
  UNION ALL
  SELECT CASE p.party_type WHEN 'customer' THEN 'payment_in' ELSE 'payment_out' END, p.id, p.date, p.created_at,
         COALESCE(c.name, v.name), p.amount, NULL, p.method || COALESCE(' · ' || p.reference, '') || COALESCE(' · ' || p.note, ''), p.party_id
    FROM payments p
    LEFT JOIN customers c ON p.party_type = 'customer' AND c.id = p.party_id
    LEFT JOIN vendors v ON p.party_type = 'vendor' AND v.id = p.party_id
  UNION ALL
  SELECT 'expense', e.id, e.date, e.created_at, e.category, e.amount, NULL, COALESCE(e.note, e.method), NULL FROM expenses e
  UNION ALL
  SELECT 'assembly', a.id, a.date, a.created_at, pr.name, a.total_cost, a.qty,
         a.qty || ' ' || pr.unit || ' @ ' || printf('%.2f', a.unit_cost) || '/unit', a.product_id
    FROM assemblies a JOIN products pr ON pr.id = a.product_id
  UNION ALL
  SELECT 'stock', m.id, m.date, m.created_at, pr.name, ABS(m.qty * m.unit_cost), m.qty,
         CASE m.ref_type WHEN 'opening' THEN 'Opening stock' ELSE 'Adjustment' END || COALESCE(' · ' || m.note, ''), m.product_id
    FROM stock_movements m JOIN products pr ON pr.id = m.product_id WHERE m.ref_type IN ('adjustment','opening')
`;

const refFor = (type, id) =>
  ({
    sale: docNo.sale,
    purchase: docNo.purchase,
    payment_in: docNo.payment,
    payment_out: docNo.payment,
    expense: docNo.expense,
    assembly: docNo.assembly,
    stock: docNo.adjustment,
  })[type]?.(id) ?? String(id);

async function activities(from, to, types, q) {
  const where = ['date >= ?', 'date <= ?'];
  const params = [from, to];
  if (types?.length) {
    where.push(`type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  if (q) {
    where.push('(party LIKE ? OR detail LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  return (await all(
    `SELECT * FROM (${ACTIVITY_SQL}) WHERE ${where.join(' AND ')} ORDER BY date DESC, created_at DESC, id DESC LIMIT 5000`,
    ...params
  )).map((a) => ({ ...a, amount: r2(a.amount), ref: refFor(a.type, a.id) }));
}

const MOVE_REF = {
  sale: docNo.sale,
  purchase: docNo.purchase,
  assembly_in: docNo.assembly,
  assembly_out: docNo.assembly,
  adjustment: docNo.adjustment,
  opening: docNo.adjustment,
};
const MOVE_LABEL = {
  sale: 'Sale',
  purchase: 'Purchase',
  assembly_in: 'Assembly output',
  assembly_out: 'Assembly consumption',
  adjustment: 'Adjustment',
  opening: 'Opening stock',
};

async function movements(from, to, extraWhere = '', extraParams = []) {
  return (await all(
    `SELECT m.*, p.name AS product_name, p.unit FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE m.date >= ? AND m.date <= ? ${extraWhere} ORDER BY m.date DESC, m.id DESC LIMIT 5000`,
    from,
    to,
    ...extraParams
  )).map((m) => ({
    ...m,
    ref: (MOVE_REF[m.ref_type] || ((x) => x))(m.ref_id ?? m.id),
    label: MOVE_LABEL[m.ref_type] || m.ref_type,
  }));
}

r.get(
  '/activity',
  h(async (req) => {
    const from = req.query.from || req.query.date || today();
    const to = req.query.to || req.query.date || from;
    const types = req.query.types ? String(req.query.types).split(',') : null;
    const list = await activities(from, to, types, req.query.q);
    const summary = {};
    for (const a of list) {
      summary[a.type] ??= { count: 0, amount: 0 };
      summary[a.type].count++;
      summary[a.type].amount = r2(summary[a.type].amount + a.amount);
    }
    return { from, to, activities: list, summary, stock_movements: await movements(from, to) };
  })
);

r.get(
  '/calendar',
  h(async (req) => {
    const month = req.query.month || today().slice(0, 7);
    const from = startOfMonth(`${month}-01`);
    const to = endOfMonth(from);
    const rows = await all(
      `SELECT date, type, COUNT(*) AS count, SUM(amount) AS amount FROM (${ACTIVITY_SQL})
       WHERE date >= ? AND date <= ? GROUP BY date, type`,
      from,
      to
    );
    const days = {};
    for (const row of rows) {
      days[row.date] ??= { total: 0, types: {} };
      days[row.date].types[row.type] = { count: row.count, amount: r2(row.amount) };
      days[row.date].total += row.count;
    }
    // stock movements from documents (sales/purchases/assembly) also count as stock changes
    const moves = await all(
      `SELECT date, COUNT(*) c FROM stock_movements WHERE date >= ? AND date <= ? GROUP BY date`,
      from,
      to
    );
    for (const m of moves) {
      days[m.date] ??= { total: 0, types: {} };
      days[m.date].stock_moves = m.c;
    }
    return { month, from, to, days };
  })
);

// ---------- dashboard ----------
async function periodTotals(from, to) {
  const s = await get(
    `SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(cost_total),0) cost, COALESCE(SUM(discount),0) disc
     FROM sales WHERE date BETWEEN ? AND ?`,
    from,
    to
  );
  const p = await get(`SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM purchases WHERE date BETWEEN ? AND ?`, from, to);
  const e = await get(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM expenses WHERE date BETWEEN ? AND ?`, from, to);
  const a = await get(
    `SELECT COUNT(*) n, COALESCE(SUM(total_cost),0) total, COALESCE(SUM(qty),0) qty, COALESCE(SUM(labor_cost),0) labor,
       COALESCE(SUM(material_cost),0) material, COALESCE(SUM(other_cost),0) other
     FROM assemblies WHERE date BETWEEN ? AND ?`,
    from,
    to
  );
  const pin = (await get(
    `SELECT COALESCE(SUM(amount),0) t FROM payments WHERE party_type='customer' AND date BETWEEN ? AND ?`,
    from,
    to
  )).t;
  const pout = (await get(
    `SELECT COALESCE(SUM(amount),0) t FROM payments WHERE party_type='vendor' AND date BETWEEN ? AND ?`,
    from,
    to
  )).t;
  const gross = s.total - s.cost;
  return {
    sales: r2(s.total),
    sales_count: s.n,
    cogs: r2(s.cost),
    gross_profit: r2(gross),
    purchases: r2(p.total),
    purchases_count: p.n,
    expenses: r2(e.total),
    expenses_count: e.n,
    assembly_cost: r2(a.total),
    assembly_count: a.n,
    assembly_units: r2(a.qty),
    assembly_material: r2(a.material),
    assembly_labor: r2(a.labor),
    assembly_other: r2(a.other),
    received: r2(pin),
    paid: r2(pout),
    // Assembly labor/other are capitalised into product cost, so they hit P&L via COGS when sold.
    net_profit: r2(gross - e.total),
    cash_flow: r2(pin - pout - e.total),
  };
}

r.get(
  '/dashboard',
  h(async (req) => {
    const period = ['day', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
    const date = req.query.date || today();
    const range = periodRange(period, date);
    const prevRange = periodRange(period, addDays(range.from, -1));
    const [current, previous] = await Promise.all([
      periodTotals(range.from, range.to),
      periodTotals(prevRange.from, prevRange.to),
    ]);

    const products = await all(`${PRODUCT_STOCK_SQL} WHERE p.active = 1`);
    const inv = { value: 0, raw: 0, finished: 0, trading: 0, units: 0, items: products.length, out_of_stock: 0 };
    const lowStock = [];
    for (const p of products) {
      const v = Math.max(p.stock, 0) * p.avg_cost;
      inv.value += v;
      inv[p.type] += v;
      inv.units += Math.max(p.stock, 0);
      if (p.stock <= 0) inv.out_of_stock++;
      if (p.reorder_level > 0 && p.stock <= p.reorder_level)
        lowStock.push({ id: p.id, name: p.name, stock: r2(p.stock), reorder_level: p.reorder_level, unit: p.unit });
    }
    for (const k of ['value', 'raw', 'finished', 'trading', 'units']) inv[k] = r2(inv[k]);

    const customers = await all(CUSTOMER_BAL_SQL);
    const vendors = await all(VENDOR_BAL_SQL);
    const receivable = r2(customers.reduce((a, c) => a + Math.max(c.balance, 0), 0));
    const payable = r2(vendors.reduce((a, v) => a + Math.max(v.balance, 0), 0));
    const topDebtors = customers
      .filter((c) => c.balance > 0.004)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 6)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone, balance: r2(c.balance) }));
    const topCreditors = vendors
      .filter((v) => v.balance > 0.004)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 6)
      .map((v) => ({ id: v.id, name: v.name, phone: v.phone, balance: r2(v.balance) }));

    const topProducts = (await all(
      `SELECT p.id, p.name, p.unit, SUM(i.qty) qty, SUM(i.line_total) revenue, SUM(i.line_total - i.unit_cost*i.qty) profit
       FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN products p ON p.id = i.product_id
       WHERE s.date BETWEEN ? AND ? GROUP BY p.id ORDER BY revenue DESC LIMIT 6`,
      range.from,
      range.to
    )).map((x) => ({ ...x, qty: r2(x.qty), revenue: r2(x.revenue), profit: r2(x.profit) }));

    // chart series
    const bks = buckets(period, date);
    const sFrom = bks[0].from;
    const sTo = bks[bks.length - 1].to;
    const daily = (sql) => all(sql, sFrom, sTo);
    const [salesDaily, purchasesDaily, expensesDaily, assemblyDaily] = await Promise.all([
      daily(`SELECT date, SUM(total) v, SUM(total - cost_total) g FROM sales WHERE date BETWEEN ? AND ? GROUP BY date`),
      daily(`SELECT date, SUM(total) v FROM purchases WHERE date BETWEEN ? AND ? GROUP BY date`),
      daily(`SELECT date, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date`),
      daily(`SELECT date, SUM(total_cost) v FROM assemblies WHERE date BETWEEN ? AND ? GROUP BY date`),
    ]);
    const maps = { sales: salesDaily, purchases: purchasesDaily, expenses: expensesDaily, assembly: assemblyDaily };
    const series = bks.map((b) => {
      const row = { label: b.label, from: b.from, to: b.to };
      for (const [k, rows] of Object.entries(maps)) {
        row[k] = r2(rows.filter((x) => x.date >= b.from && x.date <= b.to).reduce((a, x) => a + x.v, 0));
      }
      row.profit = r2(maps.sales.filter((x) => x.date >= b.from && x.date <= b.to).reduce((a, x) => a + x.g, 0));
      return row;
    });

    const expenseBreakdown = (await all(
      `SELECT category, SUM(amount) amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`,
      range.from,
      range.to
    )).map((x) => ({ ...x, amount: r2(x.amount) }));

    return {
      period,
      date,
      range,
      prev_range: prevRange,
      current,
      previous,
      inventory: inv,
      receivable,
      payable,
      net_position: r2(inv.value + receivable - payable),
      counts: {
        customers: customers.length,
        vendors: vendors.length,
        products: products.length,
      },
      low_stock: lowStock.sort((a, b) => a.stock - b.stock).slice(0, 8),
      low_stock_count: lowStock.length,
      top_debtors: topDebtors,
      top_creditors: topCreditors,
      top_products: topProducts,
      expense_breakdown: expenseBreakdown,
      series,
      recent: (await activities('0000-01-01', '9999-12-31')).slice(0, 10),
    };
  })
);

// ---------- reports ----------
const col = (key, label, type = 'text') => ({ key, label, type });
const sumCols = (rows, keys) => Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((a, x) => a + (Number(x[k]) || 0), 0))]));

const REPORTS = {
  inventory: async (q) => {
    const where = ['p.active = 1'];
    const params = [];
    if (q.product_type) where.push('p.type = ?') && params.push(q.product_type);
    if (q.product_id) where.push('p.id = ?') && params.push(q.product_id);
    if (q.q) where.push('(p.name LIKE ? OR p.sku LIKE ?)') && params.push(`%${q.q}%`, `%${q.q}%`);
    const rows = (await all(`${PRODUCT_STOCK_SQL} WHERE ${where.join(' AND ')} ORDER BY p.type, p.name`, ...params)).map((p) => ({
      sku: p.sku || '',
      name: p.name,
      type: p.type,
      category: p.category || '',
      unit: p.unit,
      stock: r2(p.stock),
      avg_cost: r2(p.avg_cost),
      value: r2(Math.max(p.stock, 0) * p.avg_cost),
      sale_price: r2(p.sale_price),
      reorder_level: p.reorder_level,
      status: p.stock <= 0 ? 'Out of stock' : p.reorder_level > 0 && p.stock <= p.reorder_level ? 'Low' : 'OK',
    }));
    return {
      title: 'Inventory Valuation',
      dated: false,
      columns: [
        col('sku', 'SKU'), col('name', 'Product'), col('type', 'Type'), col('category', 'Category'), col('unit', 'Unit'),
        col('stock', 'Stock', 'number'), col('avg_cost', 'Avg Cost', 'money'), col('value', 'Stock Value', 'money'),
        col('sale_price', 'Sale Price', 'money'), col('reorder_level', 'Reorder Lvl', 'number'), col('status', 'Status'),
      ],
      rows,
      totals: sumCols(rows, ['stock', 'value']),
    };
  },

  sales: async (q) => {
    const where = ['s.date BETWEEN ? AND ?'];
    const params = [q.from, q.to];
    if (q.customer_id) where.push('s.customer_id = ?') && params.push(q.customer_id);
    if (q.product_id)
      where.push('EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.product_id = ?)') && params.push(q.product_id);
    const rows = (await all(
      `SELECT s.*, c.name customer, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.sale_id = s.id),0) paid,
         (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) items
       FROM sales s JOIN customers c ON c.id = s.customer_id WHERE ${where.join(' AND ')} ORDER BY s.date, s.id`,
      ...params
    )).map((s) => ({
      date: s.date, ref: docNo.sale(s.id), id: s.id, customer: s.customer, items: s.items, subtotal: s.subtotal, discount: s.discount,
      tax: s.tax, total: s.total, paid: r2(s.paid), due: r2(s.total - s.paid), cost: r2(s.cost_total), profit: r2(s.total - s.cost_total),
    }));
    return {
      title: 'Sales Report',
      columns: [
        col('date', 'Date', 'date'), col('ref', 'Invoice #'), col('customer', 'Customer'), col('items', 'Items', 'number'),
        col('subtotal', 'Subtotal', 'money'), col('discount', 'Discount', 'money'), col('tax', 'Tax', 'money'), col('total', 'Total', 'money'),
        col('paid', 'Paid on Inv.', 'money'), col('due', 'Unpaid', 'money'), col('cost', 'Cost', 'money'), col('profit', 'Profit', 'money'),
      ],
      rows,
      totals: sumCols(rows, ['items', 'subtotal', 'discount', 'tax', 'total', 'paid', 'due', 'cost', 'profit']),
    };
  },

  'sales-items': async (q) => {
    const where = ['s.date BETWEEN ? AND ?'];
    const params = [q.from, q.to];
    if (q.customer_id) where.push('s.customer_id = ?') && params.push(q.customer_id);
    if (q.product_id) where.push('i.product_id = ?') && params.push(q.product_id);
    const rows = (await all(
      `SELECT s.date, s.id sid, c.name customer, p.name product, p.unit, i.qty, i.unit_price, i.line_total, i.unit_cost
       FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN customers c ON c.id = s.customer_id JOIN products p ON p.id = i.product_id
       WHERE ${where.join(' AND ')} ORDER BY s.date, s.id`,
      ...params
    )).map((x) => ({
      date: x.date, ref: docNo.sale(x.sid), customer: x.customer, product: x.product, qty: x.qty, unit: x.unit,
      unit_price: x.unit_price, total: x.line_total, cost: r2(x.unit_cost * x.qty), profit: r2(x.line_total - x.unit_cost * x.qty),
    }));
    return {
      title: 'Sales by Product (Line Items)',
      columns: [
        col('date', 'Date', 'date'), col('ref', 'Invoice #'), col('customer', 'Customer'), col('product', 'Product'),
        col('qty', 'Qty', 'number'), col('unit', 'Unit'), col('unit_price', 'Rate', 'money'), col('total', 'Amount', 'money'),
        col('cost', 'Cost', 'money'), col('profit', 'Profit', 'money'),
      ],
      rows,
      totals: sumCols(rows, ['qty', 'total', 'cost', 'profit']),
    };
  },

  purchases: async (q) => {
    const where = ['pu.date BETWEEN ? AND ?'];
    const params = [q.from, q.to];
    if (q.vendor_id) where.push('pu.vendor_id = ?') && params.push(q.vendor_id);
    if (q.product_id)
      where.push('EXISTS (SELECT 1 FROM purchase_items i WHERE i.purchase_id = pu.id AND i.product_id = ?)') && params.push(q.product_id);
    const rows = (await all(
      `SELECT pu.*, v.name vendor, COALESCE((SELECT SUM(amount) FROM payments p WHERE p.purchase_id = pu.id),0) paid,
         (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = pu.id) items
       FROM purchases pu JOIN vendors v ON v.id = pu.vendor_id WHERE ${where.join(' AND ')} ORDER BY pu.date, pu.id`,
      ...params
    )).map((p) => ({
      date: p.date, ref: docNo.purchase(p.id), id: p.id, bill: p.vendor_bill_no || '', vendor: p.vendor, items: p.items,
      subtotal: p.subtotal, discount: p.discount, tax: p.tax, total: p.total, paid: r2(p.paid), due: r2(p.total - p.paid),
    }));
    return {
      title: 'Purchases Report',
      columns: [
        col('date', 'Date', 'date'), col('ref', 'Purchase #'), col('bill', 'Vendor Bill #'), col('vendor', 'Vendor'),
        col('items', 'Items', 'number'), col('subtotal', 'Subtotal', 'money'), col('discount', 'Discount', 'money'),
        col('tax', 'Tax', 'money'), col('total', 'Total', 'money'), col('paid', 'Paid on Bill', 'money'), col('due', 'Unpaid', 'money'),
      ],
      rows,
      totals: sumCols(rows, ['items', 'subtotal', 'discount', 'tax', 'total', 'paid', 'due']),
    };
  },

  'purchase-items': async (q) => {
    const where = ['pu.date BETWEEN ? AND ?'];
    const params = [q.from, q.to];
    if (q.vendor_id) where.push('pu.vendor_id = ?') && params.push(q.vendor_id);
    if (q.product_id) where.push('i.product_id = ?') && params.push(q.product_id);
    const rows = (await all(
      `SELECT pu.date, pu.id pid, v.name vendor, p.name product, p.unit, i.qty, i.unit_cost, i.line_total
       FROM purchase_items i JOIN purchases pu ON pu.id = i.purchase_id JOIN vendors v ON v.id = pu.vendor_id JOIN products p ON p.id = i.product_id
       WHERE ${where.join(' AND ')} ORDER BY pu.date, pu.id`,
      ...params
    )).map((x) => ({
      date: x.date, ref: docNo.purchase(x.pid), vendor: x.vendor, product: x.product, qty: x.qty, unit: x.unit,
      unit_cost: x.unit_cost, total: x.line_total,
    }));
    return {
      title: 'Purchases by Product (Line Items)',
      columns: [
        col('date', 'Date', 'date'), col('ref', 'Purchase #'), col('vendor', 'Vendor'), col('product', 'Product'),
        col('qty', 'Qty', 'number'), col('unit', 'Unit'), col('unit_cost', 'Rate', 'money'), col('total', 'Amount', 'money'),
      ],
      rows,
      totals: sumCols(rows, ['qty', 'total']),
    };
  },

  expenses: async (q) => {
    const where = ['date BETWEEN ? AND ?'];
    const params = [q.from, q.to];
    if (q.category) where.push('category = ?') && params.push(q.category);
    const rows = (await all(`SELECT * FROM expenses WHERE ${where.join(' AND ')} ORDER BY date, id`, ...params)).map((e) => ({
      date: e.date, ref: docNo.expense(e.id), category: e.category, method: e.method, note: e.note || '', amount: e.amount,
    }));
    return {
      title: 'Expenses Report',
      columns: [col('date', 'Date', 'date'), col('ref', 'Ref'), col('category', 'Category'), col('method', 'Method'), col('note', 'Note'), col('amount', 'Amount', 'money')],
      rows,
      totals: sumCols(rows, ['amount']),
    };
  },

  outstanding: async (q) => {
    const rows = [];
    if (q.party !== 'vendor')
      for (const c of await all(`${CUSTOMER_BAL_SQL} ORDER BY c.name`))
        if (q.all === '1' || Math.abs(c.balance) > 0.004)
          rows.push({
            party_type: 'Customer', name: c.name, phone: c.phone || '', opening: c.opening_balance, charges: r2(c.total_sales),
            payments: r2(c.total_paid), receivable: r2(Math.max(c.balance, 0)), payable: r2(Math.max(-c.balance, 0)), balance: r2(c.balance),
          });
    if (q.party !== 'customer')
      for (const v of await all(`${VENDOR_BAL_SQL} ORDER BY v.name`))
        if (q.all === '1' || Math.abs(v.balance) > 0.004)
          rows.push({
            party_type: 'Vendor', name: v.name, phone: v.phone || '', opening: v.opening_balance, charges: r2(v.total_purchases),
            payments: r2(v.total_paid), receivable: r2(Math.max(-v.balance, 0)), payable: r2(Math.max(v.balance, 0)), balance: r2(v.balance),
          });
    return {
      title: 'Outstanding Balances',
      dated: false,
      columns: [
        col('party_type', 'Type'), col('name', 'Name'), col('phone', 'Phone'), col('opening', 'Opening', 'money'),
        col('charges', 'Sales / Purchases', 'money'), col('payments', 'Payments', 'money'),
        col('receivable', 'Receivable (owed to us)', 'money'), col('payable', 'Payable (we owe)', 'money'),
      ],
      rows,
      totals: sumCols(rows, ['receivable', 'payable']),
    };
  },

  payments: async (q) => {
    const where = ['p.date BETWEEN ? AND ?'];
    const params = [q.from, q.to];
    if (q.customer_id) where.push(`p.party_type='customer' AND p.party_id = ?`) && params.push(q.customer_id);
    if (q.vendor_id) where.push(`p.party_type='vendor' AND p.party_id = ?`) && params.push(q.vendor_id);
    if (q.party === 'customer' || q.party === 'vendor') where.push('p.party_type = ?') && params.push(q.party);
    const rows = (await all(
      `SELECT p.*, COALESCE(c.name, v.name) party FROM payments p
       LEFT JOIN customers c ON p.party_type='customer' AND c.id = p.party_id
       LEFT JOIN vendors v ON p.party_type='vendor' AND v.id = p.party_id
       WHERE ${where.join(' AND ')} ORDER BY p.date, p.id`,
      ...params
    )).map((p) => ({
      date: p.date, ref: docNo.payment(p.id), direction: p.party_type === 'customer' ? 'Received' : 'Paid', party: p.party,
      method: p.method, reference: p.reference || '', against: p.sale_id ? docNo.sale(p.sale_id) : p.purchase_id ? docNo.purchase(p.purchase_id) : '',
      received: p.party_type === 'customer' ? p.amount : 0, paid: p.party_type === 'vendor' ? p.amount : 0,
    }));
    return {
      title: 'Payments Report',
      columns: [
        col('date', 'Date', 'date'), col('ref', 'Ref'), col('direction', 'Direction'), col('party', 'Customer / Vendor'),
        col('method', 'Method'), col('reference', 'Reference'), col('against', 'Against'),
        col('received', 'Received', 'money'), col('paid', 'Paid', 'money'),
      ],
      rows,
      totals: sumCols(rows, ['received', 'paid']),
    };
  },

  'stock-movements': async (q) => {
    let extra = '';
    const params = [];
    if (q.product_id) (extra += ' AND m.product_id = ?') && params.push(q.product_id);
    if (q.ref_type) (extra += ' AND m.ref_type = ?') && params.push(q.ref_type);
    const rows = (await movements(q.from, q.to, extra, params))
      .reverse()
      .map((m) => ({
        date: m.date, ref: m.ref, movement: m.label, product: m.product_name, unit: m.unit,
        qty_in: m.qty > 0 ? m.qty : 0, qty_out: m.qty < 0 ? -m.qty : 0, unit_cost: m.unit_cost, value: r2(m.qty * m.unit_cost), note: m.note || '',
      }));
    return {
      title: 'Stock Movements',
      columns: [
        col('date', 'Date', 'date'), col('ref', 'Ref'), col('movement', 'Movement'), col('product', 'Product'), col('unit', 'Unit'),
        col('qty_in', 'In', 'number'), col('qty_out', 'Out', 'number'), col('unit_cost', 'Unit Cost', 'money'),
        col('value', 'Value', 'money'), col('note', 'Note'),
      ],
      rows,
      totals: sumCols(rows, ['qty_in', 'qty_out', 'value']),
    };
  },

  assemblies: async (q) => {
    const where = ['a.date BETWEEN ? AND ?'];
    const params = [q.from, q.to];
    if (q.product_id) where.push('a.product_id = ?') && params.push(q.product_id);
    const rows = (await all(
      `SELECT a.*, p.name product, p.unit FROM assemblies a JOIN products p ON p.id = a.product_id WHERE ${where.join(' AND ')} ORDER BY a.date, a.id`,
      ...params
    )).map((a) => ({
      date: a.date, ref: docNo.assembly(a.id), product: a.product, qty: a.qty, unit: a.unit, material: a.material_cost,
      labor: a.labor_cost, other: a.other_cost, total: a.total_cost, unit_cost: a.unit_cost,
    }));
    return {
      title: 'Assembly Cost Report',
      columns: [
        col('date', 'Date', 'date'), col('ref', 'Ref'), col('product', 'Product'), col('qty', 'Qty', 'number'), col('unit', 'Unit'),
        col('material', 'Material', 'money'), col('labor', 'Labor', 'money'), col('other', 'Other', 'money'),
        col('total', 'Total Cost', 'money'), col('unit_cost', 'Cost / Unit', 'money'),
      ],
      rows,
      totals: sumCols(rows, ['qty', 'material', 'labor', 'other', 'total']),
    };
  },

  'profit-loss': async (q) => {
    const t = await periodTotals(q.from, q.to);
    const cats = await all(
      `SELECT category, SUM(amount) amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC`,
      q.from,
      q.to
    );
    const rows = [
      { section: 'Revenue', item: 'Sales', amount: t.sales },
      { section: 'Cost of Goods Sold', item: 'Cost of items sold', amount: -t.cogs },
      { section: 'Gross Profit', item: '', amount: t.gross_profit },
      ...cats.map((c) => ({ section: 'Expenses', item: c.category, amount: -r2(c.amount) })),
      { section: 'Net Profit', item: '', amount: t.net_profit },
    ];
    return {
      title: 'Profit & Loss',
      note: 'Cost of goods sold already includes material, labor and other costs of assembled products (at their assembly cost).',
      columns: [col('section', 'Section'), col('item', 'Item'), col('amount', 'Amount', 'money')],
      rows,
      totals: null,
    };
  },

  transactions: async (q) => {
    const types = q.types ? String(q.types).split(',') : null;
    let rows = await activities(q.from, q.to, types, q.q);
    if (q.customer_id) rows = rows.filter((a) => ['sale', 'payment_in'].includes(a.type) && String(a.party_id) === String(q.customer_id));
    if (q.vendor_id) rows = rows.filter((a) => ['purchase', 'payment_out'].includes(a.type) && String(a.party_id) === String(q.vendor_id));
    const LABEL = {
      sale: 'Sale', purchase: 'Purchase', payment_in: 'Payment Received', payment_out: 'Payment Made',
      expense: 'Expense', assembly: 'Assembly', stock: 'Stock Adjustment',
    };
    return {
      title: 'All Transactions',
      columns: [col('date', 'Date', 'date'), col('ref', 'Ref'), col('type_label', 'Type'), col('party', 'Party / Item'), col('detail', 'Details'), col('amount', 'Amount', 'money')],
      rows: rows.reverse().map((a) => ({ ...a, type_label: LABEL[a.type] || a.type, detail: a.detail || '' })),
      totals: null,
    };
  },
};

r.get(
  '/reports/:type',
  h(async (req) => {
    const fn = REPORTS[req.params.type];
    if (!fn) throw bad('Unknown report');
    const q = { ...req.query };
    q.from ||= '0000-01-01';
    q.to ||= '9999-12-31';
    const out = await fn(q);
    return { type: req.params.type, from: req.query.from || null, to: req.query.to || null, generated_at: new Date().toISOString(), ...out };
  })
);

export default r;
