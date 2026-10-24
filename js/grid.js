/**
 * Quartz Family — synchronisation de la grille de lancement.
 * Cache local instantané + Firestore (`users/{uid}/settings/grid`).
 */

import {
  state,
  emit,
  sanitizeGrid,
  sameGrid,
  createDefaultGrid,
  getCachedGrid,
  cacheGrid,
} from './store.js';
import {
  loadGridFromCloud,
  saveGridToCloud,
  subscribeGrid,
  friendlyFirestoreError,
} from './firebase.js';

let uid = null;
let unsubscribe = null;
let saveTimer = null;
let saving = false;
let dirty = false;
let revision = 0;
let session = 0;

const SAVE_DEBOUNCE = 650;

function setSync(status) {
  if (state.sync === status) return;
  state.sync = status;
  emit('quartz:sync', { status });
}

function emitGrid() {
  emit('quartz:grid', state.grid);
}

/**
 * Démarre la synchronisation pour un utilisateur.
 * Retourne immédiatement : la grille locale est disponible sans attendre le réseau.
 */
export function startGridSync(user) {
  stopGridSync();
  if (!user) return null;

  const currentSession = ++session;
  uid = user.uid;

  const cached = getCachedGrid(uid);
  state.grid = cached || createDefaultGrid();
  state.gridLoaded = Boolean(cached);
  emitGrid();

  const revisionAtStart = revision;

  (async () => {
    try {
      const remote = await loadGridFromCloud(uid);
      if (session !== currentSession) return;

      if (remote && Array.isArray(remote.items) && remote.items.length > 0) {
        if (revision === revisionAtStart) {
          const remoteGrid = sanitizeGrid(remote);
          if (!sameGrid(state.grid, remoteGrid)) {
            state.grid = remoteGrid;
            cacheGrid(uid, remoteGrid);
            emitGrid();
          }
        } else if (!sameGrid(state.grid, sanitizeGrid(remote))) {
          // Des modifications locales ont eu lieu pendant le chargement :
          // elles sont prioritaires et seront envoyées à Firestore.
          dirty = true;
          scheduleSave();
        }
        if (!dirty && !saving) setSync(navigator.onLine ? 'saved' : 'offline');
      } else {
        // Premier passage : on crée la grille par défaut (ou on pousse le cache local).
        const initial = state.grid || createDefaultGrid();
        state.grid = initial;
        cacheGrid(uid, initial);
        if (revision === revisionAtStart) {
          setSync(navigator.onLine ? 'saving' : 'offline');
          if (navigator.onLine) {
            try {
              await saveGridToCloud(uid, initial);
              if (session === currentSession && !dirty) setSync('saved');
            } catch (error) {
              dirty = true;
              setSync(navigator.onLine ? 'error' : 'offline');
              emit('quartz:sync-error', {
                message: friendlyFirestoreError(error),
              });
            }
          }
        } else {
          dirty = true;
          scheduleSave();
        }
      }

      state.gridLoaded = true;
      emit('quartz:grid-loaded');

      if (session === currentSession && !unsubscribe) {
        unsubscribe = subscribeGrid(
          uid,
          (data) => {
            if (session !== currentSession || data.pending) return;
            if (dirty || saving) return;
            const remoteGrid = sanitizeGrid(data);
            if (sameGrid(state.grid, remoteGrid)) return;
            state.grid = remoteGrid;
            cacheGrid(uid, remoteGrid);
            emitGrid();
            setSync('saved');
          },
          (error) => {
            if (session !== currentSession || !navigator.onLine) return;
            setSync('error');
            emit('quartz:sync-error', { message: friendlyFirestoreError(error) });
          }
        );
      }
    } catch (error) {
      if (session !== currentSession) return;
      state.gridLoaded = true;
      if (!state.grid) {
        state.grid = createDefaultGrid();
        cacheGrid(uid, state.grid);
        emitGrid();
      }
      setSync(navigator.onLine ? 'error' : 'offline');
      emit('quartz:grid-loaded');
      emit('quartz:sync-error', { message: friendlyFirestoreError(error) });
    }
  })();

  return state.grid;
}

export function stopGridSync() {
  session += 1;
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch {
      /* déjà désabonné */
    }
    unsubscribe = null;
  }
  clearTimeout(saveTimer);
  saveTimer = null;
  uid = null;
  saving = false;
  dirty = false;
  revision = 0;
}

/**
 * Applique une nouvelle grille, la met en cache et planifie l'écriture Firestore.
 * @param {Array} items
 */
export function commitGrid(items) {
  const next = sanitizeGrid({ items });
  if (state.grid && sameGrid(state.grid, next)) return state.grid;

  state.grid = next;
  revision += 1;

  if (uid) cacheGrid(uid, next);
  emitGrid();

  if (uid) {
    dirty = true;
    scheduleSave();
  }

  return next;
}

/** Réinitialise la grille aux applications et raccourcis par défaut. */
export function resetGrid() {
  return commitGrid(createDefaultGrid().items);
}

function scheduleSave() {
  if (!uid) return;
  dirty = true;
  clearTimeout(saveTimer);

  if (!navigator.onLine) {
    setSync('offline');
    return;
  }

  setSync(saving ? 'saving' : 'saving');
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, SAVE_DEBOUNCE);
}

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;

  if (!uid || !dirty || saving) return;

  if (!navigator.onLine) {
    setSync('offline');
    return;
  }

  const targetUid = uid;
  const targetSession = session;
  const payload = state.grid;
  saving = true;
  dirty = false;
  setSync('saving');

  try {
    await saveGridToCloud(targetUid, payload);
    if (session !== targetSession) return;

    if (dirty) {
      setSync('saving');
      scheduleSave();
    } else {
      setSync('saved');
    }
  } catch (error) {
    if (session !== targetSession) return;
    dirty = true;
    setSync(navigator.onLine ? 'error' : 'offline');
    emit('quartz:sync-error', { message: friendlyFirestoreError(error) });
  } finally {
    saving = false;
    if (dirty && navigator.onLine && !saveTimer) scheduleSave();
  }
}

/** Force l'envoi des modifications en attente (ex. avant déconnexion). */
export function flushGrid() {
  if (!uid || !dirty) return Promise.resolve();
  return flush();
}

/** Relance la synchronisation après une erreur ou un retour du réseau. */
export function retrySync() {
  if (!uid) return;
  dirty = true;
  if (navigator.onLine) {
    setSync('saving');
    flush();
  } else {
    setSync('offline');
  }
}

window.addEventListener('online', () => {
  if (!uid) return;
  if (dirty) retrySync();
  else if (state.sync === 'offline') setSync('saved');
});

window.addEventListener('offline', () => {
  if (!uid) return;
  setSync('offline');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && dirty) {
    flush();
  }
});

export function currentSyncStatus() {
  return state.sync;
}
