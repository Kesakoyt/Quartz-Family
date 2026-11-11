/**
 * Quartz Family — amorçage de l'application.
 *
 * Responsabilités :
 *  - validation de la configuration et écran d'aide ;
 *  - initialisation Firebase et contrôle strict du domaine ;
 *  - coque de l'application (barre de titre, barre latérale, menu utilisateur) ;
 *  - routage par hash (#/, #/settings) ;
 *  - liens externes de la navigation (Google Drive) ;
 *  - service worker, indicateur hors ligne et mises à jour.
 */

import {
  APP_NAME,
  APP_VERSION,
  state,
  config,
  isConfigReady,
  isAllowedEmail,
  allowedDomain,
  isBuiltinId,
  repositoryUrl,
  applyTheme,
  watchSystemTheme,
  getThemePreference,
  resolveTheme,
  setThemePreference,
} from './store.js';
import {
  initFirebase,
  signOutUser,
  watchAuthState,
  resolveRedirectSignIn,
  saveUserProfile,
  friendlyAuthError,
} from './firebase.js';
import { startGridSync, stopGridSync, flushGrid, retrySync } from './grid.js';
import { initInstallPrompt } from './install.js';
import { renderLogin } from './views/login.js';
import { mountDashboard } from './views/dashboard.js';
import { mountSettings } from './views/settings.js';
import {
  el,
  icon,
  avatar,
  toast,
  documentTitle,
  prefersReducedMotion,
} from './ui.js';

const ROUTES = new Map([
  ['/', { label: 'Accueil', iconName: 'home', mount: mountDashboard }],
  ['/settings', { label: 'Réglages', iconName: 'settings', mount: mountSettings }],
]);

/** Lien Drive : ouvre Google Drive dans un nouvel onglet (aucune vue interne). */
const DRIVE_URL = 'https://drive.google.com/';

const EXTERNAL_LINKS = [
  {
    label: 'Drive',
    iconName: 'google-drive',
    url: DRIVE_URL,
    title: 'Ouvrir Google Drive dans un nouvel onglet',
  },
];

const SYNC_INFO = {
  idle: { label: 'En attente', iconName: 'cloud', title: 'Synchronisation en attente' },
  saving: { label: 'Enregistrement', iconName: 'synchronize', title: 'Enregistrement de vos modifications…' },
  saved: { label: 'Synchronisé', iconName: 'checkmark', title: 'Votre tableau de bord est synchronisé' },
  offline: { label: 'Hors ligne', iconName: 'wifi-off', title: 'Modifications conservées sur cet appareil' },
  error: { label: 'Erreur', iconName: 'error', title: 'La synchronisation a échoué. Cliquez pour réessayer.' },
};

/* --------------------------------------------------------------------------
   État interne de l'amorçage
   -------------------------------------------------------------------------- */

let shellController = null;
let shellNodes = null;
let viewCleanup = null;
let currentRoute = null;
let renderedUid = null;
let authInProgress = false;
let redirectError = '';
let lastSyncErrorAt = 0;
let profileSaveWarned = false;
let updateToastShown = false;
let reloadForUpdate = false;
let swRegistration = null;

/* --------------------------------------------------------------------------
   Démarrage
   -------------------------------------------------------------------------- */

async function boot() {
  applyTheme();
  watchSystemTheme();
  initInstallPrompt();
  registerServiceWorker();
  installGlobalListeners();

  if (!isConfigReady()) {
    renderSetupScreen();
    return;
  }

  try {
    await initFirebase(config.firebaseConfig);
  } catch (error) {
    console.error('Initialisation Firebase impossible', error);
    renderSetupScreen(error);
    return;
  }

  try {
    const redirectResult = await resolveRedirectSignIn();
    if (redirectResult && redirectResult.user) {
      console.log('[auth] redirect result present', redirectResult.user.email);
      state.user = redirectResult.user;
    } else if (redirectResult) {
      console.log('[auth] redirect result without user');
    }
  } catch (error) {
    console.error('[auth] redirect error', error);
    redirectError = friendlyAuthError(error);
  }

  watchAuthState((user) => {
    console.log('[auth] state changed', user ? { uid: user.uid, email: user.email } : null);
    if (user && !state.user) {
      state.user = user;
    }
    handleAuthState(user).catch((error) => {
      console.error('Erreur lors du traitement de la connexion', error);
      authInProgress = false;
      renderLogin({
        error:
          "Une erreur inattendue a interrompu la connexion. Rechargez la page puis réessayez.",
        errorTitle: 'Connexion interrompue',
      });
    });
  });
}

