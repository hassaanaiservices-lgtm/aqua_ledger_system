// Bill of materials (recipes) and assembly runs with full cost calculation.
// Assembly consumes component stock at current average cost and produces
// finished stock whose unit cost = (materials + labor + other) / qty.
import { Router } from 'express';
import { all, get, run, tx, r2, stockOf, avgCostOf, docNo } from '../db.js';
import { h, bad, notFound, num, str, today } from '../utils.js';

const r = Router();

async function bomFor(productId, qty = 1) {
  const product = await get('SELECT * FROM products WHERE id = ?', productId);
  if (!product) throw notFound('Product not found');
  const rawItems = (await all(
    `SELECT b.component_id, b.qty, c.name AS component_name, c.unit, c.sku FROM bom_items b
     JOIN products c ON c.id = b.component_id WHERE b.product_id = ? ORDER BY b.id`,
    productId
  ));
  const items = await Promise.all(rawItems.map(async (b) => {
    const unit_cost = await avgCostOf(b.component_id);
    const stock = r2(await stockOf(b.component_id));
    const required = r2(b.qty * qty);
    return {
      ...b,
      unit_cost,
      stock,
      required,
      line_cost: r2(unit_cost * required),
      can_build: b.qty > 0 ? Math.floor(stock / b.qty) : Infinity,
      sufficient: stock >= required,
    };
  }));
  const material = r2(items.reduce((a, i) => a + i.line_cost, 0));
  const labor = r2(product.labor_cost * qty);
  const overhead = r2(product.overhead_cost * qty);
  const total = r2(material + labor + overhead);
  const maxBuildable = items.length ? Math.min(...items.map((i) => i.can_build)) : 0;
  return {
    product,
    qty,
    items,
    material_cost: material,
    labor_cost: labor,
    other_cost: overhead,
    total_cost: total,
    unit_cost: qty > 0 ? r2(total / qty) : 0,
    max_buildable: Number.isFinite(maxBuildable) ? maxBuildable : 0,
  };
}

// List finished products with their BOM summary & cost per unit
r.get(
  '/bom',
  h(async () => {
    const prods = await all(`SELECT id FROM products WHERE type = 'finished' AND active = 1 ORDER BY name`);
    return Promise.all(prods.map(async (p) => {
      const b = await bomFor(p.id, 1);
      return {
        product_id: p.id,
        name: b.product.name,
        sku: b.product.sku,
        unit: b.product.unit,
        sale_price: b.product.sale_price,
        component_count: b.items.length,
        material_cost: b.material_cost,
        labor_cost: b.labor_cost,
        other_cost: b.other_cost,
        unit_cost: b.unit_cost,
        margin: r2(b.product.sale_price - b.unit_cost),
        max_buildable: b.max_buildable,
        stock: r2(await stockOf(p.id)),
      };
    }));
  })
);

r.get('/bom/:productId', h(async (req) => bomFor(req.params.productId, num(req.query.qty, 1) || 1)));

r.put(
  '/bom/:productId',
  h(async (req) => {
    const pid = num(req.params.productId);
    const p = await get('SELECT * FROM products WHERE id = ?', pid);
    if (!p) throw notFound();
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    for (const it of items) {
      if (num(it.component_id) === pid) throw bad('A product cannot be a component of itself');
      if (!await get('SELECT id FROM products WHERE id = ?', num(it.component_id))) throw bad('Invalid component');
      if (num(it.qty) <= 0) throw bad('Component quantity must be greater than zero');
    }
    await tx(async () => {
      await run('DELETE FROM bom_items WHERE product_id = ?', pid);
      for (const it of items)
        await run('INSERT INTO bom_items (product_id,component_id,qty) VALUES (?,?,?)', pid, num(it.component_id), num(it.qty));
      await run(
        'UPDATE products SET labor_cost = ?, overhead_cost = ? WHERE id = ?',
        num(req.body.labor_cost, p.labor_cost),
        num(req.body.overhead_cost, p.overhead_cost),
        pid
      );
    });
    return await bomFor(pid, 1);
  })
);

r.get(
  '/assemblies',
  h(async (req) => {
    const { from, to, product_id } = req.query;
    const where = [];
    const params = [];
    if (from) where.push('a.date >= ?') && params.push(from);
    if (to) where.push('a.date <= ?') && params.push(to);
    if (product_id) where.push('a.product_id = ?') && params.push(product_id);
    return (await all(
      `SELECT a.*, p.name AS product_name, p.unit FROM assemblies a JOIN products p ON p.id = a.product_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.date DESC, a.id DESC LIMIT 2000`,
      ...params
    )).map((a) => ({ ...a, ref: docNo.assembly(a.id) }));
  })
);

