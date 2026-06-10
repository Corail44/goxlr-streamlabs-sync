# goxlr-streamlabs-sync

**Control your separated Streamlabs audio tracks with your GoXLR's physical faders.**

🇫🇷 [Version française](README.fr.md)

The GoXLR only exposes ONE mixed capture device to Windows (*Broadcast Stream Mix*), so your stream/recording gets everything baked together - impossible to edit voice, game and music separately afterwards. The well-known workaround is to capture each GoXLR playback device (Game, Music, Chat, System) as its own *Audio Output Capture* source in Streamlabs Desktop and record them on separate tracks. But those captures are taken **before** the GoXLR hardware mixing, so your faders and mute buttons stop having any effect on them.

This tool fixes that: it listens to the [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) websocket API and mirrors every fader move and mute press onto your Streamlabs Desktop audio sources in real time, through Streamlabs' JSON-RPC API.

```
GoXLR hardware ──USB──> GoXLR Utility daemon ──websocket──> goxlr-streamlabs-sync ──JSON-RPC──> Streamlabs Desktop
```

Similar tools exist for OBS Studio ([goxlr-obs-fader-sync](https://github.com/FrostyCoolSlug/goxlr-obs-fader-sync), [obs-goxlr-fader-sync-plugin](https://github.com/parzival-space/obs-goxlr-fader-sync-plugin)) - this one is for **Streamlabs Desktop**.

## Features

- Real-time volume sync: GoXLR fader (0-255) → Streamlabs source volume slider
- **Two-way**: moving a Streamlabs slider drives the GoXLR back (motorized faders move), with echo suppression so the two sides never fight
- **Submix aware**: when the Broadcast Mix listens to Mix B, submix volumes are used in both directions (a MIX B badge shows in the dashboard)
- Mute sync with stream-aware logic: only mutes the source when the GoXLR mute actually affects the stream (configurable)
- Clickable MUTE chips on the dashboard strips: mute any mapped channel's Streamlabs source, even channels without a physical fader
- Dedicated mapping sets per **GoXLR profile**: load a profile on the device and the matching mappings apply automatically
- LIVE / REC badges fed by Streamlabs, with a stronger confirmation when quitting while live
- Phone remote: enable *Local network access* in the settings and open the dashboard from any device on your network
- Native Windows notifications (update available, connection lost) and a one-click diagnostic report for bug reports
- **Mix snapshots with eased fades**: save named mixes and recall them in one tap, the motorized faders glide to position
- **Scene automation**: switching to a Streamlabs scene applies the mapped mix automatically
- Optional **PIN** protecting network access (localhost never asks; remote devices are remembered)
- Any GoXLR channel can be mapped to any number of Streamlabs sources
- Works with the GoXLR Full and GoXLR Mini, and with multiple devices
- Zero npm dependencies, single small Node.js process, auto-reconnects to both ends
- Local web dashboard (live volumes, mute states, logs) and a **system tray icon** - nothing cluttering your taskbar
- **Configure everything from the dashboard**: mappings editor (suggesting your live Streamlabs sources), mute behavior, *Start with Windows* toggle - applied instantly, no restart
- **Standalone `.exe`** available (no Node.js install needed), built transparently by GitHub Actions
- Update notifications (checks the GitHub releases once a day, can be disabled)
- `--list` mode to discover your channels and exact source names
- `--dry-run` mode to test safely

## Requirements

- Windows with [Node.js 22+](https://nodejs.org/)
- [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) running (the unofficial replacement for the official GoXLR App)
- Streamlabs Desktop

## Installation

### Option A - standalone executable (easiest)

Download `goxlr-streamlabs-sync.exe` from the [Releases page](../../releases), put it in its own folder, and run it. On first run it creates a `config.json` next to the exe - edit the mappings, run it again, done. No Node.js required.

> **About Windows SmartScreen:** the exe is not code-signed (certificates cost money for a free community tool), so the first launch may show *"Windows protected your PC"* → click *More info* → *Run anyway*. Every release is built **transparently from this repository's source** by GitHub Actions, and the SHA256 checksum is published next to it (`SHA256SUMS.txt`). If in doubt, audit the code and build it yourself (Option C) - you'll get a byte-identical behavior.

### Option B - run from source

```
git clone https://github.com/Corail44/goxlr-streamlabs-sync.git
cd goxlr-streamlabs-sync
```

Requires [Node.js 22+](https://nodejs.org/). There is nothing to build and no `npm install` needed.

### Option C - build the exe yourself

```
npm install
npm run build:exe        ->  build/goxlr-streamlabs-sync.exe
```

## Setup

### 1. Create the separated capture sources in Streamlabs

For each GoXLR sub-device you want as its own track, add a source in Streamlabs Desktop:

| Streamlabs source (suggested name) | Source type            | Windows device              |
| ---------------------------------- | ---------------------- | --------------------------- |
| `Mic (GoXLR)`                      | Audio Input Capture    | Chat Mic (TC-Helicon GoXLR) |
| `Game (GoXLR)`                     | Audio Output Capture   | Game (TC-Helicon GoXLR)     |
| `Music (GoXLR)`                    | Audio Output Capture   | Music (TC-Helicon GoXLR)    |
| `Chat (GoXLR)`                     | Audio Output Capture   | Chat (TC-Helicon GoXLR)     |
| `System (GoXLR)`                   | Audio Output Capture   | System (TC-Helicon GoXLR)   |

Then in **Settings → Output (Advanced mode) → Recording**: set the format to MKV or MP4 and enable up to 6 audio tracks. In the **advanced audio settings** (cog in the Mixer panel), assign each source to its own track. Keep your *Broadcast Stream Mix* capture on track 1 only (that's what goes live), and put the separated sources on tracks 2-6 (recording only). Set audio to 48 kHz to match the GoXLR.

### 2. Configure the sync

**The easy way:** open the dashboard (http://127.0.0.1:14571), click **Settings**, then map each GoXLR channel to a Streamlabs source (the field suggests your live sources), pick the mute behavior, optionally enable *Start with Windows* and paste your Streamlabs API token, then **Save**. Changes apply instantly, no restart needed.

**The file way:** edit `config.json` (start from `config.example.json`):

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

Valid channels: `Mic`, `LineIn`, `Console`, `System`, `Game`, `Chat`, `Sample`, `Music`, `Headphones`, `MicMonitor`, `LineOut`. Run `node src/index.js --list` to print your GoXLR channels and every Streamlabs source name.

**Where is config.json?** Search order: `--config <path>` → `config.json` in the current folder → next to the exe / project root → `%APPDATA%\goxlr-streamlabs-sync\config.json`. The packaged exe creates the APPDATA one on first run, so your settings persist no matter where the exe is launched from.

### 3. Run it

A **tray icon** appears in the notification area: right-click for *Open dashboard* / *Quit*, double-click to open the dashboard.

- **Standalone exe:** just run `goxlr-streamlabs-sync.exe` - it goes straight to the background (tray icon, no console window). Use `--console` to keep it attached to a terminal and see the logs.
- **From source, no window:** double-click **`start-hidden.vbs`**.
- **From source, with console:** `start.bat` or `npm start`.

Launching it again while it's already running simply reopens the dashboard (single instance). Stop it from the tray icon, the dashboard's *Quit* button, or `stop.bat`.

Move a fader on the GoXLR - the matching Streamlabs volume slider follows. 🎚️

To launch it automatically with Windows: enable **Start with Windows** in the dashboard settings (it registers the proper command in `HKCU\...\Run`).

### The dashboard

The tool serves a small local web page (no external service, no dependency): connection status of both ends, live channel volumes, mute states, mapped sources and recent logs - plus a *Quit* button. Default address: **http://127.0.0.1:14571**. Set `ui.host` to `"0.0.0.0"` if you want to open it from another device on your network. Closing the tab never stops the sync.

The interface language follows your browser (French/English) and can be forced with the language selector in the header; the choice is remembered per browser. Adding a language is a small PR: one dictionary block in `src/ui.html`.

## Connecting to Streamlabs: pipe vs websocket

By default (`"transport": "auto"`), the tool connects through Streamlabs' local **named pipe** (`\\.\pipe\slobs`) - zero configuration needed.

**Known Streamlabs quirk:** the pipe listener is single-use. If a client disconnects (e.g. you stop this tool), Streamlabs does not recreate the pipe until it restarts. So if you restart the sync while Streamlabs stays open, the pipe will be unavailable. Two options:

- restart Streamlabs Desktop, or
- set a **token** so the tool can fall back to the websocket: in Streamlabs go to *Settings, Remote Control*, enable **Allow third-party connections**, then copy the API token shown there. Paste it in the dashboard settings (a *Test* button validates it live); the websocket host and port are editable there too, in case you changed the port in Streamlabs.

With a token configured, `auto` tries the pipe first and falls back to the websocket seamlessly.

## Configuration reference

| Key | Default | Description |
| --- | --- | --- |
| `goxlr.url` | `ws://127.0.0.1:14564/api/websocket` | GoXLR Utility websocket |
| `goxlr.serial` | `null` | Pin a specific device (serial) if you own several; `null` = first found |
| `streamlabs.transport` | `auto` | `auto`, `pipe` or `websocket` |
| `streamlabs.pipeName` | `slobs` | Named pipe name |
| `streamlabs.url` | `ws://127.0.0.1:59650/api` | Streamlabs SockJS endpoint (websocket transport) |
| `streamlabs.token` | `null` | API token (*Settings → Remote Control*), required for websocket |
| `sync.throttleMs` | `50` | Min delay between two volume updates per source (fader sweeps) |
| `sync.curveExponent` | `1.0` | `deflection = (volume/255)^exponent`. `1.0` = slider mirrors fader position |
| `sync.muteMode` | `follow_stream` | See below |
| `sync.twoWay` | `true` | Streamlabs slider moves drive the GoXLR back (motorized faders) |
| `sync.profiles` | `{}` | Dedicated mapping sets per GoXLR profile name (managed from the dashboard) |
| `sync.snapshots` | `{}` | Named mix snapshots (volumes + mutes), managed from the dashboard Mixes bar |
| `sync.snapshotFadeMs` | `1200` | Fade duration when applying a mix |
| `sync.sceneRules` | `{}` | Streamlabs scene name -> mix applied automatically on switch |
| `ui.pin` | `null` | 4-8 digit PIN required for network (non-localhost) access |
| `ui.notifications` | `true` | Windows toast notifications (update available, connection lost) |
| `sync.syncOnConnect` | `true` | Push the full GoXLR state to Streamlabs on (re)connect |
| `sync.mappings[]` | - | `{ channel, source, syncVolume?, syncMute? }` |
| `ui.enabled` | `true` | Serve the local web dashboard |
| `ui.host` | `127.0.0.1` | Dashboard bind address (`0.0.0.0` to allow LAN access) |
| `ui.port` | `14571` | Dashboard port (also used as the single-instance lock) |
| `ui.openBrowser` | `false` | Open the dashboard on startup (the `--open` flag does the same) |
| `ui.tray` | `true` | Show the system tray icon (Windows) |
| `updateCheck` | `true` | Check GitHub once a day for a newer release (shows a dashboard banner) |

### Mute modes

The GoXLR mute button can target different outputs (mute to All / Stream / Voice Chat / Phones / Line Out - and *hold* always mutes everywhere).

- `follow_stream` (default): the Streamlabs source is muted only when the GoXLR mute affects the stream mix (`MutedToAll`, or `MutedToX` with target `All`/`ToStream`). A "mute to headphones" press won't mute your recording - which is usually what you want.
- `any`: any mute state on the channel mutes the source.
- `off`: never touch mutes.

The mic **cough button** is handled too (counts as a mute on the `Mic` channel).

## Limitations

- Mute changes made in Streamlabs are not pushed back to the GoXLR (its mutes are per-fader with configurable targets, so a faithful reverse mapping does not exist). Use the GoXLR buttons or the dashboard MUTE chips.
- Submix link ratios are left untouched: the tool reads and writes volumes only.

## Troubleshooting

- **`GoXLR Utility unreachable`** - make sure the [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) daemon is running (its icon sits in the system tray). The official GoXLR App must not be used at the same time.
- **`Cannot reach Streamlabs Desktop`** - Streamlabs isn't running, or its named pipe is stale (see [pipe vs websocket](#connecting-to-streamlabs-pipe-vs-websocket)).
- **`Sources not found in Streamlabs`** - the `source` names in `config.json` must match the Streamlabs source names exactly (case-sensitive). Run `node src/index.js --list`.
- Run with `--verbose` to see every patch and API call, and `--dry-run` to test without touching Streamlabs.

## HTTP API (Stream Deck, macros)

Everything the dashboard does goes through a small local HTTP API, so any tool able to send an HTTP request (Stream Deck plugins, AutoHotkey, Bitfocus Companion...) can drive the sync. JSON bodies, on `http://127.0.0.1:14571`:

| Endpoint | Body | Effect |
| --- | --- | --- |
| `POST /api/channel-volume` | `{"channel":"Music","volume":128}` | Sets a channel volume (0-255), the motorized fader moves |
| `POST /api/channel-mute` | `{"channel":"Music","muted":true}` | Mutes/unmutes the mapped Streamlabs sources |
| `POST /api/snapshot` | `{"action":"apply","name":"Pause"}` | Applies a mix with the fade |
| `POST /api/fx` | `{"enabled":true}` or `{"preset":"Preset3"}` | Voice FX on/off, preset switch |
| `POST /api/sample` | `{"bank":"A","button":"TopLeft"}` | Plays a sampler pad (add `"stop":true` to stop) |
| `GET /api/state` | - | Full live state as JSON |

With a PIN configured, remote requests need the `gss-auth=<pin>` cookie (localhost never does).

Tip: the dashboard also works through Tailscale or any VPN that reaches your PC, so your phone can drive the mix from anywhere, not just your home Wi-Fi.

## Contributing

Issues and PRs welcome! The codebase is intentionally small and dependency-free:

```
src/index.js       entry point & CLI
src/goxlr.js       GoXLR Utility websocket client (status mirror + JSON Patch)
src/streamlabs.js  Streamlabs JSON-RPC client (named pipe + SockJS websocket)
src/sync.js        mapping engine (throttle, curves, mute logic)
src/config.js      config loading & validation
src/jsonpatch.js   minimal RFC 6902 implementation
```

## Credits

- [GoXLR-on-Linux / goxlr-utility](https://github.com/GoXLR-on-Linux/goxlr-utility) - the community project that makes all of this possible
- Inspired by [goxlr-obs-fader-sync](https://github.com/FrostyCoolSlug/goxlr-obs-fader-sync) and [obs-goxlr-fader-sync-plugin](https://github.com/parzival-space/obs-goxlr-fader-sync-plugin) (OBS Studio equivalents)

## License

[MIT](LICENSE)