async function handleAuthState(user) {
  console.log('[auth] handleAuthState called', { hasUser: Boolean(user), authInProgress, renderedUid });
  if (authInProgress) return;

  if (!user) {
    const error = redirectError;
    redirectError = '';
    console.log('[auth] no user, rendering login', error ? 'with error' : 'clean');
    teardownSession();
    renderLogin(error ? { error, errorTitle: 'Connexion impossible' } : {});
    return;
  }

  if (!isAllowedEmail(user.email)) {
    const email = (user.email || 'ce compte').trim();
    console.warn('[auth] domain rejected', email);
    authInProgress = true;
    teardownSession();

    try {
      await signOutUser();
    } catch (error) {
      console.warn('Déconnexion du compte non autorisé impossible', error);
    }

    authInProgress = false;
    renderLogin({
      error: `Le compte ${email} n'appartient pas au domaine autorisé. Utilisez une adresse @${allowedDomain} pour accéder à ${APP_NAME}.`,
      errorTitle: 'Domaine non autorisé',
    });
    return;
  }

  const isNewSession = renderedUid !== user.uid;
  console.log('[auth] user accepted', { uid: user.uid, email: user.email, isNewSession, renderedUid });
  state.user = user;

  if (!isNewSession) {
    updateUserChrome();
    return;
  }

  renderedUid = user.uid;
  state.authError = '';
  redirectError = '';
  startGridSync(user);
  buildShell();
  renderRoute(true);

  saveUserProfile(user).catch((error) => {
    console.warn('Profil non enregistré dans Firestore', error);
    if (!profileSaveWarned && error && error.code === 'permission-denied') {
      profileSaveWarned = true;
      toast(
        "Votre profil n'a pas pu être enregistré. Vérifiez que les règles Firestore sont déployées.",
        { type: 'warning', title: 'Profil' }
      );
    }
  });
}

/* --------------------------------------------------------------------------
   Écran de configuration
   -------------------------------------------------------------------------- */

function renderSetupScreen(initError = null) {
  document.title = documentTitle('Configuration');
  const app = document.getElementById('app');
  if (!app) return;

  teardownSession();

  const steps = el(
    'ol',
    { class: 'setup-steps' },
    el('li', {}, 'Copiez ', el('code', { text: 'config.example.js' }), ' en ', el('code', { text: 'config.js' }), ' à la racine du projet.'),
    el('li', {}, 'Renseignez la configuration Firebase du projet dans ce fichier.'),
    el('li', {}, 'Déployez le site (GitHub Pages) puis rechargez cette page.')
  );

  const sample = [
    '// config.js',
    'window.QUARTZ_CONFIG = {',
    '  firebaseConfig: {',
    '    apiKey: "…",',
    '    authDomain: "quartz-family.firebaseapp.com",',
    '    projectId: "quartz-family",',
    '    appId: "…"',
    '  },',
    '  allowedDomain: "kesako.org"',
    '};',
  ].join('\n');

  const card = el(
    'main',
    { class: 'auth-card setup-card', 'aria-labelledby': 'setup-title' },
    el(
      'div',
      { class: 'auth-brand' },
      el('img', { src: './icons/logo.svg', width: 34, height: 34, alt: '' }),
      el('span', { text: APP_NAME })
    ),
    el('h1', { id: 'setup-title', text: 'Configuration requise' }),
    el('p', {
      text: `La configuration Firebase de ${APP_NAME} est absente ou incomplète. L'application ne peut pas se connecter tant que ce fichier n'est pas renseigné.`,
    }),
    initError
      ? el(
          'div',
          { class: 'auth-error', role: 'alert' },
          icon('error', 16),
          el(
            'div',
            {},
            el('strong', { text: 'Initialisation impossible' }),
            document.createTextNode(friendlyAuthError(initError))
          )
        )
      : null,
    steps,
    el('pre', { class: 'setup-code', text: sample }),
    el(
      'div',
      { class: 'setup-actions' },
      el(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          on: { click: () => window.location.reload() },
        },
        icon('refresh', 16),
        el('span', { text: 'Recharger' })
      ),
      el(
        'a',
        {
          class: 'btn btn-secondary',
          href: repositoryUrl + '#installation',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        icon('document', 16),
        el('span', { text: 'Guide d’installation' })
      )
    ),
    el('p', {
      class: 'auth-foot',
      text: `${APP_NAME} v${APP_VERSION} · Configuration locale requise`,
    })
  );

  app.replaceChildren(el('div', { class: 'auth-layout' }, card));
}

