/**
 * Quartz Family — réglages (profil, apparence, données, application, à propos).
 */

import {
  state,
  APP_NAME,
  APP_VERSION,
  allowedDomain,
  repositoryUrl,
  getThemePreference,
  setThemePreference,
} from '../store.js';
import { resetGrid, flushGrid } from '../grid.js';
import { signOutUser } from '../firebase.js';
import { canInstall, promptInstall, isStandalone } from '../install.js';
import {
  el,
  icon,
  avatar,
  toast,
  confirmDialog,
  createModal,
  documentTitle,
} from '../ui.js';

const THEME_OPTIONS = [
  { value: 'light', label: 'Clair', icon: 'sun', swatch: 'light' },
  { value: 'dark', label: 'Sombre', icon: 'moon', swatch: 'dark' },
  { value: 'system', label: 'Système', icon: 'monitor', swatch: 'system' },
];

function syncBadgeInfo(status) {
  switch (status) {
    case 'saving':
      return { label: 'Enregistrement…', className: 'badge badge--accent', iconName: 'synchronize' };
    case 'saved':
      return { label: 'Synchronisé', className: 'badge badge--success', iconName: 'checkmark' };
    case 'offline':
      return { label: 'Hors ligne', className: 'badge', iconName: 'wifi-off' };
    case 'error':
      return { label: 'Échec de synchro', className: 'badge badge--danger', iconName: 'error' };
    default:
      return { label: 'En attente', className: 'badge', iconName: 'cloud' };
  }
}

function buildBadge(info, ref = null) {
  const node = el('span', { class: info.className });
  if (ref) node.dataset.ref = ref;
  node.append(icon(info.iconName, 13), document.createTextNode(info.label));
  return node;
}

