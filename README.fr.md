# goxlr-streamlabs-sync

**Contrôle tes pistes audio séparées dans Streamlabs avec les faders physiques de ton GoXLR.**

🇬🇧 [English version](README.md)

Le GoXLR n'expose qu'UN seul périphérique de capture mixé à Windows (*Broadcast Stream Mix*) : ton stream/enregistrement reçoit tout mélangé, impossible de retravailler la voix, le jeu et la musique séparément au montage. L'astuce connue consiste à capturer chaque périphérique de lecture GoXLR (Game, Music, Chat, System) comme source *Capture de sortie audio* dans Streamlabs Desktop et à les enregistrer sur des pistes séparées. Problème : ces captures sont prises **avant** le mixage matériel du GoXLR - tes faders et boutons mute n'ont plus aucun effet dessus.

Cet outil corrige ça : il écoute l'API websocket du [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) et réplique en temps réel chaque mouvement de fader et chaque mute sur tes sources audio Streamlabs Desktop, via l'API JSON-RPC de Streamlabs.

```
GoXLR ──USB──> daemon GoXLR Utility ──websocket──> goxlr-streamlabs-sync ──JSON-RPC──> Streamlabs Desktop
```

Des outils équivalents existent pour OBS Studio ([goxlr-obs-fader-sync](https://github.com/FrostyCoolSlug/goxlr-obs-fader-sync), [obs-goxlr-fader-sync-plugin](https://github.com/parzival-space/obs-goxlr-fader-sync-plugin)) - celui-ci est pour **Streamlabs Desktop**.

## Fonctionnalités

- Sync du volume en temps réel : fader GoXLR (0-255) → slider de volume Streamlabs
- **Bidirectionnelle** : bouger un slider Streamlabs pilote le GoXLR en retour (les faders motorisés bougent), avec suppression d'écho pour que les deux côtés ne se battent jamais
- **Compatible submixes** : quand le Broadcast Mix écoute le Mix B, les volumes submix sont utilisés dans les deux sens (badge MIX B dans le dashboard)
- Sync des mutes avec logique "stream" : la source n'est mutée que si le mute GoXLR affecte réellement le stream (configurable)
- Badges MUTE cliquables sur les strips du dashboard : coupe la source Streamlabs de n'importe quel canal mappé, même sans fader physique
- Jeux de mappings dédiés par **profil GoXLR** : charge un profil sur la carte, les mappings correspondants s'appliquent automatiquement
- Badges LIVE / REC alimentés par Streamlabs, avec confirmation renforcée si tu quittes pendant un live
- Télécommande téléphone : active *Accès réseau local* dans les réglages et ouvre le dashboard depuis n'importe quel appareil du réseau
- Notifications Windows natives (mise à jour disponible, connexion perdue) et rapport de diagnostic en un clic pour les issues
- **Snapshots de mix avec fondu** : enregistre des mixes nommés et rappelle-les d'un tap, les faders motorisés glissent en position
- **Scènes automatiques** : passer sur une scène Streamlabs applique le mix associé tout seul
- **PIN** optionnel protégeant l'accès réseau (jamais demandé sur le PC ; les appareils distants sont mémorisés)
- Chaque canal GoXLR peut être mappé vers une ou plusieurs sources Streamlabs
- Compatible GoXLR Full et Mini, multi-appareils
- Zéro dépendance npm, un seul petit process Node.js, reconnexion automatique des deux côtés
- Dashboard web local (volumes en direct, mutes, logs) et **icône dans la zone de notification** - rien qui traîne dans ta barre des tâches
- **Tout se configure depuis le dashboard** : éditeur de mappings (qui propose tes sources Streamlabs en direct), comportement des mutes, interrupteur *Démarrer avec Windows* - appliqué instantanément, sans redémarrage
- **`.exe` autonome** disponible (aucune installation de Node.js), compilé en toute transparence par GitHub Actions
- Notification de mise à jour (vérifie les releases GitHub une fois par jour, désactivable)
- Mode `--list` pour découvrir tes canaux et les noms exacts de tes sources
- Mode `--dry-run` pour tester sans risque

## Prérequis

- Windows avec [Node.js 22+](https://nodejs.org/)
- [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) en fonctionnement (le remplaçant non-officiel de l'app GoXLR)
- Streamlabs Desktop

## Installation

### Option A - exécutable autonome (le plus simple)

Télécharge `goxlr-streamlabs-sync.exe` depuis la [page Releases](../../releases), mets-le dans un dossier à lui, et lance-le. Au premier lancement il crée un `config.json` à côté de l'exe - édite les mappings, relance, c'est fini. Aucune installation de Node.js.

> **À propos de Windows SmartScreen :** l'exe n'est pas signé numériquement (les certificats coûtent cher pour un outil communautaire gratuit), donc le premier lancement peut afficher *« Windows a protégé votre ordinateur »* → clique *Informations complémentaires* → *Exécuter quand même*. Chaque release est compilée **en toute transparence depuis le code source de ce dépôt** par GitHub Actions, avec le hash SHA256 publié à côté (`SHA256SUMS.txt`). En cas de doute, audite le code et compile-le toi-même (Option C).

### Option B - depuis les sources

```
git clone https://github.com/Corail44/goxlr-streamlabs-sync.git
cd goxlr-streamlabs-sync
```

Nécessite [Node.js 22+](https://nodejs.org/). Rien à compiler, pas de `npm install`.

### Option C - compiler l'exe toi-même

```
npm install
npm run build:exe        ->  build/goxlr-streamlabs-sync.exe
```

## Mise en place

### 1. Créer les sources de capture séparées dans Streamlabs

Pour chaque sous-périphérique GoXLR voulu comme piste séparée, ajoute une source dans Streamlabs Desktop :

| Source Streamlabs (nom suggéré) | Type de source           | Périphérique Windows        |
| ------------------------------- | ------------------------ | --------------------------- |
| `Mic (GoXLR)`                   | Capture d'entrée audio   | Chat Mic (TC-Helicon GoXLR) |
| `Game (GoXLR)`                  | Capture de sortie audio  | Game (TC-Helicon GoXLR)     |
| `Music (GoXLR)`                 | Capture de sortie audio  | Music (TC-Helicon GoXLR)    |
| `Chat (GoXLR)`                  | Capture de sortie audio  | Chat (TC-Helicon GoXLR)     |
| `System (GoXLR)`                | Capture de sortie audio  | System (TC-Helicon GoXLR)   |

Puis dans **Paramètres → Sortie (mode Avancé) → Enregistrement** : passe le format en MKV ou MP4 et active jusqu'à 6 pistes audio. Dans les **paramètres audio avancés** (roue crantée du Mixeur), assigne chaque source à sa piste : garde la capture du *Broadcast Stream Mix* sur la piste 1 uniquement (c'est ce qui part en live), et mets les sources séparées sur les pistes 2 à 6 (enregistrement seulement). Règle l'audio en 48 kHz (fréquence du GoXLR).

### 2. Configurer la sync

**Le plus simple :** ouvre le dashboard (http://127.0.0.1:14571), clique sur **Réglages**, puis associe chaque canal GoXLR à une source Streamlabs (le champ propose tes sources en direct), choisis le comportement des mutes, active *Démarrer avec Windows* si tu veux et colle ton token API Streamlabs, puis **Enregistrer**. C'est appliqué instantanément, sans redémarrage.

**Par fichier :** édite `config.json` (pars de `config.example.json`) :

```json
{
  "sync": {
    "mappings": [
      { "channel": "Mic",    "source": "Mic (GoXLR)" },
      { "channel": "Music",  "source": "Music (GoXLR)" },
      { "channel": "Game",   "source": "Game (GoXLR)" }
    ]
  }
}
```

Canaux valides : `Mic`, `LineIn`, `Console`, `System`, `Game`, `Chat`, `Sample`, `Music`, `Headphones`, `MicMonitor`, `LineOut`. Lance `node src/index.js --list` pour afficher tes canaux GoXLR et le nom de chaque source Streamlabs.

**Où est le config.json ?** Ordre de recherche : `--config <chemin>` → `config.json` du dossier courant → à côté de l'exe / racine du projet → `%APPDATA%\goxlr-streamlabs-sync\config.json`. L'exe crée celui d'APPDATA au premier lancement : tes réglages persistent peu importe d'où l'exe est lancé.

### 3. Lancer

Une **icône apparaît dans la zone de notification** : clic droit pour *Ouvrir le dashboard* / *Quitter*, double-clic pour ouvrir le dashboard.

- **Exe autonome :** lance simplement `goxlr-streamlabs-sync.exe` - il file directement en arrière-plan (icône de notification, aucune fenêtre console). Utilise `--console` pour le garder attaché à un terminal et voir les logs.
- **Depuis les sources, sans fenêtre :** double-clique sur **`start-hidden.vbs`**.
- **Depuis les sources, avec console :** `start.bat` ou `npm start`.

Relancer alors que c'est déjà lancé rouvre simplement le dashboard (instance unique). Pour arrêter : l'icône de notification, le bouton *Quitter* du dashboard, ou `stop.bat`.

Bouge un fader sur le GoXLR - le slider Streamlabs correspondant suit. 🎚️

Pour le lancer automatiquement avec Windows : active **Démarrer avec Windows** dans les réglages du dashboard (ça enregistre la bonne commande dans `HKCU\...\Run`).

### Le dashboard

L'outil sert une petite page web locale (aucun service externe, aucune dépendance) : état des deux connexions, volumes des canaux en temps réel, mutes, sources mappées et logs récents - plus un bouton *Quitter*. Adresse par défaut : **http://127.0.0.1:14571**. Mets `ui.host` à `"0.0.0.0"` pour y accéder depuis un autre appareil de ton réseau. Fermer l'onglet n'arrête jamais la sync.

La langue de l'interface suit ton navigateur (français/anglais) et peut être forcée avec le sélecteur de langue de l'en-tête ; le choix est mémorisé par navigateur. Ajouter une langue est une petite PR : un bloc de dictionnaire dans `src/ui.html`.

## Connexion à Streamlabs : pipe ou websocket

Par défaut (`"transport": "auto"`), l'outil se connecte via le **named pipe** local de Streamlabs (`\\.\pipe\slobs`) - aucune configuration.

**Particularité connue de Streamlabs :** le listener du pipe est à usage unique. Si un client se déconnecte (ex. tu arrêtes l'outil), Streamlabs ne recrée pas le pipe avant son redémarrage. Si tu relances la sync alors que Streamlabs est resté ouvert, le pipe sera indisponible. Deux options :

- redémarrer Streamlabs Desktop, ou
- configurer un **token** pour basculer sur le websocket : dans Streamlabs, *Paramètres, Remote Control*, active **Autoriser les connexions de tiers**, puis copie le jeton d'API affiché. Colle-le dans les réglages du dashboard (un bouton *Tester* le valide en direct) ; l'adresse et le port du websocket y sont aussi modifiables, si tu as changé le port dans Streamlabs.

Avec un token configuré, `auto` essaie le pipe puis bascule tout seul sur le websocket.

## Référence de configuration

| Clé | Défaut | Description |
| --- | --- | --- |
| `goxlr.url` | `ws://127.0.0.1:14564/api/websocket` | Websocket du GoXLR Utility |
| `goxlr.serial` | `null` | Forcer un appareil précis (numéro de série) ; `null` = premier trouvé |
| `streamlabs.transport` | `auto` | `auto`, `pipe` ou `websocket` |
| `streamlabs.pipeName` | `slobs` | Nom du named pipe |
| `streamlabs.url` | `ws://127.0.0.1:59650/api` | Endpoint SockJS Streamlabs (transport websocket) |
| `streamlabs.token` | `null` | Token API (*Paramètres → Remote Control*), requis pour le websocket |
| `sync.throttleMs` | `50` | Délai mini entre deux mises à jour de volume par source |
| `sync.curveExponent` | `1.0` | `deflection = (volume/255)^exposant`. `1.0` = le slider suit la position du fader |
| `sync.muteMode` | `follow_stream` | Voir ci-dessous |
| `sync.twoWay` | `true` | Les sliders Streamlabs pilotent le GoXLR en retour (faders motorisés) |
| `sync.profiles` | `{}` | Jeux de mappings dédiés par nom de profil GoXLR (gérés depuis le dashboard) |
| `sync.snapshots` | `{}` | Snapshots de mix nommés (volumes + mutes), gérés depuis la barre Mixes |
| `sync.snapshotFadeMs` | `1200` | Durée du fondu à l'application d'un mix |
| `sync.sceneRules` | `{}` | Nom de scène Streamlabs -> mix appliqué automatiquement |
| `ui.pin` | `null` | PIN 4-8 chiffres exigé pour l'accès réseau (hors localhost) |
| `ui.notifications` | `true` | Notifications Windows (mise à jour disponible, connexion perdue) |
| `sync.syncOnConnect` | `true` | Pousse l'état complet du GoXLR vers Streamlabs à la (re)connexion |
| `sync.mappings[]` | - | `{ channel, source, syncVolume?, syncMute? }` |
| `ui.enabled` | `true` | Sert le dashboard web local |
| `ui.host` | `127.0.0.1` | Adresse d'écoute du dashboard (`0.0.0.0` pour l'accès LAN) |
| `ui.port` | `14571` | Port du dashboard (sert aussi de verrou d'instance unique) |
| `ui.openBrowser` | `false` | Ouvre le dashboard au démarrage (le flag `--open` fait pareil) |
| `ui.tray` | `true` | Affiche l'icône dans la zone de notification (Windows) |
| `updateCheck` | `true` | Vérifie une fois par jour sur GitHub si une nouvelle version existe (bannière dans le dashboard) |

### Modes de mute

Le bouton mute du GoXLR peut cibler différentes sorties (mute vers All / Stream / Voice Chat / Phones / Line Out - et l'appui long mute partout).

- `follow_stream` (défaut) : la source Streamlabs n'est mutée que si le mute GoXLR affecte le mix du stream (`MutedToAll`, ou `MutedToX` avec cible `All`/`ToStream`). Un mute "vers le casque" ne mutera pas ton enregistrement - c'est généralement ce qu'on veut.
- `any` : n'importe quel état de mute sur le canal mute la source.
- `off` : ne touche jamais aux mutes.

Le **bouton cough** du micro est géré aussi (compté comme un mute du canal `Mic`).

## Limitations

- Les mutes faits dans Streamlabs ne sont pas renvoyés vers le GoXLR (ses mutes sont par fader avec des cibles configurables, il n'existe pas de correspondance inverse fidèle). Utilise les boutons du GoXLR ou les badges MUTE du dashboard.
- Les ratios de liaison des submixes ne sont pas touchés : l'outil lit et écrit uniquement des volumes.

## Dépannage

- **`GoXLR Utility unreachable`** - vérifie que le daemon [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) tourne (icône dans la zone de notification). L'app officielle GoXLR ne doit pas tourner en même temps.
- **`Cannot reach Streamlabs Desktop`** - Streamlabs n'est pas lancé, ou son pipe est mort (voir [pipe ou websocket](#connexion-à-streamlabs--pipe-ou-websocket)).
- **`Sources not found in Streamlabs`** - les noms `source` du `config.json` doivent correspondre exactement aux noms des sources Streamlabs (sensible à la casse). Lance `node src/index.js --list`.
- Lance avec `--verbose` pour voir chaque patch et appel API, et `--dry-run` pour tester sans toucher à Streamlabs.

## API HTTP (Stream Deck, macros)

Tout ce que fait le dashboard passe par une petite API HTTP locale : n'importe quel outil capable d'envoyer une requête HTTP (plugins Stream Deck, AutoHotkey, Bitfocus Companion...) peut piloter la sync. Corps en JSON, sur `http://127.0.0.1:14571` :

| Endpoint | Corps | Effet |
| --- | --- | --- |
| `POST /api/channel-volume` | `{"channel":"Music","volume":128}` | Règle le volume d'un canal (0-255), le fader motorisé bouge |
| `POST /api/channel-mute` | `{"channel":"Music","muted":true}` | Mute/démute les sources Streamlabs mappées |
| `POST /api/snapshot` | `{"action":"apply","name":"Pause"}` | Applique un mix avec le fondu |
| `POST /api/fx` | `{"enabled":true}` ou `{"preset":"Preset3"}` | FX vocaux on/off, changement de preset |
| `POST /api/sample` | `{"bank":"A","button":"TopLeft"}` | Joue un pad du sampler (ajoute `"stop":true` pour arrêter) |
| `GET /api/state` | - | État complet en JSON |

Avec un PIN configuré, les requêtes distantes doivent porter le cookie `gss-auth=<pin>` (jamais nécessaire en localhost).

Astuce : le dashboard fonctionne aussi à travers Tailscale ou tout VPN qui atteint ton PC : ton téléphone peut piloter le mix depuis n'importe où, pas seulement ton Wi-Fi.

## Contribuer

Issues et PRs bienvenues ! Le code est volontairement petit et sans dépendance :

```
src/index.js       point d'entrée & CLI
src/goxlr.js       client websocket GoXLR Utility (miroir du status + JSON Patch)
src/streamlabs.js  client JSON-RPC Streamlabs (named pipe + websocket SockJS)
src/sync.js        moteur de mapping (throttle, courbes, logique de mute)
src/config.js      chargement & validation de la config
src/jsonpatch.js   implémentation minimale de RFC 6902
```

## Crédits

- [GoXLR-on-Linux / goxlr-utility](https://github.com/GoXLR-on-Linux/goxlr-utility) - le projet communautaire qui rend tout ça possible
- Inspiré par [goxlr-obs-fader-sync](https://github.com/FrostyCoolSlug/goxlr-obs-fader-sync) et [obs-goxlr-fader-sync-plugin](https://github.com/parzival-space/obs-goxlr-fader-sync-plugin) (équivalents OBS Studio)

## Licence

[MIT](LICENSE)
