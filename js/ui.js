/**
 * Quartz Family — primitives d'interface (icônes, notifications, modales…).
 * Aucune dépendance : uniquement du DOM natif.
 */

import { APP_NAME } from './store.js';

const ICON_CDN = 'https://img.icons8.com/fluency';

/** Construit une URL d'icône Icons8 Fluency. */
export function iconUrl(name, size = 200) {
  const clean = String(name || 'link')
    .toLowerCase()
    .replace(/\.png$/i, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'link';
  const bucket = size <= 64 ? 96 : 200;
  return `${ICON_CDN}/${bucket}/${clean}.png`;
}

/**
 * Crée une icône Icons8 avec repli automatique.
 * @param {string} name
 * @param {number} size
 * @param {{ fallback?: string, className?: string, alt?: string }} [options]
 */
export function icon(name, size = 24, options = {}) {
  const img = document.createElement('img');
  img.className = 'icon' + (options.className ? ' ' + options.className : '');
  img.src = iconUrl(name, size);
  img.width = size;
  img.height = size;
  img.alt = options.alt || '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.draggable = false;
  img.dataset.icon = name;

  let failed = false;
  img.addEventListener('error', () => {
    if (!failed && options.fallback && options.fallback !== name) {
      failed = true;
      img.src = iconUrl(options.fallback, size);
      img.dataset.icon = options.fallback;
      return;
    }
    img.style.visibility = 'hidden';
  });

  return img;
}

/* --------------------------------------------------------------------------
   Fabrique d'éléments
   -------------------------------------------------------------------------- */

/**
 * Crée un élément DOM.
 * @param {string} tag
 * @param {Object<string, any>} [attrs]
 * @param {...(Node|string|null|undefined|Array<any>)} children
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  if (!attrs) attrs = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      if (key.startsWith('aria-') || key === 'disabled' || key === 'hidden') {
        node.setAttribute(key, String(value));
      }
      continue;
    }

    if (key === 'class' || key === 'className') {
      node.className = String(value);
    } else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        if (dataValue !== undefined && dataValue !== null) {
          node.dataset[dataKey] = String(dataValue);
        }
      }
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'on' && typeof value === 'object') {
      for (const [eventName, handler] of Object.entries(value)) {
        if (typeof handler === 'function') node.addEventListener(eventName, handler);
      }
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      // Réservé aux chaînes constantes et fiables du projet.
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(node, child);
    } else if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function spinner(extraClass = '') {
  return el('span', {
    class: 'spinner' + (extraClass ? ' ' + extraClass : ''),
    'aria-hidden': 'true',
  });
}

/* --------------------------------------------------------------------------
   Avatars
   -------------------------------------------------------------------------- */

import { initialsOf } from './store.js';

export function avatar(user, { size = 30, className = '' } = {}) {
  const wrapper = el('span', {
    class: 'avatar' + (className ? ' ' + className : ''),
    style: { width: `${size}px`, height: `${size}px` },
    'aria-hidden': 'true',
  });

  const fallback = el('span', { text: initialsOf(user || {}) });
  const photo = user && user.photoURL;

  if (!photo) {
    wrapper.appendChild(fallback);
    return wrapper;
  }

  const img = el('img', {
    src: photo,
    alt: '',
    width: size,
    height: size,
    referrerpolicy: 'no-referrer',
    loading: 'lazy',
    decoding: 'async',
  });

  img.addEventListener('error', () => {
    if (img.parentNode) img.replaceWith(fallback);
  });

  wrapper.appendChild(img);
  return wrapper;
}

/* --------------------------------------------------------------------------
   Notifications
   -------------------------------------------------------------------------- */

const TOAST_ICONS = {
  success: 'checkmark',
  error: 'error',
  warning: 'error',
  info: 'info',
};

/**
 * Affiche une notification non bloquante.
 * @param {string} message
 * @param {{ type?: 'success'|'error'|'warning'|'info', title?: string, duration?: number,
 *           action?: { label: string, onClick: () => void } }} [options]
 */
export function toast(message, options = {}) {
  const region = document.getElementById('toasts');
  if (!region) return () => {};

  const type = options.type || 'info';
  const duration = options.duration === undefined ? (type === 'error' ? 6500 : 4200) : options.duration;

  const closeButton = el(
    'button',
    {
      class: 'toast-close',
      type: 'button',
      'aria-label': 'Fermer la notification',
      on: { click: () => dismiss() },
    },
    icon('cancel', 13, { fallback: 'multiply' })
  );

  const content = el(
    'div',
    { class: 'toast-content' },
    options.title ? el('div', { class: 'toast-title', text: options.title }) : null,
    el('div', { class: 'toast-message', text: message })
  );

  let actionButton = null;
  if (options.action && typeof options.action.onClick === 'function') {
    actionButton = el('button', {
      class: 'toast-action',
      type: 'button',
      text: options.action.label,
      on: {
        click: () => {
          try {
            options.action.onClick();
          } finally {
            dismiss();
          }
        },
      },
    });
  }

  const node = el(
    'div',
    { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' },
    el('span', { class: 'toast-icon' }, icon(TOAST_ICONS[type] || 'info', 20)),
    content,
    actionButton,
    closeButton
  );

  region.appendChild(node);

  while (region.children.length > 4) {
    region.firstElementChild.remove();
  }

  let timer = null;
  let dismissed = false;

  function startTimer(delay = duration) {
    if (!delay) return;
    clearTimeout(timer);
    timer = setTimeout(dismiss, delay);
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 200);
  }

  startTimer();

  node.addEventListener('mouseenter', () => {
    if (!dismissed) clearTimeout(timer);
  });
  node.addEventListener('mouseleave', () => {
    if (!dismissed && duration) startTimer(Math.min(1600, duration));
  });

  return dismiss;
}

export function toastError(message, title = 'Une erreur est survenue') {
  return toast(message, { type: 'error', title });
}

/* --------------------------------------------------------------------------
   Modales
   -------------------------------------------------------------------------- */

/**
 * Crée une boîte de dialogue native.
 * @param {{ title: string, subtitle?: string, iconName?: string, body?: Node|Node[],
 *           footer?: Node|Node[], wide?: boolean, closeOnBackdrop?: boolean }} options
 */
export function createModal(options) {
  const dialog = el('dialog', {
    class: 'modal' + (options.wide ? ' modal--wide' : ''),
    'aria-labelledby': 'modal-title-' + Math.random().toString(36).slice(2, 8),
  });

  const bodyId = dialog.getAttribute('aria-labelledby');
  const closeButton = el(
    'button',
    {
      class: 'modal-close',
      type: 'button',
      'aria-label': 'Fermer',
    },
    icon('cancel', 16, { fallback: 'multiply' })
  );

  const head = el(
    'header',
    { class: 'modal-head' },
    options.iconName
      ? el('span', { class: 'modal-head-icon' }, icon(options.iconName, 24, { fallback: 'info' }))
      : null,
    el(
      'div',
      { class: 'modal-head-text' },
      el('h2', { id: bodyId, text: options.title }),
      options.subtitle ? el('p', { class: 'modal-sub', text: options.subtitle }) : null
    ),
    closeButton
  );

  const body = el('div', { class: 'modal-body' }, options.body || null);
  const footer = options.footer ? el('footer', { class: 'modal-foot' }, options.footer) : null;

  const card = el('div', { class: 'modal-card' }, head, body, footer);
  dialog.appendChild(card);
  document.body.appendChild(dialog);

  const close = (value = 'cancel') => {
    if (dialog.open) dialog.close(value);
    else dialog.remove();
  };

  closeButton.addEventListener('click', () => close('cancel'));

  if (options.closeOnBackdrop !== false) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close('cancel');
    });
  }

  dialog.addEventListener('close', () => {
    dialog.remove();
  });

  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close('cancel');
  });

  return { dialog, close, body, card };
}

