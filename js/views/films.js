/**
 * Quartz Family — vidéothèque familiale (type Plex) servie depuis Google Drive.
 *
 * Les administrateurs (liste Firestore `config/films-admins`, gérable depuis
 * l'application) ajoutent, modifient et suppriment les films du catalogue ;
 * chaque film pointe vers un fichier Google Drive ouvert dans un nouvel
 * onglet. Les autres membres peuvent suggérer des films, validées ou
 * refusées par un administrateur.
 */

import {
  state,
  isAdminUser,
  sanitizeFilm,
  sanitizeFilmSuggestion,
  sanitizeFilmYear,
  normalizeHttpUrl,
  allowedDomain,
} from '../store.js';
import {
  saveFilmToCatalog,
  removeFilmFromCatalog,
  submitFilmSuggestion,
  withdrawFilmSuggestion,
  updateFilmAdmins,
} from '../films.js';
import {
  el,
  icon,
  toast,
  confirmDialog,
  createModal,
  documentTitle,
  formatDate,
} from '../ui.js';

const FILM_ICON = 'movie';

function friendlyFilmError(error) {
  const code = (error && error.code) || '';
  if (code === 'permission-denied') {
    return 'Accès refusé par les règles Firestore. Vérifiez le déploiement des règles et la liste des administrateurs.';
  }
  if (code === 'unavailable') {
    return 'Cloud Firestore est momentanément indisponible. Vérifiez votre connexion puis réessayez.';
  }
  return "L'enregistrement a échoué. Vérifiez votre connexion puis réessayez.";
}

/** Convertit un horodatage Firestore en Date (ou null). */
function timestampToDate(value) {
  if (!value || typeof value.toDate !== 'function') return null;
  try {
    return value.toDate();
  } catch {
    return null;
  }
}

function filmMetaLine(film) {
  const parts = [];
  if (film.year) parts.push(String(film.year));
  if (film.genre) parts.push(film.genre);
  return parts.join(' · ');
}

function addedByLine(film) {
  const name = (film.addedBy && film.addedBy.name) || 'un membre';
  const date = timestampToDate(film.addedAt);
  return `Ajouté par ${name}${date ? ` · ${formatDate(date)}` : ''}`;
}

function findFilm(id) {
  return (state.films || []).find((film) => film.id === id);
}

function findSuggestion(id) {
  return (state.filmSuggestions || []).find((item) => item.id === id);
}

