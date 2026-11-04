import React, { useState } from 'react';
import {
  BookOpen, Wallet, Landmark, Plus, ChevronLeft, ChevronRight, Scale,
  TrendingUp, Receipt, StickyNote, Users, Trash2, ArrowRightLeft,
  CalendarDays, Calculator, Banknote, CheckCircle2, Circle, AlertTriangle, Wrench, BarChart3,
} from 'lucide-react';
import { PageHeader, StatCard, Modal, Field, Empty, Loading, Seg, useFetch, useSaver, useApp } from '../components/ui';
import { MoneyFlowCard, MoneyPositionCard, ExpenseGroupsCard } from '../components/BusinessCharts';
import { api } from '../lib/api';
import { money, fmtDateLong, today, addDays } from '../lib/format';

const TABS = [
  { id: 'daybook', label: 'Day Book (Roznamcha)', icon: BookOpen },
  { id: 'charts', label: 'Charts', icon: BarChart3 },
  { id: 'trading', label: 'Trading Account', icon: Calculator },
  { id: 'pl', label: 'Profit & Loss', icon: TrendingUp },
  { id: 'balance', label: 'Balance Sheet', icon: Scale },
  { id: 'parties', label: 'Customers & Vendors', icon: Users },
  { id: 'notes', label: 'Notes & Tasks', icon: StickyNote },
];

/** Two-column Dr/Cr statement used by the trading account and balance sheet. */
function Ledger({ title, left, right, foot }) {
  const side = (heading, rows) => (
    <div>
      <div className="row-between" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
        <span className="strong small" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{heading}</span>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="summary-line" style={row.strong ? { fontWeight: 600 } : undefined}>
          <span>{row.label}</span>
          <b>{money(row.amount)}</b>
        </div>
      ))}
      <div className="summary-line total">
        <span>Total</span>
        <b>{money(rows.reduce((a, x) => a + (Number(x.amount) || 0), 0))}</b>
      </div>
    </div>
  );
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3></div>
      <div className="card-body">
        <div className="grid grid-2" style={{ gap: 28 }}>
          {side(left.heading, left.rows)}
          {side(right.heading, right.rows)}
        </div>
        {foot}
      </div>
    </div>
  );
}

