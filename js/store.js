/**
 * Quartz Family — état global, configuration, thème et grille de lancement.
 * Aucune dépendance externe : ce module est aussi utilisé hors ligne.
 */

export const APP_NAME = 'Quartz Family';
export const APP_VERSION = '1.0.0';

const CONFIG = (typeof window !== 'undefined' && window.QUARTZ_CONFIG) || null;

export const config = CONFIG;
export const allowedDomain = (CONFIG && CONFIG.allowedDomain) || 'kesako.org';
export const repositoryUrl =
  (CONFIG && CONFIG.repositoryUrl) || 'https://github.com/kesako/quartz-family';

/** La configuration Firebase est-elle exploitable ? */
export function isConfigReady() {
  const firebaseConfig = CONFIG && CONFIG.firebaseConfig;
  return Boolean(
    firebaseConfig &&
      typeof firebaseConfig.apiKey === 'string' &&
      firebaseConfig.apiKey.length > 10 &&
      typeof firebaseConfig.projectId === 'string' &&
      firebaseConfig.projectId.length > 0
  );
}

/** L'accès est-il autorisé pour cette adresse e-mail ? */
export function isAllowedEmail(email) {
  if (typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith('@' + allowedDomain.toLowerCase());
}

/**
 * Cet utilisateur peut-il gérer le catalogue de films ?
 * La liste des administrateurs vit dans Firestore (document partagé
 * `config/films-admins`) et arrive en temps réel dans `state.filmAdmins` :
 * aucune adresse n'est inscrite dans le code ou la configuration déployée.
 */
export function isAdminUser(user) {
  const email = user && typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!email) return false;
  return (state.filmAdmins || []).some(
    (entry) => typeof entry === 'string' && entry.trim().toLowerCase() === email
  );
}

/** Prénom ou nom d'affichage court. */
export function firstNameOf(user) {
  const name = (user && (user.displayName || '')).trim();
  if (!name) return '';
  return name.split(/\s+/)[0];
}

export function initialsOf(user) {
  const name = (user && user.displayName) || '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const email = (user && user.email) || '';
  return email.slice(0, 2).toUpperCase() || 'QF';
}

/* --------------------------------------------------------------------------
   État applicatif
   -------------------------------------------------------------------------- */

export const state = {
  user: null,
  grid: null,
  gridLoaded: false,
  sync: 'idle',
  films: [],
  filmsLoaded: false,
  filmsError: '',
  filmSuggestions: [],
  filmAdmins: [],
  authError: '',
  route: '/',
};

/* --------------------------------------------------------------------------
   Thème
   -------------------------------------------------------------------------- */

const THEME_KEY = 'quartz.theme';
const THEMES = new Set(['light', 'dark', 'system']);
let mediaQuery = null;

export function getThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEMES.has(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference = getThemePreference()) {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(preference = getThemePreference()) {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved;
  const meta = document.getElementById('theme-color');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b0d14' : '#eef1f8');
  return resolved;
}

export function setThemePreference(preference) {
  if (!THEMES.has(preference)) return;
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    /* stockage indisponible : le thème reste appliqué pour la session */
  }
  const resolved = applyTheme(preference);
  window.dispatchEvent(
    new CustomEvent('quartz:theme', { detail: { preference, resolved } })
  );
}

export function watchSystemTheme() {
  if (mediaQuery) return;
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', () => {
    if (getThemePreference() === 'system') {
      const resolved = applyTheme('system');
      window.dispatchEvent(
        new CustomEvent('quartz:theme', { detail: { preference: 'system', resolved } })
      );
    }
  });
}

/* --------------------------------------------------------------------------
   Grille de lancement
   -------------------------------------------------------------------------- */

export const BUILTIN_APPS = {
  drive: {
    id: 'builtin-drive',
    type: 'builtin',
    app: 'drive',
    title: 'Drive',
    description: 'Fichiers et documents',
    icon: 'google-drive',
    // Lien externe : Google Drive s'ouvre dans un nouvel onglet.
    href: 'https://drive.google.com/',
  },
  films: {
    id: 'builtin-films',
    type: 'builtin',
    app: 'films',
    title: 'Films',
    description: 'Cinéma familial',
    icon: 'movie',
    href: '#/films',
  },
  settings: {
    id: 'builtin-settings',
    type: 'builtin',
    app: 'settings',
    title: 'Réglages',
    description: 'Compte et préférences',
    icon: 'settings',
    href: '#/settings',
  },
};

const BUILTIN_BY_ID = {
  'builtin-drive': BUILTIN_APPS.drive,
  'builtin-films': BUILTIN_APPS.films,
  'builtin-settings': BUILTIN_APPS.settings,
};

const MAX_CUSTOM_ITEMS = 60;

/**
 * Version du schéma de la grille. La version 2 fait de la grille une liste
 * libre : toutes les tuiles, y compris les applications intégrées, peuvent
 * être supprimées. Les grilles version 1 sont migrées une fois (ajout de la
 * tuile Films), puis enregistrées en version 2 au prochain changement.
 */
const GRID_VERSION = 2;

export function createDefaultGrid() {
  return {
    version: GRID_VERSION,
    items: [
      { ...BUILTIN_APPS.drive },
      { ...BUILTIN_APPS.films },
      { ...BUILTIN_APPS.settings },
    ],
  };
}

export function sanitizeIconName(value) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.png$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 48) || 'link';
}

