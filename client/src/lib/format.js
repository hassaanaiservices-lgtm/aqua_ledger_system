// Formatting helpers (PKR / Pakistani number grouping).
export const CURRENCY = 'Rs';

const nf0 = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 });
const nf2 = new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n) => nf0.format(Number(n) || 0);
export const money = (n, { decimals = false } = {}) => {
  const v = Number(n) || 0;
  const s = (decimals ? nf2 : nf0).format(Math.abs(v));
  return `${v < 0 ? '-' : ''}${CURRENCY} ${s}`;
};
export const money2 = (n) => money(n, { decimals: true });
export const moneySigned = (n) => money(n);

/** Compact: Rs 1.2M / Rs 45.3K */
export const moneyShort = (n) => {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}${CURRENCY} ${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}${CURRENCY} ${(a / 1e5).toFixed(2)} Lac`;
  if (a >= 1e3) return `${sign}${CURRENCY} ${(a / 1e3).toFixed(1)}K`;
  return `${sign}${CURRENCY} ${nf0.format(a)}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${d} ${MONTHS[+m - 1]} ${y}`;
};
export const fmtDateLong = (s) => {
  if (!s) return '';
  const d = parseDate(s);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISO(new Date());
export const parseDate = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const monthStart = (s = today()) => s.slice(0, 7) + '-01';
export const yearStart = (s = today()) => s.slice(0, 4) + '-01-01';

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export const pct = (cur, prev) => {
  if (!prev) return cur ? 100 : 0;
  return ((cur - prev) / Math.abs(prev)) * 100;
};

// ---- Amount in words (South-Asian system: thousand, lakh, crore) ----
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}
function three(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' ');
}
export function amountInWords(amount) {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  const paisa = Math.round((Math.abs(Number(amount) || 0) - n) * 100);
  if (n === 0 && !paisa) return 'Rupees Zero Only';
  const parts = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${crore >= 100 ? three(crore) : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (n) parts.push(three(n));
  let s = `Rupees ${parts.join(' ') || 'Zero'}`;
  if (paisa) s += ` and ${two(paisa)} Paisa`;
  return `${s} Only`;
}

export const TYPE_META = {
  sale: { label: 'Sale', color: 'var(--green)', soft: 'var(--green-soft)', badge: 'green' },
  purchase: { label: 'Purchase', color: 'var(--sky)', soft: 'var(--sky-soft)', badge: 'sky' },
  payment_in: { label: 'Payment Received', color: 'var(--aqua)', soft: 'var(--aqua-soft)', badge: 'aqua' },
  payment_out: { label: 'Payment Made', color: 'var(--amber)', soft: 'var(--amber-soft)', badge: 'amber' },
  expense: { label: 'Expense', color: 'var(--rose)', soft: 'var(--rose-soft)', badge: 'rose' },
  assembly: { label: 'Assembly', color: 'var(--violet)', soft: 'var(--violet-soft)', badge: 'violet' },
  stock: { label: 'Stock Adjustment', color: 'var(--indigo)', soft: 'var(--indigo-soft)', badge: 'indigo' },
};

export const PRODUCT_TYPES = {
  raw: { label: 'Raw Material', badge: 'amber' },
  finished: { label: 'Assembled Product', badge: 'violet' },
  trading: { label: 'Trading Item', badge: 'sky' },
};

// Must stay in step with PAYMENT_METHODS in server/src/db.js: `account` decides
// whether an amount lands in the cash book or the bank book.
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', account: 'cash' },
  { value: 'bank', label: 'Bank Transfer', account: 'bank' },
  { value: 'cheque', label: 'Cheque', account: 'bank' },
  { value: 'online', label: 'Online / EasyPaisa / JazzCash', account: 'bank' },
  { value: 'card', label: 'Debit / Credit Card', account: 'bank' },
];