/** Per-partner bank books plus the combined position. */
function BankBooks({ accounts, total, onManage }) {
  const cell = (v, cls) => <td className={`r ${cls || ''}`}>{v ? money(v) : <span className="muted">—</span>}</td>;
  return (
    <div className="card">
      <div className="card-head">
        <h3><Landmark size={17} /> Bank Accounts</h3>
        <button className="btn btn-sm" onClick={onManage}><Wrench size={14} /> Manage Accounts</button>
      </div>
      <div className="table-wrap">
        <table className="table compact">
          <thead>
            <tr>
              <th>Account</th>
              <th className="r">Opening</th>
              <th className="r">Received</th>
              <th className="r">Paid</th>
              <th className="r">Closing Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="strong">{a.name}</span>
                  {(a.owner_name || a.bank_name || !a.active) && (
                    <div className="muted small">
                      {[a.owner_name, a.bank_name, a.account_number].filter(Boolean).join(' · ')}
                      {!a.active && <span className="badge amber" style={{ marginLeft: 6 }}>Closed</span>}
                    </div>
                  )}
                </td>
                {cell(a.opening)}
                {cell(a.inflow, 'pos')}
                {cell(a.outflow, 'neg')}
                <td className="r"><b>{money(a.closing)}</b></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Combined Bank Balance</td>
              <td className="r">{money(total.opening)}</td>
              <td className="r">{money(total.inflow)}</td>
              <td className="r">{money(total.outflow)}</td>
              <td className="r">{money(total.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function MoneyBook({ label, icon: Icon, book }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3><Icon size={17} /> {label}</h3>
      </div>
      <div className="card-body">
        <div className="summary-line"><span>Opening Balance</span><b>{money(book.opening)}</b></div>
        <div className="summary-line"><span>Received (in)</span><b className="pos">+{money(book.inflow)}</b></div>
        <div className="summary-line"><span>Paid (out)</span><b className="neg">−{money(book.outflow)}</b></div>
        <div className="summary-line total"><span>Closing Balance</span><b>{money(book.closing)}</b></div>
      </div>
    </div>
  );
}

function Rows({ title, icon: Icon, rows, columns, empty = 'Nothing recorded', total }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>{Icon && <Icon size={17} />} {title}</h3>
        {total !== undefined && <span className="strong">{money(total)}</span>}
      </div>
      {rows.length === 0 ? (
        <div className="card-body"><p className="muted small" style={{ margin: 0 }}>{empty}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.ref ?? row.id ?? ''}-${i}`}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const methodBadge = (m) => {
  const cash = String(m || 'cash').toLowerCase() === 'cash';
  return <span className={`badge ${cash ? 'green' : 'sky'}`}>{cash ? 'Cash' : String(m || '').toUpperCase()}</span>;
};

/** Names the real account an amount moved through, falling back to the method. */
const accountCell = (r) =>
  r.bank_account_name ? (
    <span className="badge sky" title={r.method || ''}>{r.bank_account_name}</span>
  ) : (
    methodBadge(r.method)
  );

// ---------------------------------------------------------------- modals
/** Picker shown whenever money moves through a bank rather than the drawer. */
function BankPicker({ label, value, onChange, accounts, hint }) {
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

function ExpenseModal({ date, categories, methods, banks, onClose }) {
  const [save, busy] = useSaver();
  const [form, setForm] = useState({
    date, category: '', amount: '', method: 'cash', bank_account_id: banks[0]?.id ?? '', note: '',
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const groups = [...new Set(categories.map((c) => c.group_name))];
  const isBank = (methods.find((m) => m.value === form.method)?.account ?? 'cash') === 'bank';

  const submit = async (e) => {
    e.preventDefault();
    const ok = await save(() => api.post('/expenses', form), 'Expense recorded');
    if (ok) onClose();
  };

  return (
    <Modal title="Record Expense" icon={<Receipt size={18} />} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save Expense'}</button>
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
            <select value={form.method} onChange={set('method')}>
              {methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          {isBank && (
            <BankPicker
              label="Which Bank Account *"
              hint="whose account it left"
              value={form.bank_account_id}
              onChange={(v) => setForm({ ...form, bank_account_id: v })}
              accounts={banks}
            />
          )}
          <Field label="Note" className="full">
            <input value={form.note} onChange={set('note')} placeholder="Optional detail, e.g. October electricity bill" />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function CashBookModal({ date, kinds, banks, onClose }) {
  const [save, busy] = useSaver();
  const [form, setForm] = useState({
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
    const ok = await save(() => api.post('/cash-book', form), 'Cash book entry saved');
    if (ok) onClose();
  };

  const accountOptions = [
    { value: 'cash', label: 'Cash in Hand' },
    { value: 'bank', label: 'Bank Account' },
  ];

  return (
    <Modal title="Cash / Bank Entry" icon={<ArrowRightLeft size={18} />} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save Entry'}</button>
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

function BankAccountsModal({ accounts, onClose }) {
  const { confirm } = useApp();
  const [save, busy] = useSaver();
  const blank = { name: '', owner_name: '', bank_name: '', account_number: '', opening_balance: '' };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const ok = editId
      ? await save(() => api.put(`/bank-accounts/${editId}`, form), 'Bank account updated')
      : await save(() => api.post('/bank-accounts', form), 'Bank account added');
    if (ok) { setForm(blank); setEditId(null); }
  };

  const edit = (a) => {
    setEditId(a.id);
    setForm({
      name: a.name || '', owner_name: a.owner_name || '', bank_name: a.bank_name || '',
      account_number: a.account_number || '', opening_balance: a.opening_balance ?? '',
    });
  };

  const close = async (a) => {
    if (!(await confirm({
      title: 'Close bank account',
      message: `Close "${a.name}"? Past entries stay on the books; it just stops appearing in the pickers.`,
      okText: 'Close Account',
    }))) return;
    await save(() => api.del(`/bank-accounts/${a.id}`), 'Bank account closed');
  };

  return (
    <Modal title="Bank Accounts" icon={<Landmark size={18} />} size="lg" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="table compact">
          <thead>
            <tr><th>Account</th><th>Owner</th><th className="r">Opening</th><th className="r">Current</th><th className="actions"></th></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={a.active ? undefined : { opacity: 0.55 }}>
                <td>
                  <span className="strong">{a.name}</span>
                  {a.bank_name && <div className="muted small">{a.bank_name}{a.account_number ? ` · ${a.account_number}` : ''}</div>}
                </td>
                <td>{a.owner_name || <span className="muted">—</span>}</td>
                <td className="r">{money(a.opening_balance)}</td>
                <td className="r"><b>{money(a.closing)}</b></td>
                <td className="actions">
                  <button className="btn btn-ghost btn-icon btn-sm" title="Edit" onClick={() => edit(a)}><Wrench size={14} /></button>
                  {a.active && (
                    <button className="btn btn-ghost btn-icon btn-sm" title="Close account" onClick={() => close(a)}><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={submit}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="strong">{editId ? 'Edit account' : 'Add a bank account'}</span>
          {editId && (
            <button type="button" className="btn btn-sm" onClick={() => { setEditId(null); setForm(blank); }}>Cancel edit</button>
          )}
        </div>
        <div className="form-grid">
          <Field label="Account Name *" hint="e.g. Hassaan — Meezan Bank" className="full">
            <input value={form.name} onChange={set('name')} required placeholder="Shown everywhere money is recorded" />
          </Field>
          <Field label="Owner / Partner">
            <input value={form.owner_name} onChange={set('owner_name')} placeholder="Whose account it is" />
          </Field>
          <Field label="Bank Name">
            <input value={form.bank_name} onChange={set('bank_name')} placeholder="e.g. Meezan Bank" />
          </Field>
          <Field label="Account Number">
            <input value={form.account_number} onChange={set('account_number')} placeholder="Optional" />
          </Field>
          <Field label="Opening Balance (Rs)" hint="money already in it">
            <input type="number" step="any" value={form.opening_balance} onChange={set('opening_balance')} placeholder="0" />
          </Field>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            <Plus size={16} /> {editId ? 'Save Changes' : 'Add Account'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- page
export default function DayDiary() {
  const { confirm } = useApp();
  const [date, setDate] = useState(today());
  const [tab, setTab] = useState('daybook');
  const [modal, setModal] = useState(null);
  const [save] = useSaver();

  const { data: d, loading } = useFetch('/day-diary', { date });
  const { data: categories } = useFetch('/expense-categories');
  const { data: methods } = useFetch('/payment-methods');
  const { data: kinds } = useFetch('/cash-book/kinds');
  const { data: bankData } = useFetch('/bank-accounts');
  const allBanks = bankData?.accounts ?? [];
  const openBanks = allBanks.filter((a) => a.active);

  if (loading && !d) return <Loading />;
  if (!d) return <Empty title="Could not load the day diary" />;

  const k = d.kpis;
  const rz = d.roznamcha;

  return (
    <>
      <PageHeader title="Day Diary" subtitle={`${fmtDateLong(d.date)} — cash book, trading account and balance sheet for the day`}>
        <button className="btn" onClick={() => setModal('expense')}><Receipt size={16} /> Expense</button>
        <button className="btn" onClick={() => setModal('cashbook')}><ArrowRightLeft size={16} /> Cash / Bank</button>
      </PageHeader>

      {/* date navigation */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters" style={{ borderBottom: 0 }}>
          <button className="btn btn-icon" title="Previous day" onClick={() => setDate(d.prev_date)}><ChevronLeft size={18} /></button>
          <Field label="Diary Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <button className="btn btn-icon" title="Next day" onClick={() => setDate(d.next_date)}><ChevronRight size={18} /></button>
          <button className="btn" onClick={() => setDate(today())}><CalendarDays size={16} /> Today</button>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <StatCard label="Cash in Hand (closing)" value={money(rz.cash.closing)} icon={Wallet} accent="green" foot={`Opened at ${money(rz.cash.opening)}`} />
        <StatCard label="Bank Balance (closing)" value={money(rz.bank.closing)} icon={Landmark} accent="sky" foot={`Opened at ${money(rz.bank.opening)}`} />
        <StatCard label="Received Today" value={money(k.receipts_total)} icon={Receipt} accent="aqua" foot={`${money(k.cash_inflow)} cash · ${money(k.bank_inflow)} bank`} />
        <StatCard
          label="Net Profit Today"
          value={money(k.net_profit)}
          icon={TrendingUp}
          accent={k.net_profit >= 0 ? 'violet' : 'rose'}
          foot={`Gross ${money(k.gross_profit)} · Expenses ${money(k.expenses_total)}`}
        />
      </div>

      <div className="card">
        <div className="tabs">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                className={tab === t.id ? 'on' : ''}
                onClick={() => setTab(t.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        {tab === 'daybook' && <DayBook d={d} onDeleteCashBook={save} confirm={confirm} onManage={() => setModal('banks')} />}
        {tab === 'charts' && <ChartsTab date={date} />}
        {tab === 'trading' && <TradingTab d={d} />}
        {tab === 'pl' && <ProfitLossTab d={d} />}
        {tab === 'balance' && <BalanceTab d={d} />}
        {tab === 'parties' && <PartiesTab d={d} />}
        {tab === 'notes' && <NotesTab d={d} date={date} />}
      </div>

      {modal === 'expense' && categories && methods && bankData && (
        <ExpenseModal date={date} categories={categories} methods={methods} banks={openBanks} onClose={() => setModal(null)} />
      )}
      {modal === 'cashbook' && kinds && bankData && (
        <CashBookModal date={date} kinds={kinds} banks={openBanks} onClose={() => setModal(null)} />
      )}
      {modal === 'banks' && bankData && (
        <BankAccountsModal accounts={allBanks} onClose={() => setModal(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- tabs
function DayBook({ d, onDeleteCashBook, confirm, onManage }) {
  const removeEntry = async (row) => {
    if (!(await confirm(`Delete cash book entry ${row.ref}?`))) return;
    await onDeleteCashBook(() => api.del(`/cash-book/${row.id}`), 'Entry deleted');
  };

  return (
    <>
      <div className="grid grid-2">
        <MoneyBook label="Cash Book" icon={Wallet} book={d.roznamcha.cash} />
        <div className="card">
          <div className="card-head"><h3><Scale size={17} /> Combined Position</h3></div>
          <div className="card-body">
            <div className="summary-line"><span>Cash in hand</span><b>{money(d.roznamcha.cash.closing)}</b></div>
            <div className="summary-line"><span>All bank accounts</span><b>{money(d.roznamcha.bank.closing)}</b></div>
            <div className="summary-line total"><span>Total money held</span><b>{money(d.roznamcha.closing_total)}</b></div>
          </div>
        </div>
      </div>

      <BankBooks accounts={d.roznamcha.bank_accounts} total={d.roznamcha.bank} onManage={onManage} />

      <Rows
        title="Cash Receipts — Money Received"
        icon={Receipt}
        total={d.receipts.total}
        rows={[
          ...d.receipts.customer_payments.map((p) => ({ ...p, _from: p.customer_name, _what: p.linked_invoice ? `Against ${p.linked_invoice}` : 'Ledger recovery' })),
          ...d.receipts.other_income.map((e) => ({ ...e, _from: e.category || 'Other income', _what: e.kind_label, method: e.to_account, bank_account_name: e.to_bank_name })),
        ]}
        empty="No money received on this day"
        columns={[
          { key: 'ref', label: 'Ref', render: (r) => <span className="mono">{r.ref}</span> },
          { key: 'from', label: 'Received From', render: (r) => <span className="strong">{r._from}</span> },
          { key: 'what', label: 'Details', render: (r) => <span className="muted small">{r._what}</span> },
          { key: 'method', label: 'Into', render: accountCell },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b className="pos">{money(r.amount)}</b> },
        ]}
      />

      <Rows
        title="Payments & Expenses — Money Paid Out"
        icon={Banknote}
        total={d.kpis.total_outflow}
        rows={[
          ...d.outflows.vendor_payments.map((p) => ({ ...p, _to: p.vendor_name, _what: p.linked_bill ? `Against ${p.linked_bill}` : 'Ledger payment' })),
          ...d.outflows.expenses.map((e) => ({ ...e, _to: e.category, _what: e.group_name })),
          ...d.cash_book.bank_charges.map((e) => ({ ...e, _to: 'Bank charges', _what: e.note || e.kind_label, method: e.from_account, bank_account_name: e.from_bank_name })),
          ...d.cash_book.drawings.map((e) => ({ ...e, _to: 'Owner drawings', _what: e.note || e.kind_label, method: e.from_account, bank_account_name: e.from_bank_name })),
        ]}
        empty="No money paid out on this day"
        columns={[
          { key: 'ref', label: 'Ref', render: (r) => <span className="mono">{r.ref}</span> },
          { key: 'to', label: 'Paid To / For', render: (r) => <span className="strong">{r._to}</span> },
          { key: 'what', label: 'Details', render: (r) => <span className="muted small">{r._what}</span> },
          { key: 'method', label: 'From', render: accountCell },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b className="neg">{money(r.amount)}</b> },
        ]}
      />

      <Rows
        title="Sales & Invoices"
        total={d.kpis.sales_total}
        rows={d.inflows.sales}
        empty="No sales on this day"
        columns={[
          { key: 'inv', label: 'Invoice', render: (r) => <span className="mono">{r.invoice_no}</span> },
          { key: 'cust', label: 'Customer', render: (r) => <span className="strong">{r.customer_name}</span> },
          { key: 'items', label: 'Items', render: (r) => <span className="muted small">{r.item_count} item(s)</span> },
          { key: 'paid', label: 'Paid', align: 'right', render: (r) => money(r.paid_on_invoice) },
          { key: 'due', label: 'Due', align: 'right', render: (r) => <span className={r.due > 0 ? 'neg' : 'muted'}>{money(r.due)}</span> },
          { key: 'total', label: 'Invoice Total', align: 'right', render: (r) => <b>{money(r.total)}</b> },
        ]}
      />

      <Rows
        title="Purchases & Vendor Bills"
        total={d.kpis.purchases_total}
        rows={d.outflows.purchases}
        empty="No purchases on this day"
        columns={[
          { key: 'no', label: 'Bill', render: (r) => <span className="mono">{r.purchase_no}</span> },
          { key: 'vend', label: 'Vendor', render: (r) => <span className="strong">{r.vendor_name}</span> },
          { key: 'items', label: 'Items', render: (r) => <span className="muted small">{r.item_count} item(s)</span> },
          { key: 'paid', label: 'Paid', align: 'right', render: (r) => money(r.paid_on_bill) },
          { key: 'due', label: 'Due', align: 'right', render: (r) => <span className={r.due > 0 ? 'neg' : 'muted'}>{money(r.due)}</span> },
          { key: 'total', label: 'Bill Total', align: 'right', render: (r) => <b>{money(r.total)}</b> },
        ]}
      />

      <Rows
        title="Cash ↔ Bank Transfers & Capital"
        icon={ArrowRightLeft}
        rows={[...d.cash_book.transfers, ...d.cash_book.capital]}
        empty="No transfers or capital movements on this day"
        columns={[
          { key: 'ref', label: 'Ref', render: (r) => <span className="mono">{r.ref}</span> },
          { key: 'kind', label: 'Type', render: (r) => <span className="badge violet">{r.kind_label}</span> },
          { key: 'move', label: 'Movement', render: (r) => (
            <span className="small">{r.from_label || '—'} → {r.to_label || '—'}</span>
          ) },
          { key: 'note', label: 'Note', render: (r) => <span className="muted small">{r.category || r.note || ''}</span> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b>{money(r.amount)}</b> },
          { key: 'act', label: '', align: 'right', render: (r) => (
            <button className="btn btn-ghost btn-icon btn-sm" title="Delete entry" onClick={() => removeEntry(r)}><Trash2 size={14} /></button>
          ) },
        ]}
      />

      {d.assemblies.length > 0 && (
        <Rows
          title="Assembly Production Runs"
          rows={d.assemblies}
          columns={[
            { key: 'ref', label: 'Ref', render: (r) => <span className="mono">{r.ref}</span> },
            { key: 'prod', label: 'Product', render: (r) => <span className="strong">{r.product_name}</span> },
            { key: 'qty', label: 'Qty', align: 'right', render: (r) => `${r.qty} ${r.unit}` },
            { key: 'unit', label: 'Unit Cost', align: 'right', render: (r) => money(r.unit_cost) },
            { key: 'total', label: 'Total Cost', align: 'right', render: (r) => <b>{money(r.total_cost)}</b> },
          ]}
        />
      )}
    </>
  );
}

const RANGES = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
];

/** Charts for the window ending on the diary date. One filter row scopes all three. */
function ChartsTab({ date }) {
  const [days, setDays] = useState(30);
  const { data: c, loading } = useFetch('/day-diary/charts', { from: addDays(date, -(days - 1)), to: date });

  return (
    <>
      <div className="row-between wrap" style={{ gap: 12 }}>
        <div className="muted small">Figures come from the same records as the Day Book, ending on the diary date above.</div>
        <Seg options={RANGES} value={days} onChange={setDays} id="chart-range" />
      </div>
      {!c ? (
        <Loading />
      ) : (
        <>
          <MoneyFlowCard data={c} refreshing={loading} />
          <div className="grid grid-2">
            <MoneyPositionCard data={c} refreshing={loading} />
            <ExpenseGroupsCard data={c} refreshing={loading} />
          </div>
        </>
      )}
    </>
  );
}

function TradingTab({ d }) {
  const t = d.trading_account;
  return (
    <>
      <Ledger
        title={`Trading Account — ${fmtDateLong(d.date)}`}
        left={{ heading: 'Dr — Debit Side', rows: t.debit }}
        right={{ heading: 'Cr — Credit Side', rows: t.credit }}
        foot={
          <div className="summary-box" style={{ marginTop: 18 }}>
            <div className="summary-line"><span>Sales Revenue</span><b>{money(d.kpis.sales_total)}</b></div>
            <div className="summary-line"><span>Cost of Goods Sold</span><b>{money(t.cost_of_goods_sold)}</b></div>
            <div className="summary-line"><span>Gross Margin</span><b>{t.gross_margin_pct}%</b></div>
            <div className="summary-line total">
              <span>{t.gross_profit >= 0 ? 'Gross Profit' : 'Gross Loss'}</span>
              <b className={t.gross_profit >= 0 ? 'pos' : 'neg'}>{money(Math.abs(t.gross_profit))}</b>
            </div>
          </div>
        }
      />
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Stock Movement of the Day</h3></div>
          <div className="card-body">
            <div className="summary-line"><span>Opening stock value</span><b>{money(d.opening_stock.value)}</b></div>
            <div className="summary-line"><span>Opening units</span><b>{d.opening_stock.units}</b></div>
            <div className="summary-line"><span>Closing stock value</span><b>{money(d.closing_stock.value)}</b></div>
            <div className="summary-line total"><span>Closing units</span><b>{d.closing_stock.units}</b></div>
          </div>
        </div>
        <Rows
          title="Stock Entries Recorded"
          rows={d.stock_movements}
          empty="No stock moved on this day"
          columns={[
            { key: 'prod', label: 'Product', render: (r) => <span className="strong">{r.product_name}</span> },
            { key: 'type', label: 'Source', render: (r) => <span className="badge indigo">{r.ref_type}</span> },
            { key: 'qty', label: 'Qty', align: 'right', render: (r) => <span className={r.qty >= 0 ? 'pos' : 'neg'}>{r.qty > 0 ? '+' : ''}{r.qty} {r.unit}</span> },
            { key: 'cost', label: 'Unit Cost', align: 'right', render: (r) => money(r.unit_cost) },
          ]}
        />
      </div>
    </>
  );
}

function ProfitLossTab({ d }) {
  const p = d.profit_and_loss;
  const { confirm } = useApp();
  const [save] = useSaver();

  const removeExpense = async (row) => {
    if (!(await confirm(`Delete expense ${row.ref} — ${row.category} ${money(row.amount)}?`))) return;
    await save(() => api.del(`/expenses/${row.id}`), 'Expense deleted');
  };

  return (
    <>
      <div className="card">
        <div className="card-head"><h3>Profit & Loss Account — {fmtDateLong(d.date)}</h3></div>
        <div className="card-body">
          <div className="summary-line"><span>Gross Profit (from trading account)</span><b>{money(p.gross_profit)}</b></div>
          <div className="summary-line"><span>Add: Other Income</span><b className="pos">+{money(p.other_income)}</b></div>
          <div className="divider" />
          {p.expenses_by_group.length === 0 ? (
            <p className="muted small" style={{ margin: '4px 0' }}>No expenses recorded on this day.</p>
          ) : (
            p.expenses_by_group.map((g) => (
              <div key={g.group_name} style={{ marginBottom: 10 }}>
                <div className="summary-line" style={{ fontWeight: 600 }}>
                  <span>Less: {g.group_name}</span><b className="neg">−{money(g.total)}</b>
                </div>
                {g.items.map((it) => (
                  <div key={it.category} className="summary-line small" style={{ paddingLeft: 18, color: 'var(--text-3)' }}>
                    <span>{it.category} {it.count > 1 && <span className="muted">×{it.count}</span>}</span>
                    <b className="muted">{money(it.total)}</b>
                  </div>
                ))}
              </div>
            ))
          )}
          <div className="summary-line" style={{ fontWeight: 600 }}><span>Total Expenses</span><b className="neg">−{money(p.total_expenses)}</b></div>
          <div className="summary-line total">
            <span>{p.net_profit >= 0 ? 'Net Profit' : 'Net Loss'}</span>
            <b className={p.net_profit >= 0 ? 'pos' : 'neg'}>{money(Math.abs(p.net_profit))}</b>
          </div>
          {d.kpis.sales_total > 0 && <div className="summary-line"><span>Net Margin</span><b>{p.net_margin_pct}%</b></div>}
        </div>
      </div>

      <Rows
        title="Expense Detail"
        icon={Receipt}
        total={d.kpis.expenses_total}
        rows={d.outflows.expenses}
        empty="No expenses recorded on this day"
        columns={[
          { key: 'ref', label: 'Ref', render: (r) => <span className="mono">{r.ref}</span> },
          { key: 'cat', label: 'Category', render: (r) => <span className="strong">{r.category}</span> },
          { key: 'grp', label: 'Group', render: (r) => <span className="badge amber">{r.group_name}</span> },
          { key: 'method', label: 'Paid From', render: accountCell },
          { key: 'note', label: 'Note', render: (r) => <span className="muted small">{r.note || ''}</span> },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <b className="neg">{money(r.amount)}</b> },
          { key: 'act', label: '', align: 'right', render: (r) => (
            <button className="btn btn-ghost btn-icon btn-sm" title="Delete expense" onClick={() => removeExpense(r)}><Trash2 size={14} /></button>
          ) },
        ]}
      />
    </>
  );
}

function BalanceTab({ d }) {
  const b = d.balance_sheet;
  const a = b.assets;
  const l = b.liabilities;
  const e = b.equity;

  const assetRows = [
    { label: 'Cash in Hand', amount: a.cash_in_hand },
    { label: 'Bank Balance', amount: a.bank_balance },
    { label: 'Accounts Receivable (customers owe)', amount: a.accounts_receivable },
    { label: 'Advances Paid to Vendors', amount: a.advances_to_vendors },
    { label: 'Closing Inventory (stock at cost)', amount: a.inventory_stock_value },
  ];
  const claimRows = [
    { label: 'Accounts Payable (owed to vendors)', amount: l.accounts_payable },
    { label: 'Advances Received from Customers', amount: l.advances_from_customers },
    { label: 'Owner Capital (introduced − drawings)', amount: e.owner_capital },
    { label: 'Retained Earnings (cumulative profit)', amount: e.retained_earnings },
    { label: 'Opening Balances & Adjustments', amount: e.opening_adjustments },
  ];

  return (
    <>
      <Ledger
        title={`Balance Sheet as at ${fmtDateLong(b.as_of_date)}`}
        left={{ heading: 'Assets — What the business owns', rows: assetRows }}
        right={{ heading: 'Liabilities & Equity — Who it belongs to', rows: claimRows }}
        foot={
          <div className="summary-box" style={{ marginTop: 18 }}>
            <div className="summary-line"><span>Total Assets</span><b>{money(a.total_assets)}</b></div>
            <div className="summary-line"><span>Total Liabilities</span><b>{money(l.total_liabilities)}</b></div>
            <div className="summary-line total"><span>Net Worth (owner's equity)</span><b>{money(e.total_equity)}</b></div>
            <div className="row small" style={{ marginTop: 10, color: b.is_balanced ? 'var(--green)' : 'var(--rose)' }}>
              {b.is_balanced ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              <span>{b.is_balanced ? 'Balanced — assets equal liabilities plus equity.' : 'Out of balance — please review the entries.'}</span>
            </div>
          </div>
        }
      />
      <div className="card">
        <div className="card-head"><h3>Equity Breakdown</h3></div>
        <div className="card-body">
          <div className="summary-line"><span>Capital introduced by owner</span><b>{money(e.capital_introduced)}</b></div>
          <div className="summary-line"><span>Less: owner drawings</span><b className="neg">−{money(e.owner_drawings)}</b></div>
          <div className="summary-line"><span>Retained earnings to date</span><b className={e.retained_earnings >= 0 ? 'pos' : 'neg'}>{money(e.retained_earnings)}</b></div>
          <div className="summary-line"><span>Opening balances & adjustments</span><b>{money(e.opening_adjustments)}</b></div>
          <div className="summary-line total"><span>Total Equity</span><b>{money(e.total_equity)}</b></div>
          <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>
            Opening customer and vendor balances and opening stock enter the books without a matching
            capital entry. That difference is shown on its own line rather than folded into another figure.
          </p>
        </div>
      </div>
    </>
  );
}

function PartiesTab({ d }) {
  return (
    <>
      <Rows
        title="Customers Active Today"
        icon={Users}
        rows={d.parties.customers}
        empty="No customer activity on this day"
        columns={[
          { key: 'name', label: 'Customer', render: (r) => <span className="strong">{r.name}</span> },
          { key: 'billed', label: 'Billed Today', align: 'right', render: (r) => money(r.billed) },
          { key: 'recv', label: 'Received Today', align: 'right', render: (r) => <span className="pos">{money(r.received)}</span> },
          { key: 'bal', label: 'Ledger Balance', align: 'right', render: (r) => <b className={r.balance > 0 ? 'neg' : 'pos'}>{money(r.balance)}</b> },
        ]}
      />
      <Rows
        title="Vendors Active Today"
        rows={d.parties.vendors}
        empty="No vendor activity on this day"
        columns={[
          { key: 'name', label: 'Vendor', render: (r) => <span className="strong">{r.name}</span> },
          { key: 'billed', label: 'Billed Today', align: 'right', render: (r) => money(r.billed) },
          { key: 'paid', label: 'Paid Today', align: 'right', render: (r) => <span className="neg">{money(r.paid)}</span> },
          { key: 'bal', label: 'Ledger Balance', align: 'right', render: (r) => <b className={r.balance > 0 ? 'neg' : 'pos'}>{money(r.balance)}</b> },
        ]}
      />
      <div className="grid grid-2">
        <Rows
          title="Top Debtors (receivables)"
          rows={d.parties.top_debtors}
          empty="Nobody owes the business right now"
          columns={[
            { key: 'name', label: 'Customer', render: (r) => <span className="strong">{r.name}</span> },
            { key: 'phone', label: 'Phone', render: (r) => <span className="muted small">{r.phone || '—'}</span> },
            { key: 'bal', label: 'Owes', align: 'right', render: (r) => <b className="neg">{money(r.balance)}</b> },
          ]}
        />
        <Rows
          title="Top Creditors (payables)"
          rows={d.parties.top_creditors}
          empty="The business owes nothing right now"
          columns={[
            { key: 'name', label: 'Vendor', render: (r) => <span className="strong">{r.name}</span> },
            { key: 'phone', label: 'Phone', render: (r) => <span className="muted small">{r.phone || '—'}</span> },
            { key: 'bal', label: 'Owed', align: 'right', render: (r) => <b className="neg">{money(r.balance)}</b> },
          ]}
        />
      </div>
    </>
  );
}

function NotesTab({ d, date }) {
  const [save, busy] = useSaver();
  const [notes, setNotes] = useState(d.notes || '');
  const [actual, setActual] = useState(d.closing_cash_actual ?? '');
  const [task, setTask] = useState('');

  const saveNotes = () =>
    save(() => api.put('/day-diary/notes', { date, notes, closing_cash_actual: actual }), 'Diary notes saved');

  const addTask = async (e) => {
    e.preventDefault();
    if (!task.trim()) return;
    const ok = await save(() => api.post('/day-diary/tasks', { date, task }), 'Task added');
    if (ok) setTask('');
  };

  const toggle = (t) => save(() => api.patch(`/day-diary/tasks/${t.id}`, { completed: !t.completed }));
  const remove = (t) => save(() => api.del(`/day-diary/tasks/${t.id}`), 'Task removed');

  const variance = actual === '' || actual == null ? null : Number(actual) - d.roznamcha.cash.closing;

  return (
    <>
      <div className="card">
        <div className="card-head"><h3><StickyNote size={17} /> Diary Notes for {fmtDateLong(date)}</h3></div>
        <div className="card-body">
          <Field label="What happened today" hint="visits, promises, follow-ups, anything worth remembering">
            <textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Write the day's diary here…" />
          </Field>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <Field label="Cash Counted in Drawer (Rs)" hint="physical count at closing">
              <input type="number" step="any" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="Leave blank if not counted" />
            </Field>
            <Field label="Book Says (closing cash)">
              <input value={money(d.roznamcha.cash.closing)} readOnly />
            </Field>
          </div>
          {variance !== null && (
            <div className="summary-box" style={{ marginTop: 14 }}>
              <div className="summary-line total">
                <span>{variance === 0 ? 'Drawer matches the book' : variance > 0 ? 'Excess cash in drawer' : 'Short cash in drawer'}</span>
                <b className={variance === 0 ? 'pos' : 'neg'}>{money(Math.abs(variance))}</b>
              </div>
            </div>
          )}
          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={busy} onClick={saveNotes}>{busy ? 'Saving…' : 'Save Notes'}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>To-do for the Day</h3></div>
        <div className="card-body">
          <form onSubmit={addTask} className="row" style={{ gap: 10 }}>
            <input className="grow" value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add a task, e.g. Call Ali Traders about pending payment" />
            <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={16} /> Add</button>
          </form>
          {d.tasks.length === 0 ? (
            <p className="muted small" style={{ marginTop: 14, marginBottom: 0 }}>No tasks for this day yet.</p>
          ) : (
            <div className="list" style={{ marginTop: 10 }}>
              {d.tasks.map((t) => (
                <div key={t.id} className="list-item" style={{ padding: '10px 0' }}>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggle(t)} title={t.completed ? 'Mark as pending' : 'Mark as done'}>
                    {t.completed ? <CheckCircle2 size={17} color="var(--green)" /> : <Circle size={17} />}
                  </button>
                  <span className="grow" style={{ textDecoration: t.completed ? 'line-through' : 'none', color: t.completed ? 'var(--text-3)' : undefined }}>
                    {t.task}
                  </span>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(t)} title="Remove task"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