/* --------------------------------------------------------------------------
   Coque de l'application
   -------------------------------------------------------------------------- */

function buildShell() {
  disposeShell();

  const app = document.getElementById('app');
  if (!app) return;

  const controller = new AbortController();
  shellController = controller;
  const { signal } = controller;

  const user = state.user || {};

  const sidebarParts = buildSidebar();

  const syncChip = el(
    'button',
    {
      class: 'sync-chip',
      type: 'button',
      dataset: { status: state.sync || 'idle' },
      title: SYNC_INFO[state.sync] ? SYNC_INFO[state.sync].title : SYNC_INFO.idle.title,
      'aria-label': 'État de la synchronisation. Cliquez pour réessayer.',
    },
    icon(SYNC_INFO[state.sync] ? SYNC_INFO[state.sync].iconName : 'cloud', 15, {
      fallback: 'refresh',
    }),
    el('span', {
      class: 'sync-chip-label',
      text: SYNC_INFO[state.sync] ? SYNC_INFO[state.sync].label : SYNC_INFO.idle.label,
    })
  );
  syncChip.addEventListener(
    'click',
    () => {
      if (state.sync === 'error' || state.sync === 'offline') retrySync();
    },
    { signal }
  );

  const themeToggle = el('button', {
    class: 'theme-toggle',
    type: 'button',
    title: 'Changer de thème',
    'aria-label': 'Changer de thème',
  });
  themeToggle.appendChild(icon(themeToggleIcon(), 18, { fallback: 'settings' }));
  themeToggle.addEventListener(
    'click',
    () => {
      const resolved = resolveTheme(getThemePreference());
      setThemePreference(resolved === 'dark' ? 'light' : 'dark');
    },
    { signal }
  );

  const chipAvatar = avatar(user, { size: 30 });
  const chipName = el('span', {
    class: 'user-chip-name',
    text: user.displayName || user.email || 'Compte',
  });

  const userChip = el(
    'button',
    {
      class: 'user-chip',
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': 'Ouvrir le menu du compte',
    },
    chipAvatar,
    chipName,
    icon('chevron-down', 13, { fallback: 'chevron-right', className: 'chevron' })
  );

  const menuAvatarSlot = el('span', {});
  menuAvatarSlot.appendChild(avatar(user, { size: 38 }));

  const menuName = el('div', {
    class: 'user-menu-name',
    text: user.displayName || 'Membre Quartz',
  });
  const menuEmail = el('div', {
    class: 'user-menu-email',
    text: user.email || '',
  });

  const signOutButton = el(
    'button',
    { class: 'user-menu-item user-menu-item--danger', type: 'button' },
    icon('exit', 16),
    el('span', { text: 'Se déconnecter' })
  );

  signOutButton.addEventListener(
    'click',
    () => {
      closeUserMenu();
      handleSignOut(signOutButton);
    },
    { signal }
  );

  const userMenu = el(
    'div',
    {
      class: 'user-menu',
      role: 'menu',
      'aria-label': 'Menu du compte',
      hidden: true,
    },
    el(
      'div',
      { class: 'user-menu-header' },
      menuAvatarSlot,
      el('div', { class: 'user-menu-id' }, menuName, menuEmail)
    ),
    el(
      'a',
      {
        class: 'user-menu-item',
        href: '#/',
        role: 'menuitem',
        on: { click: () => closeUserMenu() },
      },
      icon('home', 16),
      el('span', { text: 'Tableau de bord' })
    ),
    el(
      'a',
      {
        class: 'user-menu-item',
        href: '#/settings',
        role: 'menuitem',
        on: { click: () => closeUserMenu() },
      },
      icon('settings', 16),
      el('span', { text: 'Réglages du compte' })
    ),
    el(
      'a',
      {
        class: 'user-menu-item',
        href: repositoryUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        role: 'menuitem',
        on: { click: () => closeUserMenu() },
      },
      icon('github', 16, { fallback: 'code' }),
      el('span', { text: 'Code source' })
    ),
    signOutButton
  );

  const userMenuWrap = el('div', { class: 'user-menu-wrap' }, userChip, userMenu);

  userChip.addEventListener(
    'click',
    () => {
      const willOpen = userMenu.hidden;
      if (willOpen) openUserMenu();
      else closeUserMenu();
    },
    { signal }
  );

  const titlebar = el(
    'header',
    { class: 'titlebar' },
    el(
      'a',
      {
        class: 'brand',
        href: '#/',
        'aria-label': `${APP_NAME} — Accueil`,
      },
      el('img', {
        class: 'brand-logo',
        src: './icons/logo.svg',
        width: 34,
        height: 34,
        alt: '',
      }),
      el('span', { class: 'brand-name' }, 'Quartz ', el('span', { text: 'Family' }))
    ),
    el('div', { class: 'titlebar-tools' }, syncChip, themeToggle, userMenuWrap)
  );

  const offlineBanner = el(
    'div',
    { class: 'offline-banner', role: 'status', hidden: navigator.onLine },
    icon('wifi-off', 15),
    el('span', {
      text: 'Vous êtes hors ligne. Les modifications sont enregistrées sur cet appareil et seront synchronisées au retour du réseau.',
    })
  );

  const main = el('main', { class: 'main', id: 'main', tabindex: '-1' });

  const mobileNav = el(
    'nav',
    { class: 'mobile-nav', 'aria-label': 'Navigation mobile' },
    buildMobileNavLinks()
  );

  const shellBody = el(
    'div',
    { class: 'shell-body' },
    titlebar,
    offlineBanner,
    main,
    mobileNav
  );

  const shell = el('div', { class: 'app-shell' }, sidebarParts.sidebar, shellBody);

  app.replaceChildren(shell);

  shellNodes = {
    main,
    syncChip,
    themeToggle,
    userChip,
    userMenu,
    offlineBanner,
    sidebar: sidebarParts.sidebar,
    sidebarShortcuts: sidebarParts.shortcutsSlot,
    mobileNav,
    chipName,
    menuAvatarSlot,
    menuName,
    menuEmail,
  };

  updateSyncChip();
  updateThemeToggle();
  updateOfflineBanner();
  renderSidebarShortcuts();
  updateNav(readRoute() || '/');

  // La grille peut arriver après la coque : le panneau latéral suit les mises à jour.
  window.addEventListener('quartz:grid', renderSidebarShortcuts, { signal });

  document.addEventListener(
    'click',
    (event) => {
      if (!userMenu.hidden && !userMenuWrap.contains(event.target)) closeUserMenu();
    },
    { signal }
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !userMenu.hidden) {
        closeUserMenu();
        userChip.focus();
      }
    },
    { signal }
  );
}

