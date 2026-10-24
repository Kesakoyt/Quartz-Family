/**
 * Quartz Family — modèle de configuration.
 *
 * 1. Copiez ce fichier en `config.js` (même dossier).
 * 2. Renseignez `googleClientId` (voir la section « Google Drive » du README).
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

/**
 * ID client OAuth 2.0 de type « Application Web », créé dans Google Cloud
 * Console pour le projet `quartz-family`. Il sert uniquement à Google
 * Identity Services pour l'accès au Drive (scope `drive.file`).
 *
 * Exemple : "846072062010-abc123.apps.googleusercontent.com"
 */
const googleClientId = "";

window.QUARTZ_CONFIG = {
  firebaseConfig,
  googleClientId,

  // Seuls les comptes de ce domaine Google Workspace sont autorisés.
  allowedDomain: "kesako.org",

  // Affiché dans Réglages → À propos (facultatif).
  repositoryUrl: "https://github.com/kesako/quartz-family"
};
