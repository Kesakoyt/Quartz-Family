/**
 * Quartz Family — client Google Drive API v3.
 *
 * OAuth 2.0 via Google Identity Services (token en mémoire uniquement).
 * Scope minimal : `drive.file` (fichiers créés ou ouverts par l'application).
 */

import { config } from './store.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const API_BASE = 'https://www.googleapis.com/drive/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const EXPIRY_MARGIN = 60 * 1000;
const MAX_SIMPLE_UPLOAD = 5 * 1024 * 1024;
const RESUMABLE_CHUNK = 8 * 1024 * 1024;

const LIST_FIELDS =
  'id,name,mimeType,size,modifiedTime,createdTime,webViewLink,iconLink,parents,shortcutDetails';

let token = null;
let expiresAt = 0;
let gisPromise = null;

export class DriveError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DriveError';
    this.code = code;
    this.details = details;
  }
}

export function isDriveConfigured() {
  return Boolean(
    config && typeof config.googleClientId === 'string' && config.googleClientId.trim().length > 20
  );
}

export function isConnected() {
  return Boolean(token) && Date.now() < expiresAt;
}

export function clearDriveToken() {
  token = null;
  expiresAt = 0;
}

/* --------------------------------------------------------------------------
   Google Identity Services
   -------------------------------------------------------------------------- */

export function preloadGis() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return Promise.resolve();
  }
  if (gisPromise) return gisPromise;

  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-quartz-gis]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new DriveError('gis', 'Impossible de charger Google Identity Services.')));
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.quartzGis = 'true';
    script.onload = () => resolve();
    script.onerror = () => {
      gisPromise = null;
      script.remove();
      reject(
        new DriveError(
          'gis',
          'Impossible de contacter Google Identity Services. Vérifiez votre connexion ou votre bloqueur de scripts.'
        )
      );
    };
    document.head.appendChild(script);
  });

  return gisPromise;
}

/**
 * Demande un jeton d'accès Google Drive (fenêtre de consentement).
 * @returns {Promise<string>} jeton d'accès
 */
export async function connect() {
  if (!isDriveConfigured()) {
    throw new DriveError(
      'not-configured',
      "L'accès à Google Drive n'est pas configuré : renseignez `googleClientId` dans `config.js`."
    );
  }

  await preloadGis();

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    let client;
    try {
      client = window.google.accounts.oauth2.initTokenClient({
        client_id: config.googleClientId.trim(),
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (!response || response.error) {
            const code = (response && response.error) || 'unknown';
            finish(reject, new DriveError(code, authMessageForCode(code)));
            return;
          }

          const granted = String(response.scope || '');
          if (granted && !granted.split(/\s+/).includes(DRIVE_SCOPE)) {
            finish(
              reject,
              new DriveError(
                'scope',
                "L'autorisation Google Drive n'a pas été accordée. Réessayez et cochez l'accès demandé."
              )
            );
            return;
          }

          token = response.access_token;
          const lifetime = Number(response.expires_in) || 3600;
          expiresAt = Date.now() + lifetime * 1000 - EXPIRY_MARGIN;
          finish(resolve, token);
        },
        error_callback: (error) => {
          const code = (error && error.type) || 'popup';
          finish(reject, new DriveError(code, authMessageForCode(code)));
        },
      });
    } catch (error) {
      finish(reject, new DriveError('gis', "Impossible d'initialiser la connexion Google."));
      return;
    }

    try {
      client.requestAccessToken({ prompt: '' });
    } catch (error) {
      finish(reject, new DriveError('popup', "La fenêtre de connexion Google n'a pas pu s'ouvrir."));
    }
  });
}

function authMessageForCode(code) {
  switch (code) {
    case 'popup_closed':
      return 'La fenêtre de connexion Google a été fermée.';
    case 'popup_failed_to_open':
    case 'popup':
      return "La fenêtre de connexion Google n'a pas pu s'ouvrir. Autorisez les fenêtres surgissantes puis réessayez.";
    case 'access_denied':
      return "Vous avez refusé l'accès à Google Drive. Quartz Family ne peut pas fonctionner sans cette autorisation.";
    case 'interaction_required':
      return 'Une interaction est requise avec votre compte Google. Cliquez à nouveau sur « Se connecter ».';
    case 'invalid_client':
      return "L'ID client OAuth est invalide. Vérifiez `googleClientId` et les origines autorisées dans Google Cloud Console.";
    case 'origin_mismatch':
      return "L'origine de ce site n'est pas autorisée pour cet ID client OAuth. Ajoutez-la dans Google Cloud Console.";
    default:
      return "La connexion à Google Drive a échoué. Réessayez dans un instant.";
  }
}

/* --------------------------------------------------------------------------
   Requêtes HTTP
   -------------------------------------------------------------------------- */

