import React, { useState } from 'react';
import { 
  TrendingUp, TrendingDown, DollarSign, Package, Users, Truck, AlertTriangle, 
  ArrowUpRight, ArrowDownRight, Factory, FileText, Calendar, Plus, Wallet
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useApp, useFetch, StatCard, PageHeader, Loading, Seg } from '../components/ui';
import { money, moneyShort, fmtDate, today, TYPE_META } from '../lib/format';
import { MoneyPositionCard, ExpenseGroupsCard } from '../components/BusinessCharts';
import { axisFormatter, niceScale } from '../components/charts';
import InvoiceModal from '../components/InvoiceModal';

export default function Dashboard({ onNavigate }) {
  const [period, setPeriod] = useState('month');
  const { data, loading } = useFetch('/dashboard', { period });
  const [activeInvoice, setActiveInvoice] = useState(null);
  // Same window as the rest of the page, but never past today: a balance "as of" a future date is meaningless.
  const range = data?.range;
  const { data: charts, loading: chartsLoading } = useFetch(
    range ? '/day-diary/charts' : null,
    range ? { from: range.from, to: range.to < today() ? range.to : today() } : undefined
  );

  if (loading && !data) return <Loading />;
  if (!data) return <div className="empty">Could not load dashboard data.</div>;

  const { current, previous, inventory, receivable, payable, net_position, counts, low_stock, top_debtors, top_creditors, series, recent } = data;

  // Round, even Y ticks (0, 25K, 50K ...) instead of whatever the data maximum happens to be.
  const peak = Math.max(0, ...series.flatMap((x) => [x.sales, x.purchases]));
  const yScale = niceScale(peak <= 10 ? 1000 : peak);
  const yTick = axisFormatter(yScale.max);

  return (
    <div>
      <PageHeader 
        title="Business Dashboard" 
        subtitle={`Real-time overview of Aqua Home Appliance · Performance by ${period}`}
      >
        <Seg 
          options={[
            { label: 'Today', value: 'day' },
            { label: 'This Week', value: 'week' },
            { label: 'This Month', value: 'month' },
            { label: 'This Year', value: 'year' },
          ]}
          value={period}
          onChange={setPeriod}
        />
      </PageHeader>

      {/* Top Financial & Asset KPIs */}
      <div className="grid grid-4 mb">
        <StatCard 
          label="Total Revenue (Sales)"
          value={money(current.sales)}
          current={current.sales}
          previous={previous.sales}
          icon={TrendingUp}
          accent="green"
          foot={
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
              <svg viewBox="0 0 240 50" style={{ width: '100%', height: 38, overflow: 'visible', margin: '4px 0 2px' }}>
                <path d="M 0,38 Q 60,40 100,28 T 170,30 T 235,8" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M 229,8 L 236,8 L 236,15" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{current.sales_count} sale{current.sales_count === 1 ? '' : 's'} this month</span>
            </div>
          }
        />
        <StatCard 
          label="Gross Profit"
          value={money(current.gross_profit)}
          current={current.gross_profit}
          previous={previous.gross_profit}
          icon={DollarSign}
          accent="green"
          foot={
            <div style={{ width: '100%' }}>
              <div style={{ height: 4, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden', margin: '6px 0 5px' }}>
                <div 
                  style={{ 
                    height: '100%', 
                    width: `${Math.min(100, Math.max(0, current.sales ? (current.gross_profit / current.sales) * 100 : 0))}%`, 
                    background: '#111114', 
                    borderRadius: 999 
                  }} 
                />
              </div>
              <span>Margin {current.sales ? ((current.gross_profit / current.sales) * 100).toFixed(1) : 0}%</span>
            </div>
          }
        />
        <StatCard 
          label="Total Inventory Value"
          value={money(inventory.value)}
          icon={Package}
          accent="indigo"
          foot={<span>{inventory.units} units · {inventory.items} items</span>}
        />
        <StatCard 
          label="Net Business Position"
          value={money(net_position)}
          icon={Wallet}
          accent="violet"
          foot={<span>Inventory + Due - Owed</span>}
        />
      </div>

      <div className="grid grid-4 mb">
        <StatCard 
          label="Customer Dues (Receivable)"
          value={money(receivable)}
          icon={Users}
          accent="amber"
          foot={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#d97706' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} /> 
              {top_debtors?.length || 0} customer(s) owe
            </span>
          }
          onClick={() => onNavigate?.('customers')}
        />
        <StatCard 
          label="Vendor Dues (Payable)"
          value={money(payable)}
          icon={Truck}
          accent="rose"
          foot={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#f87171' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} /> 
              We owe {top_creditors?.length || 0} vendor(s)
            </span>
          }
          onClick={() => onNavigate?.('vendors')}
        />
        <StatCard 
          label="Purchases Made"
          value={money(current.purchases)}
          current={current.purchases}
          previous={previous.purchases}
          invert={true}
          icon={Truck}
          accent="sky"
          foot={<span>{current.purchases_count} purchase bill(s)</span>}
        />
        <StatCard 
          label="Assembly Total Cost"
          value={money(current.assembly_cost)}
          icon={Factory}
          accent="violet"
          foot={<span>{current.assembly_units} finished unit(s) assembled</span>}
          onClick={() => onNavigate?.('assembly')}
        />
      </div>

      {/* Where the money is and where it went, for the period selected above */}
      {charts && (
        <div className="grid grid-2 mb">
          <MoneyPositionCard data={charts} refreshing={chartsLoading} />
          <ExpenseGroupsCard data={charts} refreshing={chartsLoading} />
        </div>
      )}

      {/* Main Charts & Side Panels */}
      <div className="grid grid-dash mb">
        {/* Sales & Purchases Trend Chart */}
        <div className="card">
          <div className="card-head">
            <h3>Sales & Purchases</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, fontWeight: 500 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#111114' }}>
                <span style={{ width: 14, height: 2.5, background: '#111114', borderRadius: 2 }} /> Sales
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
                <span style={{ width: 14, height: 2.5, background: '#94a3b8', borderRadius: 2 }} /> Purchases
              </span>
            </div>
          </div>
          <div className="card-body" style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#111114" stopOpacity={0.08}/>
                    <stop offset="95%" stopColor="#111114" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="purchasesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.05}/>
                    <stop offset="95%" stopColor="#94a3b8" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0, 0, 0, 0.05)" />
                <XAxis dataKey="label" stroke="#64748b" fontSize={12} tickLine={false} />
                <YAxis
                  stroke="#64748b"
                  fontSize={12}
                  tickLine={false}
                  width={52}
                  domain={[0, yScale.max]}
                  ticks={yScale.ticks}
                  tickFormatter={yTick}
                />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="chart-tooltip">
                          <div className="t">{label}</div>
                          <div style={{ color: '#ffffff' }}>Sales: {money(payload[0]?.value)}</div>
                          <div style={{ color: '#94a3b8' }}>Purchases: {money(payload[1]?.value)}</div>
                          <div style={{ color: '#10b981' }}>Gross Profit: {money(payload[0]?.payload?.profit)}</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area type="monotone" dataKey="sales" name="Sales" stroke="#111114" strokeWidth={2.5} fillOpacity={1} fill="url(#salesGrad)" />
                <Area type="monotone" dataKey="purchases" name="Purchases" stroke="#94a3b8" strokeWidth={1.8} fillOpacity={1} fill="url(#purchasesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Low Stock & Alerts Panel */}
        <div className="card">
          <div className="card-head">
            <h3>Stock alerts</h3>
            <span className="badge" style={{ background: '#f1f5f9', color: '#111114', fontWeight: 600 }}>
              {low_stock?.length || 0} low
            </span>
          </div>
          <div className="card-body" style={{ maxHeight: 320, overflowY: 'auto', padding: '0' }}>
            {low_stock && low_stock.length > 0 ? (
              <div className="list">
                {low_stock.map((item) => (
                  <div key={item.id} className="list-item">
                    <div className="li-main">
                      <div className="li-title">{item.name}</div>
                      <div className="li-sub">
                        Reorder threshold: {item.reorder_level} {item.unit}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="badge rose" style={{ fontWeight: 700 }}>
                        {item.stock} {item.unit} left
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty" style={{ padding: '30px 10px' }}>
                <Package size={30} color="var(--green)" />
                <p style={{ margin: 0, color: 'var(--text-2)' }}>All inventory stock levels are healthy!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Receivables, Payables, Recent Activity Grid */}
      <div className="grid grid-3 mb">
        {/* Top Debtors */}
        <div className="card">
          <div className="card-head">
            <h3>Top Customer Balances Due</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => onNavigate?.('customers')}>View All</button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {top_debtors && top_debtors.length > 0 ? (
              <div className="list">
                {top_debtors.map((c) => (
                  <div key={c.id} className="list-item">
                    <div className="li-main">
                      <div className="li-title">{c.name}</div>
                      <div className="li-sub">{c.phone || 'No phone'}</div>
                    </div>
                    <div className="strong warn">{money(c.balance)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty" style={{ padding: '24px' }}>No outstanding customer balances.</div>
            )}
          </div>
        </div>

        {/* Top Creditors */}
        <div className="card">
          <div className="card-head">
            <h3>Top Vendor Balances Owed</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => onNavigate?.('vendors')}>View All</button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {top_creditors && top_creditors.length > 0 ? (
              <div className="list">
                {top_creditors.map((v) => (
                  <div key={v.id} className="list-item">
                    <div className="li-main">
                      <div className="li-title">{v.name}</div>
                      <div className="li-sub">{v.phone || 'No phone'}</div>
                    </div>
                    <div className="strong neg">{money(v.balance)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty" style={{ padding: '24px' }}>No vendor balances owed.</div>
            )}
          </div>
        </div>

        {/* Recent Transactions & Activity */}
        <div className="card">
          <div className="card-head">
            <h3>Recent Business Activities</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => onNavigate?.('calendar')}>Calendar</button>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {recent && recent.length > 0 ? (
              <div className="list">
                {recent.slice(0, 5).map((act, i) => {
                  const meta = TYPE_META[act.type] || { badge: 'aqua' };
                  return (
                    <div key={i} className="list-item clickable" onClick={() => act.type === 'sale' && setActiveInvoice({ type: 'sale', id: act.id })}>
                      <div className="li-main">
                        <div className="row" style={{ gap: 6 }}>
                          <span className={`badge ${meta.badge}`}>{act.ref}</span>
                          <span className="li-title">{act.party}</span>
                        </div>
                        <div className="li-sub">{act.detail} · {fmtDate(act.date)}</div>
                      </div>
                      <div className="strong r">{money(act.amount)}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty" style={{ padding: '24px' }}>No transactions recorded yet.</div>
            )}
          </div>
        </div>
      </div>

      {activeInvoice && (
        <InvoiceModal 
          type={activeInvoice.type} 
          id={activeInvoice.id} 
          onClose={() => setActiveInvoice(null)} 
        />
      )}
    </div>
  );
}