r.get(
  '/assemblies/:id',
  h(async (req) => {
    const a = await get(
      `SELECT a.*, p.name AS product_name, p.unit FROM assemblies a JOIN products p ON p.id = a.product_id WHERE a.id = ?`,
      req.params.id
    );
    if (!a) throw notFound();
    a.items = await all(
      `SELECT i.*, c.name AS component_name, c.unit FROM assembly_items i JOIN products c ON c.id = i.component_id WHERE i.assembly_id = ?`,
      a.id
    );
    a.ref = docNo.assembly(a.id);
    return a;
  })
);

r.post(
  '/assemblies',
  h(async (req) => {
    const b = req.body;
    const pid = num(b.product_id);
    const qty = num(b.qty);
    if (qty <= 0) throw bad('Quantity must be greater than zero');
    const est = await bomFor(pid, qty);

    // Components: custom list from the form, or the saved BOM scaled by qty.
    let comps = Array.isArray(b.items) && b.items.length
      ? b.items.map((it) => ({ component_id: num(it.component_id), required: num(it.qty) }))
      : est.items.map((i) => ({ component_id: i.component_id, required: i.required }));
    comps = comps.filter((c) => c.required > 0);
    if (!comps.length) throw bad('No components defined. Set up the recipe (BOM) first or add components.');

    const need = {};
    for (const c of comps) {
      if (c.component_id === pid) throw bad('A product cannot consume itself');
      need[c.component_id] = (need[c.component_id] || 0) + c.required;
    }
    for (const [cid, q] of Object.entries(need)) {
      const have = await stockOf(cid);
      if (have + 1e-9 < q) {
        const c = await get('SELECT name, unit FROM products WHERE id = ?', cid);
        throw bad(`Not enough "${c.name}". Available: ${r2(have)} ${c.unit}, required: ${r2(q)}`);
      }
    }

    const date = str(b.date) || today();
    const labor = b.labor_cost != null && b.labor_cost !== '' ? r2(b.labor_cost) : est.labor_cost;
    const other = b.other_cost != null && b.other_cost !== '' ? r2(b.other_cost) : est.other_cost;

    return await tx(async () => {
      const info = await run(
        `INSERT INTO assemblies (product_id,date,qty,labor_cost,other_cost,note) VALUES (?,?,?,?,?,?)`,
        pid,
        date,
        qty,
        labor,
        other,
        str(b.note)
      );
      const id = Number(info.lastInsertRowid);
      let material = 0;
      for (const c of comps) {
        const uc = await avgCostOf(c.component_id);
        const line = r2(uc * c.required);
        material += line;
        await run(
          'INSERT INTO assembly_items (assembly_id,component_id,qty,unit_cost,line_total) VALUES (?,?,?,?,?)',
          id,
          c.component_id,
          c.required,
          uc,
          line
        );
        await run(
          `INSERT INTO stock_movements (product_id,date,qty,unit_cost,ref_type,ref_id,note) VALUES (?,?,?,?, 'assembly_out', ?, ?)`,
          c.component_id,
          date,
          -c.required,
          uc,
          id,
          `Used in ${docNo.assembly(id)}`
        );
      }
      material = r2(material);
      const total = r2(material + labor + other);
      const unit = r2(total / qty);
      await run('UPDATE assemblies SET material_cost=?, total_cost=?, unit_cost=? WHERE id=?', material, total, unit, id);
      await run(
        `INSERT INTO stock_movements (product_id,date,qty,unit_cost,ref_type,ref_id,note) VALUES (?,?,?,?, 'assembly_in', ?, ?)`,
        pid,
        date,
        qty,
        unit,
        id,
        `Assembled on ${docNo.assembly(id)}`
      );
      return { id, ref: docNo.assembly(id), material_cost: material, total_cost: total, unit_cost: unit };
    });
  })
);

r.delete(
  '/assemblies/:id',
  h(async (req) => {
    const a = await get('SELECT * FROM assemblies WHERE id = ?', req.params.id);
    if (!a) throw notFound();
    if (await stockOf(a.product_id) - a.qty < -0.0001)
      throw bad('Cannot delete: units from this assembly have already been sold or used.');
    await tx(async () => {
      await run(`DELETE FROM stock_movements WHERE ref_type IN ('assembly_in','assembly_out') AND ref_id = ?`, a.id);
      await run('DELETE FROM assembly_items WHERE assembly_id = ?', a.id);
      await run('DELETE FROM assemblies WHERE id = ?', a.id);
    });
    return { ok: true };
  })
);

export default r;
