// Charts for the books: ranked bars and clustered columns, drawn as plain
// SVG/HTML so hover, keyboard focus and a table view all come built in.
//
// Colour follows the entity, not the row: money coming in (and balances held)
// is always blue, money going out is always orange. Both validated against the
// white card surface (CVD ΔE 24.7, normal-vision ΔE 33.6, contrast ≥ 3:1).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { money } from '../lib/format';

export const VIZ = {
  in: '#2a78d6',
  out: '#eb6834',
  grid: '#e8ecf2',
  baseline: '#cbd5e1',
  hover: 'rgba(17, 17, 20, 0.045)',
};

const nf = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 1 });

/** Axis ticks: in full below 10,000, compact once the axis reaches it. */
export function axisFormatter(max) {
  if (max < 10000) return (v) => nf.format(v);
  return (v) => {
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1e7) return `${sign}${nf.format(a / 1e7)} Cr`;
    if (a >= 1e5) return `${sign}${nf.format(a / 1e5)} Lac`;
    if (a >= 1e3) return `${sign}${nf.format(a / 1e3)}K`;
    return `${sign}${nf.format(a)}`;
  };
}

/** Round the top of an axis up to a clean number and split it into even steps. */
export function niceScale(maxValue, steps = 4) {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };
  const rough = maxValue / steps;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((u) => u >= rough) ?? 10 * pow;
  const max = unit * Math.ceil(maxValue / unit);
  const ticks = [];
  for (let v = 0; v <= max + unit / 2; v += unit) ticks.push(Math.round(v * 100) / 100);
  return { max, ticks };
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// ---------------------------------------------------------------- card chrome
/**
 * Title, optional legend, and the switch between the chart and its table twin.
 * While new data loads the previous render stays, dimmed, so nothing jumps.
 */
export function ChartCard({ title, subtitle, legend, chart, table, refreshing = false, footnote }) {
  const [view, setView] = useState('chart');
  return (
    <div className="card">
      <div className="card-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <h3>{title}</h3>
          {subtitle && <div className="muted small" style={{ marginTop: 3 }}>{subtitle}</div>}
        </div>
        <div className="seg" role="group" aria-label={`${title} view`}>
          <button type="button" className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')} title="Chart view">
            <BarChart3 size={14} aria-hidden="true" />
            <span className="sr-only">Chart</span>
          </button>
          <button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')} title="Table view">
            <Table2 size={14} aria-hidden="true" />
            <span className="sr-only">Table</span>
          </button>
        </div>
      </div>
      <div className="card-body" style={{ opacity: refreshing ? 0.55 : 1, transition: 'opacity 0.15s ease' }}>
        {view === 'chart' && legend}
        {view === 'chart' ? chart : table}
        {footnote && <p className="muted small" style={{ margin: '12px 0 0' }}>{footnote}</p>}
      </div>
    </div>
  );
}

