// Date helpers working with local 'YYYY-MM-DD' strings.
export const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => fmtDate(new Date());
export const parseDate = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
};
export const startOfWeek = (s) => {
  const d = parseDate(s);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return fmtDate(d);
};
export const startOfMonth = (s) => s.slice(0, 7) + '-01';
export const endOfMonth = (s) => {
  const d = parseDate(startOfMonth(s));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return fmtDate(d);
};
export const addMonths = (s, n) => {
  const d = parseDate(startOfMonth(s));
  d.setMonth(d.getMonth() + n);
  return fmtDate(d);
};

/** Returns {from, to} of the period containing `date`. */
export function periodRange(period, date = today()) {
  switch (period) {
    case 'day':
      return { from: date, to: date };
    case 'week': {
      const from = startOfWeek(date);
      return { from, to: addDays(from, 6) };
    }
    case 'year':
      return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` };
    case 'month':
    default:
      return { from: startOfMonth(date), to: endOfMonth(date) };
  }
}

/** Builds chart buckets ending at the period containing `date`. */
export function buckets(period, date = today()) {
  const out = [];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (period === 'day') {
    for (let i = 13; i >= 0; i--) {
      const d = addDays(date, -i);
      out.push({ from: d, to: d, label: `${d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}` });
    }
  } else if (period === 'week') {
    const ws = startOfWeek(date);
    for (let i = 11; i >= 0; i--) {
      const f = addDays(ws, -7 * i);
      out.push({ from: f, to: addDays(f, 6), label: `${f.slice(8)} ${MONTHS[+f.slice(5, 7) - 1]}` });
    }
  } else if (period === 'year') {
    const y = +date.slice(0, 4);
    for (let i = 4; i >= 0; i--) out.push({ from: `${y - i}-01-01`, to: `${y - i}-12-31`, label: String(y - i) });
  } else {
    for (let i = 11; i >= 0; i--) {
      const f = addMonths(date, -i);
      out.push({ from: f, to: endOfMonth(f), label: `${MONTHS[+f.slice(5, 7) - 1]} ${f.slice(2, 4)}` });
    }
  }
  return out;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export const num = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
export const str = (v) => (v == null ? null : String(v).trim() || null);

/** Wrap a sync/async handler so thrown errors reach the error middleware. */
export const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.then === 'function') out.then((v) => v !== undefined && !res.headersSent && res.json(v)).catch(next);
    else if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    next(e);
  }
};
