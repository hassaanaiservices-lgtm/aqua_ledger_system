import React, { useState, useRef, useEffect } from 'react';
import { 
  Package, Plus, Search, Filter, AlertTriangle, ArrowUpDown, 
  History, Pencil, Trash2, CheckCircle2, Factory, Boxes, FileSpreadsheet, ImagePlus
} from 'lucide-react';
import { useApp, useFetch, PageHeader, Modal, Field, Loading, Empty, useSaver } from '../components/ui';
import { money, fmtDate, PRODUCT_TYPES } from '../lib/format';
import { api, productImageUrl, downloadReadableBackup } from '../lib/api';
import { fileToDataUrl, imageKB, PRODUCT_LIMITS } from '../lib/image';

export default function Inventory({ onNavigate }) {
  const { toast, confirm, changed } = useApp();
  const [removingOpening, setRemovingOpening] = useState(false);
  const [tab, setTab] = useState('all'); // all, finished, raw, trading
  const [search, setSearch] = useState('');
  const [productModal, setProductModal] = useState(null); // null, 'new', or product object
  const [productImage, setProductImage] = useState('');
  const [imageTouched, setImageTouched] = useState(false);
  const imageInputRef = useRef(null);
  const [adjustModal, setAdjustModal] = useState(null); // null or product object
  const [historyModal, setHistoryModal] = useState(null); // null or product id
  const [runSave, saving] = useSaver();

  const { data: products, loading, reload } = useFetch('/products', { type: tab === 'all' ? undefined : tab, q: search });
  const { data: historyData } = useFetch(historyModal ? `/products/${historyModal}` : null);

  // Existing pictures are fetched by URL; a new one is only held in memory once chosen.
  useEffect(() => {
    setImageTouched(false);
    setProductImage(productModal?.id && productModal?.has_image ? productImageUrl(productModal.id, Date.now()) : '');
  }, [productModal]);

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setProductImage(await fileToDataUrl(file, PRODUCT_LIMITS));
      setImageTouched(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveProduct = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    if (imageTouched) body.image = productImage;
    
    await runSave(async () => {
      if (productModal?.id) {
        await api.put(`/products/${productModal.id}`, body);
        toast('Product updated successfully');
      } else {
        await api.post('/products', body);
        toast('New product added to inventory');
      }
      setProductModal(null);
      reload();
    });
  };

  const handleSaveAdjustment = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    body.product_id = adjustModal.id;

    await runSave(async () => {
      await api.post('/stock-adjustments', body);
      toast('Stock adjustment recorded');
      setAdjustModal(null);
      reload();
    });
  };

  const handleDelete = async (p) => {
    const ok = await confirm({
      title: `Delete or Archive "${p.name}"?`,
      message: 'If this product has any transaction history (sales, purchases, assemblies), it will be safely archived to preserve records integrity.',
      okText: 'Proceed'
    });
    if (!ok) return;

    await runSave(async () => {
      const res = await api.del(`/products/${p.id}`);
      if (res.archived) toast('Product archived (preserved in past records)', 'info');
      else toast('Product removed from inventory');
      reload();
    });
  };

  const totalValue = products?.reduce((sum, p) => sum + p.stock_value, 0) || 0;
  const lowCount = products?.filter((p) => p.low_stock).length || 0;

  const handleRemoveOpeningStock = async () => {
    try {
      const preview = await api.get('/opening-stock');
      if (!preview.entries) return toast('There is no opening stock to remove');
      const ok = await confirm({
        title: 'Remove all opening stock?',
        message: `This deletes ${preview.entries} opening stock entr${preview.entries === 1 ? 'y' : 'ies'} for ${preview.products.length} product(s). Sales, purchases, assemblies and your adjustments stay as they are. ${preview.negative_after} product(s) will show negative stock until you enter real stock. A full backup (.json) downloads first. This cannot be undone.`,
        okText: 'Remove Opening Stock',
        danger: true,
      });
      if (!ok) return;
      setRemovingOpening(true);
      await downloadReadableBackup();
      const res = await api.del('/opening-stock');
      toast(`Removed ${res.deleted} opening stock entries`);
      changed();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRemovingOpening(false);
    }
  };

  return (
    <div>
      <PageHeader 
        title="Product Inventory Management" 
        subtitle="Track raw materials, components, assembled products, and stock movements"
      >
        <button className="btn btn-danger" onClick={handleRemoveOpeningStock} disabled={removingOpening} title="Delete the opening stock of every product so stock can be entered through purchases">
          <Trash2 size={16} /> {removingOpening ? 'Removing…' : 'Delete Opening Stock'}
        </button>
        <button className="btn btn-primary" onClick={() => setProductModal({})}>
          <Plus size={16} /> Add Product / Item
        </button>
      </PageHeader>

      {/* Overview Cards */}
      <div className="grid grid-3 mb">
        <div className="card card-pad">
          <span className="muted small">Total Inventory Value</span>
          <div className="stat-value" style={{ color: 'var(--aqua)' }}>{money(totalValue)}</div>
          <span className="muted small">{products?.length || 0} catalog items</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Low Stock Warnings</span>
          <div className="stat-value" style={{ color: lowCount > 0 ? 'var(--amber)' : 'var(--green)' }}>
            {lowCount} item{lowCount === 1 ? '' : 's'}
          </div>
          <span className="muted small">Below defined reorder threshold</span>
        </div>
        <div className="card card-pad">
          <span className="muted small">Stock Automation</span>
          <div style={{ marginTop: 6, fontSize: '13px', color: 'var(--text-2)' }}>
            Inventory syncs automatically upon <strong>Purchases</strong>, <strong>Sales</strong>, and <strong>Assemblies</strong>.
          </div>
        </div>
      </div>

      {/* Tabs & Search Filter */}
      <div className="card mb">
        <div className="tabs">
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>All Items</button>
          <button className={tab === 'finished' ? 'on' : ''} onClick={() => setTab('finished')}>Assembled Products</button>
          <button className={tab === 'raw' ? 'on' : ''} onClick={() => setTab('raw')}>Raw Materials</button>
          <button className={tab === 'trading' ? 'on' : ''} onClick={() => setTab('trading')}>Trading Items</button>
        </div>

        <div className="filters">
          <div className="search field wide">
            <Search size={16} />
            <input 
              placeholder="Search by product name, SKU, or category..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
            />
          </div>
        </div>

        <div className="table-wrap">
          {loading ? (
            <Loading />
          ) : !products || products.length === 0 ? (
            <Empty title="No products found in this category">
              <button className="btn btn-sm btn-primary mt" onClick={() => setProductModal({})}>
                Add first product
              </button>
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th className="col-product">Product Details</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th className="r">Stock on Hand</th>
                  <th className="r">Avg Cost Price</th>
                  <th className="r">Stock Value</th>
                  <th className="r">Sale Price</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const typeMeta = PRODUCT_TYPES[p.type] || { label: p.type, badge: 'aqua' };
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <div className="thumb" style={{ width: 40, height: 40, borderRadius: 9, background: '#f1f4f8', border: '1px solid var(--border)', overflow: 'hidden', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                            {p.has_image ? (
                              <img src={productImageUrl(p.id)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <Package size={18} color="var(--text-3)" />
                            )}
                          </div>
                          <div>
                            <div className="strong">{p.name}</div>
                            <div className="muted small mono">
                              {p.sku ? `SKU: ${p.sku} · ` : ''}Unit: {p.unit}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{p.category || '—'}</td>
                      <td>
                        <span className={`badge ${typeMeta.badge}`}>{typeMeta.label}</span>
                      </td>
                      <td className="r">
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className={`strong ${p.stock <= 0 ? 'neg' : p.low_stock ? 'warn' : 'pos'}`}>
                            {p.stock} {p.unit}
                          </span>
                          {p.low_stock && (
                            <span title={`Reorder level is ${p.reorder_level} ${p.unit}`}>
                              <AlertTriangle size={15} color="var(--amber)" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="r">{money(p.avg_cost)}</td>
                      <td className="r strong" style={{ color: 'var(--aqua)' }}>{money(p.stock_value)}</td>
                      <td className="r">{money(p.sale_price)}</td>
                      <td className="actions">
                        <button 
                          className="btn btn-sm btn-ghost" 
                          title="Stock Adjustment (Damage / Correction)" 
                          onClick={() => setAdjustModal(p)}
                        >
                          <ArrowUpDown size={15} /> Adjust
                        </button>
                        <button 
                          className="btn btn-sm btn-ghost btn-icon" 
                          title="Movement History" 
                          onClick={() => setHistoryModal(p.id)}
                        >
                          <History size={15} />
                        </button>
                        <button 
                          className="btn btn-sm btn-ghost btn-icon" 
                          title="Edit Product" 
                          onClick={() => setProductModal(p)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button 
                          className="btn btn-sm btn-ghost btn-icon btn-danger" 
                          title="Delete / Archive" 
                          onClick={() => handleDelete(p)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {productModal && (
        <Modal
          title={productModal.id ? 'Edit Product' : 'Add New Product or Material'}
          onClose={() => setProductModal(null)}
          size="lg"
        >
          <form onSubmit={handleSaveProduct}>
            <div className="form-grid">
              <Field label="Product Image" hint="optional" className="full">
                <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                  <div style={{ width: 84, height: 84, borderRadius: 12, background: '#f1f4f8', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                    {productImage ? (
                      <img src={productImage} alt="Product preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <ImagePlus size={26} color="var(--text-3)" />
                    )}
                  </div>
                  <div className="stack" style={{ gap: 6 }}>
                    <input type="file" ref={imageInputRef} accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleImageSelect} />
                    <div className="row" style={{ gap: 8 }}>
                      <button type="button" className="btn btn-sm" onClick={() => imageInputRef.current?.click()}>
                        <ImagePlus size={13} /> {productImage ? 'Change image' : 'Upload image'}
                      </button>
                      {productImage && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setProductImage(''); setImageTouched(true); }}>
                          <Trash2 size={13} /> Remove
                        </button>
                      )}
                    </div>
                    <span className="muted small">{productImage.startsWith('data:') ? `${imageKB(productImage)} KB · ` : ''}Resized automatically.</span>
                  </div>
                </div>
              </Field>
              <Field label="Product Name *" className="full">
                <input name="name" defaultValue={productModal.name || ''} required placeholder="e.g. 7-Stage RO Water Purifier" />
              </Field>
              <Field label="SKU / Item Code">
                <input name="sku" defaultValue={productModal.sku || ''} placeholder="e.g. RO-7S-01" />
              </Field>
              <Field label="Item Classification *">
                <select name="type" defaultValue={productModal.type || 'finished'}>
                  <option value="finished">Assembled Product (Manufactured/Assembled)</option>
                  <option value="raw">Raw Material / Component (Used in BOM)</option>
                  <option value="trading">Trading Item (Direct Buy & Resell)</option>
                </select>
              </Field>
              <Field label="Category">
                <input name="category" defaultValue={productModal.category || ''} placeholder="e.g. Filters, Membranes, Domestic" />
              </Field>
              <Field label="Unit of Measurement *">
                <input name="unit" defaultValue={productModal.unit || 'pcs'} required placeholder="pcs, meter, kg, set" />
              </Field>
              <Field label="Purchase / Standard Cost (Rs)">
                <input type="number" step="any" name="cost_price" defaultValue={productModal.cost_price || ''} placeholder="0" />
              </Field>
              <Field label="Selling Price (Rs)">
                <input type="number" step="any" name="sale_price" defaultValue={productModal.sale_price || ''} placeholder="0" />
              </Field>
              <Field label="Reorder Level (Alert threshold)">
                <input type="number" step="any" name="reorder_level" defaultValue={productModal.reorder_level || ''} placeholder="Alert when stock falls below" />
              </Field>
              {!productModal.id && (
                <Field label="Initial Opening Stock Qty">
                  <input type="number" step="any" name="opening_stock" placeholder="0" />
                </Field>
              )}
              {productModal.type === 'finished' && (
                <>
                  <Field label="Estimated Labor Cost (Rs)">
                    <input type="number" step="any" name="labor_cost" defaultValue={productModal.labor_cost || ''} placeholder="Per unit assembly labor" />
                  </Field>
                  <Field label="Estimated Overhead Cost (Rs)">
                    <input type="number" step="any" name="overhead_cost" defaultValue={productModal.overhead_cost || ''} placeholder="Electricity, packaging, tools" />
                  </Field>
                </>
              )}
            </div>
            <div className="modal-foot" style={{ marginTop: 24, padding: '14px 0 0' }}>
              <button type="button" className="btn" onClick={() => setProductModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Product'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Stock Adjustment Modal */}
      {adjustModal && (
        <Modal
          title={`Adjust Stock: ${adjustModal.name}`}
          onClose={() => setAdjustModal(null)}
        >
          <form onSubmit={handleSaveAdjustment}>
            <div className="card-pad mb" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
              <div className="row-between">
                <span className="muted">Current stock on hand:</span>
                <span className="strong big">{adjustModal.stock} {adjustModal.unit}</span>
              </div>
            </div>

            <div className="form-grid">
              <Field label="Adjustment Quantity (+ or -) *" className="full" hint="Enter negative number to reduce stock">
                <input 
                  type="number" 
                  step="any" 
                  name="qty" 
                  required 
                  placeholder="e.g. +5 for found stock, -2 for damaged" 
                />
              </Field>
              <Field label="Adjustment Date *">
                <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </Field>
              <Field label="Unit Cost (Rs)">
                <input type="number" step="any" name="unit_cost" defaultValue={adjustModal.avg_cost || adjustModal.cost_price || ''} />
              </Field>
              <Field label="Reason / Notes *" className="full">
                <input name="note" required placeholder="e.g. Damaged in transit, Annual physical inventory audit" />
              </Field>
            </div>

            <div className="modal-foot" style={{ marginTop: 24, padding: '14px 0 0' }}>
              <button type="button" className="btn" onClick={() => setAdjustModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Apply Stock Change'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Movement History Audit Modal */}
      {historyModal && (
        <Modal
          title={`Stock Movement History: ${historyData?.name || '...'}`}
          onClose={() => setHistoryModal(null)}
          size="lg"
        >
          {!historyData ? (
            <Loading />
          ) : (
            <div>
              <div className="row-between mb">
                <div>
                  <span className="badge aqua">{historyData.unit}</span>
                  <span className="muted small" style={{ marginLeft: 8 }}>
                    Current Stock: <strong>{historyData.stock} {historyData.unit}</strong>
                  </span>
                </div>
                <div className="muted small">
                  Avg Valuation Cost: <strong>{money(historyData.avg_cost)}</strong>
                </div>
              </div>

              <div className="table-wrap" style={{ maxHeight: '55vh' }}>
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Ref Document</th>
                      <th>Type</th>
                      <th className="r">Qty Change</th>
                      <th className="r">Unit Cost</th>
                      <th className="r">Running Stock</th>
                      <th>Note / Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.movements?.map((m) => (
                      <tr key={m.id}>
                        <td>{fmtDate(m.date)}</td>
                        <td><span className="mono badge">{m.ref_type.toUpperCase()} #{m.ref_id || m.id}</span></td>
                        <td>{m.ref_type}</td>
                        <td className={`r strong ${m.qty > 0 ? 'pos' : 'neg'}`}>
                          {m.qty > 0 ? `+${m.qty}` : m.qty}
                        </td>
                        <td className="r">{money(m.unit_cost)}</td>
                        <td className="r strong">{m.balance}</td>
                        <td className="muted small">{m.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