/**
 * Demande une confirmation.
 * @param {{ title: string, message: string, confirmLabel?: string, cancelLabel?: string,
 *           danger?: boolean, iconName?: string }} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog(options) {
  return new Promise((resolve) => {
    let settled = false;

    const cancelButton = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: options.cancelLabel || 'Annuler',
      on: { click: () => modal.close('cancel') },
    });

    const confirmButton = el('button', {
      class: 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary'),
      type: 'button',
      text: options.confirmLabel || 'Confirmer',
      on: { click: () => modal.close('confirm') },
    });

    const modal = createModal({
      title: options.title,
      iconName: options.iconName || (options.danger ? 'error' : 'help'),
      body: el('p', { class: 'modal-message', text: options.message }),
      footer: [cancelButton, confirmButton],
    });

    modal.dialog.addEventListener('close', () => {
      if (settled) return;
      settled = true;
      resolve(modal.dialog.returnValue === 'confirm');
    });

    modal.dialog.showModal();
    (options.danger ? cancelButton : confirmButton).focus();
  });
}

/* --------------------------------------------------------------------------
   Formatage
   -------------------------------------------------------------------------- */

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '—';
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0 o';

  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / Math.pow(1024, exponent);
  const digits = amount >= 10 || exponent === 0 ? 0 : 1;
  return (
    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(amount) +
    ' ' +
    units[exponent]
  );
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const now = new Date();
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, now)) return `Aujourd'hui, ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Hier, ${time}`;

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

export function formatDateShort(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/* --------------------------------------------------------------------------
   Utilitaires
   -------------------------------------------------------------------------- */

export function debounce(fn, delay = 300) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function documentTitle(page) {
  return page ? `${page} · ${APP_NAME}` : APP_NAME;
}

export const GOOGLE_LOGO_SVG = `<svg class="google-g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.61 20.08H42V20H24v8h11.3C33.65 32.66 29.22 36 24 36c-6.63 0-12-5.37-12-12s5.37-12 12-12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4 12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.34-.14-2.65-.39-3.92z"/><path fill="#FF3D00" d="M6.31 14.69l6.57 4.82C14.65 15.11 18.96 12 24 12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66C34.05 6.05 29.27 4 24 4 16.32 4 9.66 8.34 6.31 14.69z"/><path fill="#4CAF50" d="M24 44c5.17 0 9.86-1.98 13.41-5.2l-6.19-5.24C29.15 35.09 26.69 36 24 36c-5.2 0-9.62-3.31-11.28-7.93l-6.52 5.02C9.51 39.56 16.23 44 24 44z"/><path fill="#1976D2" d="M43.61 20.08H42V20H24v8h11.3c-.79 2.25-2.25 4.2-4.08 5.56l.01-.01 6.19 5.24C37.02 39.2 44 34 44 24c0-1.34-.14-2.65-.39-3.92z"/></svg>`;
