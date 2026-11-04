// PDF generation: sale invoices, purchase bills, ledger statements and generic reports.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { amountInWords, fmtDate } from './format';

const C = {
  navy: [11, 18, 32],
  navy2: [22, 34, 60],
  aqua: [34, 199, 230],
  indigo: [99, 102, 241],
  text: [30, 41, 59],
  muted: [100, 116, 139],
  line: [226, 232, 240],
  soft: [241, 245, 249],
  green: [22, 163, 74],
  amber: [217, 119, 6],
  rose: [225, 29, 72],
};

const fmt = (n) =>
  `Rs ${new Intl.NumberFormat('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(Number(n) || 0))}`;
const fmtSigned = (n) => `${Number(n) < 0 ? '-' : ''}${fmt(n)}`;
const qtyFmt = (n) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 3 }).format(Number(n) || 0);

/** Dark header band with business identity on the left and document title on the right. */
function header(doc, settings, title, metaLines = [], { compact = false } = {}) {
  const W = doc.internal.pageSize.getWidth();
  const H = compact ? 30 : 40;
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, W, H, 'F');
  // accent gradient stripe (two-tone)
  doc.setFillColor(...C.aqua);
  doc.rect(0, H, W / 2, 1.6, 'F');
  doc.setFillColor(...C.indigo);
  doc.rect(W / 2, H, W / 2, 1.6, 'F');

  // logo: the uploaded image when there is one, else the initial in a circle
  let drewLogo = false;
  if (settings.business_logo) {
    try {
      const size = compact ? 11 : 14;
      const fmt = /^data:image\/(png|jpe?g|webp)/i.exec(settings.business_logo)?.[1]?.toUpperCase().replace('JPG', 'JPEG');
      if (fmt) {
        doc.addImage(settings.business_logo, fmt, 20 - size / 2, (compact ? 15 : 18) - size / 2, size, size);
        drewLogo = true;
      }
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) {
    doc.setFillColor(...C.aqua);
    doc.circle(20, compact ? 15 : 18, compact ? 5.5 : 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(compact ? 9 : 11);
    doc.text((settings.business_name || 'B')[0].toUpperCase(), 20, compact ? 16.6 : 19.8, { align: 'center' });
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');

  doc.setFontSize(compact ? 14 : 17);
  doc.text(settings.business_name || 'My Business', 30, compact ? 14 : 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(180, 196, 222);
  const contact = [settings.business_address, [settings.business_phone, settings.business_email].filter(Boolean).join('  ·  '), settings.business_ntn ? `NTN: ${settings.business_ntn}` : '']
    .filter(Boolean);
  contact.slice(0, compact ? 1 : 3).forEach((l, i) => doc.text(l, 30, (compact ? 19.5 : 22) + i * 4.4, { maxWidth: W / 2 - 20 }));

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(compact ? 14 : 20);
  doc.setTextColor(...C.aqua);
  doc.text(title, W - 14, compact ? 14 : 17, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(220, 228, 240);
  metaLines.forEach((l, i) => doc.text(l, W - 14, (compact ? 20 : 24) + i * 4.6, { align: 'right' }));
  return H + 8;
}

function pageFooters(doc, settings, label) {
  const n = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...C.line);
    doc.line(14, H - 12, W - 14, H - 12);
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(`${settings.business_name || ''} · ${label}`, 14, H - 7);
    doc.text(`Page ${i} of ${n}  ·  Generated ${new Date().toLocaleString('en-GB')}`, W - 14, H - 7, { align: 'right' });
  }
}

function infoBox(doc, x, y, w, title, lines) {
  doc.setFillColor(...C.soft);
  doc.setDrawColor(...C.line);
  const h = 9 + lines.length * 5;
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text(title.toUpperCase(), x + 4, y + 5.5);
  lines.forEach((l, i) => {
    doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
    doc.setFontSize(i === 0 ? 10.5 : 9);
    doc.setTextColor(...C.text);
    doc.text(String(l), x + 4, y + 11 + i * 5, { maxWidth: w - 8 });
  });
  return y + h;
}

function stamp(doc, x, y, text, color) {
  doc.saveGraphicsState?.();
  doc.setDrawColor(...color);
  doc.setTextColor(...color);
  doc.setLineWidth(0.8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const w = doc.getTextWidth(text) + 10;
  doc.roundedRect(x - w, y - 6.5, w, 10, 2, 2, 'S');
  doc.text(text, x - w / 2, y + 0.8, { align: 'center' });
  doc.setLineWidth(0.2);
  doc.restoreGraphicsState?.();
}

function totalsBlock(doc, x, y, w, rows) {
  rows.forEach((r, i) => {
    const yy = y + i * 6.5;
    if (r.highlight) {
      doc.setFillColor(...C.navy);
      doc.roundedRect(x, yy - 4.6, w, 8, 1.5, 1.5, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
    } else {
      doc.setTextColor(...(r.color || C.text));
      doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
      doc.setFontSize(9.5);
    }
    doc.text(r.label, x + 3, yy);
    doc.text(r.value, x + w - 3, yy, { align: 'right' });
  });
  return y + rows.length * 6.5;
}

function signatures(doc, y, left, right) {
  const W = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...C.muted);
  doc.line(14, y, 74, y);
  doc.line(W - 74, y, W - 14, y);
  doc.setFontSize(8.5);
  doc.setTextColor(...C.muted);
  doc.text(left, 44, y + 4.5, { align: 'center' });
  doc.text(right, W - 44, y + 4.5, { align: 'center' });
}

/** Shared template for sale invoices and purchase bills. */
function tradeDocument({ settings, title, number, date, party, partyLabel, items, priceKey, totals, account, extraMeta = [], note, filename }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = header(doc, settings, title, [`No: ${number}`, `Date: ${fmtDate(date)}`, ...extraMeta]);

  const boxW = (W - 28 - 6) / 2;
  const partyLines = [party.name, party.phone && `Phone: ${party.phone}`, party.email, party.address, party.cnic && `CNIC: ${party.cnic}`, party.ntn && `NTN: ${party.ntn}`].filter(Boolean);
  const y1 = infoBox(doc, 14, y, boxW, partyLabel, partyLines);
  const y2 = infoBox(doc, 14 + boxW + 6, y, boxW, 'Account Summary', [
    `Balance Due: ${fmtSigned(account.balance_after)}`,
    `Previous Balance: ${fmtSigned(account.previous)}`,
    `This ${title === 'INVOICE' ? 'Invoice' : 'Bill'}: ${fmt(totals.total)}`,
    `Paid: ${fmt(totals.paid)}`,
  ]);
  y = Math.max(y1, y2) + 6;

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['#', 'Item Description', 'Qty', 'Unit', 'Rate', 'Amount']],
    body: items.map((it, i) => [
      i + 1,
      it.product_name + (it.sku ? `\nSKU: ${it.sku}` : ''),
      qtyFmt(it.qty),
      it.unit || '',
      fmt(it[priceKey]),
      fmt(it.line_total),
    ]),
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.6, textColor: C.text, lineColor: C.line, lineWidth: 0.2 },
    headStyles: { fillColor: C.navy2, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      2: { halign: 'right', cellWidth: 18 },
      3: { cellWidth: 16 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'right', cellWidth: 34, fontStyle: 'bold' },
    },
  });
  y = doc.lastAutoTable.finalY + 8;
  if (y > 230) {
    doc.addPage();
    y = 20;
  }

  const tw = 82;
  const rows = [{ label: 'Subtotal', value: fmt(totals.subtotal) }];
  if (totals.discount) rows.push({ label: 'Discount', value: `- ${fmt(totals.discount)}`, color: C.rose });
  if (totals.tax) rows.push({ label: 'Tax', value: fmt(totals.tax) });
  rows.push({ label: 'Total', value: fmt(totals.total), highlight: true });
  rows.push({ label: 'Paid', value: fmt(totals.paid), color: C.green });
  rows.push({ label: 'Amount Due', value: fmt(totals.total - totals.paid), bold: true, color: totals.total - totals.paid > 0 ? C.rose : C.green });
  const yEnd = totalsBlock(doc, W - 14 - tw, y + 2, tw, rows);

  // Left side: words, status, note
  const lw = W - 28 - tw - 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text('AMOUNT IN WORDS', 14, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.text);
  const words = doc.splitTextToSize(amountInWords(totals.total), lw);
  doc.text(words, 14, y + 7);
  let ly = y + 7 + words.length * 4.5 + 4;

  const due = totals.total - totals.paid;
  const [st, col] = due <= 0.004 ? ['PAID', C.green] : totals.paid > 0 ? ['PARTIALLY PAID', C.amber] : ['UNPAID', C.rose];
  stamp(doc, 14 + doc.getTextWidth(st) * 1.45 + 12, ly + 4, st, col);
  ly += 14;

  if (note) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text('NOTE', 14, ly);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    const nl = doc.splitTextToSize(note, lw);
    doc.text(nl, 14, ly + 5);
    ly += 5 + nl.length * 4.5;
  }

  y = Math.max(yEnd, ly) + 8;
  if (settings.invoice_terms) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text('TERMS & CONDITIONS', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const tl = doc.splitTextToSize(settings.invoice_terms, W - 28);
    doc.text(tl, 14, y + 5);
    y += 5 + tl.length * 4 + 4;
  }

  const H = doc.internal.pageSize.getHeight();
  let sy = Math.max(y + 18, H - 40);
  if (sy > H - 20) {
    doc.addPage();
    sy = 60;
  }
  signatures(doc, sy, title === 'INVOICE' ? 'Customer Signature' : 'Received By', 'Authorized Signature');
  if (settings.invoice_footer) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...C.indigo);
    doc.text(settings.invoice_footer, W / 2, sy + 14, { align: 'center' });
  }
  pageFooters(doc, settings, `${title === 'INVOICE' ? 'Invoice' : 'Purchase Bill'} ${number}`);
  doc.save(filename);
}

