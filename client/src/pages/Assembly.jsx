import React, { useState } from 'react';
import { 
  Factory, Plus, Search, Layers, Calculator, CheckCircle2, 
  AlertTriangle, ArrowRight, History, Trash2, Pencil, Boxes 
} from 'lucide-react';
import { useApp, useFetch, PageHeader, Modal, Field, Loading, Empty, useSaver } from '../components/ui';
import { money, fmtDate } from '../lib/format';
import { api } from '../lib/api';

export default function Assembly({ onNavigate }) {
  const { lookups, toast, confirm, loadLookups } = useApp();
  const [activeTab, setActiveTab] = useState('boms'); // 'boms' or 'history'
  const [bomModal, setBomModal] = useState(null); // null or product_id
  const [assembleModal, setAssembleModal] = useState(null); // null or product_id
  const [runSave, saving] = useSaver();

  // Assemblies & BOMs fetch
  const { data: boms, loading: loadingBoms, reload: reloadBoms } = useFetch('/bom');
  const { data: assemblies, loading: loadingAssemblies, reload: reloadAssemblies } = useFetch('/assemblies');

  // BOM Editor state
  const [bomItems, setBomItems] = useState([]);
  const [laborCost, setLaborCost] = useState(0);
  const [overheadCost, setOverheadCost] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState(null);

  // Assemble Run state
  const [assembleQty, setAssembleQty] = useState(1);
  const [assembleDate, setAssembleDate] = useState(new Date().toISOString().slice(0, 10));
  const [assembleNote, setAssembleNote] = useState('');
  const [bomPreview, setBomPreview] = useState(null);

  // Open BOM Editor
  const handleOpenBomEditor = async (productId) => {
    try {
      const data = await api.get(`/bom/${productId}`);
      setSelectedProduct(data.product);
      setBomItems(data.items.map((it) => ({ component_id: it.component_id, qty: it.qty })));
      setLaborCost(data.labor_cost);
      setOverheadCost(data.other_cost);
      setBomModal(productId);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleSaveBom = async (e) => {
    e.preventDefault();
    const cleanItems = bomItems.filter((it) => it.component_id && Number(it.qty) > 0);
    if (!cleanItems.length) {
      toast('Please add at least one component to the recipe', 'error');
      return;
    }

    await runSave(async () => {
      await api.put(`/bom/${bomModal}`, {
        items: cleanItems,
        labor_cost: Number(laborCost) || 0,
        overhead_cost: Number(overheadCost) || 0,
      });
      toast('Product assembly recipe (BOM) saved');
      setBomModal(null);
      reloadBoms();
    });
  };

  // Open Assembly Run Modal
  const handleOpenAssemble = async (productId) => {
    try {
      const data = await api.get(`/bom/${productId}`, { qty: 1 });
      setBomPreview(data);
      setAssembleQty(1);
      setAssembleDate(new Date().toISOString().slice(0, 10));
      setAssembleNote('');
      setAssembleModal(productId);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleQtyChange = async (qty) => {
    const q = Number(qty) || 1;
    setAssembleQty(q);
    if (assembleModal) {
      const data = await api.get(`/bom/${assembleModal}`, { qty: q });
      setBomPreview(data);
    }
  };

  const handleRunAssembly = async (e) => {
    e.preventDefault();
    if (!assembleModal || assembleQty <= 0) return;

    await runSave(async () => {
      const res = await api.post('/assemblies', {
        product_id: assembleModal,
        qty: assembleQty,
        date: assembleDate,
        note: assembleNote,
      });
      toast(`Assembly completed! Added ${assembleQty} units to finished inventory. Cost: ${money(res.unit_cost)}/unit`);
      setAssembleModal(null);
      reloadBoms();
      reloadAssemblies();
      loadLookups();
    });
  };

  const handleDeleteAssembly = async (a) => {
    const ok = await confirm({
      title: `Reverse Assembly #${a.ref}?`,
      message: 'This will deduct the finished goods from inventory and return the raw materials back to stock.',
      okText: 'Reverse Assembly'
    });
    if (!ok) return;

    await runSave(async () => {
      await api.del(`/assemblies/${a.id}`);
      toast('Assembly reversed & stock returned');
      reloadBoms();
      reloadAssemblies();
      loadLookups();
    });
  };

  return (
    <div>
      <PageHeader 
        title="Product Assembly & Cost Calculation" 
        subtitle="Manage product recipes (BOM), calculate material and labor costs, and produce finished goods"
      >
        <button className="btn btn-primary" onClick={() => onNavigate?.('inventory')}>
          <Boxes size={16} /> Inventory Catalog
        </button>
      </PageHeader>

      {/* Tabs */}
      <div className="card mb">
        <div className="tabs">
          <button className={activeTab === 'boms' ? 'on' : ''} onClick={() => setActiveTab('boms')}>
            Product Recipes & Cost Breakdown
          </button>
          <button className={activeTab === 'history' ? 'on' : ''} onClick={() => setActiveTab('history')}>
            Assembly Production Log
          </button>
        </div>

        {activeTab === 'boms' ? (
          <div className="table-wrap">
            {loadingBoms ? (
              <Loading />
            ) : !boms || boms.length === 0 ? (
              <Empty title="No assembled products configured">
                <p className="muted small">Add a product marked as "Assembled Product" in Inventory first.</p>
                <button className="btn btn-sm btn-primary mt" onClick={() => onNavigate?.('inventory')}>
                  Go to Inventory
                </button>
              </Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Assembled Product</th>
                    <th>Components</th>
                    <th className="r">Material Cost</th>
                    <th className="r">Labor</th>
                    <th className="r">Overhead</th>
                    <th className="r">Total Cost / Unit</th>
                    <th className="r">Sale Price</th>
                    <th className="r">Buildable Now</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {boms.map((b) => (
                    <tr key={b.product_id}>
                      <td>
                        <div className="strong" style={{ fontSize: '14.5px' }}>{b.name}</div>
                        {b.sku && <span className="muted small mono">SKU: {b.sku}</span>}
                      </td>
                      <td>
                        <span className="badge aqua">{b.component_count} components</span>
                      </td>
                      <td className="r">{money(b.material_cost)}</td>
                      <td className="r">{money(b.labor_cost)}</td>
                      <td className="r">{money(b.other_cost)}</td>
                      <td className="r strong big" style={{ color: 'var(--aqua)' }}>
                        {money(b.unit_cost)}
                      </td>
                      <td className="r strong">{money(b.sale_price)}</td>
                      <td className="r">
                        <span className={`badge ${b.max_buildable > 0 ? 'green' : 'rose'}`} style={{ fontSize: '12.5px', fontWeight: 700 }}>
                          {b.max_buildable} {b.unit}
                        </span>
                      </td>
                      <td className="actions">
                        <button 
                          className="btn btn-sm btn-success" 
                          title="Assemble & Build finished stock" 
                          onClick={() => handleOpenAssemble(b.product_id)}
                          disabled={b.max_buildable <= 0}
                        >
                          <Factory size={14} /> Assemble Run
                        </button>
                        <button 
                          className="btn btn-sm btn-ghost" 
                          title="Configure Recipe / Components" 
                          onClick={() => handleOpenBomEditor(b.product_id)}
                        >
                          <Pencil size={14} /> Edit BOM
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            {loadingAssemblies ? (
              <Loading />
            ) : !assemblies || assemblies.length === 0 ? (
              <Empty title="No assembly runs recorded yet" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Ref #</th>
                    <th>Date</th>
                    <th>Assembled Product</th>
                    <th className="r">Units Built</th>
                    <th className="r">Material Cost</th>
                    <th className="r">Labor Cost</th>
                    <th className="r">Total Assembly Cost</th>
                    <th className="r">Cost / Unit</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assemblies.map((a) => (
                    <tr key={a.id}>
                      <td><span className="badge violet mono strong">{a.ref}</span></td>
                      <td>{fmtDate(a.date)}</td>
                      <td><div className="strong">{a.product_name}</div></td>
                      <td className="r strong pos">+{a.qty} {a.unit}</td>
                      <td className="r">{money(a.material_cost)}</td>
                      <td className="r">{money(a.labor_cost)}</td>
                      <td className="r strong">{money(a.total_cost)}</td>
                      <td className="r strong big" style={{ color: 'var(--aqua)' }}>{money(a.unit_cost)}</td>
                      <td className="actions">
                        <button 
                          className="btn btn-sm btn-ghost btn-icon btn-danger" 
                          title="Reverse Assembly" 
                          onClick={() => handleDeleteAssembly(a)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* BOM Recipe Editor Modal */}
      {bomModal && selectedProduct && (
        <Modal
          title={`BOM Recipe & Cost: ${selectedProduct.name}`}
          onClose={() => setBomModal(null)}
          size="lg"
        >
          <form onSubmit={handleSaveBom}>
            <p className="muted small" style={{ margin: '0 0 16px 0' }}>
              Define the raw materials and parts consumed to make <strong>1 unit</strong> of this finished product.
            </p>

            <table className="table line-items mb">
              <thead>
                <tr>
                  <th style={{ width: '60%' }}>Component / Raw Material</th>
                  <th className="r" style={{ width: '30%' }}>Qty Per 1 Unit</th>
                  <th style={{ width: '10%' }}></th>
                </tr>
              </thead>
              <tbody>
                {bomItems.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <select 
                        value={item.component_id} 
                        onChange={(e) => {
                          const next = [...bomItems];
                          next[idx].component_id = e.target.value;
                          setBomItems(next);
                        }}
                        required
                      >
                        <option value="">Select component...</option>
                        {lookups.products
                          .filter((p) => p.id !== Number(bomModal))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} [{p.unit}] — Current Avg Cost: {money(p.cost_price)}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="r">
                      <input 
                        type="number" 
                        step="any" 
                        className="num" 
                        value={item.qty} 
                        onChange={(e) => {
                          const next = [...bomItems];
                          next[idx].qty = e.target.value;
                          setBomItems(next);
                        }}
                        required 
                      />
                    </td>
                    <td className="c">
                      <button 
                        type="button" 
                        className="btn btn-sm btn-ghost btn-icon btn-danger" 
                        onClick={() => setBomItems(bomItems.filter((_, i) => i !== idx))}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button 
              type="button" 
              className="btn btn-sm btn-primary mb" 
              onClick={() => setBomItems([...bomItems, { component_id: '', qty: 1 }])}
            >
              <Plus size={14} /> Add Component
            </button>

            <div className="form-grid mb" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <Field label="Labor Cost per Unit (Rs)">
                <input 
                  type="number" 
                  step="any" 
                  value={laborCost} 
                  onChange={(e) => setLaborCost(e.target.value)} 
                  placeholder="0" 
                />
              </Field>
              <Field label="Overhead / Packaging Cost per Unit (Rs)">
                <input 
                  type="number" 
                  step="any" 
                  value={overheadCost} 
                  onChange={(e) => setOverheadCost(e.target.value)} 
                  placeholder="0" 
                />
              </Field>
            </div>

            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setBomModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Recipe'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Assemble Production Run Modal */}
      {assembleModal && bomPreview && (
        <Modal
          title={`Assemble Finished Units: ${bomPreview.product.name}`}
          onClose={() => setAssembleModal(null)}
          size="lg"
        >
          <form onSubmit={handleRunAssembly}>
            <div className="card-pad mb" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
              <div className="row-between">
                <div>
                  <span className="muted small">Max Units You Can Assemble Now:</span>
                  <div className="strong big" style={{ color: bomPreview.max_buildable > 0 ? 'var(--green)' : 'var(--rose)' }}>
                    {bomPreview.max_buildable} {bomPreview.product.unit}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="muted small">Finished Cost Per Unit:</span>
                  <div className="strong big" style={{ color: 'var(--aqua)' }}>
                    {money(bomPreview.unit_cost)}
                  </div>
                </div>
              </div>
            </div>

            <div className="form-grid mb">
              <Field label="Quantity to Assemble *">
                <input 
                  type="number" 
                  step="any" 
                  min="0.1" 
                  max={bomPreview.max_buildable > 0 ? bomPreview.max_buildable : undefined}
                  value={assembleQty} 
                  onChange={(e) => handleQtyChange(e.target.value)} 
                  required 
                />
              </Field>
              <Field label="Production Date *">
                <input type="date" value={assembleDate} onChange={(e) => setAssembleDate(e.target.value)} required />
              </Field>
              <Field label="Production Notes" className="full">
                <input value={assembleNote} onChange={(e) => setAssembleNote(e.target.value)} placeholder="e.g. Batch #4 for client order" />
              </Field>
            </div>

            {/* Component availability list */}
            <div className="card mb" style={{ border: '1px solid var(--border)' }}>
              <div className="card-head">
                <h4 style={{ margin: 0, fontSize: '13px' }}>Raw Materials to be Consumed from Stock</h4>
              </div>
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th className="r">Available Stock</th>
                      <th className="r">Required for Run</th>
                      <th className="r">Material Cost</th>
                      <th className="c">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomPreview.items?.map((it) => (
                      <tr key={it.component_id}>
                        <td>{it.component_name}</td>
                        <td className="r strong">{it.stock} {it.unit}</td>
                        <td className="r strong" style={{ color: it.sufficient ? 'var(--text)' : 'var(--rose)' }}>
                          {it.required} {it.unit}
                        </td>
                        <td className="r">{money(it.line_cost)}</td>
                        <td className="c">
                          {it.sufficient ? (
                            <span className="badge green">Sufficient</span>
                          ) : (
                            <span className="badge rose">Insufficient</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Total Run Cost summary */}
            <div className="summary-box mb">
              <div className="summary-line">
                <span>Material Cost Total:</span>
                <b>{money(bomPreview.material_cost)}</b>
              </div>
              <div className="summary-line">
                <span>Labor Cost Total:</span>
                <b>{money(bomPreview.labor_cost)}</b>
              </div>
              <div className="summary-line">
                <span>Overhead / Tools Total:</span>
                <b>{money(bomPreview.other_cost)}</b>
              </div>
              <div className="summary-line total">
                <span>Total Production Cost:</span>
                <b>{money(bomPreview.total_cost)}</b>
              </div>
            </div>

            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => setAssembleModal(null)}>Cancel</button>
              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={saving || bomPreview.max_buildable < assembleQty}
              >
                {saving ? 'Processing...' : 'Complete Assembly & Update Stock'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
