// Images are stored in the database as data URLs, because the hosted copy runs
// on Netlify where there is no writable disk. That makes every picture part of
// the normal JSON backup, but it also means they must be kept small — so each
// one is scaled down and re-compressed here before it is ever uploaded.

export const LOGO_LIMITS = { maxDim: 320, maxBytes: 150 * 1024 };
export const PRODUCT_LIMITS = { maxDim: 640, maxBytes: 250 * 1024 };

const ACCEPTED = /^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

/**
 * Scales `file` to fit `maxDim` and compresses until it fits `maxBytes`.
 * Returns a data URL ready to save. WebP keeps transparency, so a logo with a
 * see-through background still looks right on the sidebar.
 */
export async function fileToDataUrl(file, { maxDim, maxBytes }) {
  if (!file) throw new Error('No file selected.');
  if (!ACCEPTED.test(file.type)) throw new Error('Please choose a PNG, JPG, WebP or SVG image.');

  const img = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const sizeOf = (dataUrl) => Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);

  let out = canvas.toDataURL('image/webp', 0.9);
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/png');

  for (let q = 0.8; sizeOf(out) > maxBytes && q >= 0.4; q -= 0.1) {
    out = canvas.toDataURL('image/webp', q);
  }
  if (sizeOf(out) > maxBytes) {
    throw new Error('That image is too detailed to store. Please use a smaller or simpler picture.');
  }
  return out;
}

export const imageKB = (dataUrl) =>
  dataUrl ? Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75) / 1024) : 0;