export function downloadSaleInvoice(sale, settings) {
  tradeDocument({
    settings,
    title: 'INVOICE',
    number: sale.invoice_no,
    date: sale.date,
    party: sale.customer,
    partyLabel: 'Bill To',
    items: sale.items,
    priceKey: 'unit_price',
    totals: { subtotal: sale.subtotal, discount: sale.discount, tax: sale.tax, total: sale.total, paid: sale.paid_on_invoice },
    account: { previous: sale.previous_balance, balance_after: sale.balance_after },
    note: sale.note,
    filename: `${sale.invoice_no}_${sale.customer.name.replace(/[^\w]+/g, '_')}.pdf`,
  });
}

export function downloadPurchaseBill(p, settings) {
  tradeDocument({
    settings,
    title: 'PURCHASE BILL',
    number: p.purchase_no,
    date: p.date,
    party: p.vendor,
    partyLabel: 'Vendor / Supplier',
    items: p.items,
    priceKey: 'unit_cost',
    totals: { subtotal: p.subtotal, discount: p.discount, tax: p.tax, total: p.total, paid: p.paid_on_bill },
    account: { previous: p.previous_balance, balance_after: p.balance_after },
    extraMeta: p.vendor_bill_no ? [`Vendor Bill #: ${p.vendor_bill_no}`] : [],
    note: p.note,
    filename: `${p.purchase_no}_${p.vendor.name.replace(/[^\w]+/g, '_')}.pdf`,
  });
}