function requireToken() {
  if (!isConnected()) {
    throw new DriveError(
      'auth',
      'Votre session Google Drive a expiré. Reconnectez-vous pour continuer.',
      { reauth: true }
    );
  }
  return token;
}

async function parseErrorResponse(response) {
  let message = '';
  let reason = '';
  try {
    const data = await response.json();
    message = data && data.error && data.error.message ? data.error.message : '';
    reason =
      data && data.error && Array.isArray(data.error.errors) && data.error.errors[0]
        ? data.error.errors[0].reason
        : '';
  } catch {
    /* corps vide ou non JSON */
  }

  if (response.status === 401) {
    clearDriveToken();
    return new DriveError('auth', 'Votre session Google Drive a expiré. Reconnectez-vous.', {
      reauth: true,
    });
  }
  if (response.status === 403 && reason === 'storageQuotaExceeded') {
    return new DriveError('quota', "L'espace de stockage de votre Drive est plein.");
  }
  if (response.status === 403) {
    return new DriveError(
      'forbidden',
      message
        ? `Google Drive a refusé la requête : ${message}`
        : "Google Drive a refusé cette opération. Vérifiez vos autorisations."
    );
  }
  if (response.status === 404) {
    return new DriveError('not-found', "Cet élément n'existe plus dans votre Drive.");
  }
  if (response.status === 429) {
    return new DriveError('rate-limit', 'Trop de requêtes vers Google Drive. Patientez un instant.');
  }
  if (response.status >= 500) {
    return new DriveError('server', 'Google Drive est momentanément indisponible. Réessayez bientôt.');
  }

  return new DriveError(
    'api',
    message ? `Erreur Google Drive : ${message}` : `Erreur Google Drive (${response.status}).`
  );
}

async function apiFetch(path, options = {}) {
  const accessToken = requireToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json; charset=UTF-8');
    body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      body,
      signal: options.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new DriveError(
      'network',
      'Impossible de joindre Google Drive. Vérifiez votre connexion réseau.'
    );
  }

  if (!response.ok) throw await parseErrorResponse(response);
  if (response.status === 204) return null;
  return response.json();
}

function escapeQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function validFileId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
}

/* --------------------------------------------------------------------------
   Fichiers
   -------------------------------------------------------------------------- */

/**
 * Liste tous les fichiers d'un dossier (pagination incluse).
 * @param {string} folderId
 * @returns {Promise<Array>}
 */