/** Legend: a swatch that mirrors the mark, with the name in ordinary text ink. */
export function Legend({ items }) {
  return (
    <div className="row" style={{ gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <span key={it.label} className="row small" style={{ gap: 6, color: 'var(--text-2)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, display: 'inline-block' }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Tip({ x, y, boundsWidth, title, rows, foot }) {
  const flip = x > boundsWidth - 210;
  return (
    <div
      className="viz-tip"
      style={{ left: flip ? undefined : x + 14, right: flip ? boundsWidth - x + 14 : undefined, top: Math.max(0, y - 12) }}
      role="status"
    >
      <div className="viz-tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="viz-tip-row">
          <span className="viz-tip-key" style={{ background: r.color || 'var(--text-3)' }} />
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
      {foot && <div className="viz-tip-foot">{foot}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- ranked bars
/**
 * One bar per row, largest first, one colour. Bars share a single baseline
 * (the left edge, or a zero line when a balance is overdrawn) and the value
 * sits at the tip. Rows keep the order they are given.
 */
export function RankedBars({ rows, color = VIZ.in, fmt = money, ariaLabel, share = false }) {
  const [wrapRef, width] = useWidth();
  const [tip, setTip] = useState(null);

  const { lo, hi } = useMemo(() => {
    const vals = rows.map((r) => r.value);
    return { lo: Math.min(0, ...vals), hi: Math.max(0, ...vals) };
  }, [rows]);
  const span = hi - lo || 1;
  const total = rows.reduce((a, r) => a + Math.max(r.value, 0), 0);
  const BAR_ROOM = 0.7; // leaves space to the right of the longest bar for its value
  const zeroAt = (-lo / span) * BAR_ROOM * 100;

  if (!rows.length) return <p className="muted small" style={{ margin: 0 }}>Nothing to show for this period.</p>;

  const show = (row, e) => {
    const box = wrapRef.current.getBoundingClientRect();
    const pt = e?.clientX != null ? { x: e.clientX - box.left, y: e.clientY - box.top } : { x: width / 2, y: 20 };
    setTip({ row, ...pt });
  };

  return (
    <div ref={wrapRef} className="viz" style={{ position: 'relative' }} onPointerLeave={() => setTip(null)}>
      <div role="list" aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((row) => {
          const len = (Math.abs(row.value) / span) * BAR_ROOM * 100;
          const negative = row.value < 0;
          const left = negative ? zeroAt - len : zeroAt;
          const tipAt = negative ? zeroAt : zeroAt + len;
          return (
            <div
              key={row.id}
              role="listitem"
              tabIndex={0}
              className="viz-row"
              aria-label={`${row.label}: ${fmt(row.value)}`}
              onPointerMove={(e) => show(row, e)}
              onFocus={() => show(row)}
              onBlur={() => setTip(null)}
            >
              <div className="viz-row-label">
                <span className="viz-row-name">{row.label}</span>
                {row.sub && <span className="viz-row-sub">{row.sub}</span>}
              </div>
              <div className="viz-track">
                {lo < 0 && <span className="viz-zero" style={{ left: `${zeroAt}%` }} />}
                <span
                  className="viz-bar"
                  style={{
                    left: `${left}%`,
                    width: `max(${len}%, ${row.value === 0 ? 0 : 2}px)`,
                    background: color,
                    borderRadius: negative ? '4px 0 0 4px' : '0 4px 4px 0',
                  }}
                />
                <span className="viz-val" style={{ left: `calc(${tipAt}% + 8px)` }}>
                  {fmt(row.value)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {tip && (
        <Tip
          x={tip.x}
          y={tip.y}
          boundsWidth={width}
          title={tip.row.label}
          rows={[{ label: tip.row.sub || 'Amount', value: fmt(tip.row.value), color }]}
          foot={share && total > 0 && tip.row.value > 0 ? `${Math.round((tip.row.value / total) * 100)}% of the total` : null}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- columns
const topRounded = (x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};

/**
 * Two series side by side per period. A crosshair snaps to the nearest period
 * and one tooltip lists both series, so no one has to land on a 24px column.
 * Only each series' highest column carries a printed value; the rest live in
 * the axis, the tooltip and the table view.
 */
export function ColumnsChart({ data, series, height = 260, fmt = money, ariaLabel, netLabel }) {
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  const M = { top: 24, right: 8, bottom: 28, left: 54 };

  const maxV = Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key])));
  const { max, ticks } = useMemo(() => niceScale(maxV), [maxV]);
  const tickFmt = useMemo(() => axisFormatter(max), [max]);

  if (!data.length || maxV === 0) {
    return <p className="muted small" style={{ margin: 0 }}>No money moved in this period.</p>;
  }

  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const band = plotW / data.length;
  const colW = Math.max(3, Math.min(24, (band * 0.72 - 2 * (series.length - 1)) / series.length));
  const clusterW = colW * series.length + 2 * (series.length - 1);
  const y = (v) => M.top + plotH - (v / max) * plotH;
  const stride = Math.max(1, Math.ceil(46 / Math.max(band, 1)));

  // one printed value per series, at its tallest column, unless two would collide
  const peaks = series.map((s) => {
    let at = 0;
    data.forEach((d, i) => {
      if (d[s.key] > data[at][s.key]) at = i;
    });
    return { s, at, value: data[at][s.key] };
  });
  const labelled = peaks.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const shown = [];
  for (const p of labelled) {
    if (shown.every((q) => Math.abs(q.at - p.at) * band > 76)) shown.push(p);
  }

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left - M.left;
    const idx = Math.min(data.length - 1, Math.max(0, Math.floor(px / band)));
    setHover({ idx, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const hd = hover ? data[hover.idx] : null;

  return (
    <div ref={wrapRef} className="viz" style={{ position: 'relative' }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          style={{ display: 'block', overflow: 'visible' }}
          onPointerMove={onMove}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.baseline : VIZ.grid} strokeWidth="1" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">{tickFmt(t)}</text>
            </g>
          ))}

          {hd && <rect x={M.left + hover.idx * band} y={M.top} width={band} height={plotH} fill={VIZ.hover} />}

          {data.map((d, i) => {
            const x0 = M.left + i * band + (band - clusterW) / 2;
            return (
              <g key={d.key} opacity={hover && hover.idx !== i ? 0.62 : 1} style={{ transition: 'opacity 0.1s ease' }}>
                {series.map((s, k) => {
                  const h = (d[s.key] / max) * plotH;
                  if (h <= 0) return null;
                  return <path key={s.key} d={topRounded(x0 + k * (colW + 2), y(d[s.key]), colW, Math.max(h, 1), 4)} fill={s.color} />;
                })}
              </g>
            );
          })}

          {shown.map(({ s, at, value }) => {
            const k = series.indexOf(s);
            const cx = M.left + at * band + (band - clusterW) / 2 + k * (colW + 2) + colW / 2;
            const lx = Math.min(width - M.right - 2, Math.max(M.left + 2, cx));
            return (
              <text key={s.key} x={lx} y={y(value) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text-2)">
                {fmt(value)}
              </text>
            );
          })}

          {data.map((d, i) =>
            i % stride === 0 ? (
              <text key={d.key} x={M.left + i * band + band / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)">
                {d.label}
              </text>
            ) : null
          )}

          {hd && (
            <line x1={M.left + hover.idx * band + band / 2} x2={M.left + hover.idx * band + band / 2} y1={M.top} y2={M.top + plotH} stroke={VIZ.baseline} strokeWidth="1" />
          )}

          {/* one full-height hit area per period, focusable for the keyboard */}
          {data.map((d, i) => (
            <rect
              key={d.key}
              x={M.left + i * band}
              y={M.top}
              width={band}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${d.long_label || d.label}: ${series.map((s) => `${s.label} ${fmt(d[s.key])}`).join(', ')}`}
              onFocus={() => setHover({ idx: i, x: M.left + i * band + band / 2, y: M.top + 10 })}
              onBlur={() => setHover(null)}
              style={{ outline: 'none' }}
            />
          ))}
        </svg>
      )}
      {hd && (
        <Tip
          x={hover.x}
          y={hover.y}
          boundsWidth={width}
          title={hd.long_label || hd.label}
          rows={series.map((s) => ({ label: s.label, value: fmt(hd[s.key]), color: s.color }))}
          foot={netLabel ? `${netLabel}: ${hd.net < 0 ? '-' : ''}${fmt(Math.abs(hd.net))}` : null}
        />
      )}
    </div>
  );
}

/** Table twin shared by every chart: the same numbers, reachable without hover. */
export function DataTable({ columns, rows, footer }) {
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? row.key ?? i}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'r' : ''}>{footer[c.key] ?? ''}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