export function normalizeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  let candidate = value.trim();
  if (!candidate) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = 'https://' + candidate;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function displayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'link-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Normalise une grille provenant de Firestore, du cache local ou de l'interface.
 * Depuis la version 2, chaque membre compose librement sa grille : toutes les
 * tuiles peuvent être supprimées. Les grilles version 1 sont migrées une seule
 * fois (la tuile Films y est ajoutée avant l'enregistrement en version 2).
 */
export function sanitizeGrid(raw) {
  const source = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : [];
  const isLegacyGrid = Boolean(raw && typeof raw === 'object' && raw.version === 1);
  const seen = new Set();
  const items = [];
  let customCount = 0;

  for (const entry of source) {
    if (!entry || typeof entry !== 'object') continue;

    const isBuiltin =
      entry.type === 'builtin' ||
      BUILTIN_BY_ID[entry.id] ||
      (entry.app && ['drive', 'films', 'settings'].includes(entry.app));

    if (isBuiltin) {
      const builtin = BUILTIN_BY_ID[entry.id] || BUILTIN_APPS[entry.app];
      if (!builtin || seen.has(builtin.id)) continue;
      seen.add(builtin.id);
      items.push({ ...builtin });
      continue;
    }

    if (customCount >= MAX_CUSTOM_ITEMS) continue;

    const url = normalizeHttpUrl(entry.url);
    const title = String(entry.title || '').trim().slice(0, 50);
    if (!url || !title) continue;

    let id = typeof entry.id === 'string' && /^[a-zA-Z0-9_-]{4,80}$/.test(entry.id)
      ? entry.id
      : makeId();
    if (seen.has(id)) id = makeId();

    seen.add(id);
    customCount += 1;
    items.push({
      id,
      type: 'link',
      title,
      url,
      icon: sanitizeIconName(entry.icon),
    });
  }

  // Migration unique : les grilles version 1 découvrent la tuile Films.
  // Ensuite (version 2), la grille reflète exactement les choix du membre.
  if (isLegacyGrid) {
    for (const builtin of Object.values(BUILTIN_APPS)) {
      if (!seen.has(builtin.id)) {
        items.unshift({ ...builtin });
        seen.add(builtin.id);
      }
    }
  }

  return { version: GRID_VERSION, items };
}

export function isBuiltinId(id) {
  return Boolean(BUILTIN_BY_ID[id]);
}

export function sameGrid(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(a.items) === JSON.stringify(b.items);
}

/* --------------------------------------------------------------------------
   Catalogue de films
   -------------------------------------------------------------------------- */

const FILM_TITLE_MAX = 80;
const FILM_GENRE_MAX = 40;
const FILM_DESC_MAX = 600;
const FILM_NOTE_MAX = 300;

/** Année valide (1888–2100) ou `null`. */
export function sanitizeFilmYear(value) {
  const digits = String(value == null ? '' : value).replace(/[^0-9]/g, '').slice(0, 4);
  if (!digits) return null;
  const year = parseInt(digits, 10);
  if (!Number.isFinite(year) || year < 1888 || year > 2100) return null;
  return year;
}

/**
 * Normalise un film provenant de Firestore ou du formulaire.
 * Le titre et le lien Google Drive sont obligatoires.
 */
export function sanitizeFilm(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim().slice(0, FILM_TITLE_MAX);
  const driveUrl = normalizeHttpUrl(raw.driveUrl);
  if (!title || !driveUrl) return null;

  return {
    id: typeof raw.id === 'string' ? raw.id : null,
    title,
    year: sanitizeFilmYear(raw.year),
    genre: String(raw.genre || '').trim().slice(0, FILM_GENRE_MAX) || '',
    description: String(raw.description || '').trim().slice(0, FILM_DESC_MAX) || '',
    posterUrl: normalizeHttpUrl(raw.posterUrl) || '',
    driveUrl,
    addedBy: raw.addedBy && typeof raw.addedBy === 'object' ? raw.addedBy : null,
  };
}

/** Normalise une suggestion de film (seul le titre est obligatoire). */
export function sanitizeFilmSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim().slice(0, FILM_TITLE_MAX);
  if (!title) return null;

  return {
    id: typeof raw.id === 'string' ? raw.id : null,
    title,
    year: sanitizeFilmYear(raw.year),
    note: String(raw.note || '').trim().slice(0, FILM_NOTE_MAX) || '',
    driveUrl: normalizeHttpUrl(raw.driveUrl) || '',
    suggestedBy: raw.suggestedBy && typeof raw.suggestedBy === 'object' ? raw.suggestedBy : null,
  };
}

/* --------------------------------------------------------------------------
   Cache local de la grille (affichage instantané + mode hors ligne)
   -------------------------------------------------------------------------- */

function gridCacheKey(uid) {
  return `quartz.grid.${uid}`;
}

export function getCachedGrid(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(gridCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return null;
    return sanitizeGrid(parsed);
  } catch {
    return null;
  }
}

export function cacheGrid(uid, grid) {
  if (!uid || !grid) return;
  try {
    localStorage.setItem(
      gridCacheKey(uid),
      JSON.stringify({ version: grid.version || 1, items: grid.items, cachedAt: Date.now() })
    );
  } catch {
    /* quota dépassé : le cache Firestore reste la source de vérité */
  }
}

/* --------------------------------------------------------------------------
   Utilitaires divers
   -------------------------------------------------------------------------- */

export function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
