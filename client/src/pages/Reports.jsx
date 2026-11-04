import React, { useState } from 'react';
import { 
  FileBarChart, Download, FileSpreadsheet, FileText, 
  Search, Filter, Calendar, Printer, RefreshCw 
} from 'lucide-react';
import { useApp, useFetch, PageHeader, Loading, Empty, Field } from '../components/ui';
import { money, fmtDate, moneySigned } from '../lib/format';
import { exportCsv, exportXlsx } from '../lib/export';
import { downloadReportPdf } from '../lib/pdf';

const REPORT_TYPES = [
  { id: 'inventory', name: 'Inventory Valuation & Stock Levels', dated: false },
  { id: 'sales', name: 'Sales Register & Invoices', dated: true },
  { id: 'sales-items', name: 'Sales by Product (Line Items)', dated: true },
  { id: 'purchases', name: 'Purchases & Vendor Bills', dated: true },
  { id: 'purchases-items', name: 'Purchases by Product (Line Items)', dated: true },
  { id: 'outstanding', name: 'Outstanding Balances (Receivables & Payables)', dated: false },
  { id: 'payments', name: 'Payments Ledger (In & Out)', dated: true },
  { id: 'assemblies', name: 'Product Assembly & Cost Report', dated: true },
  { id: 'stock-movements', name: 'Complete Stock Movement Audit', dated: true },
  { id: 'expenses', name: 'Operating Expenses Report', dated: true },
  { id: 'profit-loss', name: 'Profit & Loss Statement (P&L)', dated: true },
  { id: 'transactions', name: 'Centralized Transactions Master Feed', dated: true },
];

export default function Reports({ onNavigate }) {
  const { settings, lookups, toast } = useApp();
  const [reportType, setReportType] = useState('inventory');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [partyType, setPartyType] = useState('all');
  const [search, setSearch] = useState('');

  const currentReportDef = REPORT_TYPES.find((r) => r.id === reportType) || REPORT_TYPES[0];

  const params = {
    from: currentReportDef.dated ? fromDate : undefined,
    to: currentReportDef.dated ? toDate : undefined,
    party: partyType === 'all' ? undefined : partyType,
    q: search || undefined,
  };

  const { data: report, loading, error, reload } = useFetch(`/reports/${reportType}`, params);

  const handleExportPdf = () => {
    if (!report || !report.rows || report.rows.length === 0) {
      toast('No data records available to export', 'error');
      return;
    }
    try {
      downloadReportPdf(report, settings);
      toast('Report exported to PDF');
    } catch (err) {
      console.error(err);
      toast('Failed to export PDF: ' + err.message, 'error');
    }
  };

  const handleExportExcel = () => {
    if (!report || !report.rows || report.rows.length === 0) {
      toast('No data records available to export', 'error');
      return;
    }
    try {
      exportXlsx(report);
      toast('Report exported to Excel (.xlsx)');
    } catch (err) {
      console.error(err);
      toast('Failed to export Excel: ' + err.message, 'error');
    }
  };

  const handleExportCsv = () => {
    if (!report || !report.rows || report.rows.length === 0) {
      toast('No data records available to export', 'error');
      return;
    }
    try {
      exportCsv(report);
      toast('Report exported to CSV');
    } catch (err) {
      console.error(err);
      toast('Failed to export CSV: ' + err.message, 'error');
    }
  };

  return (
    <div>
      <PageHeader 
        title="Business Reports & Analytics" 
        subtitle="Generate comprehensive reports, filter by date or party, and export to PDF, Excel, or CSV"
      >
        <button 
          type="button" 
          className="btn btn-primary" 
          onClick={handleExportPdf} 
          disabled={!report || loading || !report.rows || report.rows.length === 0}
        >
          <Download size={15} /> Export PDF
        </button>
        <button 
          type="button" 
          className="btn" 
          onClick={handleExportExcel} 
          disabled={!report || loading || !report.rows || report.rows.length === 0}
        >
          <FileSpreadsheet size={15} /> Export Excel
        </button>
        <button 
          type="button" 
          className="btn" 
          onClick={handleExportCsv} 
          disabled={!report || loading || !report.rows || report.rows.length === 0}
        >
          <FileText size={15} /> Export CSV
        </button>
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
            <>
              <Field label="From Date">
                <input 
                  type="date" 
                  value={fromDate} 
                  onChange={(e) => setFromDate(e.target.value)} 
                />
              </Field>
              <Field label="To Date">
                <input 
                  type="date" 
                  value={toDate} 
                  onChange={(e) => setToDate(e.target.value)} 
                />
              </Field>
            </>
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

              <table className="table">
                <thead>
                  <tr>
                    {report.columns.map((c) => (
                      <th key={c.key} className={c.type === 'money' || c.type === 'number' ? 'r' : ''}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, idx) => (
                    <tr key={idx}>
                      {report.columns.map((c) => {
                        const val = row[c.key];
                        return (
                          <td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'r' : ''}>
                            {c.type === 'money' ? (
                              <span className={val < 0 ? 'neg' : ''}>{money(val)}</span>
                            ) : c.type === 'date' ? (
                              fmtDate(val)
                            ) : (
                              val ?? '—'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {report.totals && (
                  <tfoot>
                    <tr>
                      {report.columns.map((c, i) => {
                        const val = report.totals[c.key];
                        return (
                          <td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'r' : ''}>
                            {i === 0
                              ? 'TOTAL'
                              : c.key in report.totals
                              ? c.type === 'money'
                                ? money(val)
                                : val != null
                                ? Number(val).toLocaleString()
                                : ''
                              : ''}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>

              {report.note && (
                <div className="muted small" style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', fontStyle: 'italic' }}>
                  * {report.note}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
