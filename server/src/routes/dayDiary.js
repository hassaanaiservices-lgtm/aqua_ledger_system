// Day Diary (Roznamcha / Daily Book) router.
// Computes the daily Cash & Bank Roznamcha, Trading Account, Profit & Loss and
// Balance Sheet as of any date. Every figure is derived from the source tables
// (sales, purchases, payments, expenses, cash book, stock movements, assemblies)
// so the diary can never drift out of step with the customer and vendor ledgers.
import { Router } from 'express';
import { all, get, run, r2, docNo, IS_CASH_SQL, accountOfMethod } from '../db.js';
import { h, bad, today, addDays, startOfWeek } from '../utils.js';
import { cashBookFlows, cashBookKindTotals, decorate as decorateCashBook, bankBooks, CASH_BOOK_SELECT } from './cashbook.js';

const r = Router();

const DATE_OPS = ['<', '=', '<='];

/** Stock on hand and its weighted-average value as of the end of `asOfDate`. */
async function stockValuationAsOf(asOfDate) {
  const rows = await all(
    `SELECT p.id, p.name, p.cost_price, p.type, p.unit,
       COALESCE((SELECT SUM(m.qty) FROM stock_movements m WHERE m.product_id = p.id AND m.date <= ?), 0) AS stock,
       COALESCE((SELECT SUM(m.qty * m.unit_cost) / NULLIF(SUM(m.qty), 0)
                 FROM stock_movements m
                 WHERE m.product_id = p.id AND m.qty > 0 AND m.unit_cost > 0 AND m.date <= ?), p.cost_price) AS avg_cost
     FROM products p WHERE p.active = 1`,
    asOfDate,
    asOfDate
  );
  let value = 0;
  let units = 0;
  const items = [];
  for (const row of rows) {
    if (row.stock > 0) {
      value += row.stock * row.avg_cost;
      units += row.stock;
      items.push({ ...row, stock: r2(row.stock), avg_cost: r2(row.avg_cost), value: r2(row.stock * row.avg_cost) });
    }
  }
  return { value: r2(value), units: r2(units), items };
}

/**
 * Cash drawer movements for dates matching `op`. Customer payments are money
 * in; vendor payments, expenses and cash book outflows are money out. The bank
 * side is not computed here — it comes from bankBooks(), per account.
 */
async function cashFlows(op, date) {
  if (!DATE_OPS.includes(op)) throw new Error(`Unsupported date comparison: ${op}`);
  const pay = await get(
    `SELECT
       COALESCE(SUM(CASE WHEN party_type='customer' AND ${IS_CASH_SQL} THEN amount ELSE 0 END),0) AS cash_in,
       COALESCE(SUM(CASE WHEN party_type='vendor'   AND ${IS_CASH_SQL} THEN amount ELSE 0 END),0) AS cash_out
     FROM payments WHERE date ${op} ?`,
    date
  );
  const exp = await get(
    `SELECT COALESCE(SUM(CASE WHEN ${IS_CASH_SQL} THEN amount ELSE 0 END),0) AS cash_out
     FROM expenses WHERE date ${op} ?`,
    date
  );
  const cb = await cashBookFlows(op, date);
  return {
    cash_in: r2(pay.cash_in + cb.cash_in),
    cash_out: r2(pay.cash_out + exp.cash_out + cb.cash_out),
  };
}