export async function listAllFiles(folderId = 'root') {
  if (!validFileId(folderId)) {
    throw new DriveError('invalid', 'Identifiant de dossier invalide.');
  }

  const files = [];
  let pageToken = null;
  let page = 0;

  do {
    const params = new URLSearchParams({
      q: `'${escapeQueryValue(folderId)}' in parents and trashed = false`,
      fields: `nextPageToken,files(${LIST_FIELDS})`,
      orderBy: 'folder,name_natural',
      pageSize: '200',
      spaces: 'drive',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await apiFetch(`/files?${params.toString()}`);
    if (data && Array.isArray(data.files)) files.push(...data.files);

    pageToken = data && data.nextPageToken ? data.nextPageToken : null;
    page += 1;
  } while (pageToken && page < 10);

  return files;
}

export async function createFolder(name, parentId = 'root') {
  const clean = String(name || '').trim();
  if (!clean) throw new DriveError('invalid', 'Le nom du dossier est vide.');
  if (clean.length > 120) throw new DriveError('invalid', 'Le nom du dossier est trop long.');

  const body = {
    name: clean,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId && parentId !== 'root' && validFileId(parentId)) {
    body.parents = [parentId];
  }

  return apiFetch(`/files?fields=${encodeURIComponent(LIST_FIELDS)}`, {
    method: 'POST',
    body,
  });
}

/** Place un fichier ou dossier dans la corbeille. */
export async function trashFile(fileId) {
  if (!validFileId(fileId)) throw new DriveError('invalid', 'Identifiant de fichier invalide.');
  return apiFetch(`/files/${encodeURIComponent(fileId)}?fields=id,trashed`, {
    method: 'PATCH',
    body: { trashed: true },
  });
}

/** Télécharge un fichier binaire puis déclenche l'enregistrement local. */
export async function downloadFile(file) {
  if (!file || !validFileId(file.id)) {
    throw new DriveError('invalid', 'Identifiant de fichier invalide.');
  }
  const accessToken = requireToken();

  let response;
  try {
    response = await fetch(
      `${API_BASE}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=false`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
  } catch {
    throw new DriveError('network', 'Impossible de télécharger le fichier pour le moment.');
  }

  if (!response.ok) throw await parseErrorResponse(response);

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = file.name || 'fichier';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return blob.size;
}

/* --------------------------------------------------------------------------
   Import de fichiers
   -------------------------------------------------------------------------- */

/**
 * Importe un fichier dans un dossier.
 * Multipart en dessous de 5 Mo, téléversement repris par blocs au-delà.
 * @param {File} file
 * @param {string} parentId
 * @param {(percent: number) => void} [onProgress]
 */
export async function uploadFile(file, parentId = 'root', onProgress = () => {}) {
  if (!file) throw new DriveError('invalid', 'Aucun fichier à importer.');
  if (!isConnected()) {
    throw new DriveError('auth', 'Reconnectez-vous à Google Drive avant d’importer.', {
      reauth: true,
    });
  }

  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
  };
  if (parentId && parentId !== 'root' && validFileId(parentId)) {
    metadata.parents = [parentId];
  }

  if (file.size > MAX_SIMPLE_UPLOAD) {
    return resumableUpload(file, metadata, onProgress);
  }
  return multipartUpload(file, metadata, onProgress);
}

function multipartUpload(file, metadata, onProgress) {
  return new Promise((resolve, reject) => {
    const boundary = '-------QuartzFamily' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const contentType = file.type || 'application/octet-stream';
    const body = new Blob([
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${contentType}\r\n\r\n`,
      file,
      `\r\n--${boundary}--`,
    ]);

    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      `${UPLOAD_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(LIST_FIELDS)}`
    );
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          onProgress(100);
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new DriveError('upload', "Réponse inattendue de Google Drive lors de l'import."));
        }
        return;
      }
      if (xhr.status === 401) {
        clearDriveToken();
        reject(
          new DriveError('auth', 'Votre session Google Drive a expiré. Reconnectez-vous.', {
            reauth: true,
          })
        );
        return;
      }
      let message = '';
      try {
        const data = JSON.parse(xhr.responseText);
        message = data && data.error && data.error.message ? data.error.message : '';
      } catch {
        /* réponse vide */
      }
      reject(
        new DriveError(
          'upload',
          message
            ? `L'import a échoué : ${message}`
            : `L'import a échoué (erreur ${xhr.status}).`
        )
      );
    });

    xhr.addEventListener('error', () => {
      reject(
        new DriveError('network', "L'import a été interrompu. Vérifiez votre connexion réseau.")
      );
    });

    xhr.addEventListener('abort', () => {
      reject(new DriveError('aborted', "L'import a été annulé."));
    });

    xhr.send(body);
  });
}

async function resumableUpload(file, metadata, onProgress) {
  // L'initiation renvoie un header `Location` : on utilise fetch directement
  // plutôt que le helper JSON, car le corps de réponse est vide.
  const accessToken = requireToken();
  let initResponse;
  try {
    initResponse = await fetch(
      `${UPLOAD_BASE}/files?uploadType=resumable&fields=${encodeURIComponent(LIST_FIELDS)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': file.type || 'application/octet-stream',
          'X-Upload-Content-Length': String(file.size),
        },
        body: JSON.stringify(metadata),
      }
    );
  } catch {
    throw new DriveError('network', 'Impossible de préparer l’import. Vérifiez votre connexion.');
  }

  if (!initResponse.ok) throw await parseErrorResponse(initResponse);

  const sessionUrl = initResponse.headers.get('Location');
  if (!sessionUrl) {
    throw new DriveError(
      'upload',
      "Google Drive n'a pas fourni de session d'import. Réessayez avec un fichier plus petit."
    );
  }

  const contentType = file.type || 'application/octet-stream';
  let offset = 0;
  let guard = 0;

  while (offset < file.size) {
    guard += 1;
    if (guard > 10_000) {
      throw new DriveError('upload', "L'import a pris trop de temps. Réessayez.");
    }

    const end = Math.min(offset + RESUMABLE_CHUNK, file.size);
    const chunk = file.slice(offset, end);
    const result = await sendChunk(sessionUrl, chunk, offset, file.size, contentType, onProgress);
    if (result.done) {
      onProgress(100);
      return result.data;
    }
    offset = result.nextOffset;
  }

  throw new DriveError('upload', "L'import ne s'est pas terminé correctement.");
}

function sendChunk(url, chunk, start, total, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${start + chunk.size - 1}/${total}`);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percent = Math.round(((start + event.loaded) / total) * 100);
        onProgress(Math.min(99, percent));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          resolve({ done: true, data: JSON.parse(xhr.responseText) });
        } catch {
          resolve({ done: true, data: { name: 'fichier' } });
        }
        return;
      }

      if (xhr.status === 308) {
        const range = xhr.getResponseHeader('Range');
        let nextOffset = start + chunk.size;
        if (range) {
          const match = /bytes=(\d+)-(\d+)/.exec(range);
          if (match) nextOffset = Number(match[2]) + 1;
        }
        resolve({ done: false, nextOffset });
        return;
      }

      if (xhr.status === 401) {
        clearDriveToken();
        reject(
          new DriveError('auth', 'Votre session Google Drive a expiré. Reconnectez-vous.', {
            reauth: true,
          })
        );
        return;
      }

      let message = '';
      try {
        const data = JSON.parse(xhr.responseText);
        message = data && data.error && data.error.message ? data.error.message : '';
      } catch {
        /* vide */
      }
      reject(
        new DriveError(
          'upload',
          message ? `L'import a échoué : ${message}` : `L'import a échoué (erreur ${xhr.status}).`
        )
      );
    });

    xhr.addEventListener('error', () => {
      reject(new DriveError('network', "L'import a été interrompu par une erreur réseau."));
    });

    xhr.addEventListener('abort', () => {
      reject(new DriveError('aborted', "L'import a été annulé."));
    });

    xhr.send(chunk);
  });
}

