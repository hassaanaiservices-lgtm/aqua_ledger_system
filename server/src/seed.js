import { db, run, get, tx, setSetting, r2 } from './db.js';

console.log('🌱 Seeding initial business data for Aqua Home Appliance...');

await tx(async () => {
  // Check if data already exists
  const count = (await get('SELECT COUNT(*) c FROM products')).c;
  if (count > 0) {
    console.log('Database already contains records. Skipping seed.');
    return;
  }

  // Settings
  await setSetting('business_name', 'Aqua Home Appliance');
  await setSetting('business_address', 'Shop #14, Al-Madina Water Filtration Center, Main Commercial Market, Lahore');
  await setSetting('business_phone', '0300-4567890 / 042-35889900');
  await setSetting('business_email', 'sales@aquahomeappliance.com');
  await setSetting('business_ntn', '7892341-2');
  await setSetting('currency', 'Rs');
  await setSetting('invoice_footer', 'Thank you for choosing Aqua Home Appliance! Quality water for healthy living.');
  await setSetting('invoice_terms', '1. Warranty covers manufacturing defects for 1 year.\n2. Replacement filters should be serviced every 6 months for optimum purification.\n3. Balances must be cleared within 30 days of invoice date.');

  // 1. Raw Materials & Components
  const rawProducts = [
    { sku: 'RAW-PP-01', name: '5-Micron PP Sediment Filter', category: 'Filters', unit: 'pcs', cost_price: 180, sale_price: 350, stock: 150, reorder: 30 },
    { sku: 'RAW-GAC-02', name: 'Granular Activated Carbon (GAC) Cartridge', category: 'Filters', unit: 'pcs', cost_price: 320, sale_price: 600, stock: 120, reorder: 25 },
    { sku: 'RAW-CTO-03', name: 'Carbon Block (CTO) Filter 10-inch', category: 'Filters', unit: 'pcs', cost_price: 350, sale_price: 650, stock: 100, reorder: 20 },
    { sku: 'RAW-MEM-75', name: '75 GPD RO Membrane (Filmtec Tech)', category: 'Membranes', unit: 'pcs', cost_price: 1850, sale_price: 3200, stock: 45, reorder: 10 },
    { sku: 'RAW-PUMP-24V', name: '24V RO Booster Pump & Transformer', category: 'Electrical', unit: 'pcs', cost_price: 3200, sale_price: 4800, stock: 35, reorder: 8 },
    { sku: 'RAW-TANK-32', name: '3.2 Gallon Pressure Storage Tank', category: 'Tanks', unit: 'pcs', cost_price: 2400, sale_price: 3800, stock: 28, reorder: 5 },
    { sku: 'RAW-FAUCET-SS', name: 'Stainless Steel Goose Neck Faucet', category: 'Fittings', unit: 'pcs', cost_price: 650, sale_price: 1100, stock: 50, reorder: 15 },
    { sku: 'RAW-PIPE-14', name: 'Food-Grade 1/4 inch Tubing Pipe', category: 'Fittings', unit: 'meter', cost_price: 25, sale_price: 50, stock: 400, reorder: 100 },
  ];

  for (const p of rawProducts) {
    const info = await run(
      `INSERT INTO products (sku, name, type, category, unit, cost_price, sale_price, reorder_level)
       VALUES (?, ?, 'raw', ?, ?, ?, ?, ?)`,
      p.sku, p.name, p.category, p.unit, p.cost_price, p.sale_price, p.reorder
    );
    const id = Number(info.lastInsertRowid);
    await run(
      `INSERT INTO stock_movements (product_id, date, qty, unit_cost, ref_type, note)
       VALUES (?, '2026-10-01', ?, ?, 'opening', 'Opening inventory stock')`,
      id, p.stock, p.cost_price
    );
  }

  // 2. Finished Assembled Products
  const finishedProducts = [
    {
      sku: 'RO-HOME-6S',
      name: 'Aqua 6-Stage Domestic RO Water Purifier',
      category: 'Domestic Purifiers',
      unit: 'set',
      sale_price: 28500,
      reorder_level: 4,
      labor_cost: 1200,
      overhead_cost: 600,
      components: [
        { sku: 'RAW-PP-01', qty: 1 },
        { sku: 'RAW-GAC-02', qty: 1 },
        { sku: 'RAW-CTO-03', qty: 1 },
        { sku: 'RAW-MEM-75', qty: 1 },
        { sku: 'RAW-PUMP-24V', qty: 1 },
        { sku: 'RAW-TANK-32', qty: 1 },
        { sku: 'RAW-FAUCET-SS', qty: 1 },
        { sku: 'RAW-PIPE-14', qty: 5 },
      ]
    },
    {
      sku: 'RO-HOME-7S-UV',
      name: 'Aqua 7-Stage Mineralizer RO System with UV',
      category: 'Domestic Purifiers',
      unit: 'set',
      sale_price: 36000,
      reorder_level: 3,
      labor_cost: 1600,
      overhead_cost: 800,
      components: [
        { sku: 'RAW-PP-01', qty: 2 },
        { sku: 'RAW-GAC-02', qty: 1 },
        { sku: 'RAW-CTO-03', qty: 1 },
        { sku: 'RAW-MEM-75', qty: 1 },
        { sku: 'RAW-PUMP-24V', qty: 1 },
        { sku: 'RAW-TANK-32', qty: 1 },
        { sku: 'RAW-FAUCET-SS', qty: 1 },
        { sku: 'RAW-PIPE-14', qty: 8 },
      ]
    }
  ];

  for (const fp of finishedProducts) {
    const info = await run(
      `INSERT INTO products (sku, name, type, category, unit, cost_price, sale_price, reorder_level, labor_cost, overhead_cost)
       VALUES (?, ?, 'finished', ?, ?, 0, ?, ?, ?, ?)`,
      fp.sku, fp.name, fp.category, fp.unit, fp.sale_price, fp.reorder_level, fp.labor_cost, fp.overhead_cost
    );
    const finishedId = Number(info.lastInsertRowid);

    // Insert BOM items
    for (const cmp of fp.components) {
      const compProd = await get('SELECT id FROM products WHERE sku = ?', cmp.sku);
      if (compProd) {
        await run('INSERT INTO bom_items (product_id, component_id, qty) VALUES (?, ?, ?)', finishedId, compProd.id, cmp.qty);
      }
    }
  }

  // 3. Customers
  const customers = [
    { name: 'Ali Traders & Appliances', phone: '0321-4455667', address: 'Main Market, Gulberg III, Lahore', cnic: '35201-1234567-1', opening: 15000 },
    { name: 'Dr. Tariq Mahmood (Clinic)', phone: '0300-8899112', address: 'DHA Phase 5, Commercial Sector C, Lahore', cnic: '35202-9876543-3', opening: 0 },
    { name: 'Bilal Water Technologies', phone: '0333-5566778', address: 'College Road, Township, Lahore', cnic: '35201-5544332-9', opening: 8500 },
    { name: 'Chaudhry Household', phone: '0312-3344556', address: 'House 42-B, Model Town, Lahore', cnic: '35202-1122334-5', opening: 0 },
  ];
  for (const c of customers) {
    await run('INSERT INTO customers (name, phone, address, cnic, opening_balance) VALUES (?, ?, ?, ?, ?)', c.name, c.phone, c.address, c.cnic, c.opening);
  }

  // 4. Vendors
  const vendors = [
    { name: 'Karachi Water Parts & Components Ltd', phone: '021-34567890', address: 'Site Industrial Area, Karachi', ntn: '1244556-9', opening: 25000 },
    { name: 'Pak Filter Technologies Co', phone: '042-37654321', address: 'Brandreth Road Hardware Market, Lahore', ntn: '9876543-1', opening: 12000 },
    { name: 'Sino-Pak Import Consortium', phone: '051-2345678', address: 'I-9 Industrial Area, Islamabad', ntn: '3456789-0', opening: 0 },
  ];
  for (const v of vendors) {
    await run('INSERT INTO vendors (name, phone, address, ntn, opening_balance) VALUES (?, ?, ?, ?, ?)', v.name, v.phone, v.address, v.ntn, v.opening);
  }

  // 5. Assemblies Run: Assemble 12 units of Aqua 6-Stage RO System
  const p6s = await get(`SELECT id FROM products WHERE sku = 'RO-HOME-6S'`);
  if (p6s) {
    // Run assembly for 6 units on 2026-10-05
    const asmComponents = [
      { sku: 'RAW-PP-01', qty: 6 },
      { sku: 'RAW-GAC-02', qty: 6 },
      { sku: 'RAW-CTO-03', qty: 6 },
      { sku: 'RAW-MEM-75', qty: 6 },
      { sku: 'RAW-PUMP-24V', qty: 6 },
      { sku: 'RAW-TANK-32', qty: 6 },
      { sku: 'RAW-FAUCET-SS', qty: 6 },
      { sku: 'RAW-PIPE-14', qty: 30 },
    ];
    let matCost = 0;
    const aInfo = await run(
      `INSERT INTO assemblies (product_id, date, qty, labor_cost, other_cost, note)
       VALUES (?, '2026-10-05', 6, ?, ?, 'Batch production 01')`,
      p6s.id, 6 * 1200, 6 * 600
    );
    const aid = Number(aInfo.lastInsertRowid);

    for (const c of asmComponents) {
      const prod = await get('SELECT id, cost_price FROM products WHERE sku = ?', c.sku);
      const lineCost = prod.cost_price * c.qty;
      matCost += lineCost;
      await run('INSERT INTO assembly_items (assembly_id, component_id, qty, unit_cost, line_total) VALUES (?, ?, ?, ?, ?)', aid, prod.id, c.qty, prod.cost_price, lineCost);
      await run(`INSERT INTO stock_movements (product_id, date, qty, unit_cost, ref_type, ref_id, note) VALUES (?, '2026-10-05', ?, ?, 'assembly_out', ?, 'Batch 01 Consumption')`, prod.id, -c.qty, prod.cost_price, aid);
    }
    const totCost = matCost + (6 * 1200) + (6 * 600);
    const unitCost = r2(totCost / 6);
    await run('UPDATE assemblies SET material_cost = ?, total_cost = ?, unit_cost = ? WHERE id = ?', matCost, totCost, unitCost, aid);
    await run(`INSERT INTO stock_movements (product_id, date, qty, unit_cost, ref_type, ref_id, note) VALUES (?, '2026-10-05', 6, ?, 'assembly_in', ?, 'Batch 01 Output')`, p6s.id, unitCost, aid);
  }

  // 6. Record Sales & Invoices
  // Sale 1: to Ali Traders
  const sInfo = await run(
    `INSERT INTO sales (customer_id, date, subtotal, discount, tax, total, cost_total, note)
     VALUES (1, '2026-10-08', 57000, 2000, 0, 55000, 21900, 'Delivered with free 1st service kit')`
  );
  const sid = Number(sInfo.lastInsertRowid);
  await run(`INSERT INTO sale_items (sale_id, product_id, qty, unit_price, unit_cost, line_total) VALUES (?, ?, 2, 28500, 10950, 57000)`, sid, p6s.id);
  await run(`INSERT INTO stock_movements (product_id, date, qty, unit_cost, ref_type, ref_id, note) VALUES (?, '2026-10-08', -2, 10950, 'sale', ?, 'Sold on INV-00001')`, p6s.id, sid);
  // Partial payment received on sale
  await run(`INSERT INTO payments (party_type, party_id, date, amount, method, reference, sale_id, note)
       VALUES ('customer', 1, '2026-10-08', 30000, 'cash', 'RCP-101', ?, 'Upfront cash at time of invoice')`, sid);

  // Sale 2: to Dr. Tariq Mahmood (Fully Paid)
  const sInfo2 = await run(
    `INSERT INTO sales (customer_id, date, subtotal, discount, tax, total, cost_total, note)
     VALUES (2, '2026-10-12', 28500, 500, 0, 28000, 10950, 'Clinic waiting area installation')`
  );
  const sid2 = Number(sInfo2.lastInsertRowid);
  await run(`INSERT INTO sale_items (sale_id, product_id, qty, unit_price, unit_cost, line_total) VALUES (?, ?, 1, 28500, 10950, 28500)`, sid2, p6s.id);
  await run(`INSERT INTO stock_movements (product_id, date, qty, unit_cost, ref_type, ref_id, note) VALUES (?, '2026-10-12', -1, 10950, 'sale', ?, 'Sold on INV-00002')`, p6s.id, sid2);
  await run(`INSERT INTO payments (party_type, party_id, date, amount, method, reference, sale_id, note)
       VALUES ('customer', 2, '2026-10-12', 28000, 'bank', 'MBL-887192', ?, 'Online transfer received')`, sid2);

  // Operating Expenses
  await run(`INSERT INTO expenses (date, category, amount, method, note) VALUES ('2026-10-02', 'Rent', 35000, 'bank', 'Shop and assembly workshop rent')`);
  await run(`INSERT INTO expenses (date, category, amount, method, note) VALUES ('2026-10-06', 'Electricity', 8400, 'online', 'LESCO commercial bill')`);
  await run(`INSERT INTO expenses (date, category, amount, method, note) VALUES ('2026-10-10', 'Transport', 3200, 'cash', 'Cargo delivery from Karachi station')`);

  console.log('✅ Seeding completed successfully!');
});