/** Account statement (ledger) for a customer or vendor. */
export function downloadLedgerStatement(ledger, kind, settings) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const period = ledger.from || ledger.to ? `${ledger.from ? fmtDate(ledger.from) : 'Beginning'} – ${ledger.to ? fmtDate(ledger.to) : 'Today'}` : 'All transactions';
  let y = header(doc, settings, 'ACCOUNT STATEMENT', [kind === 'customer' ? 'Customer Ledger' : 'Vendor Ledger', `Period: ${period}`, `Date: ${fmtDate(new Date().toISOString())}`]);

  const p = ledger.party;
  const y1 = infoBox(doc, 14, y, 90, kind === 'customer' ? 'Customer' : 'Vendor', [p.name, p.phone && `Phone: ${p.phone}`, p.address].filter(Boolean));

  // KPI tiles
  const tiles = [
    ['Opening', ledger.opening_balance],
    [kind === 'customer' ? 'Sales' : 'Purchases', ledger.total_charge],
    ['Payments', ledger.total_payment],
    ['Closing Balance', ledger.closing_balance],
  ];
  const tx = 110;
  const tw = (W - 14 - tx - 3) / 2;
  tiles.forEach(([l, v], i) => {
    const xx = tx + (i % 2) * (tw + 3);
    const yy = y + Math.floor(i / 2) * 15;
    const last = i === 3;
    doc.setFillColor(...(last ? C.navy : C.soft));
    doc.roundedRect(xx, yy, tw, 13, 2, 2, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(last ? [170, 190, 220] : C.muted));
    doc.text(l.toUpperCase(), xx + 3, yy + 4.6);
    doc.setFontSize(10);
    doc.setTextColor(...(last ? [255, 255, 255] : C.text));
    doc.text(fmtSigned(v), xx + 3, yy + 10);
  });
  y = Math.max(y1, y + 30) + 6;

  const chargeLabel = kind === 'customer' ? 'Debit (Sale)' : 'Credit (Purchase)';
  const payLabel = kind === 'customer' ? 'Credit (Paid)' : 'Debit (Paid)';
  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['Date', 'Ref', 'Description', chargeLabel, payLabel, 'Balance']],
    body: [
      [ledger.from ? fmtDate(ledger.from) : '', '', 'Opening Balance', '', '', fmtSigned(ledger.opening_balance)],
      ...ledger.entries.map((e) => [fmtDate(e.date), e.ref, e.description, e.charge ? fmt(e.charge) : '', e.payment ? fmt(e.payment) : '', fmtSigned(e.balance)]),
    ],
    foot: [['', '', 'Totals', fmt(ledger.total_charge), fmt(ledger.total_payment), fmtSigned(ledger.closing_balance)]],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.2, textColor: C.text, lineColor: C.line, lineWidth: 0.2 },
    headStyles: { fillColor: C.navy2, textColor: [255, 255, 255], fontSize: 8 },
    footStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 22 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 28 },
      5: { halign: 'right', cellWidth: 30, fontStyle: 'bold' },
    },
  });
  y = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(9);
  doc.setTextColor(...C.text);
  const bal = ledger.closing_balance;
  const msg =
    kind === 'customer'
      ? bal > 0 ? `Amount payable by ${p.name}: ${fmt(bal)}` : bal < 0 ? `Advance / credit with us: ${fmt(bal)}` : 'Account is fully settled.'
      : bal > 0 ? `Amount payable to ${p.name}: ${fmt(bal)}` : bal < 0 ? `Advance paid to vendor: ${fmt(bal)}` : 'Account is fully settled.';
  doc.setFont('helvetica', 'bold');
  doc.text(msg, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(amountInWords(Math.abs(bal)), 14, y + 5);
  pageFooters(doc, settings, `Statement · ${p.name}`);
  doc.save(`Statement_${p.name.replace(/[^\w]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/** Generic tabular report → PDF (auto landscape for wide reports). */
export function downloadReportPdf(report, settings) {
  const landscape = report.columns.length > 7;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' });
  const period = report.from || report.to ? `${report.from ? fmtDate(report.from) : 'Beginning'} – ${report.to ? fmtDate(report.to) : 'Today'}` : report.dated === false ? 'As of today' : 'All dates';
  const y = header(doc, settings, report.title.toUpperCase(), [`Period: ${period}`, `Records: ${report.rows.length}`], { compact: true });
  const cell = (c, v) => (c.type === 'money' ? fmtSigned(v) : c.type === 'number' ? qtyFmt(v) : c.type === 'date' ? fmtDate(v) : v ?? '');
  autoTable(doc, {
    startY: y,
    margin: { left: 10, right: 10 },
    head: [report.columns.map((c) => c.label)],
    body: report.rows.map((r) => report.columns.map((c) => cell(c, r[c.key]))),
    foot: report.totals ? [report.columns.map((c, i) => (i === 0 ? 'TOTAL' : c.key in report.totals ? cell(c, report.totals[c.key]) : ''))] : undefined,
    theme: 'striped',
    styles: { fontSize: 7.8, cellPadding: 1.8, textColor: C.text },
    headStyles: { fillColor: C.navy2, textColor: [255, 255, 255], fontSize: 7.5 },
    footStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: Object.fromEntries(report.columns.map((c, i) => [i, c.type === 'money' || c.type === 'number' ? { halign: 'right' } : {}])),
  });
  if (report.note) {
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(report.note, 10, doc.lastAutoTable.finalY + 6);
  }
  pageFooters(doc, settings, report.title);
  doc.save(`${report.title.replace(/[^\w]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
