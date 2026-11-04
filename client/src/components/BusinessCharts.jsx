// The three chart cards that sit on the Day Diary and the Dashboard. They all
// read one payload from /day-diary/charts, so a figure on a chart always agrees
// with the same figure in the diary's tables.
import { ChartCard, ColumnsChart, DataTable, Legend, RankedBars, VIZ } from './charts';
import { fmtDate, money } from '../lib/format';

const pctOf = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

export function MoneyPositionCard({ data, refreshing }) {
  const rows = [...data.money]
    .sort((a, b) => b.balance - a.balance)
    .map((m) => ({ id: m.id, label: m.label, sub: m.sub, value: m.balance }));
  const overdrawn = rows.filter((r) => r.value < 0);

  return (
    <ChartCard
      title="Where your money is"
      subtitle={`${money(data.totals.money_total)} held in total · as of ${fmtDate(data.to)}`}
      refreshing={refreshing}
      chart={<RankedBars rows={rows} color={VIZ.in} share ariaLabel="Money held in cash and in each bank account" />}
      table={
        <DataTable
          columns={[
            { key: 'label', label: 'Where', render: (r) => (<><span className="strong">{r.label}</span>{r.sub && <div className="muted small">{r.sub}</div>}</>) },
            { key: 'value', label: 'Balance', align: 'right', render: (r) => money(r.value) },
            { key: 'share', label: 'Share', align: 'right', render: (r) => (r.value > 0 ? pctOf(r.value, rows.reduce((a, x) => a + Math.max(x.value, 0), 0)) : '—') },
          ]}
          rows={rows}
          footer={{ label: 'Total held', value: money(data.totals.money_total) }}
        />
      }
      footnote={
        overdrawn.length
          ? `${overdrawn.map((r) => r.label).join(' and ')} shows a negative balance: more has been paid out than was recorded as coming in. Check the cash book for a missing receipt or transfer.`
          : null
      }
    />
  );
}

export function ExpenseGroupsCard({ data, refreshing }) {
  const rows = data.expenses_by_group.map((g) => ({
    id: g.group_name,
    label: g.group_name,
    sub: `${g.count} ${g.count === 1 ? 'entry' : 'entries'}`,
    value: g.total,
  }));
  const total = data.totals.expenses;

  return (
    <ChartCard
      title="Where the money went"
      subtitle={`${money(total)} of expenses · ${fmtDate(data.from)} to ${fmtDate(data.to)}`}
      refreshing={refreshing}
      chart={<RankedBars rows={rows} color={VIZ.out} share ariaLabel="Expenses by group" />}
      table={
        <DataTable
          columns={[
            { key: 'label', label: 'Expense group', render: (r) => <span className="strong">{r.label}</span> },
            { key: 'sub', label: 'Entries', render: (r) => <span className="muted">{r.sub}</span> },
            { key: 'value', label: 'Amount', align: 'right', render: (r) => money(r.value) },
            { key: 'share', label: 'Share', align: 'right', render: (r) => pctOf(r.value, total) },
          ]}
          rows={rows}
          footer={{ label: 'Total', value: money(total) }}
        />
      }
      footnote="Bank charges are counted under Other Expense, the same as in the Profit & Loss."
    />
  );
}

export function MoneyFlowCard({ data, refreshing }) {
  const weekly = data.granularity === 'week';
  const rows = data.daily.map((d) => ({ ...d, key: d.from }));
  const series = [
    { key: 'received', label: 'Received', color: VIZ.in },
    { key: 'paid', label: 'Paid out', color: VIZ.out },
  ];

  return (
    <ChartCard
      title="Money received vs paid out"
      subtitle={`${weekly ? 'By week' : 'By day'} · ${fmtDate(data.from)} to ${fmtDate(data.to)} · net ${data.totals.net < 0 ? '-' : ''}${money(Math.abs(data.totals.net))}`}
      refreshing={refreshing}
      legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
      chart={
        <ColumnsChart
          data={rows}
          series={series}
          netLabel="Net"
          ariaLabel={`Money received and paid out, ${weekly ? 'week by week' : 'day by day'}, ${fmtDate(data.from)} to ${fmtDate(data.to)}`}
        />
      }
      table={
        <DataTable
          columns={[
            { key: 'long_label', label: weekly ? 'Week' : 'Day', render: (r) => <span className="strong">{r.long_label}</span> },
            { key: 'received', label: 'Received', align: 'right', render: (r) => money(r.received) },
            { key: 'paid', label: 'Paid out', align: 'right', render: (r) => money(r.paid) },
            { key: 'net', label: 'Net', align: 'right', render: (r) => <span className={r.net < 0 ? 'neg' : r.net > 0 ? 'pos' : 'muted'}>{money(r.net)}</span> },
          ]}
          rows={rows}
          footer={{
            long_label: 'Total',
            received: money(data.totals.received),
            paid: money(data.totals.paid),
            net: money(data.totals.net),
          }}
        />
      }
      footnote={data.excludes}
    />
  );
}
