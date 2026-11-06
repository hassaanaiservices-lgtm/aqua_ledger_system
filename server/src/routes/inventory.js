// Products, stock levels, stock movements and manual adjustments.
import { Router } from 'express';
import { all, get, run, tx, r2, stockOf, avgCostOf, PRODUCT_STOCK_SQL, cleanImage } from '../db.js';
import { h, bad, notFound, num, str, today } from '../utils.js';

const r = Router();

const enrich = (p) => ({
  ...p,
  stock: r2(p.stock),
  avg_cost: r2(p.avg_cost),
  stock_value: r2(p.stock * p.avg_cost),
  low_stock: p.reorder_level > 0 && p.stock <= p.reorder_level,
});

r.get(
  '/products',
  h(async (req) => {
    const { type, q, active } = req.query;
    const where = [];
    const params = [];
    if (type) {
      where.push('p.type = ?');
      params.push(type);
    }
    if (q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (active !== 'all') where.push('p.active = 1');
    const sql = `${PRODUCT_STOCK_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name`;
    return (await all(sql, ...params)).map(enrich);
  })
);

r.get(
  '/products/:id/image',
  h(async (req, res) => {
    const row = await get('SELECT image FROM products WHERE id = ?', req.params.id);
    const m = row?.image && /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(row.image);
    if (!m) throw notFound('No image');
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(m[2], 'base64'));
  })
);

r.get(
  '/products/:id',
  h(async (req) => {
    const p = await get(`${PRODUCT_STOCK_SQL} WHERE p.id = ?`, req.params.id);
    if (!p) throw notFound('Product not found');
    const movements = await all(
      `SELECT * FROM stock_movements WHERE product_id = ? ORDER BY date, id`,
      req.params.id
    );
    let bal = 0;
    for (const m of movements) {
      bal += m.qty;
      m.balance = r2(bal);
    }
    const bom = await all(
      `SELECT b.*, c.name AS component_name, c.unit FROM bom_items b JOIN products c ON c.id = b.component_id WHERE b.product_id = ?`,
      req.params.id
    );
    return { ...enrich(p), movements: movements.reverse(), bom };
  })
);

function productFields(b) {
  if (!str(b.name)) throw bad('Product name is required');
  const type = ['raw', 'finished', 'trading'].includes(b.type) ? b.type : 'finished';
  return [
    str(b.sku),
    str(b.name),
    type,
    str(b.category),
    str(b.unit) || 'pcs',
    num(b.cost_price),
    num(b.sale_price),
    num(b.reorder_level),
    num(b.labor_cost),
    num(b.overhead_cost),
  ];
}

