# goxlr-streamlabs-sync

**Contrôle tes pistes audio séparées dans Streamlabs avec les faders physiques de ton GoXLR.**

🇬🇧 [English version](README.md)

Le GoXLR n'expose qu'UN seul périphérique de capture mixé à Windows (*Broadcast Stream Mix*) : ton stream/enregistrement reçoit tout mélangé, impossible de retravailler la voix, le jeu et la musique séparément au montage. L'astuce connue consiste à capturer chaque périphérique de lecture GoXLR (Game, Music, Chat, System) comme source *Capture de sortie audio* dans Streamlabs Desktop et à les enregistrer sur des pistes séparées. Problème : ces captures sont prises **avant** le mixage matériel du GoXLR — tes faders et boutons mute n'ont plus aucun effet dessus.

Cet outil corrige ça : il écoute l'API websocket du [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) et réplique en temps réel chaque mouvement de fader et chaque mute sur tes sources audio Streamlabs Desktop, via l'API JSON-RPC de Streamlabs.

```
GoXLR ──USB──> daemon GoXLR Utility ──websocket──> goxlr-streamlabs-sync ──JSON-RPC──> Streamlabs Desktop
```

Des outils équivalents existent pour OBS Studio ([goxlr-obs-fader-sync](https://github.com/FrostyCoolSlug/goxlr-obs-fader-sync), [obs-goxlr-fader-sync-plugin](https://github.com/parzival-space/obs-goxlr-fader-sync-plugin)) — celui-ci est pour **Streamlabs Desktop**.

## Fonctionnalités

- Sync du volume en temps réel : fader GoXLR (0-255) → slider de volume Streamlabs
- Sync des mutes avec logique "stream" : la source n'est mutée que si le mute GoXLR affecte réellement le stream (configurable)
- Chaque canal GoXLR peut être mappé vers une ou plusieurs sources Streamlabs
- Compatible GoXLR Full et Mini, multi-appareils
- Zéro dépendance npm, un seul petit process Node.js, reconnexion automatique des deux côtés
- Dashboard web local (volumes en direct, mutes, logs) + lanceur sans fenêtre — rien qui traîne dans ta barre des tâches
- Mode `--list` pour découvrir tes canaux et les noms exacts de tes sources
- Mode `--dry-run` pour tester sans risque

## Prérequis

- Windows avec [Node.js 22+](https://nodejs.org/)
- [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) en fonctionnement (le remplaçant non-officiel de l'app GoXLR)
- Streamlabs Desktop

## Installation

```
git clone https://github.com/YOUR_USER/goxlr-streamlabs-sync.git
cd goxlr-streamlabs-sync
```

(ou télécharge le ZIP depuis GitHub et décompresse-le — rien à compiler, pas de `npm install`)

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

```
copy config.example.json config.json
```

Édite `config.json` — mappe les canaux GoXLR vers les noms **exacts** de tes sources :

```json
{
  "sync": {
    "mappings": [
      { "channel": "Mic",    "source": "Mic (GoXLR)" },
      { "channel": "Music",  "source": "Music (GoXLR)" },
      { "channel": "Game",   "source": "Game (GoXLR)" },
      { "channel": "System", "source": "System (GoXLR)" },
      { "channel": "Chat",   "source": "Chat (GoXLR)" }
    ]
  }
}
```

Canaux valides : `Mic`, `LineIn`, `Console`, `System`, `Game`, `Chat`, `Sample`, `Music`, `Headphones`, `MicMonitor`, `LineOut`.

Pas sûr des noms ? Lance :

```
node src/index.js --list
```

Ça affiche tes canaux GoXLR (avec les volumes en direct) et le nom de chaque source audio Streamlabs.

### 3. Lancer

**Recommandé (aucune fenêtre) :** double-clique sur **`start-hidden.vbs`** — la sync tourne silencieusement en arrière-plan et le dashboard s'ouvre dans ton navigateur. Re-double-cliquer rouvre juste le dashboard (instance unique). Pour arrêter : `stop.bat` ou le bouton *Quitter* du dashboard.

**Avec une console :** double-clique sur `start.bat`, ou `npm start`.

Bouge un fader sur le GoXLR — le slider Streamlabs correspondant suit. 🎚️

Pour le lancer automatiquement avec Windows : `Win+R`, tape `shell:startup`, et dépose un raccourci vers `start-hidden.vbs` dans ce dossier.

### Le dashboard

L'outil sert une petite page web locale (aucun service externe, aucune dépendance) : état des deux connexions, volumes des canaux en temps réel, mutes, sources mappées et logs récents — plus un bouton *Quitter*. Adresse par défaut : **http://127.0.0.1:14571**. Mets `ui.host` à `"0.0.0.0"` pour y accéder depuis un autre appareil de ton réseau. Fermer l'onglet n'arrête jamais la sync.

## Connexion à Streamlabs : pipe ou websocket

Par défaut (`"transport": "auto"`), l'outil se connecte via le **named pipe** local de Streamlabs (`\\.\pipe\slobs`) — aucune configuration.

**Particularité connue de Streamlabs :** le listener du pipe est à usage unique. Si un client se déconnecte (ex. tu arrêtes l'outil), Streamlabs ne recrée pas le pipe avant son redémarrage. Si tu relances la sync alors que Streamlabs est resté ouvert, le pipe sera indisponible. Deux options :

- redémarrer Streamlabs Desktop, ou
- configurer un **token** pour basculer sur le websocket : dans Streamlabs, *Paramètres → Remote Control*, clique sur le QR code, *Show details*, copie le token API dans `streamlabs.token` du `config.json`.

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
| `sync.syncOnConnect` | `true` | Pousse l'état complet du GoXLR vers Streamlabs à la (re)connexion |
| `sync.mappings[]` | — | `{ channel, source, syncVolume?, syncMute? }` |
| `ui.enabled` | `true` | Sert le dashboard web local |
| `ui.host` | `127.0.0.1` | Adresse d'écoute du dashboard (`0.0.0.0` pour l'accès LAN) |
| `ui.port` | `14571` | Port du dashboard (sert aussi de verrou d'instance unique) |
| `ui.openBrowser` | `false` | Ouvre le dashboard au démarrage (le flag `--open` fait pareil) |

### Modes de mute

Le bouton mute du GoXLR peut cibler différentes sorties (mute vers All / Stream / Voice Chat / Phones / Line Out — et l'appui long mute partout).

- `follow_stream` (défaut) : la source Streamlabs n'est mutée que si le mute GoXLR affecte le mix du stream (`MutedToAll`, ou `MutedToX` avec cible `All`/`ToStream`). Un mute "vers le casque" ne mutera pas ton enregistrement — c'est généralement ce qu'on veut.
- `any` : n'importe quel état de mute sur le canal mute la source.
- `off` : ne touche jamais aux mutes.

Le **bouton cough** du micro est géré aussi (compté comme un mute du canal `Mic`).

## Limitations

- Sync à sens unique (GoXLR → Streamlabs). Bouger un slider dans Streamlabs ne bouge pas le fader motorisé.
- Les **submixes** GoXLR ne sont pas encore gérés — c'est le volume principal du canal qui est utilisé.
- Les canaux sans fader assigné synchronisent quand même leur volume (changé via l'interface de l'Utility), mais n'ont pas de bouton mute à synchroniser.

## Dépannage

- **`GoXLR Utility unreachable`** — vérifie que le daemon [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) tourne (icône dans la zone de notification). L'app officielle GoXLR ne doit pas tourner en même temps.
- **`Cannot reach Streamlabs Desktop`** — Streamlabs n'est pas lancé, ou son pipe est mort (voir [pipe ou websocket](#connexion-à-streamlabs--pipe-ou-websocket)).
- **`Sources not found in Streamlabs`** — les noms `source` du `config.json` doivent correspondre exactement aux noms des sources Streamlabs (sensible à la casse). Lance `node src/index.js --list`.
- Lance avec `--verbose` pour voir chaque patch et appel API, et `--dry-run` pour tester sans toucher à Streamlabs.

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

- [GoXLR-on-Linux / goxlr-utility](https://github.com/GoXLR-on-Linux/goxlr-utility) — le projet communautaire qui rend tout ça possible
- Inspiré par [goxlr-obs-fader-sync](https://github.com/FrostyCoolSlug/goxlr-obs-fader-sync) et [obs-goxlr-fader-sync-plugin](https://github.com/parzival-space/obs-goxlr-fader-sync-plugin) (équivalents OBS Studio)

## Licence

[MIT](LICENSE)
