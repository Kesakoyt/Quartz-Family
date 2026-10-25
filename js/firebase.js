/**
 * Quartz Family — services Firebase (Auth + Firestore).
 * Le SDK modulaire est embarqué dans `vendor/firebase` pour fonctionner hors ligne.
 */

import { initializeApp, getApps } from '../vendor/firebase/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from '../vendor/firebase/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from '../vendor/firebase/firebase-firestore.js';

import { allowedDomain } from './store.js';

let app = null;
let auth = null;
let db = null;
let provider = null;

/** Initialise Firebase une seule fois. */
export async function initFirebase(firebaseConfig) {
  if (auth && db) return { app, auth, db };

  const existing = getApps();
  app = existing.length ? existing[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);

  try {
    await setPersistence(auth, indexedDBLocalPersistence);
    console.log('[firebase] persistence set to indexedDBLocalPersistence');
  } catch (e) {
    try {
      await setPersistence(auth, browserLocalPersistence);
      console.log('[firebase] persistence set to browserLocalPersistence');
    } catch {
      console.warn('[firebase] persistence fallback failed', e);
    }
  }

  provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    hd: allowedDomain,
    prompt: 'select_account',
  });

  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // Certains navigateurs (navigation privée stricte) refusent IndexedDB.
    db = getFirestore(app);
  }

  return { app, auth, db };
}

export function getFirebaseAuth() {
  return auth;
}

export function getFirestoreDb() {
  return db;
}

/* --------------------------------------------------------------------------
   Authentification
   -------------------------------------------------------------------------- */

/**
 * Connexion Google.
 *
 * Le flux par redirection est utilisé systématiquement : `signInWithPopup`
 * surveille la fenêtre ouverte via `window.closed`, ce qu'un en-tête
 * Cross-Origin-Opener-Policy (COOP) bloque (« policy would block the
 * window.closed call »). La redirection ne dépend pas de cet accès et reste
 * donc fiable, y compris sur GitHub Pages où aucun en-tête personnalisé ne
 * peut être défini.
 *
 * @returns {Promise<null>} La page est redirigée ; le résultat est traité par
 *   `resolveRedirectSignIn()` au chargement suivant.
 */
export async function signInWithGoogle() {
  console.log('[firebase] signInWithGoogle called');
  try {
    await signInWithRedirect(auth, provider);
    console.log('[firebase] signInWithRedirect initiated');
    return null;
  } catch (error) {
    console.error('[firebase] signInWithRedirect failed', error && error.code, error && error.message);
    throw error;
  }
}

/** Termine une éventuelle redirection de connexion. */
export async function resolveRedirectSignIn() {
  try {
    const result = await getRedirectResult(auth);
    console.log('[firebase] getRedirectResult', result ? (result.user ? result.user.email : 'no-user') : null);
    return result;
  } catch (error) {
    console.error('[firebase] getRedirectResult error', error && error.code, error && error.message);
    throw error;
  }
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signOutUser() {
  await signOut(auth);
}

/* --------------------------------------------------------------------------
   Profil et grille (Firestore)
   -------------------------------------------------------------------------- */

export async function saveUserProfile(user) {
  if (!user) return;
  const ref = doc(db, 'users', user.uid);
  await setDoc(
    ref,
    {
      displayName: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
      lastLoginAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** @returns {Promise<{version?: number, items?: Array}|null>} */
export async function loadGridFromCloud(uid) {
  if (!uid) return null;
  const snapshot = await getDoc(doc(db, 'users', uid, 'settings', 'grid'));
  if (!snapshot.exists()) return null;
  return snapshot.data();
}

export async function saveGridToCloud(uid, grid) {
  if (!uid || !grid) return;
  await setDoc(doc(db, 'users', uid, 'settings', 'grid'), {
    version: grid.version || 1,
    items: grid.items || [],
    updatedAt: serverTimestamp(),
  });
}

/**
 * Écoute les modifications de la grille (synchronisation multi-appareils).
 * @param {string} uid
 * @param {(data: {items: Array, version?: number, pending: boolean}) => void} onData
 * @param {(error: Error) => void} [onError]
 */
export function subscribeGrid(uid, onData, onError) {
  if (!uid) return () => {};
  return onSnapshot(
    doc(db, 'users', uid, 'settings', 'grid'),
    (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data() || {};
      onData({
        version: data.version || 1,
        items: Array.isArray(data.items) ? data.items : [],
        pending: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      if (typeof onError === 'function') onError(error);
    }
  );
}

/* --------------------------------------------------------------------------
   Messages d'erreur en français
   -------------------------------------------------------------------------- */

export function friendlyAuthError(error) {
  const code = (error && error.code) || '';

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'La fenêtre de connexion a été fermée avant la fin. Réessayez quand vous le souhaitez.';
    case 'auth/cancelled-popup-request':
      return 'Une autre connexion est déjà en cours. Patientez quelques instants.';
    case 'auth/popup-blocked':
      return 'Votre navigateur a bloqué la fenêtre de connexion. Autorisez les fenêtres surgissantes puis réessayez.';
    case 'auth/redirect-cancelled-by-user':
      return 'La connexion a été interrompue avant la fin. Réessayez quand vous le souhaitez.';
    case 'auth/redirect-operation-pending':
      return 'Une connexion est déjà en cours. Patientez quelques secondes puis réessayez.';
    case 'auth/web-storage-unsupported':
      return "Votre navigateur bloque le stockage local nécessaire à la connexion. Autorisez les cookies et le stockage pour ce site, puis réessayez.";
    case 'auth/network-request-failed':
      return 'Impossible de joindre le service de connexion. Vérifiez votre connexion réseau puis réessayez.';
    case 'auth/unauthorized-domain':
      return "Ce domaine n'est pas autorisé dans Firebase Authentication. Ajoutez l'adresse du site dans les domaines autorisés.";
    case 'auth/operation-not-supported-in-this-environment':
      return "La connexion Google n'est pas disponible dans ce contexte. Ouvrez l'application dans un navigateur classique.";
    case 'auth/account-exists-with-different-credential':
      return 'Un compte existe déjà avec une autre méthode de connexion pour cette adresse.';
    case 'auth/too-many-requests':
      return 'Trop de tentatives de connexion. Patientez quelques minutes avant de réessayer.';
    case 'auth/user-disabled':
      return 'Ce compte a été désactivé. Contactez un administrateur.';
    case 'auth/internal-error':
      return 'Le service de connexion a rencontré une erreur interne. Réessayez dans un instant.';
    case 'auth/invalid-api-key':
      return "La clé d'API Firebase est incorrecte. Vérifiez la configuration du projet.";
    case 'auth/app-not-authorized':
      return "Cette application n'est pas autorisée à utiliser Firebase Authentication.";
    default:
      if (error && error.message) {
        return `La connexion a échoué (${error.message}).`;
      }
      return 'La connexion a échoué. Réessayez dans un instant.';
  }
}

export function friendlyFirestoreError(error) {
  const code = (error && error.code) || '';
  if (code === 'permission-denied') {
    return "Accès refusé par les règles Firestore. Vérifiez que votre compte est bien autorisé.";
  }
  if (code === 'unavailable') {
    return 'Cloud Firestore est momentanément indisponible.';
  }
  if (code === 'failed-precondition') {
    return 'La base Firestore doit être initialisée dans la console Firebase.';
  }
  return 'La synchronisation avec Cloud Firestore a échoué.';
}