r.get(
  '/day-diary',
  h(async (req) => {
    const date = req.query.date || today();
    const prevDate = addDays(date, -1);
    const nextDate = addDays(date, 1);

    // ---------------------------------------------------------------
    // 1. SALES & MONEY RECEIVED (linked to the customer ledger)
    // ---------------------------------------------------------------
    const sales = (await all(
      `SELECT s.*, c.name AS customer_name,
         COALESCE((SELECT SUM(amount) FROM payments p WHERE p.sale_id = s.id), 0) AS paid_on_invoice,
         (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS item_count
       FROM sales s
       JOIN customers c ON c.id = s.customer_id
       WHERE s.date = ?
       ORDER BY s.id DESC`,
      date
    )).map((s) => ({
      ...s,
      invoice_no: docNo.sale(s.id),
      due: r2(s.total - s.paid_on_invoice),
      profit: r2(s.total - s.cost_total),
    }));

    const customerPayments = (await all(
      `SELECT p.*, c.name AS customer_name, s.id AS sale_id, ba.name AS bank_account_name
       FROM payments p
       JOIN customers c ON c.id = p.party_id
       LEFT JOIN sales s ON s.id = p.sale_id
       LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
       WHERE p.party_type = 'customer' AND p.date = ?
       ORDER BY p.id DESC`,
      date
    )).map((p) => ({
      ...p,
      ref: docNo.payment(p.id),
      account: accountOfMethod(p.method),
      linked_invoice: p.sale_id ? docNo.sale(p.sale_id) : null,
    }));

    // ---------------------------------------------------------------
    // 2. PURCHASES & MONEY PAID (linked to the vendor ledger)
    // ---------------------------------------------------------------
    const purchases = (await all(
      `SELECT pu.*, v.name AS vendor_name,
         COALESCE((SELECT SUM(amount) FROM payments p WHERE p.purchase_id = pu.id), 0) AS paid_on_bill,
         (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = pu.id) AS item_count
       FROM purchases pu
       JOIN vendors v ON v.id = pu.vendor_id
       WHERE pu.date = ?
       ORDER BY pu.id DESC`,
      date
    )).map((pu) => ({
      ...pu,
      purchase_no: docNo.purchase(pu.id),
      due: r2(pu.total - pu.paid_on_bill),
    }));

    const vendorPayments = (await all(
      `SELECT p.*, v.name AS vendor_name, pu.id AS purchase_id, ba.name AS bank_account_name
       FROM payments p
       JOIN vendors v ON v.id = p.party_id
       LEFT JOIN purchases pu ON pu.id = p.purchase_id
       LEFT JOIN bank_accounts ba ON ba.id = p.bank_account_id
       WHERE p.party_type = 'vendor' AND p.date = ?
       ORDER BY p.id DESC`,
      date
    )).map((p) => ({
      ...p,
      ref: docNo.payment(p.id),
      account: accountOfMethod(p.method),
      linked_bill: p.purchase_id ? docNo.purchase(p.purchase_id) : null,
    }));

    // ---------------------------------------------------------------
    // 3. EXPENSES & CASH BOOK ENTRIES FOR THE DAY
    // ---------------------------------------------------------------
    const expenses = (await all(
      `SELECT e.*, COALESCE(c.group_name, 'Other Expense') AS group_name, ba.name AS bank_account_name
       FROM expenses e
       LEFT JOIN expense_categories c ON c.name = e.category
       LEFT JOIN bank_accounts ba ON ba.id = e.bank_account_id
       WHERE e.date = ? ORDER BY e.id DESC`,
      date
    )).map((e) => ({
      ...e,
      ref: docNo.expense(e.id),
      account: accountOfMethod(e.method),
    }));

    const cashBookEntries = (await all(`${CASH_BOOK_SELECT} WHERE c.date = ? ORDER BY c.id DESC`, date)).map(decorateCashBook);
    const byKind = (k) => cashBookEntries.filter((e) => e.kind === k);
    const otherIncome = byKind('income');
    const transfers = byKind('transfer');
    const bankCharges = byKind('bank_charge');
    const capitalIn = byKind('capital');
    const drawings = byKind('drawings');
    const sumOf = (rows) => r2(rows.reduce((a, x) => a + x.amount, 0));

    // ---------------------------------------------------------------
    // 4. ROZNAMCHA — CASH BOOK & BANK BOOK
    // ---------------------------------------------------------------
    const before = await cashFlows('<', date);
    const onDay = await cashFlows('=', date);

    const openingCash = r2(before.cash_in - before.cash_out);
    const closingCash = r2(openingCash + onDay.cash_in - onDay.cash_out);

    // Each bank account keeps its own book; the combined figure is their sum.
    const banks = await bankBooks(date);
    const openingBank = banks.total.opening;
    const closingBank = banks.total.closing;

    const noteRow = await get('SELECT * FROM day_diary_notes WHERE date = ?', date) || {
      date,
      notes: '',
      closing_cash_actual: null,
    };
    const cashVariance =
      noteRow.closing_cash_actual != null ? r2(noteRow.closing_cash_actual - closingCash) : null;

    const roznamcha = {
      cash: {
        opening: openingCash,
        inflow: onDay.cash_in,
        outflow: onDay.cash_out,
        closing: closingCash,
      },
      bank: {
        opening: openingBank,
        inflow: banks.total.inflow,
        outflow: banks.total.outflow,
        closing: closingBank,
      },
      bank_accounts: banks.accounts,
      opening_total: r2(openingCash + openingBank),
      closing_total: r2(closingCash + closingBank),
      closing_cash_actual: noteRow.closing_cash_actual,
      cash_variance: cashVariance,
    };

    // ---------------------------------------------------------------
    // 5. TRADING ACCOUNT FOR THE DAY
    // ---------------------------------------------------------------
    const daySalesTotal = r2(sales.reduce((a, s) => a + s.total, 0));
    const dayCogsTotal = r2(sales.reduce((a, s) => a + s.cost_total, 0));
    const dayPurchasesTotal = r2(purchases.reduce((a, pu) => a + pu.total, 0));
    const dayExpensesTotal = r2(expenses.reduce((a, e) => a + e.amount, 0));
    const dayOtherIncome = sumOf(otherIncome);
    const dayBankCharges = sumOf(bankCharges);
    const dayGrossProfit = r2(daySalesTotal - dayCogsTotal);
    const dayNetProfit = r2(dayGrossProfit + dayOtherIncome - dayExpensesTotal - dayBankCharges);

    const openingStock = await stockValuationAsOf(prevDate);
    const closingStock = await stockValuationAsOf(date);

    const assemblies = (await all(
      `SELECT a.*, p.name AS product_name, p.unit
       FROM assemblies a JOIN products p ON p.id = a.product_id
       WHERE a.date = ? ORDER BY a.id DESC`,
      date
    )).map((a) => ({ ...a, ref: docNo.assembly(a.id) }));

    const dayAssemblyAddedCost = r2(assemblies.reduce((acc, a) => acc + a.labor_cost + a.other_cost, 0));

    // Trading account in classic debit / credit form. Goods consumed by assembly
    // stay inside stock, so only the labour and overhead added by a production
    // run are a fresh charge against the day.
    const tradingAccount = {
      debit: [
        { label: 'Opening Stock (start of day)', amount: openingStock.value },
        { label: 'Purchases (goods inward)', amount: dayPurchasesTotal },
        { label: 'Manufacturing Labour & Overhead', amount: dayAssemblyAddedCost },
        { label: 'Gross Profit c/d', amount: Math.max(dayGrossProfit, 0) },
      ],
      credit: [
        { label: 'Sales Revenue', amount: daySalesTotal },
        { label: 'Closing Stock (end of day)', amount: closingStock.value },
        { label: 'Gross Loss c/d', amount: dayGrossProfit < 0 ? Math.abs(dayGrossProfit) : 0 },
      ],
      cost_of_goods_sold: dayCogsTotal,
      gross_profit: dayGrossProfit,
      gross_margin_pct: daySalesTotal > 0 ? r2((dayGrossProfit / daySalesTotal) * 100) : 0,
    };

    // ---------------------------------------------------------------
    // 6. PROFIT & LOSS FOR THE DAY
    // ---------------------------------------------------------------
    const expensesByCategory = (await all(
      `SELECT e.category, COALESCE(c.group_name, 'Other Expense') AS group_name,
              SUM(e.amount) AS total, COUNT(*) AS count
       FROM expenses e LEFT JOIN expense_categories c ON c.name = e.category
       WHERE e.date = ?
       GROUP BY e.category ORDER BY total DESC`,
      date
    )).map((c) => ({ ...c, total: r2(c.total) }));

    const groupMap = new Map();
    for (const row of expensesByCategory) {
      const g = groupMap.get(row.group_name) || { group_name: row.group_name, total: 0, items: [] };
      g.total = r2(g.total + row.total);
      g.items.push(row);
      groupMap.set(row.group_name, g);
    }
    if (dayBankCharges > 0) {
      const g = groupMap.get('Other Expense') || { group_name: 'Other Expense', total: 0, items: [] };
      g.total = r2(g.total + dayBankCharges);
      g.items.push({ category: 'Bank Charges (cash book)', group_name: 'Other Expense', total: dayBankCharges, count: bankCharges.length });
      groupMap.set('Other Expense', g);
    }
    const expensesByGroup = [...groupMap.values()].sort((a, b) => b.total - a.total);

    const profitAndLoss = {
      gross_profit: dayGrossProfit,
      other_income: dayOtherIncome,
      expenses_breakdown: expensesByCategory,
      expenses_by_group: expensesByGroup,
      bank_charges: dayBankCharges,
      total_expenses: r2(dayExpensesTotal + dayBankCharges),
      net_profit: dayNetProfit,
      net_margin_pct: daySalesTotal > 0 ? r2((dayNetProfit / daySalesTotal) * 100) : 0,
    };

    // ---------------------------------------------------------------
    // 7. BALANCE SHEET AS OF THIS DATE
    // ---------------------------------------------------------------
    const customersOut = (await all(
      `SELECT c.id, c.name, c.phone,
         c.opening_balance
         + COALESCE((SELECT SUM(total) FROM sales WHERE customer_id = c.id AND date <= ?), 0)
         - COALESCE((SELECT SUM(amount) FROM payments WHERE party_type = 'customer' AND party_id = c.id AND date <= ?), 0) AS balance
       FROM customers c`,
      date,
      date
    )).map((c) => ({ ...c, balance: r2(c.balance) }));
    const totalReceivables = r2(customersOut.reduce((acc, c) => acc + Math.max(c.balance, 0), 0));
    const customerAdvances = r2(customersOut.reduce((acc, c) => acc + Math.max(-c.balance, 0), 0));

    const vendorsOut = (await all(
      `SELECT v.id, v.name, v.phone,
         v.opening_balance
         + COALESCE((SELECT SUM(total) FROM purchases WHERE vendor_id = v.id AND date <= ?), 0)
         - COALESCE((SELECT SUM(amount) FROM payments WHERE party_type = 'vendor' AND party_id = v.id AND date <= ?), 0) AS balance
       FROM vendors v`,
      date,
      date
    )).map((v) => ({ ...v, balance: r2(v.balance) }));
    const totalPayables = r2(vendorsOut.reduce((acc, v) => acc + Math.max(v.balance, 0), 0));
    const vendorAdvances = r2(vendorsOut.reduce((acc, v) => acc + Math.max(-v.balance, 0), 0));

    const assets = {
      cash_in_hand: closingCash,
      bank_balance: closingBank,
      accounts_receivable: totalReceivables,
      advances_to_vendors: vendorAdvances,
      inventory_stock_value: closingStock.value,
      total_assets: r2(closingCash + closingBank + totalReceivables + vendorAdvances + closingStock.value),
    };

    const liabilities = {
      accounts_payable: totalPayables,
      advances_from_customers: customerAdvances,
      total_liabilities: r2(totalPayables + customerAdvances),
    };

    // Cumulative earnings and owner movements up to this date.
    const cumTrade = await get(
      'SELECT COALESCE(SUM(total),0) AS s, COALESCE(SUM(cost_total),0) AS c FROM sales WHERE date <= ?',
      date
    );
    const cumExpenses = (await get('SELECT COALESCE(SUM(amount),0) AS e FROM expenses WHERE date <= ?', date)).e;
    const cumCashBook = await cashBookKindTotals('<=', date);
    const retainedEarnings = r2(
      cumTrade.s - cumTrade.c + cumCashBook.income - cumExpenses - cumCashBook.bank_charge
    );
    const ownerCapital = r2(cumCashBook.capital - cumCashBook.drawings);
    const netWorth = r2(assets.total_assets - liabilities.total_liabilities);
    // Party opening balances and opening stock enter the books without a
    // matching capital entry, so this line carries that difference openly
    // instead of silently bending one of the real figures.
    const openingAdjustments = r2(netWorth - ownerCapital - retainedEarnings);

    const equity = {
      owner_capital: ownerCapital,
      capital_introduced: cumCashBook.capital,
      owner_drawings: cumCashBook.drawings,
      retained_earnings: retainedEarnings,
      opening_adjustments: openingAdjustments,
      total_equity: netWorth,
    };

    const balanceSheet = {
      as_of_date: date,
      assets,
      liabilities,
      equity,
      is_balanced:
        Math.abs(assets.total_assets - (liabilities.total_liabilities + equity.total_equity)) < 0.01,
    };

    // ---------------------------------------------------------------
    // 8. PARTY ACTIVITY — WHO MOVED TODAY, AND WHERE THEY STAND
    // ---------------------------------------------------------------
    const balanceOfCustomer = new Map(customersOut.map((c) => [c.id, c.balance]));
    const balanceOfVendor = new Map(vendorsOut.map((v) => [v.id, v.balance]));

    const activeCustomers = new Map();
    for (const s of sales) {
      const e = activeCustomers.get(s.customer_id) || { id: s.customer_id, name: s.customer_name, billed: 0, received: 0 };
      e.billed = r2(e.billed + s.total);
      activeCustomers.set(s.customer_id, e);
    }
    for (const p of customerPayments) {
      const e = activeCustomers.get(p.party_id) || { id: p.party_id, name: p.customer_name, billed: 0, received: 0 };
      e.received = r2(e.received + p.amount);
      activeCustomers.set(p.party_id, e);
    }

    const activeVendors = new Map();
    for (const pu of purchases) {
      const e = activeVendors.get(pu.vendor_id) || { id: pu.vendor_id, name: pu.vendor_name, billed: 0, paid: 0 };
      e.billed = r2(e.billed + pu.total);
      activeVendors.set(pu.vendor_id, e);
    }
    for (const p of vendorPayments) {
      const e = activeVendors.get(p.party_id) || { id: p.party_id, name: p.vendor_name, billed: 0, paid: 0 };
      e.paid = r2(e.paid + p.amount);
      activeVendors.set(p.party_id, e);
    }

    const parties = {
      customers: [...activeCustomers.values()].map((c) => ({ ...c, balance: balanceOfCustomer.get(c.id) ?? 0 })),
      vendors: [...activeVendors.values()].map((v) => ({ ...v, balance: balanceOfVendor.get(v.id) ?? 0 })),
      top_debtors: customersOut
        .filter((c) => c.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 8),
      top_creditors: vendorsOut
        .filter((v) => v.balance > 0)
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 8),
    };

    const stockMovements = await all(
      `SELECT m.*, p.name AS product_name, p.unit
       FROM stock_movements m JOIN products p ON p.id = m.product_id
       WHERE m.date = ? ORDER BY m.id DESC`,
      date
    );

    const tasks = await all('SELECT * FROM day_diary_tasks WHERE date = ? ORDER BY id ASC', date);

    return {
      date,
      prev_date: prevDate,
      next_date: nextDate,
      kpis: {
        total_inflow: r2(onDay.cash_in + banks.total.inflow),
        cash_inflow: onDay.cash_in,
        bank_inflow: banks.total.inflow,
        total_outflow: r2(onDay.cash_out + banks.total.outflow),
        cash_outflow: onDay.cash_out,
        bank_outflow: banks.total.outflow,
        net_cash_flow: r2(onDay.cash_in + banks.total.inflow - onDay.cash_out - banks.total.outflow),
        sales_total: daySalesTotal,
        sales_count: sales.length,
        purchases_total: dayPurchasesTotal,
        purchases_count: purchases.length,
        expenses_total: dayExpensesTotal,
        other_income: dayOtherIncome,
        gross_profit: dayGrossProfit,
        net_profit: dayNetProfit,
        receipts_total: r2(customerPayments.reduce((a, p) => a + p.amount, 0) + dayOtherIncome),
      },
      roznamcha,
      receipts: {
        customer_payments: customerPayments,
        other_income: otherIncome,
        total: r2(customerPayments.reduce((a, p) => a + p.amount, 0) + dayOtherIncome),
      },
      inflows: { sales, customer_payments: customerPayments },
      outflows: { expenses, purchases, vendor_payments: vendorPayments },
      cash_book: {
        entries: cashBookEntries,
        transfers,
        other_income: otherIncome,
        bank_charges: bankCharges,
        capital: capitalIn,
        drawings,
        totals: {
          transfers: sumOf(transfers),
          other_income: dayOtherIncome,
          bank_charges: dayBankCharges,
          capital: sumOf(capitalIn),
          drawings: sumOf(drawings),
        },
      },
      trading_account: tradingAccount,
      profit_and_loss: profitAndLoss,
      balance_sheet: balanceSheet,
      opening_stock: { value: openingStock.value, units: openingStock.units },
      closing_stock: closingStock,
      parties,
      assemblies,
      stock_movements: stockMovements,
      notes: noteRow.notes || '',
      closing_cash_actual: noteRow.closing_cash_actual,
      tasks,
    };
  })
);