/** Construit le panneau latéral : navigation principale + raccourcis de l'utilisateur. */
function buildSidebar() {
  const shortcutsSlot = el('div', { class: 'sidebar-shortcuts' });

  const sidebar = el(
    'aside',
    { class: 'sidebar' },
    el(
      'div',
      { class: 'sidebar-scroll' },
      el('nav', { class: 'sidebar-nav', 'aria-label': 'Navigation principale' }, ...buildSidebarLinks()),
      el(
        'div',
        { class: 'sidebar-group' },
        el('p', { class: 'sidebar-label', text: 'Mes raccourcis' }),
        shortcutsSlot
      )
    )
  );

  return { sidebar, shortcutsSlot };
}

/** Liens de la barre latérale : Accueil, liens externes, puis les autres vues. */
function buildSidebarLinks() {
  const entries = [...ROUTES.entries()];
  const [first, ...rest] = entries;
  const links = first ? [buildSidebarRouteLink(first[0], first[1])] : [];
  for (const entry of EXTERNAL_LINKS) links.push(buildSidebarExternalLink(entry));
  for (const [path, entry] of rest) links.push(buildSidebarRouteLink(path, entry));
  return links;
}

function sidebarLink(label, iconName, extra) {
  return el(
    'a',
    { class: 'sidebar-link', ...extra },
    icon(iconName, 18, { fallback: 'link' }),
    el('span', { class: 'sidebar-link-text', text: label })
  );
}

