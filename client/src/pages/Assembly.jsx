import React, { useState } from 'react';
import { Factory, Plus, Trash2, Eye } from 'lucide-react';
import { useApp, useFetch, PageHeader, Modal, Field, Loading, Empty, useSaver } from '../components/ui';
import { money, fmtDate, today } from '../lib/format';
import { api } from '../lib/api';

const blankRow = () => ({ component_id: '', qty: 1 });

/**
 * Assembly in one form: pick the machine being made, the raw parts that go
 * into one unit, labour and overhead per unit, and how many units. The parts
 * leave stock, the finished machines enter stock at the full cost, and the
 * parts list is remembered as that machine's recipe for next time.
 */
function AssembleModal({ products, onClose, onDone }) {
  const [runSave, saving] = useSaver();
  const { toast } = useApp();
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [date, setDate] = useState(today());
  const [items, setItems] = useState([blankRow()]);
  const [labor, setLabor] = useState(0);
  const [overhead, setOverhead] = useState(0);
  const [note, setNote] = useState('');
  const [remember, setRemember] = useState(true);

  const byId = new Map(products.map((p) => [p.id, p]));
  const finished = products.filter((p) => p.type === 'finished');
  const others = products.filter((p) => p.type !== 'finished');

  // Picking the machine fills in its saved recipe, if it has one.
  const pickProduct = async (id) => {
    setProductId(id);
    if (!id) return;
    try {
      const bom = await api.get(`/bom/${id}`, { qty: 1 });
      setItems(bom.items.length ? bom.items.map((i) => ({ component_id: i.component_id, qty: i.qty })) : [blankRow()]);
      setLabor(bom.labor_cost || 0);
      setOverhead(bom.other_cost || 0);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const setRow = (i, patch) => setItems(items.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const units = Number(qty) || 0;
  const rows = items
    .filter((r) => r.component_id)
    .map((r) => {
      const p = byId.get(Number(r.component_id));
      const perUnit = Number(r.qty) || 0;
      const needed = perUnit * units;
      return { ...r, p, perUnit, needed, cost: needed * (p?.avg_cost || 0), short: p ? needed > p.stock + 1e-9 : false };
    });
  const materialCost = rows.reduce((t, r) => t + r.cost, 0);
  const laborTotal = (Number(labor) || 0) * units;
  const overheadTotal = (Number(overhead) || 0) * units;
  const totalCost = materialCost + laborTotal + overheadTotal;
  const unitCost = units > 0 ? totalCost / units : 0;
  const anyShort = rows.some((r) => r.short);
  const target = byId.get(Number(productId));

  const submit = async (e) => {
    e.preventDefault();
    if (!productId) return toast('Choose the product you are making', 'error');
    if (units <= 0) return toast('Quantity must be more than zero', 'error');
    const parts = rows.filter((r) => r.perUnit > 0);
    if (!parts.length) return toast('Add at least one raw product', 'error');
    if (parts.some((r) => Number(r.component_id) === Number(productId))) {
      return toast('A product cannot be used to make itself', 'error');
    }

    await runSave(async () => {
      const res = await api.post('/assemblies', {
        product_id: Number(productId),
        qty: units,
        date,
        note,
        labor_cost: laborTotal,
        other_cost: overheadTotal,
        items: parts.map((r) => ({ component_id: Number(r.component_id), qty: r.needed })),
      });
      if (remember) {
        await api.put(`/bom/${productId}`, {
          items: parts.map((r) => ({ component_id: Number(r.component_id), qty: r.perUnit })),
          labor_cost: Number(labor) || 0,
          overhead_cost: Number(overhead) || 0,
        });
      }
      toast(`${res.ref}: ${units} × ${target?.name} added to stock at ${money(res.unit_cost)} each`);
      onDone();
    });
  };

  const productOption = (p) => (
    <option key={p.id} value={p.id}>{p.name} — stock {p.stock} {p.unit}</option>
  );

  return (
    <Modal title="Assemble a Product" icon={<Factory size={18} />} size="xl" onClose={onClose}
      footer={<>
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" disabled={saving || anyShort} onClick={submit}>
          {saving ? 'Assembling…' : `Assemble ${units || ''} ${target ? target.unit : ''}`}
        </button>
      </>}>
      <form onSubmit={submit}>
        <h4 style={{ margin: '0 0 10px' }}>1. What are you making?</h4>
        <div className="form-grid mb">
          <Field label="Main Product (e.g. washing machine, cooler) *" className="full">
            <select value={productId} onChange={(e) => pickProduct(e.target.value)} required>
              <option value="">Select product…</option>
              {finished.length > 0 && <optgroup label="Assembled products">{finished.map(productOption)}</optgroup>}
              {others.length > 0 && <optgroup label="Other products">{others.map(productOption)}</optgroup>}
            </select>
          </Field>
          <Field label="How many units? *">
            <input type="number" min="1" step="any" value={qty} onChange={(e) => setQty(e.target.value)} required />
          </Field>
          <Field label="Date *">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>

        <h4 style={{ margin: '0 0 10px' }}>2. Raw products used for ONE unit</h4>
        <div className="table-wrap mb" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <table className="table compact">
            <thead>
              <tr>
                <th>Raw product (motor, body, side window…)</th>
                <th className="r" style={{ width: 110 }}>Per unit</th>
                <th className="r">Needed</th>
                <th className="r">In stock</th>
                <th className="r">Cost</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => {
                const p = byId.get(Number(r.component_id));
                const needed = (Number(r.qty) || 0) * units;
                const short = p ? needed > p.stock + 1e-9 : false;
                return (
                  <tr key={i}>
                    <td>
                      <select value={r.component_id} onChange={(e) => setRow(i, { component_id: e.target.value })}>
                        <option value="">Select raw product…</option>
                        {products.filter((x) => String(x.id) !== String(productId)).map((x) => (
                          <option key={x.id} value={x.id}>{x.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="r">
                      <input type="number" min="0" step="any" className="num" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
                    </td>
                    <td className="r strong">{p ? `${needed} ${p.unit}` : '—'}</td>
                    <td className={`r ${short ? 'neg strong' : 'muted'}`}>{p ? `${p.stock} ${p.unit}` : '—'}{short && ' — not enough'}</td>
                    <td className="r">{p ? money(needed * p.avg_cost) : '—'}</td>
                    <td className="c">
                      <button type="button" className="btn btn-sm btn-ghost btn-icon btn-danger" title="Remove" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-sm mb" onClick={() => setItems([...items, blankRow()])}>
          <Plus size={14} /> Add raw product
        </button>

        <h4 style={{ margin: '6px 0 10px' }}>3. Labour &amp; overhead for ONE unit</h4>
        <div className="form-grid mb">
          <Field label="Labour per unit (Rs)">
            <input type="number" min="0" step="any" value={labor} onChange={(e) => setLabor(e.target.value)} />
          </Field>
          <Field label="Overhead per unit (Rs)" hint="packing, electricity, transport">
            <input type="number" min="0" step="any" value={overhead} onChange={(e) => setOverhead(e.target.value)} />
          </Field>
          <Field label="Note" className="full">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. batch for Kashif Electronics" />
          </Field>
        </div>

        <div className="summary-box">
          <div className="summary-line"><span>Raw products</span><b>{money(materialCost)}</b></div>
          <div className="summary-line"><span>Labour ({units} × {money(Number(labor) || 0)})</span><b>{money(laborTotal)}</b></div>
          <div className="summary-line"><span>Overhead ({units} × {money(Number(overhead) || 0)})</span><b>{money(overheadTotal)}</b></div>
          <div className="summary-line total"><span>Total cost</span><b>{money(totalCost)}</b></div>
          <div className="summary-line" style={{ fontSize: 15 }}>
            <span>Cost of ONE {target?.name || 'unit'}</span>
            <b style={{ color: target && target.sale_price && unitCost > target.sale_price ? 'var(--rose)' : 'var(--text)' }}>{money(unitCost)}</b>
          </div>
          {target && target.sale_price > 0 && (
            <div className="summary-line small">
              <span className="muted">Sale price {money(target.sale_price)} → profit per unit</span>
              <b className={target.sale_price - unitCost >= 0 ? 'pos' : 'neg'}>{money(target.sale_price - unitCost)}</b>
            </div>
          )}
        </div>

        <label className="row small" style={{ gap: 8, marginTop: 12, cursor: 'pointer' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember these raw products, labour and overhead for this product next time
        </label>
        {anyShort && <p className="neg small" style={{ marginBottom: 0 }}>Some raw products are not in stock. Purchase them first or lower the quantity.</p>}
      </form>
    </Modal>
  );
}

function AssemblyDetail({ id, onClose }) {
  const { data: a, loading } = useFetch(`/assemblies/${id}`);
  return (
    <Modal title={a ? `${a.ref} — ${a.product_name}` : 'Assembly'} icon={<Factory size={18} />} size="lg" onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      {loading || !a ? <Loading /> : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>{fmtDate(a.date)} · {a.qty} {a.unit} made{a.note ? ` · ${a.note}` : ''}</p>
          <table className="table compact mb">
            <thead><tr><th>Raw product used</th><th className="r">Qty</th><th className="r">Cost each</th><th className="r">Total</th></tr></thead>
            <tbody>
              {a.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.component_name}</td>
                  <td className="r">{it.qty} {it.unit}</td>
                  <td className="r">{money(it.unit_cost)}</td>
                  <td className="r">{money(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="summary-box">
            <div className="summary-line"><span>Raw products</span><b>{money(a.material_cost)}</b></div>
            <div className="summary-line"><span>Labour</span><b>{money(a.labor_cost)}</b></div>
            <div className="summary-line"><span>Overhead</span><b>{money(a.other_cost)}</b></div>
            <div className="summary-line total"><span>Total</span><b>{money(a.total_cost)}</b></div>
            <div className="summary-line"><span>Cost per unit</span><b>{money(a.unit_cost)}</b></div>
          </div>
        </>
      )}
    </Modal>
  );
}

export default function Assembly() {
  const { confirm, loadLookups } = useApp();
  const [runSave] = useSaver();
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState(null);
  const { data: products, reload: reloadProducts } = useFetch('/products');
  const { data: assemblies, loading, reload } = useFetch('/assemblies');

  const refresh = () => {
    reload();
    reloadProducts();
    loadLookups();
  };

  const reverse = async (a) => {
    const ok = await confirm({
      title: `Reverse ${a.ref}?`,
      message: `${a.qty} ${a.unit} of ${a.product_name} leave stock and the raw products used go back into stock.`,
      okText: 'Reverse',
    });
    if (!ok) return;
    await runSave(async () => {
      await api.del(`/assemblies/${a.id}`);
      refresh();
    }, 'Assembly reversed');
  };

  return (
    <div>
      <PageHeader title="Assembly" subtitle="Make a finished product from raw products, labour and overhead">
        <button className="btn btn-primary" disabled={!products} onClick={() => setOpen(true)}>
          <Plus size={16} /> New Assembly
        </button>
      </PageHeader>

      <div className="card">
        <div className="card-head"><h3><Factory size={17} /> Assemblies made</h3></div>
        <div className="table-wrap">
          {loading ? (
            <Loading />
          ) : !assemblies?.length ? (
            <Empty title="Nothing assembled yet">
              <button className="btn btn-sm btn-primary mt" disabled={!products} onClick={() => setOpen(true)}>
                <Plus size={14} /> New Assembly
              </button>
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Date</th>
                  <th>Product made</th>
                  <th className="r">Units</th>
                  <th className="r">Raw products</th>
                  <th className="r">Labour + Overhead</th>
                  <th className="r">Total</th>
                  <th className="r">Per unit</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assemblies.map((a) => (
                  <tr key={a.id}>
                    <td><span className="badge violet mono">{a.ref}</span></td>
                    <td>{fmtDate(a.date)}</td>
                    <td className="strong">{a.product_name}</td>
                    <td className="r pos strong">+{a.qty} {a.unit}</td>
                    <td className="r">{money(a.material_cost)}</td>
                    <td className="r">{money(a.labor_cost + a.other_cost)}</td>
                    <td className="r strong">{money(a.total_cost)}</td>
                    <td className="r strong">{money(a.unit_cost)}</td>
                    <td className="actions">
                      <button className="btn btn-sm btn-ghost btn-icon" title="See raw products used" onClick={() => setViewId(a.id)}><Eye size={14} /></button>
                      <button className="btn btn-sm btn-ghost btn-icon btn-danger" title="Reverse assembly" onClick={() => reverse(a)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {open && products && (
        <AssembleModal products={products} onClose={() => setOpen(false)} onDone={() => { setOpen(false); refresh(); }} />
      )}
      {viewId && <AssemblyDetail id={viewId} onClose={() => setViewId(null)} />}
    </div>
  );
}