/* --------------------------------------------------------------------------
   Présentation des fichiers
   -------------------------------------------------------------------------- */

const GOOGLE_APPS = {
  'application/vnd.google-apps.folder': {
    label: 'Dossier',
    icon: 'folder-invoices',
    folder: true,
  },
  'application/vnd.google-apps.document': {
    label: 'Document Google',
    icon: 'google-docs',
    google: true,
    openBase: 'https://docs.google.com/document/d/',
  },
  'application/vnd.google-apps.spreadsheet': {
    label: 'Feuille de calcul Google',
    icon: 'google-sheets',
    google: true,
    openBase: 'https://docs.google.com/spreadsheets/d/',
  },
  'application/vnd.google-apps.presentation': {
    label: 'Présentation Google',
    icon: 'google-slides',
    google: true,
    openBase: 'https://docs.google.com/presentation/d/',
  },
  'application/vnd.google-apps.form': {
    label: 'Formulaire Google',
    icon: 'google-docs',
    google: true,
    openBase: 'https://docs.google.com/forms/d/',
  },
  'application/vnd.google-apps.drawing': {
    label: 'Dessin Google',
    icon: 'google-docs',
    google: true,
    openBase: 'https://docs.google.com/drawings/d/',
  },
  'application/vnd.google-apps.script': {
    label: 'Projet Apps Script',
    icon: 'google-drive',
    google: true,
  },
};

export function describeFile(file) {
  const mime = (file && file.mimeType) || '';
  const googleApp = GOOGLE_APPS[mime];
  if (googleApp) {
    return {
      label: googleApp.label,
      icon: googleApp.icon,
      folder: Boolean(googleApp.folder),
      google: Boolean(googleApp.google),
      canDownload: false,
      openBase: googleApp.openBase || null,
    };
  }

  if (file && file.shortcutDetails) {
    return {
      label: 'Raccourci',
      icon: 'link',
      folder: false,
      google: false,
      canDownload: false,
      openBase: null,
    };
  }

  let label = 'Fichier';
  let iconName = 'file';
  let canDownload = true;

  if (mime === 'application/pdf') {
    label = 'Document PDF';
    iconName = 'pdf';
  } else if (mime.startsWith('image/')) {
    label = 'Image';
    iconName = 'image';
  } else if (mime.startsWith('video/')) {
    label = 'Vidéo';
    iconName = 'video-file';
  } else if (mime.startsWith('audio/')) {
    label = 'Audio';
    iconName = 'music';
  } else if (
    /(zip|rar|7z|tar|gzip|compressed)/i.test(mime) ||
    /\.(zip|rar|7z|tar|gz)$/i.test(file.name || '')
  ) {
    label = 'Archive';
    iconName = 'archive';
  } else if (mime.startsWith('text/') || /(document|word|json|xml)/i.test(mime)) {
    label = 'Document';
    iconName = 'document';
  } else if (/(spreadsheet|excel|csv)/i.test(mime)) {
    label = 'Feuille de calcul';
    iconName = 'google-sheets';
  } else if (/(presentation|powerpoint)/i.test(mime)) {
    label = 'Présentation';
    iconName = 'google-slides';
  }

  const extension = (file.name || '').includes('.')
    ? file.name.split('.').pop().slice(0, 8).toUpperCase()
    : '';
  if (label === 'Fichier' && extension) label = `Fichier ${extension}`;

  return {
    label,
    icon: iconName,
    folder: false,
    google: false,
    canDownload,
    openBase: null,
  };
}

/** URL d'ouverture dans l'application Google officielle (ou l'aperçu Drive). */
export function openUrlFor(file) {
  if (!file || !validFileId(file.id)) return 'https://drive.google.com/';
  const meta = describeFile(file);
  if (meta.openBase) return `${meta.openBase}${encodeURIComponent(file.id)}/edit`;
  if (file.webViewLink) return file.webViewLink;
  return `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`;
}