export function mountSettings(root) {
  document.title = documentTitle('Réglages');

  const controller = new AbortController();
  const { signal } = controller;
  let disposed = false;

  const section = el('section', {
    class: 'view settings',
    'aria-labelledby': 'settings-title',
  });
  root.appendChild(section);

  function render() {
    if (disposed) return;
    section.replaceChildren(buildHeader(), buildGrid());
  }

  function buildHeader() {
    return el(
      'header',
      { class: 'view-head' },
      el(
        'div',
        {},
        el('p', { class: 'eyebrow', text: 'Préférences' }),
        el('h1', { id: 'settings-title', text: 'Réglages' }),
        el('p', {
          class: 'view-sub',
          text: "Gérez votre compte, l'apparence et les données synchronisées de Quartz Family.",
        })
      )
    );
  }

  function buildGrid() {
    return el(
      'div',
      { class: 'settings-grid' },
      buildProfileCard(),
      buildAppearanceCard(),
      buildDataCard(),
      buildApplicationCard(),
      buildAboutCard()
    );
  }

  function buildProfileCard() {
    const user = state.user || {};
    const name = user.displayName || 'Membre Quartz';

    return el(
      'section',
      { class: 'card glass profile-card span-2', 'aria-labelledby': 'profile-title' },
      el(
        'div',
        { class: 'profile-head' },
        avatar(user, { size: 74, className: 'avatar--lg' }),
        el(
          'div',
          { class: 'profile-id' },
          el('h2', { id: 'profile-title', text: name }),
          el('p', { class: 'profile-email', text: user.email || '' }),
          el(
            'div',
            { class: 'profile-badges' },
            el(
              'span',
              { class: 'badge badge--accent' },
              icon('shield', 13, { fallback: 'lock' }),
              el('span', { text: `Compte @${allowedDomain}` })
            ),
            el(
              'span',
              { class: 'badge' },
              icon('google-logo', 13, { fallback: 'google-drive' }),
              el('span', { text: 'Google Workspace' })
            )
          )
        ),
        el(
          'div',
          { class: 'profile-actions' },
          el(
            'button',
            {
              class: 'btn btn-secondary',
              type: 'button',
              dataset: { action: 'signout' },
            },
            icon('exit', 16),
            el('span', { text: 'Se déconnecter' })
          )
        )
      )
    );
  }

  function buildAppearanceCard() {
    const current = getThemePreference();

    return el(
      'section',
      { class: 'card glass', 'aria-labelledby': 'appearance-title' },
      el(
        'div',
        { class: 'card-header' },
        icon('color-palette', 22, { fallback: 'palette' }),
        el(
          'div',
          {},
          el('h2', { class: 'card-title', id: 'appearance-title', text: 'Apparence' }),
          el('p', {
            class: 'card-subtitle',
            text: 'Choisissez le thème de Quartz Family.',
          })
        )
      ),
      el(
        'div',
        { class: 'theme-options', role: 'radiogroup', 'aria-label': "Thème de l'application" },
        THEME_OPTIONS.map((option) => {
          const input = el('input', {
            type: 'radio',
            name: 'appearance',
            value: option.value,
            checked: current === option.value,
          });
          return el(
            'label',
            {
              class: 'theme-option',
              dataset: { selected: String(current === option.value), themeValue: option.value },
            },
            input,
            el('span', {
              class: `theme-swatch theme-swatch--${option.swatch}`,
              'aria-hidden': 'true',
            }),
            el(
              'span',
              { class: 'theme-option-label' },
              icon(option.icon, 14),
              el('span', { text: option.label })
            )
          );
        })
      ),
      el('p', {
        class: 'attribution',
        text: "L'option Système suit automatiquement les préférences de Windows, macOS ou de votre appareil.",
      })
    );
  }

  function buildDataCard() {
    const badge = buildBadge(syncBadgeInfo(state.sync), 'sync-badge');

    return el(
      'section',
      { class: 'card glass', 'aria-labelledby': 'data-title' },
      el(
        'div',
        { class: 'card-header' },
        icon('database', 22),
        el(
          'div',
          {},
          el('h2', { class: 'card-title', id: 'data-title', text: 'Données' }),
          el('p', {
            class: 'card-subtitle',
            text: 'Votre grille est synchronisée dans Cloud Firestore.',
          })
        )
      ),
      el(
        'div',
        { class: 'settings-row' },
        el(
          'div',
          {},
          el('div', { class: 'settings-row-label', text: 'Synchronisation' }),
          el('div', {
            class: 'settings-row-hint',
            text: 'Enregistrée dans users/{uid}/settings/grid et mise en cache hors ligne.',
          })
        ),
        badge
      ),
      el(
        'div',
        { class: 'settings-row' },
        el(
          'div',
          {},
          el('div', { class: 'settings-row-label', text: 'Tableau de bord' }),
          el('div', {
            class: 'settings-row-hint',
            text: 'Retirer tous les raccourcis personnalisés et restaurer les applications par défaut.',
          })
        ),
        el(
          'button',
          {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            dataset: { action: 'reset-grid' },
          },
          icon('refresh', 15),
          el('span', { text: 'Réinitialiser' })
        )
      )
    );
  }

  function buildApplicationCard() {
    const standalone = isStandalone();
    const installable = canInstall();

    let installRow;
    if (standalone) {
      installRow = el(
        'span',
        { class: 'badge badge--success' },
        icon('checkmark', 13),
        el('span', { text: 'Installée' })
      );
    } else if (installable) {
      installRow = el(
        'button',
        {
          class: 'btn btn-primary btn-sm',
          type: 'button',
          dataset: { action: 'install' },
        },
        icon('download', 15),
        el('span', { text: 'Installer' })
      );
    } else {
      installRow = el(
        'span',
        { class: 'settings-row-value', text: 'Via le navigateur' }
      );
    }

    let installHint;
    if (standalone) {
      installHint = 'Quartz Family est ouverte comme une application autonome.';
    } else if (installable) {
      installHint = "Installez l'application pour un lancement plus rapide et un accès hors ligne.";
    } else {
      installHint =
        "Utilisez le menu du navigateur → « Installer Quartz Family » (Chrome, Edge) ou « Sur l'écran d'accueil » (Safari).";
    }

    return el(
      'section',
      { class: 'card glass', 'aria-labelledby': 'app-title' },
      el(
        'div',
        { class: 'card-header' },
        icon('windows-11', 22),
        el(
          'div',
          {},
          el('h2', { class: 'card-title', id: 'app-title', text: 'Application' }),
          el('p', {
            class: 'card-subtitle',
            text: 'Version, installation et fonctionnement hors ligne.',
          })
        )
      ),
      el(
        'div',
        { class: 'settings-row' },
        el('div', { class: 'settings-row-label', text: 'Version' }),
        el('span', { class: 'badge', text: APP_VERSION })
      ),
      el(
        'div',
        { class: 'settings-row' },
        el(
          'div',
          {},
          el('div', { class: 'settings-row-label', text: 'Installer sur cet appareil' }),
          el('div', { class: 'settings-row-hint', text: installHint })
        ),
        installRow
      ),
      el('p', {
        class: 'settings-row-hint',
        text: "L'interface et les icônes sont mises en cache par le service worker.",
      }),
      el(
        'div',
        { class: 'settings-row' },
        el(
          'div',
          {},
          el('div', { class: 'settings-row-label', text: 'Politique de confidentialité' }),
          el('div', {
            class: 'settings-row-hint',
            text: "Consultez les informations sur le traitement des données dans l'application.",
          })
        ),
        el(
          'button',
          {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            dataset: { action: 'privacy-policy' },
          },
          icon('document', 15),
          el('span', { text: 'Afficher' })
        )
      )
    );
  }


  function buildAboutCard() {
    const repo = repositoryUrl;

    return el(
      'section',
      { class: 'card glass span-2', 'aria-labelledby': 'about-title' },
      el(
        'div',
        { class: 'card-header' },
        icon('info', 22),
        el(
          'div',
          {},
          el('h2', { class: 'card-title', id: 'about-title', text: 'À propos' }),
          el('p', {
            class: 'card-subtitle',
            text: `${APP_NAME} est une application web open source, conçue pour les membres de l'organisation.`,
          })
        )
      ),
      el('p', {
        class: 'settings-row-hint',
        text: "Interface Fluent, synchronisation Firebase et accès Google Drive limité au strict nécessaire. Aucune donnée n'est revendue ni transmise à des tiers.",
      }),
      el(
        'div',
        { class: 'about-credits' },
        creditRow('Application', `${APP_NAME} v${APP_VERSION}`),
        creditRow('Icônes', 'Icons8 Fluency', 'https://icons8.com/'),
        creditRow('Authentification & données', 'Firebase · Google Cloud', 'https://firebase.google.com/'),
        creditRow('Fichiers', 'Google Drive API v3', 'https://developers.google.com/drive'),
        creditRow('Hébergement', 'GitHub Pages', 'https://pages.github.com/')
      ),
      el(
        'div',
        { class: 'about-links' },
        repo
          ? el(
              'a',
              {
                class: 'btn btn-secondary btn-sm',
                href: repo,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              icon('github', 15),
              el('span', { text: 'Code source' })
            )
          : null,
        repo
          ? el(
              'a',
              {
                class: 'btn btn-secondary btn-sm',
                href: repo + '/blob/main/LICENSE',
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              icon('document', 15),
              el('span', { text: 'Licence MIT' })
            )
          : null,
        repo
          ? el(
              'a',
              {
                class: 'btn btn-secondary btn-sm',
                href: repo + '/issues',
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              icon('error', 15),
              el('span', { text: 'Signaler un problème' })
            )
          : null
      ),
      el('p', {
        class: 'attribution',
        text: "Icônes : Icons8 (licence gratuite avec attribution). Produit non affilié à Google. « Google Drive », « Google Workspace » et les logos associés sont des marques de Google LLC.",
      })
    );
  }

  function creditRow(label, value, href) {
    return el(
      'div',
      { class: 'about-credit' },
      el('span', { text: label }),
      href
        ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: value })
        : el('span', { text: value })
    );
  }

  function updateThemeSelection() {
    const current = getThemePreference();
    section.querySelectorAll('.theme-option').forEach((option) => {
      const selected = option.dataset.themeValue === current;
      option.dataset.selected = String(selected);
      const input = option.querySelector('input');
      if (input) input.checked = selected;
    });
  }

  function updateSyncBadge() {
    const node = section.querySelector('[data-ref="sync-badge"]');
    if (!node) return;
    const info = syncBadgeInfo(state.sync);
    node.className = info.className;
    node.replaceChildren(icon(info.iconName, 13), document.createTextNode(info.label));
  }

  async function handleSignOut(button) {
    button.disabled = true;
    try {
      await flushGrid();
    } catch {
      /* une dernière écriture peut échouer : la déconnexion reste possible */
    }
    try {
      await signOutUser();
    } catch {
      button.disabled = false;
      toast('Impossible de vous déconnecter pour le moment.', { type: 'error' });
    }
  }

  async function handleReset() {
    const confirmed = await confirmDialog({
      title: 'Réinitialiser le tableau de bord ?',
      message:
        'Tous vos raccourcis personnalisés seront supprimés et la disposition par défaut sera restaurée. Vos applications Drive et Réglages restent disponibles.',
      confirmLabel: 'Réinitialiser',
      danger: true,
      iconName: 'refresh',
    });
    if (!confirmed || disposed) return;

    resetGrid();
    toast('Tableau de bord réinitialisé.', { type: 'success' });
  }

  async function handleInstall() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      toast('Quartz Family a été installée sur cet appareil.', {
        type: 'success',
        title: 'Installation',
      });
    } else if (outcome === 'unavailable') {
      toast(
        "L'installation n'est pas disponible via ce navigateur. Utilisez le menu du navigateur pour installer l'application.",
        { type: 'info', title: 'Installation' }
      );
    }
    if (!disposed) render();
  }

  async function handlePrivacyPolicy() {
    const body = el(
      'div',
      { class: 'privacy-content' },
      el('p', {
        class: 'modal-message',
        text: "Quartz Family utilise uniquement les services nécessaires à son fonctionnement : authentification Google, Cloud Firestore pour la grille de raccourcis et Google Drive via le scope restreint drive.file.",
      }),
      el('h3', { class: 'privacy-subtitle', text: "Données traitées" }),
      el(
        'ul',
        { class: 'privacy-list' },
        el('li', {}, el('strong', { text: 'Compte Google : ' }), 'nom, adresse e-mail, photo de profil (pour l’affichage et la vérification du domaine).'),
        el('li', {}, el('strong', { text: 'Grille de raccourcis : ' }), 'vos liens personnalisés enregistrés dans users/{uid}/settings/grid.'),
        el('li', {}, el('strong', { text: 'Google Drive : ' }), 'accès limité aux fichiers créés ou ouverts par l’application (scope drive.file). Aucun jeton n’est stocké de manière persistante.'),
        el('li', {}, el('strong', { text: 'Préférences locales : ' }), 'thème choisi (localStorage).')
      ),
      el('h3', { class: 'privacy-subtitle', text: 'Sécurité' }),
      el(
        'ul',
        { class: 'privacy-list' },
        el('li', {}, "Accès restreint aux comptes du domaine @kesako.org, contrôlé côté client et par les règles Firestore."),
        el('li', {}, 'Chaque utilisateur ne peut accéder qu’à ses propres données Firestore.'),
        el('li', {}, 'L’autorisation Drive est demandée à la demande et limitée au strict nécessaire.'),
        el('li', {}, 'Aucune donnée n’est revendue ni transmise à des tiers.')
      ),
      el('h3', { class: 'privacy-subtitle', text: 'Contact' }),
      el('p', {
        class: 'modal-message',
        text: 'Pour toute question relative à la confidentialité, veuillez contacter les administrateurs de l’organisation.',
      })
    );

    const modal = createModal({
      title: 'Politique de confidentialité',
      subtitle: APP_NAME + ' · Traitement et protection des données',
      iconName: 'shield',
      body,
      footer: [
        el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: 'Fermer',
          on: { click: () => modal.close('close') },
        }),
      ],
      wide: true,
    });

    modal.dialog.showModal();
  }

  section.addEventListener(
    'click',
    (event) => {
      const trigger = event.target.closest('[data-action]');
      if (!trigger) return;
      const action = trigger.dataset.action;

      if (action === 'signout') handleSignOut(trigger);
      else if (action === 'reset-grid') handleReset();
      else if (action === 'install') handleInstall();
      else if (action === 'privacy-policy') handlePrivacyPolicy();
    },
    { signal }
  );

  section.addEventListener(
    'change',
    (event) => {
      const input = event.target;
      if (input && input.name === 'appearance') {
        setThemePreference(input.value);
        updateThemeSelection();
      }
    },
    { signal }
  );

  window.addEventListener('quartz:sync', updateSyncBadge, { signal });
  window.addEventListener('quartz:theme', updateThemeSelection, { signal });
  window.addEventListener(
    'quartz:install',
    () => {
      if (!disposed) render();
    },
    { signal }
  );

  render();

  return () => {
    disposed = true;
    controller.abort();
  };
}
