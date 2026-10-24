/**
 * Quartz Family — écran de connexion.
 */

import { signInWithGoogle, friendlyAuthError } from '../firebase.js';
import { allowedDomain, APP_NAME, APP_VERSION } from '../store.js';
import { el, icon, documentTitle, GOOGLE_LOGO_SVG } from '../ui.js';

/**
 * @param {{ error?: string, errorTitle?: string }} [options]
 */
export function renderLogin(options = {}) {
  const app = document.getElementById('app');
  document.title = documentTitle('Connexion');

  const errorSlot = el('div', { class: 'auth-error-slot' });

  const googleButton = el(
    'button',
    {
      class: 'btn btn-google',
      type: 'button',
    },
    el('span', { html: GOOGLE_LOGO_SVG }),
    el('span', { text: 'Se connecter avec Google' })
  );

  const layout = el(
    'div',
    { class: 'auth-layout' },
    el(
      'main',
      { class: 'auth-card', 'aria-labelledby': 'auth-title' },
      el(
        'div',
        { class: 'auth-brand' },
        el('img', { src: './icons/logo.svg', width: 34, height: 34, alt: '' }),
        el('span', { text: APP_NAME })
      ),
      el(
        'div',
        { class: 'auth-logo', 'aria-hidden': 'true' },
        el('img', { src: './icons/icon-192.png', width: 78, height: 78, alt: '' })
      ),
      el('h1', { id: 'auth-title', text: 'Bienvenue' }),
      el('p', {
        class: 'auth-lead',
        text: "Votre espace de travail, vos outils et vos fichiers réunis dans une seule application.",
      }),
      errorSlot,
      el('div', { class: 'auth-actions' }, googleButton),
      el(
        'p',
        { class: 'auth-scope' },
        icon('shield', 14, { fallback: 'lock' }),
        el('span', { text: 'Accès réservé aux comptes' }),
        el('strong', { text: '@' + allowedDomain })
      ),
      el(
        'div',
        { class: 'auth-points' },
        el(
          'span',
          { class: 'auth-point' },
          icon('google-drive', 15),
          el('span', { text: 'Drive intégré' })
        ),
        el(
          'span',
          { class: 'auth-point' },
          icon('synchronize', 15, { fallback: 'refresh' }),
          el('span', { text: 'Synchronisé' })
        ),
        el(
          'span',
          { class: 'auth-point' },
          icon('cloud', 15),
          el('span', { text: 'Hors ligne' })
        )
      ),
      el('p', {
        class: 'auth-foot',
        text: `${APP_NAME} v${APP_VERSION} · Application interne de l'organisation`,
      })
    )
  );

  app.replaceChildren(layout);

  function clearError() {
    errorSlot.replaceChildren();
  }

  function showError(message, title = 'Connexion impossible') {
    errorSlot.replaceChildren(
      el(
        'div',
        { class: 'auth-error', role: 'alert' },
        icon('error', 16),
        el(
          'div',
          {},
          el('strong', { text: title }),
          document.createTextNode(message)
        )
      )
    );
  }

  function setBusy(busy) {
    googleButton.disabled = busy;
    googleButton.classList.toggle('is-busy', busy);
    googleButton.replaceChildren(
      busy
        ? el('span', { class: 'spinner', 'aria-hidden': 'true' })
        : el('span', { html: GOOGLE_LOGO_SVG }),
      el('span', { text: busy ? 'Connexion en cours…' : 'Se connecter avec Google' }),
      busy ? el('span', { class: 'visually-hidden', text: 'Veuillez patienter' }) : null
    );
    googleButton.setAttribute('aria-busy', String(busy));
  }

  googleButton.addEventListener('click', async () => {
    clearError();
    setBusy(true);
    try {
      await signInWithGoogle();
      // La suite est gérée par onAuthStateChanged dans app.js.
    } catch (error) {
      setBusy(false);
      showError(friendlyAuthError(error));
    }
  });

  if (options.error) {
    showError(options.error, options.errorTitle || 'Connexion impossible');
  }

  return () => {};
}
