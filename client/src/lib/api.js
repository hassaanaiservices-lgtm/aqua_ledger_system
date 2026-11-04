// Thin fetch wrapper with auth token handling.
const TOKEN_KEY = 'bms_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

async function request(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (res.status === 401 && !url.startsWith('/auth/')) {
    setToken(null);
    window.dispatchEvent(new Event('bms:logout'));
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/** URL for a product picture. <img> cannot send headers, so the token rides in the query. */
export const productImageUrl = (id, bust = '') =>
  `/api/products/${id}/image?token=${encodeURIComponent(getToken() || '')}${bust ? `&v=${bust}` : ''}`;

export const qs = (obj = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

export async function downloadBackup() {
  const res = await fetch('/api/backup', { headers: { Authorization: `Bearer ${getToken() || ''}` } });
  if (!res.ok) throw new Error('Backup download failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `business-backup-${new Date().toISOString().slice(0, 10)}.db`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function downloadReadableBackup() {
  const res = await fetch('/api/backup/readable', { headers: { Authorization: `Bearer ${getToken() || ''}` } });
  if (!res.ok) throw new Error('Master data export failed');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aqua-master-readable-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Loads a .json archive back in. Unlike the .db upload this works against a
 * hosted database too, so it is the route that moves a business online.
 */
export async function restoreArchive(file) {
  let archive;
  try {
    archive = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON. Pick the .json archive you downloaded from this app.');
  }
  if (!archive?.tables) throw new Error('That JSON file is not an Aqua Home Appliance archive.');
  return api.post('/backup/import', { ...archive, confirm: true });
}

export async function restoreBackup(file) {
  const arrayBuffer = await file.arrayBuffer();
  const res = await fetch('/api/backup/restore', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      Authorization: `Bearer ${getToken() || ''}`,
    },
    body: arrayBuffer,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data?.error || `Restore failed (${res.status})`);
  return data;
}
