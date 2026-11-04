import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Info, Inbox, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api } from '../lib/api';
import { pct } from '../lib/format';

// ---------------- App context (settings, lookups, toasts, confirm) ----------------
const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [settings, setSettings] = useState({});
  const [lookups, setLookups] = useState({ customers: [], vendors: [], products: [] });
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [version, setVersion] = useState(0); // bump to refetch data across pages

  const loadSettings = useCallback(() => api.get('/settings').then(setSettings).catch(() => {}), []);
  const loadLookups = useCallback(() => api.get('/lookups').then(setLookups).catch(() => {}), []);
  useEffect(() => {
    loadSettings();
    loadLookups();
  }, [loadSettings, loadLookups]);

  const toast = useCallback((message, type = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const confirm = useCallback(
    (opts) => new Promise((resolve) => setConfirmState({ ...(typeof opts === 'string' ? { message: opts } : opts), resolve })),
    []
  );

  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    loadLookups();
  }, [loadLookups]);

  return (
    <AppCtx.Provider value={{ settings, setSettings, loadSettings, lookups, loadLookups, toast, confirm, version, changed }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'success' ? <CheckCircle2 size={18} color="var(--green)" /> : t.type === 'error' ? <AlertTriangle size={18} color="var(--rose)" /> : <Info size={18} color="var(--aqua)" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      {confirmState && (
        <Modal
          title={confirmState.title || 'Please confirm'}
          onClose={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  confirmState.resolve(false);
                  setConfirmState(null);
                }}
              >
                Cancel
              </button>
              <button
                id="confirm-ok"
                className={`btn ${confirmState.danger === false ? 'btn-primary' : 'btn-danger'}`}
                onClick={() => {
                  confirmState.resolve(true);
                  setConfirmState(null);
                }}
              >
                {confirmState.okText || 'Delete'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, color: 'var(--text-2)' }}>{confirmState.message}</p>
        </Modal>
      )}
    </AppCtx.Provider>
  );
}

// ---------------- Data hook ----------------
/** Fetch data and refetch when deps or global `version` change. */
export function useFetch(url, params, deps = []) {
  const { version } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const key = JSON.stringify(params || {});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true);
    api
      .get(url, params)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, version, tick, ...deps]);
  return { data, loading, error, reload: () => setTick((t) => t + 1), setData };
}

// ---------------- Primitives ----------------
export function Modal({ title, children, onClose, footer, size = '', icon }) {
  const ref = useRef();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} ref={ref} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2 className="row">
            {icon}
            {title}
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, accent = 'aqua', foot, current, previous, invert = false, onClick }) {
  const d = previous !== undefined ? pct(current, previous) : null;
  const good = d === null ? null : invert ? d <= 0 : d >= 0;
  return (
    <div
      className="card stat"
      style={{ '--accent': `var(--${accent})`, '--accent-soft': `var(--${accent}-soft)`, cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
    >
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {d !== null ? (
          <span className={`delta-badge ${good ? 'up' : 'down'}`}>
            {d >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(d).toFixed(1)}%
          </span>
        ) : Icon ? (
          <span className="stat-icon">
            <Icon size={18} />
          </span>
        ) : null}
      </div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, title = 'Nothing here yet', children }) {
  return (
    <div className="empty">
      <Icon size={40} />
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export const Loading = () => (
  <div className="loading">
    <div className="spinner" />
  </div>
);

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span>
        {label} {hint && <span className="hint">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Seg({ options, value, onChange, id }) {
  return (
    <div className="seg" id={id}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Searchable select built on a native <input list>. Simpler: native select with optional filter. */
export function Select({ value, onChange, options, placeholder = 'Select…', id, required, disabled }) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Generic save helper: runs fn, toasts success/error, calls changed(). */
export function useSaver() {
  const { toast, changed } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (fn, successMsg) => {
    setBusy(true);
    try {
      const out = await fn();
      if (successMsg) toast(successMsg);
      changed();
      return out ?? true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}