export function mountFilms(root) {
  document.title = documentTitle('Films');

  const controller = new AbortController();
  const { signal } = controller;

  let isAdmin = false;
  let disposed = false;
  let searchValue = '';

  const section = el('section', {
    class: 'view films-view',
    'aria-labelledby': 'films-title',
  });
  root.appendChild(section);

  const librarySlot = el('div', {});
  const suggestionsSlot = el('div', {});

  const searchInput = el('input', {
    class: 'input film-search-input',
    id: 'film-search',
    type: 'search',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Rechercher un film…',
    'aria-label': 'Rechercher un film dans le catalogue',
  });
  searchInput.addEventListener(
    'input',
    () => {
      searchValue = searchInput.value.trim().toLowerCase();
      renderLibrary();
    },
    { signal }
  );

  function render() {
    if (disposed) return;
    isAdmin = isAdminUser(state.user);
    section.replaceChildren(buildHeader(), buildSearch(), librarySlot, suggestionsSlot);
    renderLibrary();
    renderSuggestions();
  }

  /* ------------------------------------------------------------------------
     En-tête et recherche
     ------------------------------------------------------------------------ */

  function buildHeader() {
    return el(
      'header',
      { class: 'view-head' },
      el(
        'div',
        {},
        el('p', { class: 'eyebrow', text: 'Cinéma' }),
        el('h1', { id: 'films-title', text: 'Films' }),
        el('p', {
          class: 'view-sub',
          text: 'La vidéothèque familiale, servie depuis Google Drive.',
        })
      ),
      el(
        'div',
        { class: 'view-actions' },
        el(
          'button',
          {
            class: 'btn btn-secondary',
            type: 'button',
            dataset: { action: 'suggest-film' },
          },
          icon('idea', 16, { fallback: 'movie' }),
          el('span', { text: 'Suggérer un film' })
        ),
        isAdmin
          ? el(
              'button',
              {
                class: 'btn btn-secondary',
                type: 'button',
                dataset: { action: 'manage-admins' },
                title: 'Gérer les administrateurs de la vidéothèque',
              },
              icon('user-male-circle', 16, { fallback: 'settings' }),
              el('span', { text: 'Administrateurs' })
            )
          : null,
        isAdmin
          ? el(
              'button',
              {
                class: 'btn btn-primary',
                type: 'button',
                dataset: { action: 'add-film' },
              },
              icon('plus', 16),
              el('span', { text: 'Ajouter un film' })
            )
          : null
      )
    );
  }

  function buildSearch() {
    return el('div', { class: 'film-search' }, icon('search', 16), searchInput);
  }

  function filterFilms(films) {
    if (!searchValue) return films;
    const terms = searchValue.split(/\s+/).filter(Boolean);
    return films.filter((film) => {
      const haystack = [film.title, film.year ? String(film.year) : '', film.genre || '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }

  /* ------------------------------------------------------------------------
     Catalogue
     ------------------------------------------------------------------------ */

  function renderLibrary() {
    const films = state.films || [];
    const loading = !state.filmsLoaded && !state.filmsError;

    let content;
    if (state.filmsError) {
      content = buildState('error', 'Catalogue indisponible', state.filmsError);
    } else if (loading) {
      content = el(
        'div',
        { class: 'films-state' },
        el('span', { class: 'spinner' }),
        el('p', { class: 'films-state-title', text: 'Chargement du catalogue…' })
      );
    } else if (!films.length) {
      content = buildState(
        'movie',
        'Aucun film pour l’instant',
        isAdmin
          ? 'Ajoutez le premier film du catalogue avec son lien Google Drive.'
          : 'Suggérez un film : l’administrateur se chargera de l’ajouter.'
      );
    } else {
      const visible = filterFilms(films);
      content = visible.length
        ? el('div', { class: 'film-grid' }, ...visible.map((film) => buildFilmCard(film)))
        : buildState('search', 'Aucun résultat', `Aucun film ne correspond à « ${searchValue} ».`);
    }

    const results = films.length ? filterFilms(films).length : 0;
    librarySlot.replaceChildren(
      el(
        'div',
        { class: 'section-head' },
        el('h2', { text: 'Catalogue' }),
        el('span', { class: 'section-count', text: String(films.length) }),
        searchValue && films.length
          ? el('span', { class: 'section-hint', text: `${results} résultat${results > 1 ? 's' : ''}` })
          : null
      ),
      content
    );
  }

  function buildState(iconName, title, text) {
    return el(
      'div',
      { class: 'films-state' },
      icon(iconName, 28),
      el('p', { class: 'films-state-title', text: title }),
      text ? el('p', { class: 'films-state-text', text }) : null
    );
  }

  function buildFilmCard(film) {
    const meta = filmMetaLine(film);
    return el(
      'button',
      {
        class: 'film-card',
        type: 'button',
        dataset: { action: 'open-film', id: film.id },
        title: film.title + (meta ? ` (${meta})` : ''),
      },
      buildPoster(film),
      el(
        'span',
        { class: 'film-card-text' },
        el('span', { class: 'film-card-title', text: film.title }),
        meta ? el('span', { class: 'film-card-meta', text: meta }) : null
      )
    );
  }

  function buildPoster(film, extraClass = '') {
    const wrap = el('span', {
      class: 'film-poster' + (extraClass ? ' ' + extraClass : ''),
      'aria-hidden': 'true',
    });
    wrap.appendChild(
      el('span', { class: 'film-poster-fallback' }, icon(FILM_ICON, 30))
    );

    if (film.posterUrl) {
      const img = el('img', {
        class: 'film-poster-img',
        src: film.posterUrl,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
        draggable: 'false',
      });
      img.addEventListener(
        'error',
        () => {
          img.remove();
        },
        { once: true }
      );
      wrap.appendChild(img);
    }

    return wrap;
  }

  /* ------------------------------------------------------------------------
     Suggestions
     ------------------------------------------------------------------------ */

  function renderSuggestions() {
    const suggestions = state.filmSuggestions || [];
    if (!suggestions.length) {
      suggestionsSlot.replaceChildren();
      return;
    }

    suggestionsSlot.replaceChildren(
      el(
        'div',
        { class: 'films-suggestions' },
        el(
          'div',
          { class: 'section-head' },
          el('h2', { text: 'Suggestions' }),
          el('span', { class: 'section-count', text: String(suggestions.length) }),
          el('span', {
            class: 'section-hint',
            text: isAdmin ? 'À valider pour rejoindre le catalogue' : 'En attente de validation',
          })
        ),
        el('div', { class: 'suggestion-list' }, ...suggestions.map(buildSuggestionRow))
      )
    );
  }

  function buildSuggestionRow(suggestion) {
    const own =
      Boolean(state.user) &&
      Boolean(suggestion.suggestedBy) &&
      suggestion.suggestedBy.uid === state.user.uid;

    const meta = [
      suggestion.year ? String(suggestion.year) : null,
      (suggestion.suggestedBy && suggestion.suggestedBy.name) || null,
      formatDate(timestampToDate(suggestion.suggestedAt)),
    ]
      .filter(Boolean)
      .join(' · ');

    return el(
      'article',
      { class: 'suggestion-row' },
      el('span', { class: 'suggestion-icon' }, icon(FILM_ICON, 20, { fallback: 'idea' })),
      el(
        'div',
        { class: 'suggestion-body' },
        el('span', { class: 'suggestion-title', text: suggestion.title }),
        suggestion.note ? el('span', { class: 'suggestion-note', text: suggestion.note }) : null,
        suggestion.driveUrl
          ? el(
              'a',
              {
                class: 'suggestion-link',
                href: suggestion.driveUrl,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              icon('external-link', 12),
              el('span', { text: 'Lien Drive fourni' })
            )
          : null,
        meta ? el('span', { class: 'suggestion-meta', text: meta }) : null
      ),
      isAdmin || own
        ? el(
            'div',
            { class: 'suggestion-actions' },
            isAdmin
              ? el(
                  'button',
                  {
                    class: 'btn btn-primary btn--sm',
                    type: 'button',
                    dataset: { action: 'approve-suggestion', id: suggestion.id },
                  },
                  icon('plus', 14),
                  el('span', { text: 'Ajouter' })
                )
              : null,
            el(
              'button',
              {
                class: 'btn btn-secondary btn--sm',
                type: 'button',
                dataset: { action: 'remove-suggestion', id: suggestion.id },
              },
              icon('trash', 14),
              el('span', { text: isAdmin ? 'Refuser' : 'Retirer' })
            )
          )
        : null
    );
  }

  /* ------------------------------------------------------------------------
     Fenêtre de détail d'un film
     ------------------------------------------------------------------------ */

  function openFilmDialog(film) {
    const modal = createModal({
      title: film.title,
      subtitle: filmMetaLine(film) || 'Film familial',
      iconName: FILM_ICON,
      wide: true,
      body: el(
        'div',
        { class: 'film-detail' },
        buildPoster(film, 'film-poster--detail'),
        el(
          'div',
          { class: 'film-detail-info' },
          el('p', {
            class: 'film-detail-desc' + (film.description ? '' : ' film-detail-desc--empty'),
            text: film.description || 'Aucune description pour ce film.',
          }),
          el('p', { class: 'film-detail-meta', text: addedByLine(film) })
        )
      ),
      footer: [
        isAdmin
          ? el('button', {
              class: 'btn btn-danger',
              type: 'button',
              text: 'Supprimer',
              on: { click: () => modal.close('delete') },
            })
          : null,
        isAdmin
          ? el('button', {
              class: 'btn btn-secondary',
              type: 'button',
              text: 'Modifier',
              on: { click: () => modal.close('edit') },
            })
          : null,
        el(
          'a',
          {
            class: 'btn btn-primary',
            href: film.driveUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            on: { click: () => modal.close('watch') },
          },
          icon('play', 16),
          el('span', { text: 'Regarder sur Drive' })
        ),
      ],
    });

    modal.dialog.addEventListener('close', () => {
      const result = modal.dialog.returnValue;
      if (result === 'edit') {
        openFilmForm(film);
      } else if (result === 'delete') {
        confirmDeleteFilm(film);
      }
    });

    modal.dialog.showModal();
  }

  function confirmDeleteFilm(film) {
    confirmDialog({
      title: 'Supprimer ce film ?',
      message: `« ${film.title} » sera retiré du catalogue. Le fichier Google Drive n'est pas supprimé.`,
      confirmLabel: 'Supprimer',
      danger: true,
      iconName: 'trash',
    }).then(async (confirmed) => {
      if (!confirmed || disposed) return;
      try {
        await removeFilmFromCatalog(film.id);
        toast('Film supprimé du catalogue.', { type: 'success' });
      } catch (error) {
        toast(friendlyFilmError(error), { type: 'error', title: 'Films' });
      }
    });
  }

  /* ------------------------------------------------------------------------
     Formulaire d'ajout / modification (administrateurs)
     ------------------------------------------------------------------------ */

  function currentAuthor() {
    const user = state.user || {};
    return { uid: user.uid || '', name: user.displayName || user.email || 'Membre Quartz' };
  }

  function openFilmForm(existing = null, options = {}) {
    const isEdit = Boolean(existing);
    const initial = isEdit ? existing : options.prefill || {};
    const onSaved = typeof options.onSaved === 'function' ? options.onSaved : null;

    const titleInput = el('input', {
      class: 'input',
      id: 'film-title',
      name: 'title',
      type: 'text',
      maxlength: '80',
      autocomplete: 'off',
      placeholder: 'Ex. Le Voyage de Chihiro',
      value: initial.title || '',
    });

    const yearInput = el('input', {
      class: 'input',
      id: 'film-year',
      name: 'year',
      type: 'text',
      inputmode: 'numeric',
      maxlength: '4',
      autocomplete: 'off',
      placeholder: '2001',
      value: initial.year ? String(initial.year) : '',
    });

    const genreInput = el('input', {
      class: 'input',
      id: 'film-genre',
      name: 'genre',
      type: 'text',
      maxlength: '40',
      autocomplete: 'off',
      placeholder: 'Ex. Animation, Aventure',
      value: initial.genre || '',
    });

    const driveInput = el('input', {
      class: 'input',
      id: 'film-drive',
      name: 'driveUrl',
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'https://drive.google.com/file/d/…',
      value: initial.driveUrl || '',
    });

    const posterInput = el('input', {
      class: 'input',
      id: 'film-poster',
      name: 'posterUrl',
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'https://exemple.org/affiche.jpg',
      value: initial.posterUrl || '',
    });

    const descInput = el(
      'textarea',
      {
        class: 'input textarea',
        id: 'film-desc',
        name: 'description',
        rows: '4',
        maxlength: '600',
        placeholder: 'Résumé, remarques, conseils de visionnage…',
      },
      initial.description || ''
    );

    const titleError = el('p', { class: 'field-error', role: 'alert' });
    const yearError = el('p', { class: 'field-error', role: 'alert' });
    const driveError = el('p', { class: 'field-error', role: 'alert' });
    const posterError = el('p', { class: 'field-error', role: 'alert' });

    const form = el(
      'form',
      {
        class: 'film-form',
        novalidate: 'novalidate',
        on: {
          submit: (event) => {
            event.preventDefault();
            save();
          },
        },
      },
      formField('film-title', 'Titre', titleInput, titleError),
      el(
        'div',
        { class: 'film-form-row' },
        formField('film-year', 'Année', yearInput, yearError),
        formField('film-genre', 'Catégorie', genreInput)
      ),
      formField(
        'film-drive',
        'Lien Google Drive',
        driveInput,
        el('p', {
          class: 'field-hint',
          text: "Collez l'adresse du fichier vidéo sur Google Drive ; le film s'ouvrira dans un nouvel onglet.",
        }),
        driveError
      ),
      formField(
        'film-poster',
        'Affiche (facultatif)',
        posterInput,
        el('p', {
          class: 'field-hint',
          text: "Adresse directe d'une image (l'affiche du film), sinon une vignette par défaut est utilisée.",
        }),
        posterError
      ),
      formField('film-desc', 'Description (facultatif)', descInput)
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
      el('span', { text: isEdit ? 'Enregistrer' : 'Ajouter au catalogue' })
    );

    const modal = createModal({
      title: options.title || (isEdit ? 'Modifier le film' : 'Nouveau film'),
      subtitle:
        options.subtitle ||
        (isEdit
          ? 'Ajustez les informations ou le lien Google Drive de ce film.'
          : 'Le film sera ajouté au catalogue familial.'),
      iconName: isEdit ? 'pencil' : 'plus',
      body: form,
      footer: [cancelButton, saveButton],
    });

    function invalid(input, errorNode, message) {
      errorNode.textContent = message;
      input.setAttribute('aria-invalid', 'true');
    }

    function save() {
      for (const [input, errorNode] of [
        [titleInput, titleError],
        [yearInput, yearError],
        [driveInput, driveError],
        [posterInput, posterError],
      ]) {
        errorNode.textContent = '';
        input.setAttribute('aria-invalid', 'false');
      }

      const title = titleInput.value.trim();
      const yearRaw = yearInput.value.trim();
      const driveUrl = normalizeHttpUrl(driveInput.value);
      const posterRaw = posterInput.value.trim();
      const posterUrl = posterRaw ? normalizeHttpUrl(posterRaw) : '';
      const year = yearRaw ? sanitizeFilmYear(yearRaw) : null;

      let valid = true;
      let focusTarget = null;

      if (title.length < 2) {
        invalid(titleInput, titleError, 'Le titre doit contenir au moins 2 caractères.');
        focusTarget = focusTarget || titleInput;
        valid = false;
      }
      if (yearRaw && !year) {
        invalid(yearInput, yearError, 'Indiquez une année à 4 chiffres (ex. 1994) ou laissez vide.');
        focusTarget = focusTarget || yearInput;
        valid = false;
      }
      if (!driveUrl) {
        invalid(
          driveInput,
          driveError,
          'Lien invalide. Collez l’adresse https du fichier hébergé sur Google Drive.'
        );
        focusTarget = focusTarget || driveInput;
        valid = false;
      }
      if (posterRaw && !posterUrl) {
        invalid(posterInput, posterError, "Adresse d'image invalide (http/https uniquement).");
        focusTarget = focusTarget || posterInput;
        valid = false;
      }

      if (!valid) {
        if (focusTarget) focusTarget.focus();
        return;
      }

      const film = sanitizeFilm({
        id: isEdit ? existing.id : null,
        title,
        year,
        genre: genreInput.value.trim(),
        description: descInput.value.trim(),
        posterUrl: posterUrl || '',
        driveUrl,
        addedBy: (isEdit && existing.addedBy) || currentAuthor(),
      });
      if (!film) {
        invalid(titleInput, titleError, 'Informations incomplètes. Vérifiez le titre et le lien.');
        return;
      }

      modal.close('saved');
      (async () => {
        try {
          if (isEdit) await saveFilmToCatalog(film, existing.id);
          else await saveFilmToCatalog(film);
          if (onSaved) await onSaved();
          toast(
            isEdit
              ? 'Film mis à jour.'
              : onSaved
                ? 'Suggestion ajoutée au catalogue.'
                : 'Film ajouté au catalogue.',
            { type: 'success' }
          );
        } catch (error) {
          toast(friendlyFilmError(error), { type: 'error', title: 'Films' });
        }
      })();
    }

    modal.dialog.showModal();
    setTimeout(() => titleInput.focus(), 60);
  }

  /* ------------------------------------------------------------------------
     Formulaire de suggestion (tous les membres)
     ------------------------------------------------------------------------ */

  function openSuggestionForm() {
    const titleInput = el('input', {
      class: 'input',
      id: 'suggestion-title',
      name: 'title',
      type: 'text',
      maxlength: '80',
      autocomplete: 'off',
      placeholder: 'Ex. La Ligne verte',
    });

    const yearInput = el('input', {
      class: 'input',
      id: 'suggestion-year',
      name: 'year',
      type: 'text',
      inputmode: 'numeric',
      maxlength: '4',
      autocomplete: 'off',
      placeholder: '1999',
    });

    const driveInput = el('input', {
      class: 'input',
      id: 'suggestion-drive',
      name: 'driveUrl',
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'https://drive.google.com/file/d/…',
    });

    const noteInput = el(
      'textarea',
      {
        class: 'input textarea',
        id: 'suggestion-note',
        name: 'note',
        rows: '3',
        maxlength: '300',
        placeholder: 'Un mot pour convaincre l’administrateur…',
      },
      ''
    );

    const titleError = el('p', { class: 'field-error', role: 'alert' });
    const yearError = el('p', { class: 'field-error', role: 'alert' });
    const driveError = el('p', { class: 'field-error', role: 'alert' });

    const form = el(
      'form',
      {
        class: 'film-form',
        novalidate: 'novalidate',
        on: {
          submit: (event) => {
            event.preventDefault();
            save();
          },
        },
      },
      formField('suggestion-title', 'Titre du film', titleInput, titleError),
      el(
        'div',
        { class: 'film-form-row' },
        formField('suggestion-year', 'Année', yearInput, yearError),
        formField('suggestion-drive', 'Lien Google Drive (facultatif)', driveInput, driveError)
      ),
      formField(
        'suggestion-note',
        'Note (facultatif)',
        noteInput,
        el('p', {
          class: 'field-hint',
          text: "Votre suggestion sera visible par toute la famille jusqu'à sa validation.",
        })
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
      icon('idea', 16, { fallback: 'plus' }),
      el('span', { text: 'Envoyer la suggestion' })
    );

    const modal = createModal({
      title: 'Suggérer un film',
      subtitle: 'L’administrateur recevra votre suggestion et l’ajoutera au catalogue.',
      iconName: 'idea',
      body: form,
      footer: [cancelButton, saveButton],
    });

    function save() {
      for (const [input, errorNode] of [
        [titleInput, titleError],
        [yearInput, yearError],
        [driveInput, driveError],
      ]) {
        errorNode.textContent = '';
        input.setAttribute('aria-invalid', 'false');
      }

      const title = titleInput.value.trim();
      const yearRaw = yearInput.value.trim();
      const driveRaw = driveInput.value.trim();
      const year = yearRaw ? sanitizeFilmYear(yearRaw) : null;
      const driveUrl = driveRaw ? normalizeHttpUrl(driveRaw) : '';

      let valid = true;
      let focusTarget = null;

      if (title.length < 2) {
        titleError.textContent = 'Le titre doit contenir au moins 2 caractères.';
        titleInput.setAttribute('aria-invalid', 'true');
        focusTarget = titleInput;
        valid = false;
      }
      if (yearRaw && !year) {
        yearError.textContent = 'Indiquez une année à 4 chiffres (ex. 1994) ou laissez vide.';
        yearInput.setAttribute('aria-invalid', 'true');
        focusTarget = focusTarget || yearInput;
        valid = false;
      }
      if (driveRaw && !driveUrl) {
        driveError.textContent = 'Lien invalide. Collez une adresse http(s) complète.';
        driveInput.setAttribute('aria-invalid', 'true');
        focusTarget = focusTarget || driveInput;
        valid = false;
      }

      if (!valid) {
        if (focusTarget) focusTarget.focus();
        return;
      }

      const suggestion = sanitizeFilmSuggestion({
        title,
        year,
        note: noteInput.value.trim(),
        driveUrl: driveUrl || '',
      });
      if (!suggestion) {
        titleError.textContent = 'Donnez un titre à cette suggestion.';
        titleInput.setAttribute('aria-invalid', 'true');
        titleInput.focus();
        return;
      }

      modal.close('saved');
      submitFilmSuggestion(suggestion)
        .then(() => {
          toast('Suggestion envoyée. L’administrateur la validera bientôt !', {
            type: 'success',
            title: 'Suggestion',
          });
        })
        .catch((error) => {
          toast(friendlyFilmError(error), { type: 'error', title: 'Suggestion' });
        });
    }

    modal.dialog.showModal();
    setTimeout(() => titleInput.focus(), 60);
  }

  function approveSuggestion(suggestion) {
    const author = (suggestion.suggestedBy && suggestion.suggestedBy.name) || 'un membre';
    openFilmForm(null, {
      prefill: {
        title: suggestion.title,
        year: suggestion.year,
        driveUrl: suggestion.driveUrl || '',
      },
      title: 'Valider la suggestion',
      subtitle: `Pré-rempli depuis la suggestion de ${author}. Ajustez si besoin avant l'ajout.`,
      onSaved: () => withdrawFilmSuggestion(suggestion.id),
    });
  }

  function confirmRemoveSuggestion(suggestionId) {
    const suggestion = findSuggestion(suggestionId);
    if (!suggestion) return;

    confirmDialog({
      title: isAdmin ? 'Refuser cette suggestion ?' : 'Retirer votre suggestion ?',
      message: `« ${suggestion.title} » sera retirée de la liste des suggestions.`,
      confirmLabel: isAdmin ? 'Refuser' : 'Retirer',
      danger: true,
      iconName: 'trash',
    }).then(async (confirmed) => {
      if (!confirmed || disposed) return;
      try {
        await withdrawFilmSuggestion(suggestionId);
        toast('Suggestion retirée.', { type: 'success' });
      } catch (error) {
        toast(friendlyFilmError(error), { type: 'error', title: 'Films' });
      }
    });
  }

  /* ------------------------------------------------------------------------
     Gestion des administrateurs (administrateurs uniquement)
     ------------------------------------------------------------------------ */

  function openAdminsDialog() {
    const self = state.user && state.user.email ? state.user.email.trim().toLowerCase() : '';
    const listSlot = el('div', { class: 'admin-list' });

    const emailInput = el('input', {
      class: 'input',
      id: 'admin-email',
      name: 'email',
      type: 'email',
      maxlength: '80',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'prenom.nom@kesako.org',
    });

    const emailError = el('p', { class: 'field-error', role: 'alert' });

    const addButton = el(
      'button',
      {
        class: 'btn btn-primary',
        type: 'button',
        on: { click: addAdmin },
      },
      icon('plus', 16),
      el('span', { text: 'Ajouter' })
    );

    function renderAdminsList() {
      const admins = [...(state.filmAdmins || [])].sort((a, b) => a.localeCompare(b));
      if (!admins.length) {
        listSlot.replaceChildren(
          el('p', {
            class: 'field-hint',
            text: 'Aucun administrateur : la liste vit dans le document Firestore config/films-admins.',
          })
        );
        return;
      }
      listSlot.replaceChildren(
        ...admins.map((email) =>
          el(
            'div',
            { class: 'admin-row' + (email === self ? ' admin-row--self' : '') },
            icon('user-male-circle', 16, { fallback: 'link' }),
            el('span', { class: 'admin-email', text: email }),
            email === self
              ? el('span', { class: 'admin-self', text: 'Vous' })
              : el(
                  'button',
                  {
                    class: 'btn btn-secondary btn--sm',
                    type: 'button',
                    'aria-label': `Retirer ${email}`,
                    on: { click: () => removeAdmin(email) },
                  },
                  icon('trash', 14),
                  el('span', { text: 'Retirer' })
                )
          )
        )
      );
    }

    function invalid(message) {
      emailError.textContent = message;
      emailInput.setAttribute('aria-invalid', 'true');
      emailInput.focus();
    }

    async function persist(next, message) {
      addButton.disabled = true;
      emailInput.disabled = true;
      try {
        await updateFilmAdmins(next);
        emailInput.value = '';
        emailError.textContent = '';
        emailInput.setAttribute('aria-invalid', 'false');
        toast(message, { type: 'success', title: 'Administrateurs' });
      } catch (error) {
        toast(friendlyFilmError(error), { type: 'error', title: 'Administrateurs' });
      } finally {
        addButton.disabled = false;
        emailInput.disabled = false;
      }
    }

    function addAdmin() {
      const email = emailInput.value.trim().toLowerCase();
      const admins = state.filmAdmins || [];

      emailError.textContent = '';
      emailInput.setAttribute('aria-invalid', 'false');

      if (!email) {
        invalid('Donnez une adresse e-mail.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        invalid('Adresse e-mail invalide.');
        return;
      }
      if (!email.endsWith('@' + allowedDomain.toLowerCase())) {
        invalid(`Seules les adresses @${allowedDomain} peuvent administrer les films.`);
        return;
      }
      if (admins.includes(email)) {
        invalid('Cette adresse est déjà administratrice.');
        return;
      }
      if (admins.length >= 20) {
        invalid('Limite de 20 administrateurs atteinte.');
        return;
      }

      persist([...admins, email], `${email} peut maintenant gérer la vidéothèque.`);
    }

    function removeAdmin(email) {
      const admins = state.filmAdmins || [];
      if (!admins.includes(email)) return;
      persist(
        admins.filter((entry) => entry !== email),
        `${email} n'est plus administrateur.`
      );
    }

    const form = el(
      'form',
      {
        class: 'admin-add',
        novalidate: 'novalidate',
        on: {
          submit: (event) => {
            event.preventDefault();
            addAdmin();
          },
        },
      },
      emailInput,
      addButton
    );

    const closeButton = el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: 'Fermer',
      on: { click: () => modal.close('close') },
    });

    const modal = createModal({
      title: 'Administrateurs des films',
      subtitle:
        'Ces membres ajoutent, modifient et suppriment les films, et valident les suggestions. La liste est partagée et protégée par les règles Firestore.',
      iconName: 'user-male-circle',
      body: el(
        'div',
        {},
        el('p', {
          class: 'field-label',
          text: 'Administrateurs actuels',
        }),
        listSlot,
        el(
          'div',
          { class: 'field' },
          el('label', { class: 'field-label', for: 'admin-email', text: 'Ajouter un administrateur' }),
          form,
          emailError,
          el('p', {
            class: 'field-hint',
            text: "Vous ne pouvez pas vous retirer vous-même de la liste ; un autre administrateur le fera pour vous.",
          })
        )
      ),
      footer: [closeButton],
    });

    const onAdminsChanged = () => renderAdminsList();
    window.addEventListener('quartz:film-admins', onAdminsChanged);
    modal.dialog.addEventListener(
      'close',
      () => window.removeEventListener('quartz:film-admins', onAdminsChanged),
      { once: true }
    );

    renderAdminsList();
    modal.dialog.showModal();
    setTimeout(() => emailInput.focus(), 60);
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

      if (action === 'open-film' && id) {
        const film = findFilm(id);
        if (film) openFilmDialog(film);
      } else if (action === 'add-film') {
        openFilmForm();
      } else if (action === 'suggest-film') {
        openSuggestionForm();
      } else if (action === 'manage-admins') {
        openAdminsDialog();
      } else if (action === 'approve-suggestion' && id) {
        const suggestion = findSuggestion(id);
        if (suggestion) approveSuggestion(suggestion);
      } else if (action === 'remove-suggestion' && id) {
        confirmRemoveSuggestion(id);
      }
    },
    { signal }
  );

  window.addEventListener(
    'quartz:films',
    () => {
      if (!disposed) renderLibrary();
    },
    { signal }
  );

  window.addEventListener(
    'quartz:film-suggestions',
    () => {
      if (!disposed) renderSuggestions();
    },
    { signal }
  );

  window.addEventListener(
    'quartz:film-admins',
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

function formField(forId, label, control, ...extra) {
  return el(
    'div',
    { class: 'field' },
    el('label', { class: 'field-label', for: forId, text: label }),
    control,
    ...extra
  );
}
