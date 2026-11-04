import React, { useState, useEffect, useRef } from 'react';
import { 
  Settings as SettingsIcon, Save, Database, Lock, 
  Building2, FileText, CheckCircle2, Download, Upload,
  FolderOpen, ShieldCheck, HardDrive, RefreshCw, Clock, Trash2
} from 'lucide-react';
import { useApp, PageHeader, Field, useSaver } from '../components/ui';
import { fileToDataUrl, imageKB, LOGO_LIMITS } from '../lib/image';
import { api, downloadBackup, downloadReadableBackup, restoreBackup, restoreArchive, restoreDbToHosted } from '../lib/api';

export default function Settings({ onNavigate }) {
  const { settings, loadSettings, toast, confirm, changed } = useApp();
  const [profile, setProfile] = useState({ ...settings });
  const [passwords, setPasswords] = useState({ current: '', password: '', confirm: '' });
  const [storage, setStorage] = useState(null);
  const [loadingStorage, setLoadingStorage] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [downloadingReadable, setDownloadingReadable] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoringArchive, setRestoringArchive] = useState(false);
  const fileInputRef = useRef(null);
  const archiveInputRef = useRef(null);
  const [runSave, saving] = useSaver();

  const loadStorageInfo = async () => {
    try {
      setLoadingStorage(true);
      const data = await api.get('/system/storage');
      setStorage(data);
    } catch (e) {
      console.error('Failed to load storage info:', e);
    } finally {
      setLoadingStorage(false);
    }
  };

  useEffect(() => {
    loadStorageInfo();
  }, []);

  const logoInputRef = useRef(null);
  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file, LOGO_LIMITS);
      setProfile((p) => ({ ...p, business_logo: dataUrl }));
      toast('Logo ready. Press Save to keep it.', 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    await runSave(async () => {
      await api.put('/settings', profile);
      toast('Business profile & invoice settings saved');
      loadSettings();
    });
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (passwords.password !== passwords.confirm) {
      toast('New passwords do not match', 'error');
      return;
    }
    await runSave(async () => {
      await api.post('/auth/change-password', {
        current: passwords.current,
        password: passwords.password,
      });
      toast('Password changed successfully');
      setPasswords({ current: '', password: '', confirm: '' });
    });
  };

  const handleBackupDownload = async () => {
    try {
      await downloadBackup();
      toast('Database backup file (.db) downloaded');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const handleReadableDownload = async () => {
    try {
      setDownloadingReadable(true);
      await downloadReadableBackup();
      toast('Master readable data archive (.json) downloaded');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDownloadingReadable(false);
    }
  };

  const handleArchiveSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      toast('Please select the .json archive downloaded from this app', 'error');
      e.target.value = '';
      return;
    }

    const ok = await confirm({
      title: 'Load data from archive?',
      message: `This replaces everything currently in this copy with the contents of "${file.name}" — products, ledgers, invoices, purchases, bank accounts and diary. Your password is not changed. This cannot be undone.`,
      okText: 'Replace Data',
      danger: true,
    });
    if (!ok) {
      e.target.value = '';
      return;
    }

    try {
      setRestoringArchive(true);
      const res = await restoreArchive(file);
      toast(`Loaded ${res.total} records. Refreshing…`);
      loadSettings();
      changed();
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRestoringArchive(false);
      e.target.value = '';
    }
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.db')) {
      toast('Please select a valid SQLite .db file', 'error');
      return;
    }

    const ok = await confirm({
      title: 'Restore Database from File?',
      message: storage?.hosted
        ? `This replaces everything currently in the online copy with the contents of "${file.name}". Your password is not changed. This cannot be undone.`
        : `Are you sure you want to restore data from "${file.name}"? This will replace the current database with the uploaded file. A safety backup of your existing database will be saved automatically first.`,
      okText: 'Restore Now',
      danger: true,
    });
    if (!ok) {
      e.target.value = '';
      return;
    }

    try {
      setRestoring(true);
      if (storage?.hosted) await restoreDbToHosted(file);
      else await restoreBackup(file);
      toast('Database successfully restored! Refreshing application...');
      loadSettings();
      loadStorageInfo();
      changed();
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateInstantBackup = async () => {
    try {
      setBackingUp(true);
      const res = await api.post('/system/create-backup');
      toast(`Instant backup created: ${res.backup.name}`);
      loadStorageInfo();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await api.post('/system/open-folder');
      toast('Data folder opened');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div>
      <PageHeader 
        title="Settings & System Configuration" 
        subtitle="Configure business details, invoice letterhead, backup database, and manage security"
      />

      <div className="grid grid-2 mb">
        {/* Business Profile & Invoice Brand */}
        <div className="card">
          <div className="card-head">
            <h3 className="row"><Building2 size={18} color="var(--aqua)" /> Business Letterhead & Details</h3>
          </div>
          <div className="card-body">
            <form onSubmit={handleSaveProfile}>
              <div className="form-grid mb">
                <Field label="Business Legal Name *" hint="shown in the sidebar and on invoices">
                  <input
                    value={profile.business_name || ''}
                    onChange={(e) => setProfile({ ...profile, business_name: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Tagline" hint="the small line under the name">
                  <input
                    value={profile.business_tagline ?? ''}
                    onChange={(e) => setProfile({ ...profile, business_tagline: e.target.value })}
                    placeholder="Management System"
                  />
                </Field>
                <Field label="Logo / Monogram" hint="shown in the sidebar and on invoices" className="full">
                  <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 14, background: '#111114', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      {profile.business_logo ? (
                        <img src={profile.business_logo} alt="Logo preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (
                        <span style={{ color: '#fff', fontWeight: 700, fontSize: 22 }}>{(profile.business_name || 'A')[0].toUpperCase()}</span>
                      )}
                    </div>
                    <div className="stack" style={{ gap: 6 }}>
                      <input type="file" ref={logoInputRef} accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={handleLogoSelect} />
                      <div className="row" style={{ gap: 8 }}>
                        <button type="button" className="btn btn-sm" onClick={() => logoInputRef.current?.click()}>
                          <Upload size={13} /> {profile.business_logo ? 'Change logo' : 'Upload logo'}
                        </button>
                        {profile.business_logo && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProfile({ ...profile, business_logo: '' })}>
                            <Trash2 size={13} /> Remove
                          </button>
                        )}
                      </div>
                      <span className="muted small">
                        {profile.business_logo ? `${imageKB(profile.business_logo)} KB · ` : ''}PNG, JPG, WebP or SVG. Resized automatically.
                      </span>
                    </div>
                  </div>
                </Field>
                <Field label="Phone / Mobile">
                  <input 
                    value={profile.business_phone || ''} 
                    onChange={(e) => setProfile({ ...profile, business_phone: e.target.value })} 
                  />
                </Field>
                <Field label="Email Address">
                  <input 
                    type="email"
                    value={profile.business_email || ''} 
                    onChange={(e) => setProfile({ ...profile, business_email: e.target.value })} 
                  />
                </Field>
                <Field label="NTN / STRN / Tax Number">
                  <input 
                    value={profile.business_ntn || ''} 
                    onChange={(e) => setProfile({ ...profile, business_ntn: e.target.value })} 
                  />
                </Field>
                <Field label="Currency Symbol">
                  <input 
                    value={profile.currency || 'Rs'} 
                    onChange={(e) => setProfile({ ...profile, currency: e.target.value })} 
                  />
                </Field>
                <Field label="Full Business Address" className="full">
                  <textarea 
                    value={profile.business_address || ''} 
                    onChange={(e) => setProfile({ ...profile, business_address: e.target.value })} 
                  />
                </Field>
                <Field label="Invoice Footer Message" className="full">
                  <input 
                    value={profile.invoice_footer || ''} 
                    onChange={(e) => setProfile({ ...profile, invoice_footer: e.target.value })} 
                    placeholder="e.g. Thank you for your valued business!" 
                  />
                </Field>
                <Field label="Default Terms & Conditions" className="full">
                  <textarea 
                    value={profile.invoice_terms || ''} 
                    onChange={(e) => setProfile({ ...profile, invoice_terms: e.target.value })} 
                    placeholder="e.g. Goods once sold are returnable within 7 days in original condition." 
                  />
                </Field>
              </div>

              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Save size={15} /> Save Business Profile
              </button>
            </form>
          </div>
        </div>

        {/* Database Backup & Security */}
        <div className="stack">
          {/* SQLite Permanent Data & Backups Card */}
          <div className="card">
            <div className="card-head">
              <h3 className="row">
                <ShieldCheck size={18} color="var(--green)" /> 
                Permanent Data Safety & Automatic Backups
              </h3>
              {storage?.is_safe_location ? (
                <span className="badge green" title="Stored outside Windows OS drive so data survives Windows reinstallation">
                  <CheckCircle2 size={12} /> Reinstall-Safe Partition
                </span>
              ) : (
                <span className="badge sky">
                  <HardDrive size={12} /> Local Storage
                </span>
              )}
            </div>
            <div className="card-body">
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.05em' }}>
                  Active Database Location
                </div>
                <div className="mono" style={{ padding: '8px 10px', background: 'rgba(7, 13, 24, 0.65)', border: '1px solid var(--border)', borderRadius: 6, marginTop: 5, fontSize: 12, wordBreak: 'break-all' }}>
                  {storage?.db_path || 'Loading database path...'}
                </div>
              </div>

              <div style={{ background: 'rgba(34, 211, 238, 0.05)', border: '1px solid rgba(34, 211, 238, 0.15)', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
                <div className="row" style={{ gap: 8, color: 'var(--aqua)', fontWeight: 600, fontSize: 12.5 }}>
                  <Clock size={15} /> 30-Day Rotating Daily Backups Active
                </div>
                <p className="muted small" style={{ margin: '4px 0 0', lineHeight: 1.5 }}>
                  Every launch creates a daily snapshot in the <code className="mono">backups</code> folder. Backups older than 30 days are automatically rotated out.
                </p>
              </div>

              <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
                <button 
                  type="button" 
                  className="btn btn-sm" 
                  onClick={handleBackupDownload}
                  title="Exact SQLite database file for 1-click restore"
                >
                  <Download size={13} /> Download .db File
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm" 
                  onClick={handleReadableDownload}
                  disabled={downloadingReadable}
                  title="Plain text JSON archive opening in Notepad, Chrome, or any text editor"
                >
                  <FileText size={13} className={downloadingReadable ? 'spinner' : ''} /> 
                  {downloadingReadable ? 'Exporting...' : 'Download Master Data (.json / Text)'}
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm" 
                  onClick={handleCreateInstantBackup} 
                  disabled={backingUp}
                >
                  <RefreshCw size={13} className={backingUp ? 'spinner' : ''} /> 
                  {backingUp ? 'Creating Backup...' : 'Create Snapshot'}
                </button>
                <button 
                  type="button" 
                  className="btn btn-sm" 
                  onClick={handleOpenFolder}
                >
                  <FolderOpen size={13} /> Open Data Folder
                </button>
              </div>

              {/* JSON archive restore — the one that also works on the hosted copy */}
              <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <div className="row-between wrap" style={{ gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#111114', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Upload size={14} color="#111114" /> Upload &amp; Restore Archive (.json)
                      <span className="badge green">Works online too</span>
                    </div>
                    <p className="muted small" style={{ margin: '4px 0 0', lineHeight: 1.45 }}>
                      Loads a <code className="mono">.json</code> archive back in — products, customer and vendor
                      ledgers, invoices, purchase history, bank accounts, cash book and diary. Use this to move
                      your books onto the online version. Your password is not changed.
                    </p>
                  </div>
                  <div>
                    <input
                      type="file"
                      ref={archiveInputRef}
                      accept=".json,application/json"
                      style={{ display: 'none' }}
                      onChange={handleArchiveSelect}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => archiveInputRef.current?.click()}
                      disabled={restoringArchive}
                    >
                      <Upload size={13} />
                      {restoringArchive ? 'Loading archive…' : 'Upload & Restore .json'}
                    </button>
                  </div>
                </div>
              </div>

              {/* 1-Click Restore Action Box */}
              <div style={{ background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <div className="row-between wrap" style={{ gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#111114', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Upload size={14} color="#111114" /> Upload & Restore Database (.db)
                    </div>
                    <p className="muted small" style={{ margin: '4px 0 0', lineHeight: 1.45 }}>
                      Restore a SQLite .db backup from the desktop app. Works on the online version too. On a PC a safety snapshot is saved first.
                    </p>
                  </div>
                  <div>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      accept=".db" 
                      style={{ display: 'none' }} 
                      onChange={handleFileSelect} 
                    />
                    <button 
                      type="button" 
                      className="btn btn-primary btn-sm" 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={restoring}
                    >
                      <Upload size={13} className={restoring ? 'spinner' : ''} />
                      {restoring ? 'Restoring Database...' : 'Upload & Restore .db'}
                    </button>
                  </div>
                </div>
              </div>

              {storage?.backups && storage.backups.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6 }}>
                    Recent Local Snapshots ({storage.backups.length})
                  </div>
                  <div style={{ maxHeight: 130, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <table className="table compact" style={{ fontSize: 12 }}>
                      <tbody>
                        {storage.backups.slice(0, 5).map((b) => (
                          <tr key={b.name}>
                            <td className="mono" style={{ fontSize: 11 }}>{b.name}</td>
                            <td className="r muted">{b.size_kb} KB</td>
                            <td className="r muted">
                              {new Date(b.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Change Password Card */}
          <div className="card">
            <div className="card-head">
              <h3 className="row"><Lock size={18} color="var(--amber)" /> Change Password</h3>
            </div>
            <div className="card-body">
              <form onSubmit={handleChangePassword}>
                <div className="form-grid mb">
                  <Field label="Current Password" className="full">
                    <input 
                      type="password" 
                      value={passwords.current} 
                      onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} 
                      placeholder="Leave blank if first setup" 
                    />
                  </Field>
                  <Field label="New Password">
                    <input 
                      type="password" 
                      value={passwords.password} 
                      onChange={(e) => setPasswords({ ...passwords, password: e.target.value })} 
                      required 
                      minLength={4} 
                    />
                  </Field>
                  <Field label="Confirm New Password">
                    <input 
                      type="password" 
                      value={passwords.confirm} 
                      onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} 
                      required 
                      minLength={4} 
                    />
                  </Field>
                </div>
                <button type="submit" className="btn" disabled={saving}>
                  Update Password
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
