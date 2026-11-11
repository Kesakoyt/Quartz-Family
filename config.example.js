/**
 * Quartz Family — modèle de configuration.
 *
 * 1. Copiez ce fichier en `config.js` (même dossier).
 * 2. Renseignez la configuration Firebase.
 * 3. Ne committez jamais `config.js` : il est ignoré par Git.
 *
 * Ce fichier est chargé en script classique avant l'application : il expose
 * la configuration via `window.QUARTZ_CONFIG`.
 */

const firebaseConfig = {
  apiKey: "AIzaSyDCO2HXhRSiDgBp2zKirr6msJTX4Pt4Vyg",
  authDomain: "quartz-family.firebaseapp.com",
  projectId: "quartz-family",
  storageBucket: "quartz-family.firebasestorage.app",
  messagingSenderId: "846072062010",
  appId: "1:846072062010:web:65dd2643f7bc3470459503"
};

window.QUARTZ_CONFIG = {
  firebaseConfig,

  // Seuls les comptes de ce domaine Google Workspace sont autorisés.
  allowedDomain: "kesako.org",

  // Adresses autorisées à gérer le catalogue de films (ajout, modification,
  // suppression). Ce miroir doit rester cohérent avec `isFilmAdmin`
  // dans firestore.rules.
  adminEmails: ["admin@kesako.org"],

  // Affiché dans Réglages → À propos (facultatif).
  repositoryUrl: "https://github.com/kesako/quartz-family"
};
