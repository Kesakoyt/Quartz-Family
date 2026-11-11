# Quartz Family

Le tableau de bord de l'organisation et un accès direct à Google Drive, réunis dans une application web installable, rapide et élégante.

Quartz Family est une **PWA statique** en HTML, CSS et JavaScript natif (modules ES6), sans framework ni étape de build. Elle reprend les codes de **Windows 11 Fluent Design** : effets acryliques, coins arrondis, ombres douces, thèmes clair/sombre/système et transitions fluides.

- **Tableau de bord** — grille de raccourcis personnalisables (ajout, modification, réorganisation par glisser-déposer ou flèches, suppression), synchronisée entre appareils.
- **Barre latérale** — navigation (Accueil, Drive, Films, Réglages) et raccourcis de l'utilisateur, suivis en temps réel depuis la grille ; remplacée par une barre inférieure sur mobile.
- **Films** — vidéothèque familiale type Plex : les administrateurs ajoutent des films avec leur lien Google Drive, une affiche, une année et une description ; les autres membres peuvent suggérer des films que les administrateurs valident ou refusent. La liste des administrateurs vit dans Firestore (`config/films-admins`) et se gère depuis l'application (Films → Administrateurs).
- **Drive** — lien direct vers [Google Drive](https://drive.google.com/) (drive.google.com), ouvert dans un nouvel onglet depuis la barre latérale et la grille d'accueil.
- **Réglages** — profil Google, thème, état de synchronisation, installation, réinitialisation de la grille, informations et crédits.
- **Accès restreint** — authentification Google réservée aux comptes `@kesako.org`, côté client **et** via les règles Firestore.
- **Hors ligne** — service worker, cache applicatif et cache local de la grille ; les modifications sont synchronisées au retour du réseau.

---

## Sommaire

- [Aperçu technique](#aperçu-technique)
- [Démarrage local](#démarrage-local)
- [Configuration Firebase](#configuration-firebase)
- [Règles Firestore](#règles-firestore)
- [Déploiement sur GitHub Pages](#déploiement-sur-github-pages)
- [Installation de la PWA](#installation-de-la-pwa)
- [Structure du projet](#structure-du-projet)
- [Sécurité et données](#sécurité-et-données)
- [Dépannage](#dépannage)
- [Crédits et licence](#crédits-et-licence)

---

## Aperçu technique

| Élément | Choix |
| --- | --- |
| Interface | HTML5, CSS3, JavaScript ES6 natif — aucun framework |
| Authentification | Firebase Authentication, fournisseur Google |
| Données | Cloud Firestore : `users/{uid}/settings/grid`, collections partagées `films`, `film-suggestions` et `config/films-admins` |
| Fichiers | Lien direct vers Google Drive (aucun accès aux fichiers) |
| Hors ligne | Service worker + `localStorage` + cache persistant Firestore |
| Hébergement | GitHub Pages (site statique) |
| Langue | Français |

Le SDK Firebase **v10.14.1 est embarqué** dans `vendor/firebase/` : aucun CDN n'est nécessaire au chargement de l'application, ce qui améliore la fiabilité et le fonctionnement hors ligne.

### Routage

L'application utilise le routage par hash, compatible avec GitHub Pages sans réécriture côté serveur :

| Route | Vue |
| --- | --- |
| `#/` | Tableau de bord |
| `#/films` | Films (catalogue familial et suggestions) |
| `#/settings` | Réglages |

Le lien « Drive » de la barre latérale et de la grille d'accueil pointe directement vers `https://drive.google.com/` (ouverture dans un nouvel onglet, sans vue interne).

---

## Démarrage local

Prérequis : [Node.js](https://nodejs.org/) ou Python, et un navigateur moderne.

```bash
git clone https://github.com/kesako/quartz-family.git
cd quartz-family

# 1. Créer la configuration locale
cp config.example.js config.js
```

Renseignez ensuite `config.js` :

```js
window.QUARTZ_CONFIG = {
  firebaseConfig: {
    apiKey: "…",
    authDomain: "quartz-family.firebaseapp.com",
    projectId: "quartz-family",
    storageBucket: "quartz-family.firebasestorage.app",
    messagingSenderId: "…",
    appId: "…"
  },
  allowedDomain: "kesako.org",
  repositoryUrl: "https://github.com/kesako/quartz-family"
};
```

> `config.js` est **ignoré par Git**. Ne le committez jamais : chaque environnement (local, production) génère le sien.
>
> Les administrateurs de la vidéothèque Films ne se configurent **pas** ici : leur liste vit dans Firestore (document `config/films-admins`), voir [Règles Firestore](#règles-firestore).

Lancez un serveur statique — l'ouverture directe en `file://` ne fonctionne pas avec les modules ES et le service worker :

```bash
npx serve .
# ou
python -m http.server 8080
```

Ouvrez ensuite `http://localhost:8080`.

**Astuce développement :** dans les DevTools → Application → Service Workers, cochez « Update on reload » ou désinscrivez le service worker pour éviter de servir une ancienne version des fichiers.

---

## Configuration Firebase

1. Créez un projet dans la [console Firebase](https://console.firebase.google.com/) (ou utilisez `quartz-family`).
2. Ajoutez une **application Web** (paramètres du projet → Vos applications).
3. Copiez les valeurs de `firebaseConfig` dans `config.js` ou dans les variables du dépôt (voir [déploiement](#déploiement-sur-github-pages)).
4. Dans **Authentication → Sign-in method**, activez le fournisseur **Google**.
5. Dans **Authentication → Settings → Authorized domains**, ajoutez :
   - `localhost` (développement) ;
   - `<votre-compte>.github.io` (GitHub Pages) ;
   - votre éventuel domaine personnalisé.
6. Dans **Firestore Database**, créez une base en mode production, puis déployez les règles ci-dessous.

Le champ `hd: 'kesako.org'` est transmis au fournisseur Google pour proposer les comptes du domaine, mais **ce n'est pas une sécurité** : l'application vérifie elle-même l'adresse et déconnecte immédiatement tout compte hors domaine. Les règles Firestore appliquent la même restriction côté serveur.

---

## Règles Firestore

Le fichier [`firestore.rules`](./firestore.rules) autorise chaque membre à accéder **uniquement à ses propres documents**, et uniquement avec une adresse vérifiée du domaine autorisé :

```text
users/{uid}                     → profil
users/{uid}/settings/grid       → grille du tableau de bord
config/films-admins             → administrateurs de la vidéothèque (lecture : membres, écriture : administrateurs)
films/{filmId}                  → catalogue de films (lecture : tous les membres, écriture : administrateurs)
film-suggestions/{id}           → suggestions de films (création : tous, suppression : admin ou auteur)
```

### Administrateurs des films

La liste des administrateurs vit **uniquement dans Firestore** — aucune adresse n'est inscrite dans le code, la configuration déployée ni ce dépôt. Les règles la lisent en direct :

```text
config/films-admins → { emails: ["pierre.cebrian@kesako.org"] }
```

**Initialisation (une seule fois, dans la console Firebase)** :

1. **Firestore Database** → **Démarrer une collection** → ID de collection : `config`.
2. ID du document : `films-admins`.
3. Champ : `emails` (type **array**) → ajoutez la première adresse, par ex. `pierre.cebrian@kesako.org`.
4. Ne stockez **que** ce champ `emails` (le reste est écrit par l'application).

Ensuite, tout se gère depuis l'application : **Films → Administrateurs** — un administrateur ajoute ou retire d'autres adresses (`@kesako.org` uniquement). Un administrateur ne peut pas se retirer lui-même de la liste (les règles Firestore l'interdisent aussi), pour éviter tout verrouillage de la vidéothèque.

Déploiement avec la CLI Firebase :

```bash
npm install -g firebase-tools
firebase login
firebase use quartz-family
firebase deploy --only firestore:rules
```

Ou copiez le contenu de `firestore.rules` dans **Firestore → Règles** dans la console Firebase.

> Si les règles ne sont pas déployées, l'application affiche une erreur de synchronisation (`permission-denied`) et conserve la grille en cache local.

---

## Déploiement sur GitHub Pages

Le workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) publie automatiquement le site à chaque push sur `main`.

### 1. Activer GitHub Pages

Dans le dépôt : **Settings → Pages → Build and deployment → Source : GitHub Actions**.

### 2. Ajouter les variables du dépôt

Dans **Settings → Secrets and variables → Actions → Variables**, ajoutez :

| Variable | Obligatoire | Exemple |
| --- | --- | --- |
| `FIREBASE_API_KEY` | oui | `AIza…` |
| `FIREBASE_PROJECT_ID` | oui | `quartz-family` |
| `FIREBASE_APP_ID` | oui | `1:846072062010:web:…` |
| `FIREBASE_AUTH_DOMAIN` | non | `quartz-family.firebaseapp.com` |
| `FIREBASE_STORAGE_BUCKET` | non | `quartz-family.firebasestorage.app` |
| `FIREBASE_MESSAGING_SENDER_ID` | non | `846072062010` |
| `ALLOWED_DOMAIN` | non | `kesako.org` |
| `REPOSITORY_URL` | non | URL du dépôt affichée dans l'application |

Le workflow génère `config.js` au moment du déploiement. Aucun secret n'est stocké dans le dépôt ; les valeurs Firebase (clé d'API Web, identifiants de projet) sont des identifiants publics, protégés par les règles Firestore et les domaines autorisés.

### 3. Déployer

```bash
git add .
git commit -m "Quartz Family"
git push origin main
```

Le site est publié sur `https://<compte>.github.io/quartz-family/`. Ajoutez cette origine dans Firebase Authentication.

> Si vous préférez un déploiement manuel, publiez le contenu du dépôt sur une branche `gh-pages` en veillant à inclure un `config.js` généré. Le fichier `.nojekyll` est présent pour éviter le traitement Jekyll.

---

## Installation de la PWA

- **Chrome / Edge (Windows)** : icône d'installation dans la barre d'adresse, ou **Réglages → Application → Installer**.
- **Android** : menu du navigateur → « Installer l'application ».
- **iOS / iPadOS** : Safari → Partager → « Sur l'écran d'accueil ».

Le manifeste déclare le mode `standalone`, les icônes (dont maskable), les raccourcis Films et Réglages, ainsi que les métadonnées iOS. Une fois installée, l'application démarre hors ligne et se met à jour via une notification « Mise à jour disponible ».

---

## Structure du projet

```text
.
├── index.html                  # Coque HTML, thème pré-rendu, chargement de config.js
├── manifest.json               # Manifeste PWA (icônes, raccourcis, standalone)
├── sw.js                       # Service worker (précache, offline, mises à jour)
├── config.example.js           # Modèle de configuration à copier en config.js
├── config.js                   # Configuration locale (ignorée par Git)
├── firestore.rules             # Règles de sécurité Firestore
├── firebase.json               # Configuration de déploiement des règles
├── css/
│   └── app.css                 # Design system Fluent, thèmes, composants, responsive
├── js/
│   ├── app.js                  # Amorçage, auth, coque, routage, service worker
│   ├── store.js                # Configuration, thème, état, grille, cache local
│   ├── firebase.js             # Auth Google, Firestore, messages d'erreur
│   ├── grid.js                 # Synchronisation de la grille (cache + Firestore)
│   ├── films.js                # Catalogue de films et suggestions (temps réel)
│   ├── install.js              # Invite d'installation PWA
│   ├── ui.js                   # Icônes, DOM, modales, toasts, formats
│   └── views/
│       ├── login.js            # Écran de connexion
│       ├── dashboard.js        # Tableau de bord et édition des raccourcis
│       ├── films.js            # Vidéothèque familiale (catalogue + suggestions)
│       └── settings.js         # Réglages
├── icons/                      # Logo et icônes PWA générées
├── vendor/firebase/            # SDK Firebase v10.14.1 embarqué
└── .github/workflows/deploy.yml# Déploiement GitHub Pages
```

---

## Sécurité et données

- **Domaine** : seules les adresses `@kesako.org` sont acceptées. Un compte hors domaine est déconnecté immédiatement avec un message explicite, et les règles Firestore refusent toute lecture/écriture.
- **Isolation** : chaque utilisateur n'accède qu'à `users/{son_uid}` et à ses sous-collections.
- **Films** : le catalogue et les suggestions sont partagés entre membres. La liste des administrateurs vit dans le document `config/films-admins` (jamais dans le code déployé) ; seules ces adresses peuvent modifier le catalogue, et un administrateur ne peut pas se retirer lui-même. Une suggestion n'est attribuable qu'à son auteur.
- **Drive** : simple lien externe vers `drive.google.com` — l'application ne demande aucune autorisation Drive et n'accède à aucun fichier.
- **Secrets** : `config.js` est ignoré par Git et généré à la volée en production. La clé d'API Firebase Web n'est pas un secret serveur ; sa portée est limitée par les règles Firestore et les domaines autorisés.
- **Données** : aucune donnée n'est revendue ni transmise à des tiers en dehors de Firebase/Google, nécessaires au fonctionnement.
- **Hors ligne** : le cache local (`localStorage`, cache Firestore) peut contenir la grille et le profil. Utilisez « Se déconnecter » sur un appareil partagé.

Pour aller plus loin, vous pouvez restreindre l'écran de consentement OAuth au type « Interne » du Workspace et limiter l'utilisation de la clé d'API Firebase par domaine dans Google Cloud Console.

---

## Dépannage

| Symptôme | Piste |
| --- | --- |
| « Configuration requise » au démarrage | `config.js` absent ou incomplet. Copiez `config.example.js` et renseignez Firebase. |
| `auth/unauthorized-domain` | Ajoutez le domaine du site dans Firebase Authentication → Authorized domains. |
| `permission-denied` dans la console | Les règles Firestore ne sont pas déployées ou l'adresse n'est pas `@kesako.org`. |
| « Accès refusé » lors d'un ajout de film | Votre adresse n'est pas dans le document Firestore `config/films-admins` (liste des administrateurs). Un administrateur peut vous l'ajouter depuis Films → Administrateurs. |
| Le lien Drive n'ouvre rien | Vérifiez que votre navigateur autorise les onglets/popups pour ce site, puis ouvrez directement `https://drive.google.com/`. |
| Ancienne version affichée | Rechargez avec `Ctrl+F5`, ou acceptez la notification de mise à jour. |
| L'application ne s'installe pas | Vérifiez HTTPS, `manifest.json`, le service worker et utilisez Chrome/Edge. |

Les erreurs détaillées sont disponibles dans la console du navigateur (F12).

---

## Crédits et licence

- Icônes : [Icons8 Fluency](https://icons8.com/) — licence gratuite avec attribution.
- Authentification et base de données : [Firebase](https://firebase.google.com/).
- Fichiers : [Google Drive](https://drive.google.com/).
- Hébergement : [GitHub Pages](https://pages.github.com/).

Produit non affilié à Google. « Google Drive », « Google Workspace » et les logos associés sont des marques de Google LLC.

Code distribué sous [licence MIT](./LICENSE).
