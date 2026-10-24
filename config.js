/**
 * Configuration locale — NE PAS COMMITTER.
 * Copiez `config.example.js` puis complétez `googleClientId`.
 */
const firebaseConfig = {
  apiKey: "AIzaSyDCO2HXhRSiDgBp2zKirr6msJTX4Pt4Vyg",
  authDomain: "quartz-family.firebaseapp.com",
  projectId: "quartz-family",
  storageBucket: "quartz-family.firebasestorage.app",
  messagingSenderId: "846072062010",
  appId: "1:846072062010:web:65dd2643f7bc3470459503"
};

const googleClientId = "";

window.QUARTZ_CONFIG = {
  firebaseConfig,
  googleClientId,
  allowedDomain: "kesako.org",
  repositoryUrl: "https://github.com/kesako/quartz-family"
};