function buildSidebarRouteLink(path, entry) {
  return sidebarLink(entry.label, entry.iconName, {
    href: '#' + path,
    dataset: { route: path },
  });
}

function buildSidebarExternalLink(entry) {
  return sidebarLink(entry.label, entry.iconName, {
    href: entry.url,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: entry.title || entry.label,
  });
}

/** Raccourcis utilisateur (grille de l'accueil) affichés dans le panneau latéral. */
function renderSidebarShortcuts() {
  if (!shellNodes || !shellNodes.sidebarShortcuts) return;
  const items = ((state.grid && state.grid.items) || []).filter(
    (item) => item && item.type === 'link' && !isBuiltinId(item.id)
  );

  if (!items.length) {
    shellNodes.sidebarShortcuts.replaceChildren(
      el('p', { class: 'sidebar-empty', text: "Aucun raccourci. Ajoutez-en depuis l'accueil." })
    );
    return;
  }

  shellNodes.sidebarShortcuts.replaceChildren(
    ...items.map((item) =>
      sidebarLink(item.title || item.url || 'Raccourci', item.icon, {
        href: item.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: item.title || item.url || '',
      })
    )
  );
}

/** Liens de la barre de navigation mobile : Accueil, liens externes, puis les autres vues. */
function buildMobileNavLinks() {
  const entries = [...ROUTES.entries()];
  const [first, ...rest] = entries;
  const links = first ? [buildMobileRouteLink(first[0], first[1])] : [];
  for (const entry of EXTERNAL_LINKS) links.push(buildMobileExternalLink(entry));
  for (const [path, entry] of rest) links.push(buildMobileRouteLink(path, entry));
  return links;
}

function mobileLink(label, iconName, extra) {
  return el(
    'a',
    { class: 'mobile-nav-link', ...extra },
    icon(iconName, 21, { fallback: 'link' }),
    el('span', { class: 'mobile-nav-label', text: label })
  );
}

function buildMobileRouteLink(path, entry) {
  return mobileLink(entry.label, entry.iconName, {
    href: '#' + path,
    dataset: { route: path },
  });
}

function buildMobileExternalLink(entry) {
  return mobileLink(entry.label, entry.iconName, {
    href: entry.url,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: entry.title || entry.label,
  });
}

function updateUserChrome() {
  if (!shellNodes || !state.user) return;
  const user = state.user;
  const chipAvatar = shellNodes.userChip.querySelector('.avatar');
  if (chipAvatar) chipAvatar.replaceWith(avatar(user, { size: 30 }));
  shellNodes.chipName.textContent = user.displayName || user.email || 'Compte';
  shellNodes.menuAvatarSlot.replaceChildren(avatar(user, { size: 38 }));
  shellNodes.menuName.textContent = user.displayName || 'Membre Quartz';
  shellNodes.menuEmail.textContent = user.email || '';
  updateThemeToggle();
}

function openUserMenu() {
  if (!shellNodes) return;
  shellNodes.userMenu.hidden = false;
  shellNodes.userChip.setAttribute('aria-expanded', 'true');
}

