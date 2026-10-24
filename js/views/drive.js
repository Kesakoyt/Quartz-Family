/**
 * Quartz Family — application Drive (explorateur simplifié).
 */

import { repositoryUrl } from '../store.js';
import * as driveApi from '../drive.js';
import {
  el,
  icon,
  toast,
  confirmDialog,
  createModal,
  formatBytes,
  formatDateShort,
  plural,
  documentTitle,
} from '../ui.js';

const VIEW_MODE_KEY = 'quartz.drive.view';

function makeUploadId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'upload-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

export function mountDrive(root) {
  document.title = documentTitle('Drive');

  const controller = new AbortController();
  const { signal } = controller;
  let disposed = false;
  let dragDepth = 0;
  const removalTimers = new Set();

  const view = {
    connected: driveApi.isConnected(),
    connecting: false,
    connectError: '',
    sessionExpired: false,
    loading: false,
    loaded: false,
    loadError: null,
    items: [],
    filter: '',
    stack: [{ id: 'root', name: 'Mon Drive' }],
    gridView: false,
    uploads: [],
  };

  try {
    view.gridView = localStorage.getItem(VIEW_MODE_KEY) === 'grid';
  } catch {
    view.gridView = false;
  }

  const configured = driveApi.isDriveConfigured();

  const section = el('section', {
    class: 'view drive-view',
    'aria-labelledby': 'drive-title',
  });
  root.appendChild(section);

  if (configured) {
    driveApi.preloadGis().catch(() => {
      /* l'utilisateur verra un message s'il tente de se connecter */
    });
  }

  const currentFolder = () => view.stack[view.stack.length - 1];

  function filteredItems() {
    const needle = view.filter.trim().toLowerCase();
    if (!needle) return view.items;
    return view.items.filter((file) => (file.name || '').toLowerCase().includes(needle));
  }

  /* ------------------------------------------------------------------------
     Rendu
     ------------------------------------------------------------------------ */

  function render() {
    if (disposed) return;
    section.replaceChildren(buildHeader(), buildBody(), buildDropOverlay());
    section.classList.remove('is-dragging');
    dragDepth = 0;
  }

  function buildHeader() {
    const actions = el('div', { class: 'view-actions' });

    if (view.connected) {
      actions.append(
        el(
          'div',
          { class: 'segmented', role: 'group', 'aria-label': "Mode d'affichage" },
          el(
            'button',
            {
              type: 'button',
              dataset: { action: 'set-view', mode: 'list' },
              'aria-pressed': String(!view.gridView),
              title: 'Vue liste',
              'aria-label': 'Vue liste',
            },
            icon('list', 17)
          ),
          el(
            'button',
            {
              type: 'button',
              dataset: { action: 'set-view', mode: 'grid' },
              'aria-pressed': String(view.gridView),
              title: 'Vue grille',
              'aria-label': 'Vue grille',
            },
            icon('thumbnails', 17, { fallback: 'list' })
          )
        ),
        el(
          'button',
          {
            class: 'btn btn-secondary btn-icon',
            type: 'button',
            dataset: { action: 'refresh' },
            title: 'Actualiser',
            'aria-label': 'Actualiser le dossier',
            disabled: view.loading,
          },
          icon('refresh', 17)
        )
      );
    }

    return el(
      'header',
      { class: 'view-head' },
      el(
        'div',
        {},
        el('p', { class: 'eyebrow', text: 'Application' }),
        el('h1', { id: 'drive-title', text: 'Drive' }),
        el('p', {
          class: 'view-sub',
          text: view.connected
            ? 'Parcourez, importez et organisez les fichiers accessibles à Quartz Family.'
            : 'Connectez votre compte Google pour accéder à vos fichiers.',
        })
      ),
      actions
    );
  }

  function buildBody() {
    if (!view.connected) return buildConnectView();
    return buildConnectedView();
  }

  function buildConnectView() {
    const card = el('div', { class: 'drive-connect' });

    const heading = view.sessionExpired
      ? 'Reconnectez votre Google Drive'
      : 'Connectez votre Google Drive';
    const lead = view.sessionExpired
      ? 'Votre session Google Drive a expiré. Reconnectez-vous pour retrouver vos fichiers.'
      : "Retrouvez vos documents sans quitter Quartz Family. L'accès reste limité aux fichiers que vous créez ou ouvrez avec cette application.";

    const main = el(
      'div',
      { class: 'drive-connect-main' },
      el('p', { class: 'eyebrow', text: 'Google Drive' }),
      el('h2', { text: heading }),
      el('p', { text: lead }),
      el(
        'ul',
        { class: 'drive-scopes' },
        scopeItem('Parcourir les fichiers et dossiers accessibles à Quartz Family'),
        scopeItem('Importer, organiser et mettre des fichiers à la corbeille'),
        scopeItem('Ouvrir les documents Google dans leurs applications officielles')
      )
    );

    if (!configured) {
      main.append(
        el(
          'div',
          { class: 'notice notice--warning', style: { marginTop: '18px' } },
          icon('error', 20),
          el(
            'div',
            {},
            el('strong', { text: 'Configuration requise' }),
            el('div', {
              text: "Renseignez l'identifiant `googleClientId` dans le fichier config.js, puis rechargez la page.",
            }),
            el(
              'a',
              {
                href: repositoryUrl + '#google-drive',
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'Consulter le guide d’installation',
              }
            )
          )
        )
      );
    }

    if (view.connectError) {
      main.append(
        el(
          'div',
          { class: 'notice notice--danger', style: { marginTop: '12px' } },
          icon('error', 20),
          el(
            'div',
            {},
            el('strong', { text: 'Connexion impossible' }),
            el('div', { text: view.connectError })
          )
        )
      );
    }

    const connectButton = el(
      'button',
      {
        class: 'btn btn-primary' + (view.connecting ? ' is-busy' : ''),
        type: 'button',
        dataset: { action: 'connect' },
        disabled: view.connecting || !configured,
        'aria-busy': String(view.connecting),
      },
      view.connecting
        ? el('span', { class: 'spinner', 'aria-hidden': 'true' })
        : icon('google-drive', 18),
      el('span', {
        text: view.connecting
          ? 'Connexion en cours…'
          : view.sessionExpired
            ? 'Reconnecter Google Drive'
            : 'Se connecter à Google Drive',
      })
    );

    main.append(
      connectButton,
      el(
        'p',
        { class: 'scope-note' },
        icon('lock', 14),
        el('span', {
          text: 'Autorisation limitée à drive.file : Quartz Family ne voit pas les autres fichiers de votre Drive. Aucun mot de passe ne nous est transmis.',
        })
      )
    );

    card.append(main, el('div', { class: 'drive-connect-art' }, icon('google-drive', 88)));
    return card;
  }

  function scopeItem(text) {
    return el(
      'li',
      {},
      icon('checkmark', 16, { fallback: 'checkmark' }),
      el('span', { text })
    );
  }

  function buildConnectedView() {
    const panel = el('div', { class: 'drive-panel' });

    if (view.loadError) {
      panel.append(
        buildNotice({
          type: 'danger',
          iconName: 'error',
          title: 'Impossible de charger ce dossier',
          message: view.loadError.message || 'Une erreur inattendue est survenue.',
          actionLabel: 'Réessayer',
          action: 'retry',
        })
      );
    }

    if (view.sessionExpired) {
      panel.append(
        buildNotice({
          type: 'warning',
          iconName: 'lock',
          title: 'Session Google Drive expirée',
          message: 'Reconnectez-vous pour continuer à parcourir vos fichiers.',
          actionLabel: 'Se reconnecter',
          action: 'connect',
        })
      );
    }

    panel.append(buildToolbar(), buildMeta(), buildUploadsContainer());

    const surface = el('div', {
      class: 'file-surface',
      dataset: { ref: 'file-surface' },
      'aria-busy': String(view.loading),
    });
    surface.append(buildFileContent());
    panel.append(surface);

    panel.append(
      el(
        'p',
        { class: 'scope-note' },
        icon('shield', 14, { fallback: 'lock' }),
        el('span', {
          text: 'Seuls les fichiers créés ou ouverts avec Quartz Family apparaissent ici (autorisation Google drive.file).',
        })
      )
    );

    return panel;
  }

  function buildNotice({ type, iconName, title, message, actionLabel, action }) {
    const node = el(
      'div',
      { class: 'notice' + (type ? ' notice--' + type : ''), role: 'status' },
      icon(iconName, 20, { fallback: 'info' }),
      el(
        'div',
        { style: { minWidth: '0' } },
        el('strong', { text: title }),
        el('div', { text: message })
      )
    );

    if (actionLabel && action) {
      node.append(
        el(
          'div',
          { class: 'notice-actions' },
          el(
            'button',
            {
              class: 'btn btn-secondary btn-sm',
              type: 'button',
              dataset: { action },
            },
            el('span', { text: actionLabel })
          )
        )
      );
    }

    return node;
  }

  function buildToolbar() {
    const crumbs = [];
    if (view.stack.length > 1) {
      crumbs.push(
        el(
          'button',
          {
            class: 'crumb',
            type: 'button',
            dataset: { action: 'back' },
            title: 'Dossier parent',
            'aria-label': 'Revenir au dossier parent',
          },
          icon('back', 14, { fallback: 'chevron-left' })
        )
      );
    }

    view.stack.forEach((folder, index) => {
      if (index > 0) {
        crumbs.push(icon('chevron-right', 12, { className: 'crumb-sep' }));
      }
      crumbs.push(
        el(
          'button',
          {
            class: 'crumb',
            type: 'button',
            dataset: { action: 'goto', index: String(index) },
            'aria-current': index === view.stack.length - 1 ? 'page' : null,
            title: folder.name,
          },
          el('span', { text: folder.name })
        )
      );
    });

    const searchInput = el('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Filtrer ce dossier…',
      'aria-label': 'Filtrer les fichiers de ce dossier',
      autocomplete: 'off',
      spellcheck: 'false',
      value: view.filter,
      dataset: { ref: 'drive-filter' },
    });

    const fileInput = el('input', {
      type: 'file',
      multiple: true,
      class: 'visually-hidden',
      tabindex: '-1',
      dataset: { ref: 'file-input' },
    });

    return el(
      'div',
      { class: 'drive-toolbar glass' },
      el('nav', { class: 'breadcrumbs', 'aria-label': 'Dossier courant' }, crumbs),
      el(
        'div',
        { class: 'drive-tools' },
        el('label', { class: 'search-field' }, icon('search', 16), searchInput),
        el(
          'button',
          {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            dataset: { action: 'new-folder' },
            title: 'Créer un dossier',
          },
          icon('add-folder', 15, { fallback: 'folder-invoices' }),
          el('span', { text: 'Dossier' })
        ),
        el(
          'button',
          {
            class: 'btn btn-primary btn-sm',
            type: 'button',
            dataset: { action: 'upload' },
            title: 'Importer des fichiers',
          },
          icon('upload', 15),
          el('span', { text: 'Importer' })
        ),
        fileInput
      )
    );
  }

  function countLabel() {
    if (view.loading && !view.loaded) return 'Chargement…';
    const filtered = filteredItems().length;
    if (view.filter.trim()) {
      return `${plural(filtered, 'résultat', 'résultats')} sur ${view.items.length}`;
    }
    return plural(view.items.length, 'élément', 'éléments');
  }

  function buildMeta() {
    return el(
      'div',
      { class: 'drive-meta' },
      el('span', { dataset: { ref: 'drive-count' } }, el('strong', { text: countLabel() })),
      el(
        'span',
        { class: 'drive-hint' },
        icon('shield', 13, { fallback: 'lock' }),
        el('span', {
          text: view.loading && view.loaded ? 'Actualisation…' : 'Accès drive.file uniquement',
        })
      )
    );
  }

  function buildUploadsContainer() {
    const queue = el('div', {
      class: 'upload-queue',
      dataset: { ref: 'upload-queue' },
      role: 'status',
      'aria-live': 'polite',
    });
    for (const entry of view.uploads) queue.append(buildUploadRow(entry));
    return queue;
  }

  function buildUploadRow(entry) {
    const stateLabel =
      entry.state === 'error' ? 'Échec' : entry.state === 'done' ? 'Terminé' : `${entry.progress} %`;
    const iconName =
      entry.state === 'error' ? 'error' : entry.state === 'done' ? 'checkmark' : 'upload';
    const width = entry.state === 'done' ? 100 : entry.state === 'error' ? 100 : entry.progress;

    return el(
      'div',
      {
        class: 'upload-item',
        dataset: { uploadId: entry.id, state: entry.state },
      },
      icon(iconName, 18, { fallback: 'upload' }),
      el(
        'div',
        { class: 'upload-info' },
        el(
          'div',
          { class: 'upload-name' },
          el('span', { text: entry.name, title: entry.name }),
          el('span', { class: 'upload-percent', text: stateLabel })
        ),
        el(
          'div',
          { class: 'progress' },
          el('span', { style: { width: `${width}%` } })
        )
      )
    );
  }

  function buildFileContent() {
    if (view.loading && !view.loaded) return buildSkeleton();

    const list = filteredItems();

    if (!list.length) {
      const hasFilter = Boolean(view.filter.trim());
      return el(
        'div',
        { class: 'drive-empty' },
        icon(hasFilter ? 'search' : 'opened-folder', 46, {
          fallback: hasFilter ? 'search' : 'folder-invoices',
        }),
        el('strong', {
          text: hasFilter ? 'Aucun résultat' : view.loaded ? 'Ce dossier est vide' : 'Dossier vide',
        }),
        el('span', {
          text: hasFilter
            ? `Aucun élément ne correspond à « ${view.filter.trim()} » dans ce dossier.`
            : 'Importez un fichier ou créez un sous-dossier pour commencer.',
        }),
        hasFilter
          ? el(
              'button',
              {
                class: 'btn btn-secondary btn-sm',
                type: 'button',
                dataset: { action: 'clear-filter' },
              },
              el('span', { text: 'Effacer le filtre' })
            )
          : el(
              'button',
              {
                class: 'btn btn-primary btn-sm',
                type: 'button',
                dataset: { action: 'upload' },
              },
              icon('upload', 15),
              el('span', { text: 'Importer un fichier' })
            )
      );
    }

    if (view.gridView) {
      const grid = el('div', { class: 'file-grid' });
      for (const file of list) grid.append(buildFileCard(file));
      return grid;
    }

    const listNode = el('div', { class: 'file-list' });
    for (const file of list) listNode.append(buildFileRow(file));
    return listNode;
  }

  function buildSkeleton() {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 6; index += 1) {
      fragment.append(
        el(
          'div',
          { class: 'drive-skeleton', 'aria-hidden': 'true' },
          el('span', {
            class: 'skeleton',
            style: { width: '34px', height: '34px', borderRadius: '9px', flex: 'none' },
          }),
          el(
            'span',
            { style: { flex: '1', minWidth: '0' } },
            el('span', {
              class: 'skeleton',
              style: { display: 'block', width: `${38 + index * 5}%`, height: '10px' },
            }),
            el('span', {
              class: 'skeleton',
              style: {
                display: 'block',
                width: '22%',
                height: '8px',
                marginTop: '7px',
              },
            })
          )
        )
      );
    }
    return fragment;
  }

  function buildFileRow(file) {
    const meta = driveApi.describeFile(file);
    const name = file.name || 'Sans nom';

    const main = el(
      'button',
      {
        class: 'file-main',
        type: 'button',
        dataset: { action: 'open', id: file.id },
        title: meta.folder ? `Ouvrir ${name}` : `Ouvrir ${name} dans un nouvel onglet`,
      },
      el(
        'span',
        { class: 'file-icon' },
        icon(meta.icon, 24, { fallback: meta.folder ? 'folder-invoices' : 'file' })
      ),
      el(
        'span',
        { class: 'file-text' },
        el('span', { class: 'file-name', text: name }),
        el('span', { class: 'file-kind', text: meta.label })
      )
    );

    return el(
      'div',
      {
        class: 'file-row' + (meta.folder ? ' file-row--folder' : ''),
        dataset: { fileId: file.id },
      },
      main,
      el('span', { class: 'file-date' }, icon('clock', 13), formatDateShort(file.modifiedTime)),
      el('span', { class: 'file-size', text: meta.folder ? '—' : formatBytes(file.size) }),
      buildFileActions(file, meta)
    );
  }

  function buildFileCard(file) {
    const meta = driveApi.describeFile(file);
    const name = file.name || 'Sans nom';

    return el(
      'div',
      { class: 'file-card', dataset: { fileId: file.id } },
      el(
        'button',
        {
          class: 'file-card-main',
          type: 'button',
          dataset: { action: 'open', id: file.id },
          title: meta.folder ? `Ouvrir ${name}` : `Ouvrir ${name} dans un nouvel onglet`,
        },
        el(
          'span',
          { class: 'file-icon' },
          icon(meta.icon, 30, { fallback: meta.folder ? 'folder-invoices' : 'file' })
        ),
        el('span', { class: 'file-name', text: name })
      ),
      el(
        'div',
        { class: 'file-card-foot' },
        el('span', { class: 'file-card-date', text: formatDateShort(file.modifiedTime) }),
        buildFileActions(file, meta)
      )
    );
  }

  function buildFileActions(file, meta) {
    const actions = el('div', { class: 'file-actions' });
    const name = file.name || 'Sans nom';

    if (meta.canDownload) {
      actions.append(
        actionButton('download', 'download', `Télécharger ${name}`, file.id)
      );
    }

    actions.append(
      actionButton('trash', 'trash', `Mettre ${name} à la corbeille`, file.id, true),
      actionButton('open-external', 'external-link', `Ouvrir ${name} dans un nouvel onglet`, file.id)
    );

    return actions;
  }

  function actionButton(action, iconName, label, id, danger = false) {
    return el(
      'button',
      {
        class: 'file-action' + (danger ? ' file-action--danger' : ''),
        type: 'button',
        title: label,
        'aria-label': label,
        dataset: { action, id },
      },
      icon(iconName, 16)
    );
  }

  function buildDropOverlay() {
    if (!view.connected) return null;
    return el(
      'div',
      { class: 'drop-overlay', 'aria-hidden': 'true' },
      el(
        'div',
        { class: 'drop-card' },
        icon('upload-to-cloud', 56, { fallback: 'upload' }),
        el('strong', { text: 'Déposez vos fichiers ici' }),
        el('span', { text: `Ils seront importés dans « ${currentFolder().name} ».` })
      )
    );
  }

  /* ------------------------------------------------------------------------
     Mises à jour ciblées
     ------------------------------------------------------------------------ */

  function renderFiles() {
    const surface = section.querySelector('[data-ref="file-surface"]');
    if (!surface) return;
    surface.replaceChildren(buildFileContent());
    surface.setAttribute('aria-busy', String(view.loading));
    updateMeta();
  }

  function updateMeta() {
    const node = section.querySelector('[data-ref="drive-count"]');
    if (node) node.replaceChildren(el('strong', { text: countLabel() }));
    const hint = section.querySelector('.drive-hint span');
    if (hint) hint.textContent = view.loading && view.loaded ? 'Actualisation…' : 'Accès drive.file uniquement';
  }

  function renderUploads() {
    const queue = section.querySelector('[data-ref="upload-queue"]');
    if (!queue) return;
    queue.replaceChildren(...view.uploads.map(buildUploadRow));
  }

  function updateUploadRow(entry) {
    const row = section.querySelector(`[data-upload-id="${cssEscape(entry.id)}"]`);
    if (!row) {
      renderUploads();
      return;
    }
    row.dataset.state = entry.state;
    const percent = row.querySelector('.upload-percent');
    const bar = row.querySelector('.progress > span');
    if (percent) {
      percent.textContent =
        entry.state === 'error'
          ? 'Échec'
          : entry.state === 'done'
            ? 'Terminé'
            : `${entry.progress} %`;
    }
    if (bar) {
      bar.style.width = `${entry.state === 'error' || entry.state === 'done' ? 100 : entry.progress}%`;
    }
  }

  function scheduleUploadRemoval(id, delay = 7000) {
    const timer = setTimeout(() => {
      removalTimers.delete(timer);
      if (disposed) return;
      view.uploads = view.uploads.filter((entry) => entry.id !== id);
      renderUploads();
    }, delay);
    removalTimers.add(timer);
  }

  /* ------------------------------------------------------------------------
     Chargement et navigation
     ------------------------------------------------------------------------ */

  async function loadFiles({ quiet = false } = {}) {
    if (!view.connected || view.loading) return;

    view.loading = true;
    view.loadError = null;
    if (!quiet) render();

    try {
      const files = await driveApi.listAllFiles(currentFolder().id);
      if (disposed) return;
      view.items = files;
      view.loaded = true;
    } catch (error) {
      if (disposed) return;
      if (error && (error.code === 'auth' || (error.details && error.details.reauth))) {
        driveApi.clearDriveToken();
        view.sessionExpired = true;
        view.connected = false;
        view.items = [];
        view.loaded = false;
      } else {
        view.loadError = error;
      }
    } finally {
      if (disposed) return;
      view.loading = false;
      render();
    }
  }

  async function openFolder(file) {
    view.stack.push({ id: file.id, name: file.name || 'Dossier' });
    view.items = [];
    view.loaded = false;
    view.filter = '';
    await loadFiles();
  }

  async function goToCrumb(index) {
    if (index < 0 || index >= view.stack.length || index === view.stack.length - 1) return;
    view.stack = view.stack.slice(0, index + 1);
    view.items = [];
    view.loaded = false;
    view.filter = '';
    await loadFiles();
  }

  async function goBack() {
    if (view.stack.length <= 1) return;
    view.stack.pop();
    view.items = [];
    view.loaded = false;
    view.filter = '';
    await loadFiles();
  }

  async function refresh() {
    if (view.loading) return;
    await loadFiles();
  }

  /* ------------------------------------------------------------------------
     Connexion
     ------------------------------------------------------------------------ */

  async function handleConnect() {
    if (view.connecting) return;

    view.connecting = true;
    view.connectError = '';
    render();

    try {
      await driveApi.connect();
      view.connecting = false;
      view.connected = true;
      view.sessionExpired = false;
      view.loaded = false;
      view.items = [];
      view.filter = '';
      toast('Google Drive connecté.', { type: 'success' });
      await loadFiles();
    } catch (error) {
      view.connecting = false;
      view.connectError = error && error.message ? error.message : 'La connexion à Google Drive a échoué.';
      view.connected = driveApi.isConnected();
      render();
    }
  }

  /* ------------------------------------------------------------------------
     Actions sur les fichiers
     ------------------------------------------------------------------------ */

  function fileById(id) {
    return view.items.find((file) => file.id === id) || null;
  }

  function openFile(file) {
    if (!file) return;
    const meta = driveApi.describeFile(file);
    if (meta.folder) {
      openFolder(file);
      return;
    }
    const url = driveApi.openUrlFor(file);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function handleDriveError(error) {
    if (!error) return;
    if (error.code === 'auth' || (error.details && error.details.reauth)) {
      driveApi.clearDriveToken();
      view.sessionExpired = true;
      view.connected = false;
      view.items = [];
      view.loaded = false;
      view.uploadError = null;
      render();
      toast('Votre session Google Drive a expiré. Reconnectez-vous.', {
        type: 'error',
        title: 'Google Drive',
      });
      return;
    }
    toast(error.message || "L'opération a échoué.", {
      type: 'error',
      title: 'Google Drive',
    });
  }

  async function downloadItem(id, button) {
    const file = fileById(id);
    if (!file) return;
    if (button) button.disabled = true;
    try {
      await driveApi.downloadFile(file);
      if (!disposed) {
        toast(`« ${file.name} » a été téléchargé.`, { type: 'success' });
      }
    } catch (error) {
      handleDriveError(error);
    } finally {
      if (button && !disposed) button.disabled = false;
    }
  }

  async function trashItem(id) {
    const file = fileById(id);
    if (!file) return;

    const confirmed = await confirmDialog({
      title: 'Mettre à la corbeille ?',
      message: `« ${file.name} » sera déplacé dans la corbeille de votre Google Drive. Vous pourrez le restaurer depuis Google Drive.`,
      confirmLabel: 'Mettre à la corbeille',
      danger: true,
      iconName: 'trash',
    });
    if (!confirmed || disposed) return;

    try {
      await driveApi.trashFile(file.id);
      view.items = view.items.filter((entry) => entry.id !== id);
      render();
      toast(`« ${file.name} » a été mis à la corbeille.`, {
        type: 'success',
        title: 'Google Drive',
      });
    } catch (error) {
      handleDriveError(error);
    }
  }

  function openNewFolderDialog() {
    const input = el('input', {
      class: 'input',
      id: 'new-folder-name',
      type: 'text',
      maxlength: '100',
      autocomplete: 'off',
      placeholder: 'Ex. Comptes rendus',
    });
    const errorNode = el('p', { class: 'field-error', role: 'alert' });

    const cancelButton = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: 'Annuler',
      on: { click: () => modal.close('cancel') },
    });

    const createButton = el(
      'button',
      { class: 'btn btn-primary', type: 'button' },
      icon('add-folder', 16, { fallback: 'folder-invoices' }),
      el('span', { text: 'Créer' })
    );

    const form = el(
      'form',
      {
        novalidate: 'novalidate',
        on: {
          submit: (event) => {
            event.preventDefault();
            create();
          },
        },
      },
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'field-label', for: 'new-folder-name', text: 'Nom du dossier' }),
        input,
        el('p', {
          class: 'field-hint',
          text: `Il sera créé dans « ${currentFolder().name} ».`,
        }),
        errorNode
      )
    );

    const modal = createModal({
      title: 'Nouveau dossier',
      subtitle: 'Organisez vos fichiers dans Google Drive.',
      iconName: 'add-folder',
      body: form,
      footer: [cancelButton, createButton],
    });

    async function create() {
      const name = input.value.trim();
      errorNode.textContent = '';

      if (!name) {
        errorNode.textContent = 'Saisissez un nom pour le dossier.';
        input.focus();
        return;
      }
      if (name.length > 100) {
        errorNode.textContent = 'Le nom doit contenir moins de 100 caractères.';
        return;
      }

      createButton.disabled = true;
      createButton.classList.add('is-busy');
      try {
        await driveApi.createFolder(name, currentFolder().id);
        modal.close('created');
        toast(`Dossier « ${name} » créé.`, { type: 'success', title: 'Google Drive' });
        await loadFiles({ quiet: true });
      } catch (error) {
        createButton.disabled = false;
        createButton.classList.remove('is-busy');
        errorNode.textContent =
          error && error.message ? error.message : 'La création du dossier a échoué.';
        handleDriveError(error);
      }
    }

    createButton.addEventListener('click', create);
    modal.dialog.showModal();
    setTimeout(() => input.focus(), 60);
  }

  /* ------------------------------------------------------------------------
     Import de fichiers
     ------------------------------------------------------------------------ */

  function triggerUpload() {
    const input = section.querySelector('[data-ref="file-input"]');
    if (input) input.click();
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    if (!driveApi.isConnected()) {
      driveApi.clearDriveToken();
      view.sessionExpired = true;
      view.connected = false;
      render();
      toast('Reconnectez-vous à Google Drive avant d’importer.', { type: 'error' });
      return;
    }

    const folder = currentFolder();
    const entries = files.map((file) => ({
      id: makeUploadId(),
      name: file.name,
      progress: 0,
      state: 'uploading',
      file,
    }));

    view.uploads.push(...entries);
    renderUploads();

    let success = 0;
    let failed = 0;
    let authFailure = false;

    const queue = [...entries];

    async function uploadOne(entry) {
      if (authFailure) {
        entry.state = 'error';
        entry.progress = 0;
        failed += 1;
        updateUploadRow(entry);
        scheduleUploadRemoval(entry.id, 4000);
        return;
      }

      try {
        await driveApi.uploadFile(entry.file, folder.id, (percent) => {
          if (disposed) return;
          entry.progress = Math.max(entry.progress, Math.min(99, percent));
          updateUploadRow(entry);
        });
        if (disposed) return;
        entry.state = 'done';
        entry.progress = 100;
        success += 1;
        renderUploads();
        scheduleUploadRemoval(entry.id);
      } catch (error) {
        if (disposed) return;
        entry.state = 'error';
        entry.error = error && error.message ? error.message : "L'import a échoué.";
        failed += 1;
        updateUploadRow(entry);
        scheduleUploadRemoval(entry.id, 10_000);

        if (error && (error.code === 'auth' || (error.details && error.details.reauth))) {
          authFailure = true;
          driveApi.clearDriveToken();
          view.sessionExpired = true;
          view.connected = false;
          view.items = [];
          view.loaded = false;
        }
      }
    }

    const workerCount = Math.min(3, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length) {
        const entry = queue.shift();
        // eslint-disable-next-line no-await-in-loop
        await uploadOne(entry);
      }
    });

    await Promise.all(workers);
    if (disposed) return;

    if (authFailure) {
      render();
      toast('Votre session Google Drive a expiré. Reconnectez-vous.', {
        type: 'error',
        title: 'Google Drive',
      });
      return;
    }

    if (success > 0) {
      toast(plural(success, 'fichier importé', 'fichiers importés'), {
        type: 'success',
        title: 'Google Drive',
      });
    }
    if (failed > 0) {
      toast(plural(failed, "fichier n'a pas pu être importé", "fichiers n'ont pas pu être importés"), {
        type: 'error',
        title: 'Import incomplet',
      });
    }

    if (success > 0 && currentFolder().id === folder.id) {
      await loadFiles({ quiet: true });
    }
  }

  /* ------------------------------------------------------------------------
     Événements
     ------------------------------------------------------------------------ */

  section.addEventListener(
    'click',
    (event) => {
      const trigger = event.target.closest('[data-action]');
      if (!trigger || !section.contains(trigger)) return;
      const action = trigger.dataset.action;
      const id = trigger.dataset.id;

      if (action === 'connect') {
        handleConnect();
      } else if (action === 'refresh' || action === 'retry') {
        refresh();
      } else if (action === 'set-view') {
        view.gridView = trigger.dataset.mode === 'grid';
        try {
          localStorage.setItem(VIEW_MODE_KEY, view.gridView ? 'grid' : 'list');
        } catch {
          /* stockage indisponible */
        }
        render();
      } else if (action === 'upload') {
        triggerUpload();
      } else if (action === 'new-folder') {
        openNewFolderDialog();
      } else if (action === 'back') {
        goBack();
      } else if (action === 'goto') {
        goToCrumb(Number(trigger.dataset.index));
      } else if (action === 'clear-filter') {
        view.filter = '';
        renderFiles();
        const filter = section.querySelector('[data-ref="drive-filter"]');
        if (filter) {
          filter.value = '';
          filter.focus();
        }
      } else if (action === 'open' && id) {
        openFile(fileById(id));
      } else if (action === 'open-external' && id) {
        openFile(fileById(id));
      } else if (action === 'download' && id) {
        downloadItem(id, trigger);
      } else if (action === 'trash' && id) {
        trashItem(id);
      }
    },
    { signal }
  );

  section.addEventListener(
    'input',
    (event) => {
      if (event.target.matches('[data-ref="drive-filter"]')) {
        view.filter = event.target.value;
        renderFiles();
      }
    },
    { signal }
  );

  section.addEventListener(
    'keydown',
    (event) => {
      if (event.target.matches('[data-ref="drive-filter"]') && event.key === 'Escape') {
        event.target.value = '';
        view.filter = '';
        renderFiles();
      }
    },
    { signal }
  );

  section.addEventListener(
    'change',
    (event) => {
      if (event.target.matches('[data-ref="file-input"]')) {
        const files = event.target.files;
        event.target.value = '';
        handleFiles(files);
      }
    },
    { signal }
  );

  section.addEventListener(
    'dragenter',
    (event) => {
      if (!view.connected) return;
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
      event.preventDefault();
      dragDepth += 1;
      section.classList.add('is-dragging');
    },
    { signal }
  );

  section.addEventListener(
    'dragover',
    (event) => {
      if (!view.connected) return;
      if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    { signal }
  );

  section.addEventListener(
    'dragleave',
    (event) => {
      if (!view.connected) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) section.classList.remove('is-dragging');
    },
    { signal }
  );

  section.addEventListener(
    'drop',
    (event) => {
      if (!view.connected) return;
      if (!event.dataTransfer) return;
      event.preventDefault();
      dragDepth = 0;
      section.classList.remove('is-dragging');
      const files = event.dataTransfer.files;
      if (files && files.length) handleFiles(files);
    },
    { signal }
  );

  render();
  if (view.connected) loadFiles();

  return () => {
    disposed = true;
    controller.abort();
    for (const timer of removalTimers) clearTimeout(timer);
    removalTimers.clear();
  };
}
