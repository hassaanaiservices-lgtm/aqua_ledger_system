import React, { useState } from 'react';
import { 
  FileBarChart, Download, FileSpreadsheet, FileText, 
  Search, Filter, Calendar, Printer, RefreshCw 
} from 'lucide-react';
import { useFetch, PageHeader, Loading, Empty, Field } from '../components/ui';
import { fmtDate, PAYMENT_METHODS } from '../lib/format';
import { ReportTable, ReportExportButtons, RangeFilter } from '../components/ReportView';

const REPORT_TYPES = [
  { id: 'inventory', name: 'Inventory Valuation & Stock Levels', dated: false },
  { id: 'sales', name: 'Sales Register & Invoices', dated: true },
  { id: 'sales-items', name: 'Sales by Product (Line Items)', dated: true },
  { id: 'purchases', name: 'Purchases & Vendor Bills', dated: true },
  { id: 'purchases-items', name: 'Purchases by Product (Line Items)', dated: true },
  { id: 'outstanding', name: 'Outstanding Balances (Receivables & Payables)', dated: false },
  { id: 'payments', name: 'Payments Ledger (In & Out)', dated: true },
  { id: 'payment-methods', name: 'Payment Methods (Cash & Bank Ledgers)', dated: true },
  { id: 'diary-days', name: 'Day-wise Diary Register', dated: true },
  { id: 'assemblies', name: 'Product Assembly & Cost Report', dated: true },
  { id: 'stock-movements', name: 'Complete Stock Movement Audit', dated: true },
  { id: 'expenses', name: 'Operating Expenses Report', dated: true },
  { id: 'profit-loss', name: 'Profit & Loss Statement (P&L)', dated: true },
  { id: 'transactions', name: 'Centralized Transactions Master Feed', dated: true },
];

export default function Reports({ onNavigate }) {
  const [reportType, setReportType] = useState('inventory');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [partyType, setPartyType] = useState('all');
  const [search, setSearch] = useState('');
  const [account, setAccount] = useState('all');
  const { data: bankData } = useFetch('/bank-accounts');

  const currentReportDef = REPORT_TYPES.find((r) => r.id === reportType) || REPORT_TYPES[0];

  const params = {
    from: currentReportDef.dated ? fromDate : undefined,
    to: currentReportDef.dated ? toDate : undefined,
    party: partyType === 'all' ? undefined : partyType,
    q: search || undefined,
    account: reportType === 'payment-methods' ? account : undefined,
  };

  const { data: report, loading, error, reload } = useFetch(`/reports/${reportType}`, params);

  return (
    <div>
      <PageHeader 
        title="Business Reports & Analytics" 
        subtitle="Generate comprehensive reports, filter by date or party, and export to PDF, Excel, or CSV"
      >
        <ReportExportButtons report={report} loading={loading} />
      </PageHeader>

      {/* Report Selection Tabs */}
      <div className="card mb">
        <div className="tabs" style={{ padding: '0 10px', overflowX: 'auto' }}>
          {REPORT_TYPES.map((rt) => (
            <button 
              key={rt.id} 
              type="button"
              className={reportType === rt.id ? 'on' : ''} 
              onClick={() => setReportType(rt.id)}
            >
              {rt.name}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="filters">
          {currentReportDef.dated && (
            <RangeFilter from={fromDate} to={toDate} onChange={(r) => { setFromDate(r.from); setToDate(r.to); }} />
          )}

          {reportType === 'payment-methods' && (
            <Field label="Payment Method / Account">
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="all">All methods (summary)</option>
                <optgroup label="Cash & bank accounts">
                  <option value="cash">Cash in Hand</option>
                  {(bankData?.accounts ?? []).map((a) => (
                    <option key={a.id} value={`bank:${a.id}`}>{a.owner_name ? `${a.name} (${a.owner_name})` : a.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Payment methods (all banks)">
                  {PAYMENT_METHODS.filter((m) => m.value !== 'cash').map((m) => (
                    <option key={m.value} value={`method:${m.value}`}>{m.label}</option>
                  ))}
                </optgroup>
              </select>
            </Field>
          )}

          {reportType === 'outstanding' && (
            <Field label="Party Filter">
              <select value={partyType} onChange={(e) => setPartyType(e.target.value)}>
                <option value="all">All (Customers & Vendors)</option>
                <option value="customer">Customers Only</option>
                <option value="vendor">Vendors Only</option>
              </select>
            </Field>
          )}

          <div className="search field wide" style={{ alignSelf: 'flex-end' }}>
            <Search size={16} />
            <input 
              placeholder="Search in report..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>

          <button 
            type="button" 
            className="btn btn-ghost btn-icon" 
            onClick={reload} 
            title="Refresh Report" 
            style={{ alignSelf: 'flex-end', marginBottom: 2 }}
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Report Content */}
        <div className="table-wrap">
          {loading ? (
            <Loading />
          ) : error ? (
            <Empty title={`Error loading report: ${error}`} />
          ) : !report || !report.rows || report.rows.length === 0 ? (
            <Empty title="No data records for this report and filter" />
          ) : (
            <div>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{report.title}</h3>
                  <span className="muted small">
                    {report.rows.length} record{report.rows.length === 1 ? '' : 's'} · Generated {fmtDate(new Date().toISOString())}
                  </span>
                </div>
              </div>

              <ReportTable report={report} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