function closeUserMenu() {
  if (!shellNodes) return;
  shellNodes.userMenu.hidden = true;
  shellNodes.userChip.setAttribute('aria-expanded', 'false');
}

async function handleSignOut(button) {
  button.disabled = true;
  try {
    await flushGrid();
  } catch {
    /* une dernière écriture peut échouer sans bloquer la déconnexion */
  }
  try {
    await signOutUser();
  } catch (error) {
    console.error('Déconnexion impossible', error);
    button.disabled = false;
    toast('Impossible de vous déconnecter pour le moment. Réessayez.', {
      type: 'error',
      title: 'Déconnexion',
    });
  }
}

/* --------------------------------------------------------------------------
   Routage
   -------------------------------------------------------------------------- */

/** @returns {string|null} Route normalisée, `#main` pour le lien d'évitement, ou null si inconnue. */
function readRoute() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  if (!raw || raw === '/') return '/';
  if (raw === 'main') return '#main';

  const path = raw.split('?')[0];
  const clean = '/' + path.replace(/^\/+|\/+$/g, '');
  return ROUTES.has(clean) ? clean : null;
}

function handleRoute() {
  if (!shellNodes || !state.user) return;

  const route = readRoute();
  if (route === '#main') {
    const main = document.getElementById('main');
    if (main) main.focus({ preventScroll: true });
    return;
  }

  if (!route) {
    history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
    renderRoute(true);
    return;
  }

  renderRoute();
}

function renderRoute(force = false) {
  if (!shellNodes || !state.user) return;

  let route = readRoute();

  // Le lien d'évitement utilise #main : sur un chargement direct, on revient
  // à l'accueil au lieu de laisser la zone principale vide.
  if (route === '#main') {
    if (currentRoute) return;
    history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
    route = '/';
  }

  if (!route) return;

  const entry = ROUTES.get(route);
  if (!entry) return;

  const changed = currentRoute !== route;
  if (!changed && !force) return;

  currentRoute = route;
  state.route = route;
  updateNav(route);
  disposeView();

  const { main } = shellNodes;
  main.replaceChildren();

  try {
    viewCleanup = entry.mount(main) || null;
  } catch (error) {
    console.error('Impossible de monter la vue', route, error);
    viewCleanup = null;
    main.replaceChildren(buildViewError(error));
    toast("Cette page n'a pas pu être affichée. Rechargez l'application si le problème persiste.", {
      type: 'error',
      title: 'Affichage impossible',
    });
  }

  if (changed) {
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } else if (!viewCleanup) {
    main.focus({ preventScroll: true });
  }
}

