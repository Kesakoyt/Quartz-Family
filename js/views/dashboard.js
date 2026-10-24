/**
 * Quartz Family — tableau de bord (lanceur d'applications).
 */

import {
  state,
  createDefaultGrid,
  displayHost,
  isBuiltinId,
  firstNameOf,
  normalizeHttpUrl,
  sanitizeIconName,
} from '../store.js';
import { commitGrid } from '../grid.js';
import {
  el,
  icon,
  toast,
  confirmDialog,
  createModal,
  documentTitle,
} from '../ui.js';

const ICON_SUGGESTIONS = [
  'folder-invoices',
  'calendar',
  'mail',
  'chat',
  'video-call',
  'task',
  'briefcase',
  'documents',
  'book',
  'bank',
  'building',
  'notion',
  'figma',
  'canva',
  'zoom',
  'google-drive',
  'google-docs',
  'google-sheets',
  'google-slides',
  'cloud',
  'database',
];

function makeShortcutId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'link-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function mountDashboard(root) {
  document.title = documentTitle('Accueil');

  const controller = new AbortController();
  const { signal } = controller;

  let customizing = false;
  let dragId = null;
  let dropTarget = null;
  let pendingFocusId = null;
  let disposed = false;

  const section = el('section', {
    class: 'view dashboard',
    'aria-labelledby': 'dashboard-title',
  });
  root.appendChild(section);

  const items = () => (state.grid && state.grid.items) || createDefaultGrid().items;

  function render() {
    if (disposed) return;
    section.replaceChildren(buildHeader(), buildBoard());
    if (pendingFocusId) {
      const id = pendingFocusId;
      pendingFocusId = null;
      requestAnimationFrame(() => {
        const wrap = section.querySelector(`.tile-wrap[data-id="${cssEscape(id)}"]`);
        if (!wrap) return;
        const focusable = wrap.querySelector(
          'a.tile, article.tile, .tile-tool:not([disabled]), .tile-add'
        );
        if (focusable) focusable.focus({ preventScroll: true });
      });
    }
  }

  function buildHeader() {
    const list = items();
    const firstName = firstNameOf(state.user);
    const title = firstName ? `Bonjour, ${firstName}` : 'Bonjour';
    const customCount = list.filter((item) => !isBuiltinId(item.id)).length;

    return el(
      'header',
      { class: 'view-head' },
      el(
        'div',
        {},
        el('p', { class: 'eyebrow', text: 'Tableau de bord' }),
        el('h1', { id: 'dashboard-title', text: title }),
        el('p', {
          class: 'view-sub',
          text: customizing
            ? 'Réorganisez vos applications et raccourcis, ou ajoutez-en de nouveaux.'
            : 'Vos applications et raccourcis, à portée de main.',
        })
      ),
      el(
        'div',
        { class: 'view-actions' },
        el(
          'button',
          {
            class: 'btn ' + (customizing ? 'btn-primary' : 'btn-secondary'),
            type: 'button',
            dataset: { action: 'toggle-customize' },
            'aria-pressed': String(customizing),
          },
          icon(customizing ? 'checkmark' : 'pencil', 16),
          el('span', { text: customizing ? 'Terminer' : 'Personnaliser' })
        ),
        customCount === 0
          ? null
          : el('span', {
              class: 'badge',
              title: `${customCount} raccourci${customCount > 1 ? 's' : ''} personnalisé${
                customCount > 1 ? 's' : ''
              }`,
            }, `${customCount} raccourci${customCount > 1 ? 's' : ''}`)
      )
    );
  }

  function buildBoard() {
    const list = items();
    const grid = el('div', { class: 'tile-grid' });

    for (const item of list) {
      grid.appendChild(buildTile(item, list));
    }

    grid.appendChild(
      el(
        'button',
        {
          class: 'tile tile-add',
          type: 'button',
          dataset: { action: 'add-shortcut' },
          'aria-label': 'Ajouter un raccourci',
        },
        el(
          'span',
          { class: 'tile-add-inner' },
          icon('plus', 22),
          el('span', { text: 'Ajouter un raccourci' })
        )
      )
    );

    return el(
      'div',
      {},
      el(
        'div',
        { class: 'section-head' },
        el('h2', { text: 'Applications' }),
        el('span', { class: 'section-count', text: String(list.length) }),
        customizing
          ? el('span', { class: 'section-hint', text: 'Glissez-déposez pour réordonner' })
          : null
      ),
      grid,
      customizing
        ? el(
            'p',
            { class: 'customize-note' },
            icon('drag-and-drop', 15),
            el('span', {
              text: 'Mode personnalisation : glissez les tuiles ou utilisez les flèches. Les applications intégrées ne peuvent pas être supprimées.',
            })
          )
        : null
    );
  }

  function buildTile(item, list) {
    const builtin = isBuiltinId(item.id);
    const wrap = el('div', {
      class: 'tile-wrap',
      dataset: { id: item.id },
      draggable: customizing ? 'true' : 'false',
    });

    if (customizing) {
      wrap.appendChild(buildManagedTile(item, list, builtin));
    } else {
      wrap.appendChild(buildLinkTile(item, builtin));
    }

    return wrap;
  }

  function buildIconBox(item, builtin) {
    return el(
      'span',
      { class: 'tile-icon' },
      icon(item.icon || (builtin ? 'settings' : 'link'), 32, {
        fallback: builtin ? 'settings' : 'link',
      })
    );
  }

  function buildLinkTile(item, builtin) {
    const href = builtin ? item.href : item.url;
    const label = builtin
      ? `${item.title} — ${item.description || 'Application intégrée'}`
      : `${item.title} — ${displayHost(item.url)}`;

    return el(
      'a',
      {
        class: 'tile' + (builtin ? ' tile--builtin' : ''),
        href,
        target: builtin ? null : '_blank',
        rel: builtin ? null : 'noopener noreferrer',
        title: label,
        'aria-label': label,
      },
      buildIconBox(item, builtin),
      el(
        'span',
        { class: 'tile-text' },
        el('span', { class: 'tile-title', text: item.title }),
        el('span', {
          class: 'tile-desc',
          text: builtin ? item.description || 'Application intégrée' : displayHost(item.url),
        })
      ),
      icon(builtin ? 'chevron-right' : 'external-link', 15, {
        className: 'tile-open',
      })
    );
  }

  function buildManagedTile(item, list, builtin) {
    const index = list.findIndex((entry) => entry.id === item.id);
    const isFirst = index === 0;
    const isLast = index === list.length - 1;
    const name = item.title;

    return el(
      'article',
      {
        class: 'tile tile--manage' + (builtin ? ' tile--builtin' : ''),
        tabindex: '-1',
        'aria-label': `${name}${builtin ? ' (application intégrée)' : ''}`,
      },
      el(
        'div',
        { class: 'tile-main' },
        buildIconBox(item, builtin),
        el(
          'span',
          { class: 'tile-text' },
          el('span', { class: 'tile-title', text: item.title }),
          el('span', {
            class: 'tile-desc',
            text: builtin ? 'Application intégrée' : displayHost(item.url),
          })
        )
      ),
      el(
        'div',
        { class: 'tile-tools' },
        toolButton('move-left', 'chevron-left', `Déplacer ${name} vers la gauche`, item.id, isFirst),
        toolButton('move-right', 'chevron-right', `Déplacer ${name} vers la droite`, item.id, isLast),
        builtin
          ? null
          : toolButton('edit-shortcut', 'pencil', `Modifier ${name}`, item.id, false),
        builtin
          ? null
          : toolButton('delete-shortcut', 'trash', `Supprimer ${name}`, item.id, false, true),
        el(
          'span',
          { class: 'tile-grip', title: 'Glisser pour réordonner', 'aria-hidden': 'true' },
          icon('drag-and-drop', 16)
        )
      )
    );
  }

  function toolButton(action, iconName, label, id, disabled = false, danger = false) {
    return el(
      'button',
      {
        class: 'tile-tool' + (danger ? ' tile-tool--danger' : ''),
        type: 'button',
        title: label,
        'aria-label': label,
        dataset: { action, id },
        disabled,
      },
      icon(iconName, 15)
    );
  }

  function findItem(id) {
    return items().find((item) => item.id === id);
  }

  function moveItem(id, delta) {
    const current = items();
    const index = current.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return;

    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    pendingFocusId = id;
    commitGrid(next);
  }

  function deleteItem(id) {
    const item = findItem(id);
    if (!item || isBuiltinId(id)) return;

    confirmDialog({
      title: 'Supprimer ce raccourci ?',
      message: `« ${item.title} » sera retiré de votre tableau de bord. Aucun fichier ni site distant ne sera supprimé.`,
      confirmLabel: 'Supprimer',
      danger: true,
      iconName: 'trash',
    }).then((confirmed) => {
      if (!confirmed || disposed) return;
      pendingFocusId = null;
      commitGrid(items().filter((entry) => entry.id !== id));
      toast('Raccourci supprimé.', { type: 'success' });
    });
  }

  function openShortcutDialog(existing = null) {
    const isEdit = Boolean(existing);
    const initialIcon = existing ? existing.icon : 'link';

    const titleInput = el('input', {
      class: 'input',
      id: 'shortcut-title',
      name: 'title',
      type: 'text',
      maxlength: '50',
      autocomplete: 'off',
      placeholder: 'Ex. Espace projet',
      value: existing ? existing.title : '',
    });

    const urlInput = el('input', {
      class: 'input',
      id: 'shortcut-url',
      name: 'url',
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'https://exemple.kesako.org',
      value: existing ? existing.url : '',
    });

    const iconInput = el('input', {
      class: 'input',
      id: 'shortcut-icon',
      name: 'icon',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'google-drive',
      value: initialIcon,
    });

    const titleError = el('p', { class: 'field-error', role: 'alert' });
    const urlError = el('p', { class: 'field-error', role: 'alert' });
    const preview = el('span', { class: 'icon-preview' }, icon(initialIcon, 26, { fallback: 'link' }));

    const suggestions = el('div', { class: 'icon-suggestions', role: 'group', 'aria-label': 'Icônes suggérées' });

    const suggestionButtons = ICON_SUGGESTIONS.map((name) => {
      const button = el(
        'button',
        {
          class: 'icon-choice',
          type: 'button',
          title: name,
          'aria-label': `Utiliser l'icône ${name}`,
          'aria-pressed': String(name === initialIcon),
          dataset: { iconName: name },
        },
        icon(name, 22, { fallback: 'link' })
      );
      button.addEventListener('click', () => {
        iconInput.value = name;
        updatePreview();
        markSelected(name);
      });
      suggestions.appendChild(button);
      return button;
    });

    function markSelected(name) {
      for (const button of suggestionButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.iconName === name));
      }
    }

    function updatePreview() {
      const clean = sanitizeIconName(iconInput.value);
      preview.replaceChildren(icon(clean, 26, { fallback: 'link' }));
      markSelected(clean);
      iconInput.setAttribute('aria-invalid', 'false');
    }

    iconInput.addEventListener('input', updatePreview);

    const form = el(
      'form',
      {
        class: 'shortcut-form',
        novalidate: 'novalidate',
        on: {
          submit: (event) => {
            event.preventDefault();
            save();
          },
        },
      },
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'field-label', for: 'shortcut-title', text: 'Nom du raccourci' }),
        titleInput,
        titleError
      ),
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'field-label', for: 'shortcut-url', text: 'Adresse web' }),
        urlInput,
        el('p', {
          class: 'field-hint',
          text: "L'adresse s'ouvrira dans un nouvel onglet. HTTPS est ajouté automatiquement si besoin.",
        }),
        urlError
      ),
      el(
        'div',
        { class: 'field' },
        el('label', { class: 'field-label', for: 'shortcut-icon', text: 'Icône Icons8' }),
        el('div', { class: 'icon-input-row' }, iconInput, preview),
        el('p', {
          class: 'field-hint',
          text: "Nom de l'icône Fluency, par exemple « folder-invoices » ou « notion ».",
        }),
        suggestions
      )
    );

    const cancelButton = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: 'Annuler',
      on: { click: () => modal.close('cancel') },
    });

    const saveButton = el(
      'button',
      {
        class: 'btn btn-primary',
        type: 'button',
        on: { click: save },
      },
      icon(isEdit ? 'checkmark' : 'plus', 16),
      el('span', { text: isEdit ? 'Enregistrer' : 'Ajouter' })
    );

    const modal = createModal({
      title: isEdit ? 'Modifier le raccourci' : 'Nouveau raccourci',
      subtitle: isEdit
        ? 'Ajustez le nom, la destination ou l’icône de ce raccourci.'
        : 'Ajoutez un site ou un outil à votre tableau de bord.',
      iconName: isEdit ? 'pencil' : 'plus',
      body: form,
      footer: [cancelButton, saveButton],
    });

    function save() {
      const title = titleInput.value.trim();
      const url = normalizeHttpUrl(urlInput.value);
      const iconName = sanitizeIconName(iconInput.value);
      let valid = true;

      titleError.textContent = '';
      urlError.textContent = '';
      titleInput.setAttribute('aria-invalid', 'false');
      urlInput.setAttribute('aria-invalid', 'false');

      if (!title) {
        titleError.textContent = 'Donnez un nom à ce raccourci.';
        titleInput.setAttribute('aria-invalid', 'true');
        titleInput.focus();
        valid = false;
      } else if (title.length < 2) {
        titleError.textContent = 'Le nom doit contenir au moins 2 caractères.';
        titleInput.setAttribute('aria-invalid', 'true');
        titleInput.focus();
        valid = false;
      }

      if (!url) {
        urlError.textContent =
          'Adresse invalide. Utilisez une URL http(s) complète, par exemple https://exemple.kesako.org.';
        urlInput.setAttribute('aria-invalid', 'true');
        if (valid) urlInput.focus();
        valid = false;
      }

      if (!valid) return;

      const current = [...items()];
      if (isEdit) {
        const index = current.findIndex((item) => item.id === existing.id);
        if (index < 0) {
          modal.close('cancel');
          return;
        }
        current[index] = {
          ...current[index],
          title: title.slice(0, 50),
          url,
          icon: iconName,
        };
      } else {
        current.push({
          id: makeShortcutId(),
          type: 'link',
          title: title.slice(0, 50),
          url,
          icon: iconName,
        });
      }

      modal.close('saved');
      commitGrid(current);
      toast(isEdit ? 'Raccourci mis à jour.' : 'Raccourci ajouté au tableau de bord.', {
        type: 'success',
      });
    }

    modal.dialog.showModal();
    setTimeout(() => titleInput.focus(), 60);
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

      if (action === 'toggle-customize') {
        customizing = !customizing;
        dragId = null;
        render();
      } else if (action === 'add-shortcut') {
        openShortcutDialog();
      } else if (action === 'edit-shortcut' && id) {
        const item = findItem(id);
        if (item && !isBuiltinId(id)) openShortcutDialog(item);
      } else if (action === 'delete-shortcut' && id) {
        deleteItem(id);
      } else if (action === 'move-left' && id) {
        moveItem(id, -1);
      } else if (action === 'move-right' && id) {
        moveItem(id, 1);
      }
    },
    { signal }
  );

  section.addEventListener(
    'dragstart',
    (event) => {
      if (!customizing) {
        event.preventDefault();
        return;
      }
      const wrap = event.target.closest('.tile-wrap');
      if (!wrap) return;
      dragId = wrap.dataset.id;
      event.dataTransfer.effectAllowed = 'move';
      try {
        event.dataTransfer.setData('text/plain', dragId);
      } catch {
        /* certains navigateurs limitent dataTransfer */
      }
      requestAnimationFrame(() => {
        if (wrap.isConnected) wrap.classList.add('is-dragging');
      });
    },
    { signal }
  );

  section.addEventListener(
    'dragover',
    (event) => {
      if (!customizing || !dragId) return;
      const wrap = event.target.closest('.tile-wrap');
      if (!wrap || wrap.dataset.id === dragId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (dropTarget !== wrap) {
        if (dropTarget) dropTarget.classList.remove('is-drop-target');
        dropTarget = wrap;
        dropTarget.classList.add('is-drop-target');
      }
    },
    { signal }
  );

  section.addEventListener(
    'drop',
    (event) => {
      if (!customizing || !dragId) return;
      const wrap = event.target.closest('.tile-wrap');
      event.preventDefault();
      if (!wrap || wrap.dataset.id === dragId) {
        cleanupDrag();
        return;
      }

      const rect = wrap.getBoundingClientRect();
      const horizontal =
        Math.abs(event.clientX - (rect.left + rect.width / 2)) >
        Math.abs(event.clientY - (rect.top + rect.height / 2));
      const after = horizontal
        ? event.clientX > rect.left + rect.width / 2
        : event.clientY > rect.top + rect.height / 2;

      const current = [...items()];
      const fromIndex = current.findIndex((item) => item.id === dragId);
      if (fromIndex < 0) {
        cleanupDrag();
        return;
      }

      const [moved] = current.splice(fromIndex, 1);
      const targetIndex = current.findIndex((item) => item.id === wrap.dataset.id);
      const insertAt = targetIndex < 0 ? current.length : targetIndex + (after ? 1 : 0);
      current.splice(insertAt, 0, moved);

      const movedId = moved.id;
      cleanupDrag();
      pendingFocusId = movedId;
      commitGrid(current);
    },
    { signal }
  );

  section.addEventListener('dragend', cleanupDrag, { signal });

  function cleanupDrag() {
    dragId = null;
    if (dropTarget) {
      dropTarget.classList.remove('is-drop-target');
      dropTarget = null;
    }
    section.querySelectorAll('.tile-wrap.is-dragging').forEach((node) => {
      node.classList.remove('is-dragging');
    });
  }

  window.addEventListener(
    'quartz:grid',
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

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}