r.post(
  '/products',
  h(async (req) => {
    const b = req.body;
    return await tx(async () => {
      const info = await run(
        `INSERT INTO products (sku,name,type,category,unit,cost_price,sale_price,reorder_level,labor_cost,overhead_cost,image)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ...productFields(b),
        cleanImage(b.image, 'Product image')
      );
      const id = Number(info.lastInsertRowid);
      const opening = num(b.opening_stock);
      if (opening > 0) {
        await run(
          `INSERT INTO stock_movements (product_id,date,qty,unit_cost,ref_type,note) VALUES (?,?,?,?, 'opening', 'Opening stock')`,
          id,
          str(b.opening_date) || today(),
          opening,
          num(b.cost_price)
        );
      }
      return { id };
    });
  })
);

r.put(
  '/products/:id',
  h(async (req) => {
    if (!await get('SELECT id FROM products WHERE id = ?', req.params.id)) throw notFound();
    const b = req.body;
    // Opening stock is replaced as one entry; sales, purchases and adjustments are untouched.
    if (b.opening_stock !== undefined && b.opening_stock !== '') {
      const qty = num(b.opening_stock);
      if (qty < 0) throw bad('Opening stock cannot be negative');
      const first = await get("SELECT MIN(date) AS d FROM stock_movements WHERE product_id = ? AND ref_type = 'opening'", req.params.id);
      await tx(async () => {
        await run("DELETE FROM stock_movements WHERE product_id = ? AND ref_type = 'opening'", req.params.id);
        if (qty > 0) {
          await run(
            `INSERT INTO stock_movements (product_id,date,qty,unit_cost,ref_type,note) VALUES (?,?,?,?, 'opening', 'Opening stock')`,
            req.params.id, first?.d || today(), qty, num(b.cost_price)
          );
        }
      });
    }
    await run(
      `UPDATE products SET sku=?,name=?,type=?,category=?,unit=?,cost_price=?,sale_price=?,reorder_level=?,labor_cost=?,overhead_cost=?,
       active=? WHERE id=?`,
      ...productFields(req.body),
      req.body.active === false || req.body.active === 0 ? 0 : 1,
      req.params.id
    );
    // The list never carries pictures, so a client that did not touch the image
    // simply omits the key. Only an explicit value (or '') changes it.
    if ('image' in req.body) {
      await run('UPDATE products SET image = ? WHERE id = ?', cleanImage(req.body.image, 'Product image'), req.params.id);
    }
    return { ok: true };
  })
);

r.delete(
  '/products/:id',
  h(async (req) => {
    const id = req.params.id;
    const used =
      (await get('SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?', id)).c +
      (await get('SELECT COUNT(*) c FROM sale_items WHERE product_id = ?', id)).c +
      (await get('SELECT COUNT(*) c FROM purchase_items WHERE product_id = ?', id)).c +
      (await get('SELECT COUNT(*) c FROM bom_items WHERE component_id = ?', id)).c +
      (await get('SELECT COUNT(*) c FROM assemblies WHERE product_id = ?', id)).c +
      (await get('SELECT COUNT(*) c FROM assembly_items WHERE component_id = ?', id)).c;
    if (used > 0) {
      // Keep history intact: archive instead of delete.
      await run('UPDATE products SET active = 0 WHERE id = ?', id);
      return { archived: true };
    }
    await tx(async () => {
      await run('DELETE FROM bom_items WHERE product_id = ?', id);
      await run('DELETE FROM products WHERE id = ?', id);
    });
    return { deleted: true };
  })
);

// ---- Stock movements & adjustments ----
r.get(
  '/stock-movements',
  h(async (req) => {
    const { product_id, from, to, ref_type } = req.query;
    const where = [];
    const params = [];
    if (product_id) where.push('m.product_id = ?') && params.push(product_id);
    if (from) where.push('m.date >= ?') && params.push(from);
    if (to) where.push('m.date <= ?') && params.push(to);
    if (ref_type) where.push('m.ref_type = ?') && params.push(ref_type);
    return await all(
      `SELECT m.*, p.name AS product_name, p.unit FROM stock_movements m JOIN products p ON p.id = m.product_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.date DESC, m.id DESC LIMIT 2000`,
      ...params
    );
  })
);

r.post(
  '/stock-adjustments',
  h(async (req) => {
    const b = req.body;
    const pid = num(b.product_id);
    const qty = num(b.qty);
    if (!await get('SELECT id FROM products WHERE id = ?', pid)) throw bad('Select a product');
    if (!qty) throw bad('Quantity cannot be zero');
    if (qty < 0 && await stockOf(pid) + qty < 0) throw bad(`Not enough stock. Available: ${await stockOf(pid)}`);
    const unitCost = qty > 0 ? num(b.unit_cost) || await avgCostOf(pid) : await avgCostOf(pid);
    const info = await run(
      `INSERT INTO stock_movements (product_id,date,qty,unit_cost,ref_type,note) VALUES (?,?,?,?, 'adjustment', ?)`,
      pid,
      str(b.date) || today(),
      qty,
      unitCost,
      str(b.note) || (qty > 0 ? 'Stock added' : 'Stock removed')
    );
    return { id: Number(info.lastInsertRowid) };
  })
);

r.delete(
  '/stock-movements/:id',
  h(async (req) => {
    const m = await get('SELECT * FROM stock_movements WHERE id = ?', req.params.id);
    if (!m) throw notFound();
    if (!['adjustment', 'opening'].includes(m.ref_type))
      throw bad('This movement belongs to a document. Delete the sale/purchase/assembly instead.');
    if (m.qty > 0 && await stockOf(m.product_id) - m.qty < 0) throw bad('Deleting this would make stock negative');
    await run('DELETE FROM stock_movements WHERE id = ?', m.id);
    return { ok: true };
  })
);

// Every opening-stock entry at once. Sales, purchases, assemblies and manual
// adjustments are never touched, so stock sold out of the opening stock goes negative.
const OPENING_PREVIEW_SQL = `
  SELECT p.id, p.name,
    SUM(CASE WHEN m.ref_type = 'opening' THEN m.qty ELSE 0 END) AS opening,
    SUM(m.qty) AS stock
  FROM stock_movements m JOIN products p ON p.id = m.product_id
  GROUP BY p.id HAVING SUM(CASE WHEN m.ref_type = 'opening' THEN 1 ELSE 0 END) > 0
  ORDER BY p.name`;

r.get(
  '/opening-stock',
  h(async () => {
    const rows = (await all(OPENING_PREVIEW_SQL)).map((x) => ({ ...x, after: r2(x.stock - x.opening) }));
    const entries = (await get("SELECT COUNT(*) AS c FROM stock_movements WHERE ref_type = 'opening'")).c;
    return { entries, products: rows, negative_after: rows.filter((x) => x.after < 0).length };
  })
);

r.delete(
  '/opening-stock',
  h(async () => {
    const res = await run("DELETE FROM stock_movements WHERE ref_type = 'opening'");
    return { ok: true, deleted: res.changes };
  })
);

export default r;