function updateNav(route) {
  if (!shellNodes) return;
  const containers = [shellNodes.sidebar, shellNodes.mobileNav];
  for (const container of containers) {
    if (!container) continue;
    for (const link of container.querySelectorAll('[data-route]')) {
      if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
}

function buildViewError(error) {
  return el(
    'section',
    { class: 'error-view', role: 'alert' },
    icon('error', 34),
    el('h2', { text: 'Impossible d’afficher cette page' }),
    el('p', {
      text:
        (error && error.message) ||
        "Une erreur inattendue s'est produite pendant le chargement de la vue.",
    }),
    el(
      'button',
      {
        class: 'btn btn-secondary',
        type: 'button',
        on: { click: () => window.location.reload() },
      },
      icon('refresh', 16),
      el('span', { text: 'Recharger la page' })
    )
  );
}

/* --------------------------------------------------------------------------
   Nettoyage
   -------------------------------------------------------------------------- */

function disposeView() {
  if (typeof viewCleanup === 'function') {
    try {
      viewCleanup();
    } catch (error) {
      console.warn('Nettoyage de la vue impossible', error);
    }
  }
  viewCleanup = null;
}

function disposeShell() {
  closeUserMenu();
  disposeView();
  if (shellController) {
    shellController.abort();
    shellController = null;
  }
  shellNodes = null;
  currentRoute = null;
}

function teardownSession() {
  disposeShell();
  stopGridSync();
  renderedUid = null;
  state.user = null;
  state.grid = null;
  state.gridLoaded = false;
  state.sync = 'idle';
  state.authError = '';
  state.route = '/';
}

/* --------------------------------------------------------------------------
   Indicateurs de la coque
   -------------------------------------------------------------------------- */

function updateSyncChip() {
  if (!shellNodes) return;
  const status = state.sync || 'idle';
  const info = SYNC_INFO[status] || SYNC_INFO.idle;
  const { syncChip } = shellNodes;
  syncChip.dataset.status = status;
  syncChip.title = info.title;
  syncChip.replaceChildren(
    icon(info.iconName, 15, { fallback: 'refresh' }),
    el('span', { class: 'sync-chip-label', text: info.label })
  );
}

function themeToggleIcon() {
  return resolveTheme(getThemePreference()) === 'dark' ? 'sun' : 'moon';
}

function updateThemeToggle() {
  if (!shellNodes) return;
  const isDark = resolveTheme(getThemePreference()) === 'dark';
  shellNodes.themeToggle.replaceChildren(
    icon(isDark ? 'sun' : 'moon', 18, { fallback: 'settings' })
  );
  shellNodes.themeToggle.setAttribute(
    'aria-label',
    isDark ? 'Passer au thème clair' : 'Passer au thème sombre'
  );
  shellNodes.themeToggle.title = isDark ? 'Passer au thème clair' : 'Passer au thème sombre';
}

function updateOfflineBanner() {
  if (!shellNodes) return;
  shellNodes.offlineBanner.hidden = navigator.onLine;
}

/* --------------------------------------------------------------------------
   Écouteurs globaux
   -------------------------------------------------------------------------- */

function installGlobalListeners() {
  window.addEventListener('hashchange', handleRoute);

  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);

  window.addEventListener('quartz:sync', updateSyncChip);

  window.addEventListener('quartz:theme', () => {
    updateThemeToggle();
  });

  window.addEventListener('quartz:sync-error', (event) => {
    if (!state.user) return;
    const now = Date.now();
    if (now - lastSyncErrorAt < 12000) return;
    lastSyncErrorAt = now;

    toast(
      (event.detail && event.detail.message) ||
        'La synchronisation avec Cloud Firestore a échoué.',
      {
        type: 'error',
        title: 'Synchronisation',
        action: { label: 'Réessayer', onClick: retrySync },
      }
    );
  });

  window.addEventListener('beforeinstallprompt', () => {
    // Le bouton d'installation apparaît dans Réglages via js/install.js.
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && shellNodes) {
      updateOfflineBanner();
      if (!navigator.onLine) updateSyncChip();
    }
  });
}

/* --------------------------------------------------------------------------
   Service worker
   -------------------------------------------------------------------------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.location.protocol === 'file:') return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadForUpdate) return;
    reloadForUpdate = false;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none',
      });
      swRegistration = registration;

      if (registration.waiting && navigator.serviceWorker.controller) {
        notifyUpdate(registration);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            notifyUpdate(registration);
          }
        });
      });

      // Vérifie discrètement les mises à jour toutes les heures.
      window.setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    } catch (error) {
      console.warn('Service worker non enregistré', error);
    }
  });
}

function notifyUpdate(registration) {
  if (updateToastShown) return;
  updateToastShown = true;

  toast('Une nouvelle version de Quartz Family est prête.', {
    type: 'info',
    title: 'Mise à jour disponible',
    duration: 0,
    action: {
      label: 'Redémarrer',
      onClick: () => {
        const waiting = registration.waiting || (swRegistration && swRegistration.waiting);
        if (!waiting) {
          window.location.reload();
          return;
        }
        reloadForUpdate = true;
        waiting.postMessage({ type: 'SKIP_WAITING' });
        window.setTimeout(() => {
          if (reloadForUpdate) {
            reloadForUpdate = false;
            window.location.reload();
          }
        }, 1500);
      },
    },
  });
}

/* --------------------------------------------------------------------------
   Démarrage effectif (le module est chargé après le parse du document)
   -------------------------------------------------------------------------- */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