// ---------------------------------------------------------------- charts
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d) => `${d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`;
const MAX_CHART_DAYS = 400;
const DAILY_UP_TO_DAYS = 31;

/**
 * Everything the chart cards need for one window, from the same source tables
 * as the diary itself so a chart can never disagree with a table.
 *
 *  - received: customer payments + other income
 *  - paid:     vendor payments + expenses + bank charges + owner drawings
 *  Cash<->bank transfers and owner capital are left out: they move or inject
 *  money without being a receipt from, or a payment to, anyone.
 */
r.get(
  '/day-diary/charts',
  h(async (req) => {
    const to = req.query.to || today();
    const from = req.query.from || addDays(to, -29);
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw bad('Dates must look like 2026-11-04');
    if (from > to) throw bad('The start date is after the end date');
    const span = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (span > MAX_CHART_DAYS) throw bad(`Pick a range of at most ${MAX_CHART_DAYS} days`);

    // ---- money in / out per day ----
    const flow = await all(
      `SELECT date, SUM(received) AS received, SUM(paid) AS paid FROM (
         SELECT date, amount AS received, 0 AS paid FROM payments WHERE party_type = 'customer' AND date BETWEEN ? AND ?
         UNION ALL SELECT date, amount, 0 FROM cash_book WHERE kind = 'income' AND date BETWEEN ? AND ?
         UNION ALL SELECT date, 0, amount FROM payments WHERE party_type = 'vendor' AND date BETWEEN ? AND ?
         UNION ALL SELECT date, 0, amount FROM expenses WHERE date BETWEEN ? AND ?
         UNION ALL SELECT date, 0, amount FROM cash_book WHERE kind IN ('bank_charge','drawings') AND date BETWEEN ? AND ?
       ) GROUP BY date`,
      from, to, from, to, from, to, from, to, from, to
    );
    const byDate = new Map(flow.map((x) => [x.date, x]));

    const weekly = span > DAILY_UP_TO_DAYS;
    const buckets = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const key = weekly ? startOfWeek(d) : d;
      let b = buckets[buckets.length - 1];
      if (!b || b.key !== key) {
        b = { key, from: d < key ? key : d, to: d, received: 0, paid: 0 };
        buckets.push(b);
      }
      b.to = d;
      const row = byDate.get(d);
      if (row) {
        b.received = r2(b.received + row.received);
        b.paid = r2(b.paid + row.paid);
      }
    }
    const daily = buckets.map((b) => ({
      from: b.from,
      to: b.to,
      label: weekly ? shortDate(b.from) : shortDate(b.to),
      long_label: weekly ? `${shortDate(b.from)} – ${shortDate(b.to)}` : shortDate(b.to),
      received: b.received,
      paid: b.paid,
      net: r2(b.received - b.paid),
    }));

    // ---- where the money went, by expense group ----
    const groups = new Map(
      (
        await all(
          `SELECT COALESCE(c.group_name, 'Other Expense') AS group_name, SUM(e.amount) AS total, COUNT(*) AS count
           FROM expenses e LEFT JOIN expense_categories c ON c.name = e.category
           WHERE e.date BETWEEN ? AND ? GROUP BY group_name`,
          from, to
        )
      ).map((g) => [g.group_name, { group_name: g.group_name, total: r2(g.total), count: g.count }])
    );
    const fees = await get(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM cash_book WHERE kind = 'bank_charge' AND date BETWEEN ? AND ?`,
      from, to
    );
    if (fees.total > 0) {
      const g = groups.get('Other Expense') || { group_name: 'Other Expense', total: 0, count: 0 };
      g.total = r2(g.total + fees.total);
      g.count += fees.count;
      groups.set('Other Expense', g);
    }
    const expenses_by_group = [...groups.values()].sort((a, b) => b.total - a.total);

    // ---- where the money sits at the end of the window ----
    const cash = await cashFlows('<=', to);
    const banks = await bankBooks(to);
    const money = [
      { id: 'cash', kind: 'cash', label: 'Cash in hand', balance: r2(cash.cash_in - cash.cash_out) },
      ...banks.accounts
        .filter((a) => a.active || a.closing !== 0)
        .map((a) => ({
          id: `bank-${a.id}`,
          kind: 'bank',
          label: a.name,
          sub: [a.owner_name, a.bank_name].filter(Boolean).join(' · '),
          balance: a.closing,
        })),
    ];

    return {
      from,
      to,
      days: span,
      granularity: weekly ? 'week' : 'day',
      daily,
      expenses_by_group,
      money,
      totals: {
        received: r2(daily.reduce((a, x) => a + x.received, 0)),
        paid: r2(daily.reduce((a, x) => a + x.paid, 0)),
        net: r2(daily.reduce((a, x) => a + x.net, 0)),
        expenses: r2(expenses_by_group.reduce((a, x) => a + x.total, 0)),
        money_total: r2(money.reduce((a, x) => a + x.balance, 0)),
      },
      excludes: 'Transfers between cash and bank, and owner capital, are not counted as money received or paid out.',
    };
  })
);

// Save / update the day's notes and the actual counted drawer cash
r.put(
  '/day-diary/notes',
  h(async (req) => {
    const { date, notes, closing_cash_actual } = req.body;
    if (!date) throw bad('Date is required');

    await run(
      `INSERT INTO day_diary_notes (date, notes, closing_cash_actual, updated_at)
       VALUES (?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(date) DO UPDATE SET
         notes = excluded.notes,
         closing_cash_actual = excluded.closing_cash_actual,
         updated_at = excluded.updated_at`,
      date,
      notes != null ? String(notes) : '',
      closing_cash_actual !== '' && closing_cash_actual != null ? Number(closing_cash_actual) : null
    );

    return { success: true, date };
  })
);

r.post(
  '/day-diary/tasks',
  h(async (req) => {
    const { date, task } = req.body;
    if (!date || !task?.trim()) throw bad('Date and task description are required');
    const info = await run('INSERT INTO day_diary_tasks (date, task, completed) VALUES (?, ?, 0)', date, task.trim());
    return { id: Number(info.lastInsertRowid), date, task: task.trim(), completed: 0 };
  })
);

r.patch(
  '/day-diary/tasks/:id',
  h(async (req) => {
    const id = Number(req.params.id);
    const { completed } = req.body;
    await run('UPDATE day_diary_tasks SET completed = ? WHERE id = ?', completed ? 1 : 0, id);
    return { id, completed: completed ? 1 : 0 };
  })
);

r.delete(
  '/day-diary/tasks/:id',
  h(async (req) => {
    const id = Number(req.params.id);
    await run('DELETE FROM day_diary_tasks WHERE id = ?', id);
    return { success: true, id };
  })
);

export default r;
