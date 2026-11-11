/**
 * Quartz Family — catalogue de films et suggestions.
 *
 * Contrairement à la grille (données personnelles), le catalogue est partagé
 * entre tous les membres : la source de vérité est Firestore et chaque
 * mutation passe par le serveur. Les mises à jour arrivent en temps réel via
 * `onSnapshot` ; le cache persistant du SDK Firestore sert le catalogue hors
 * ligne et au rechargement.
 *
 * Collections :
 *  - `films` : catalogue géré par les administrateurs (voir `config/films-admins`) ;
 *  - `film-suggestions` : suggestions des membres, validées par un administrateur.
 */

import { state, emit } from './store.js';
import {
  subscribeFilms,
  subscribeFilmSuggestions,
  subscribeFilmAdmins,
  saveFilmAdmins,
  createFilm,
  updateFilm as updateFilmInCloud,
  removeFilm as removeFilmFromCloud,
  addFilmSuggestion,
  removeFilmSuggestion,
  friendlyFirestoreError,
} from './firebase.js';

let session = 0;
let unsubFilms = null;
let unsubSuggestions = null;
let unsubAdmins = null;

/**
 * Démarre l'écoute du catalogue pour un utilisateur connecté.
 * Les états arrivent dans `state.films` / `state.filmSuggestions`.
 */
export function startFilmsSync(user) {
  stopFilmsSync();
  if (!user) return;

  const currentSession = ++session;

  unsubFilms = subscribeFilms(
    (films) => {
      if (session !== currentSession) return;
      state.films = films;
      state.filmsLoaded = true;
      state.filmsError = '';
      emit('quartz:films');
    },
    (error) => {
      if (session !== currentSession) return;
      state.filmsLoaded = true;
      state.filmsError = friendlyFirestoreError(error);
      emit('quartz:films');
      emit('quartz:films-error', { message: state.filmsError });
    }
  );

  unsubSuggestions = subscribeFilmSuggestions(
    (suggestions) => {
      if (session !== currentSession) return;
      state.filmSuggestions = suggestions;
      emit('quartz:film-suggestions');
    },
    (error) => {
      if (session !== currentSession) return;
      emit('quartz:films-error', { message: friendlyFirestoreError(error) });
    }
  );

  // La liste des administrateurs vit dans Firestore (`config/films-admins`) :
  // aucune adresse n'est inscrite dans le code ni la configuration déployée.
  unsubAdmins = subscribeFilmAdmins(
    (emails) => {
      if (session !== currentSession) return;
      state.filmAdmins = emails
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
        .filter(Boolean);
      emit('quartz:film-admins');
    },
    () => {
      /* silencieux : les erreurs du catalogue sont déjà signalées */
    }
  );
}

export function stopFilmsSync() {
  session += 1;
  for (const unsubscribe of [unsubFilms, unsubSuggestions, unsubAdmins]) {
    if (!unsubscribe) continue;
    try {
      unsubscribe();
    } catch {
      /* déjà désabonné */
    }
  }
  unsubFilms = null;
  unsubSuggestions = null;
  unsubAdmins = null;
  state.films = [];
  state.filmSuggestions = [];
  state.filmAdmins = [];
  state.filmsLoaded = false;
  state.filmsError = '';
}

/**
 * Enregistre la liste des administrateurs des films (réservé aux
 * administrateurs, contrôlé aussi par les règles Firestore).
 * @param {Array<string>} emails adresses en minuscules
 */
export function updateFilmAdmins(emails) {
  const clean = [...new Set(
    emails
      .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
      .filter(Boolean)
  )];
  return saveFilmAdmins(clean);
}

/** Enregistre un film dans le catalogue partagé (création ou mise à jour). */
export async function saveFilmToCatalog(film, filmId = null) {
  if (filmId) return updateFilmInCloud(filmId, film);
  return createFilm(film);
}

export function removeFilmFromCatalog(filmId) {
  return removeFilmFromCloud(filmId);
}

/** Envoie une suggestion de film à l'administrateur. */
export function submitFilmSuggestion(suggestion) {
  const user = state.user || {};
  return addFilmSuggestion({
    ...suggestion,
    suggestedBy: {
      uid: user.uid || '',
      name: user.displayName || user.email || 'Membre Quartz',
    },
  });
}

export function withdrawFilmSuggestion(suggestionId) {
  return removeFilmSuggestion(suggestionId);
}
