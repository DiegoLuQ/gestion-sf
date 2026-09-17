// Cliente HTTP de la API. Todas las escrituras envían X-Requested-With (protección CSRF básica).

export class ApiError extends Error {
  constructor(message, status, errors = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

async function request(method, url, body) {
  const opts = { method, headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.includes('/auth/login')) {
    location.href = '/acceso-sf';
    throw new ApiError(data.error || 'Sesión expirada.', 401);
  }
  if (!res.ok) throw new ApiError(data.error || `Error ${res.status}`, res.status, data.errors || {});
  return data;
}

// Descarga un archivo generado por la API (p. ej. un PDF) y lo guarda con el nombre que envía el servidor.
async function download(url) {
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', 0);
  }
  if (res.status === 401) {
    location.href = '/acceso-sf';
    throw new ApiError('Sesión expirada.', 401);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `Error ${res.status}`, res.status);
  }
  const disposition = res.headers.get('Content-Disposition') || '';
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || 'archivo.pdf';
  const blobUrl = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href: blobUrl, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  return filename;
}

export const api = {
  download,
  get: url => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: url => request('DELETE', url),
  upload: (url, formData) => request('POST', url, formData),
};
