import React, { useState } from 'react';
import { 
  Calendar as CalIcon, ChevronLeft, ChevronRight, Download, 
  ShoppingCart, Truck, CreditCard, Factory, ArrowUpDown, FileText, CheckCircle2 
} from 'lucide-react';
import { useApp, useFetch, PageHeader, Loading, Empty } from '../components/ui';
import { money, fmtDate, fmtDateLong, TYPE_META, MONTHS_FULL } from '../lib/format';
import InvoiceModal from '../components/InvoiceModal';

export default function CalendarPage({ onNavigate }) {
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7)); // 'YYYY-MM'
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10)); // 'YYYY-MM-DD'
  const [activeInvoice, setActiveInvoice] = useState(null);

  // Month overview dots
  const { data: calData, loading: loadingCal } = useFetch('/calendar', { month: currentMonth });

  // Selected day activities
  const { data: dayData, loading: loadingDay } = useFetch('/activity', { 
    from: selectedDate, 
    to: selectedDate 
  });

  const [year, month] = currentMonth.split('-').map(Number);

  const handlePrevMonth = () => {
    const prev = new Date(year, month - 2, 1);
    const s = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    setCurrentMonth(s);
  };

  const handleNextMonth = () => {
    const next = new Date(year, month, 1);
    const s = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    setCurrentMonth(s);
  };

  // Build calendar matrix (42 cells: 6 weeks x 7 days)
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month, 0).getDate();

  const calendarDays = [];
  // Days from previous month
  const prevMonthLastDate = new Date(year, month - 1, 0).getDate();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthLastDate - i;
    const m = month === 1 ? 12 : month - 1;
    const y = month === 1 ? year - 1 : year;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarDays.push({ date: dateStr, dayNum: d, isCurrentMonth: false });
  }
  // Days of current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarDays.push({ date: dateStr, dayNum: d, isCurrentMonth: true });
  }
  // Remaining days to fill 35 or 42 cells
  const remaining = (7 - (calendarDays.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const m = month === 12 ? 1 : month + 1;
    const y = month === 12 ? year + 1 : year;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarDays.push({ date: dateStr, dayNum: d, isCurrentMonth: false });
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader 
        title="Business Calendar & Daily Operations" 
        subtitle="Click any date to view all activities recorded on that day: sales, purchases, payments, and stock changes"
      />

      <div className="grid grid-dash mb">
        {/* Calendar Grid */}
        <div className="card">
          <div className="card-head">
            <h3 className="row">
              <CalIcon size={18} color="var(--aqua)" /> 
              {MONTHS_FULL[month - 1]} {year}
            </h3>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-ghost btn-icon" onClick={handlePrevMonth} title="Previous Month">
                <ChevronLeft size={16} />
              </button>
              <button 
                className="btn btn-sm" 
                onClick={() => {
                  const now = new Date().toISOString();
                  setCurrentMonth(now.slice(0, 7));
                  setSelectedDate(now.slice(0, 10));
                }}
              >
                Today
              </button>
              <button className="btn btn-sm btn-ghost btn-icon" onClick={handleNextMonth} title="Next Month">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="cal-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dow) => (
              <div key={dow} className="cal-dow">{dow}</div>
            ))}

            {calendarDays.map((cell) => {
              const daySummary = calData?.days?.[cell.date];
              const isSelected = selectedDate === cell.date;
              const isToday = todayStr === cell.date;

              return (
                <div 
                  key={cell.date}
                  className={`cal-day ${!cell.isCurrentMonth ? 'other' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                  onClick={() => setSelectedDate(cell.date)}
                >
                  <div className="row-between">
                    <span className="cal-num">{cell.dayNum}</span>
                    {daySummary && (
                      <span className="badge aqua" style={{ fontSize: '10px', padding: '1px 5px' }}>
                        {daySummary.total}
                      </span>
                    )}
                  </div>

                  {daySummary && (
                    <div className="cal-dots">
                      {daySummary.types.sale && (
                        <span className="cal-chip" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                          {daySummary.types.sale.count} sale
                        </span>
                      )}
                      {daySummary.types.purchase && (
                        <span className="cal-chip" style={{ background: 'var(--sky-soft)', color: 'var(--sky)' }}>
                          {daySummary.types.purchase.count} pur
                        </span>
                      )}
                      {daySummary.types.payment_in && (
                        <span className="cal-chip" style={{ background: 'var(--aqua-soft)', color: 'var(--aqua)' }}>
                          {daySummary.types.payment_in.count} rcv
                        </span>
                      )}
                      {daySummary.types.assembly && (
                        <span className="cal-chip" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}>
                          {daySummary.types.assembly.count} asm
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Date Activity Feed */}
        <div className="card">
          <div className="card-head">
            <div>
              <h3 style={{ margin: 0, fontSize: '15px' }}>Activities on {fmtDate(selectedDate)}</h3>
              <span className="muted small">{fmtDateLong(selectedDate)}</span>
            </div>
          </div>

          <div className="card-body" style={{ maxHeight: 520, overflowY: 'auto', padding: 0 }}>
            {loadingDay ? (
              <Loading />
            ) : !dayData || !dayData.activities || dayData.activities.length === 0 ? (
              <Empty title="No business activities on this date">
                <p className="muted small">No sales, purchases, payments or stock movements were recorded on {fmtDate(selectedDate)}.</p>
              </Empty>
            ) : (
              <div>
                {/* Summary bar for the day */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, padding: 14, background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <span className="muted small">Sales Billing:</span>
                    <div className="strong" style={{ color: 'var(--green)' }}>
                      {money(dayData.summary?.sale?.amount || 0)}
                    </div>
                  </div>
                  <div>
                    <span className="muted small">Cash Received:</span>
                    <div className="strong" style={{ color: 'var(--aqua)' }}>
                      {money(dayData.summary?.payment_in?.amount || 0)}
                    </div>
                  </div>
                </div>

                <div className="timeline">
                  {dayData.activities.map((act, idx) => {
                    const meta = TYPE_META[act.type] || { badge: 'aqua' };
                    return (
                      <div key={idx} className="tl-item">
                        <div className="tl-icon" style={{ background: meta.soft, color: meta.color }}>
                          {act.type === 'sale' ? <ShoppingCart size={16} /> :
                           act.type === 'purchase' ? <Truck size={16} /> :
                           act.type === 'payment_in' ? <CreditCard size={16} /> :
                           act.type === 'payment_out' ? <CreditCard size={16} /> :
                           act.type === 'assembly' ? <Factory size={16} /> :
                           <ArrowUpDown size={16} />}
                        </div>
                        <div className="tl-main">
                          <div className="row-between">
                            <span className={`badge ${meta.badge}`} style={{ fontSize: '11px' }}>
                              {meta.label} · {act.ref}
                            </span>
                            <span className="strong mono">{money(act.amount)}</span>
                          </div>
                          <div className="strong" style={{ marginTop: 4 }}>{act.party}</div>
                          <div className="muted small">{act.detail}</div>

                          {act.type === 'sale' && (
                            <button 
                              className="btn btn-sm btn-ghost" 
                              style={{ marginTop: 6, padding: '2px 8px', fontSize: '11.5px', color: 'var(--aqua)' }}
                              onClick={() => setActiveInvoice({ type: 'sale', id: act.id })}
                            >
                              <Download size={13} /> View Invoice
                            </button>
                          )}
                          {act.type === 'purchase' && (
                            <button 
                              className="btn btn-sm btn-ghost" 
                              style={{ marginTop: 6, padding: '2px 8px', fontSize: '11.5px', color: 'var(--sky)' }}
                              onClick={() => setActiveInvoice({ type: 'purchase', id: act.id })}
                            >
                              <Download size={13} /> View Bill
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
