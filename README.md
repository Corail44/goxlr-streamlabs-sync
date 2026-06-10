# goxlr-streamlabs-sync

**Control your separated Streamlabs audio tracks with your GoXLR's physical faders.**

🇫🇷 [Version française](README.fr.md)

The GoXLR only exposes ONE mixed capture device to Windows (*Broadcast Stream Mix*), so your stream/recording gets everything baked together — impossible to edit voice, game and music separately afterwards. The well-known workaround is to capture each GoXLR playback device (Game, Music, Chat, System) as its own *Audio Output Capture* source in Streamlabs Desktop and record them on separate tracks. But those captures are taken **before** the GoXLR hardware mixing, so your faders and mute buttons stop having any effect on them.

This tool fixes that: it listens to the [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) websocket API and mirrors every fader move and mute press onto your Streamlabs Desktop audio sources in real time, through Streamlabs' JSON-RPC API.

```
GoXLR hardware ──USB──> GoXLR Utility daemon ──websocket──> goxlr-streamlabs-sync ──JSON-RPC──> Streamlabs Desktop
```

Similar tools exist for OBS Studio ([goxlr-obs-fader-sync](https://github.com/FrostyCoolSlug/goxlr-obs-fader-sync), [obs-goxlr-fader-sync-plugin](https://github.com/parzival-space/obs-goxlr-fader-sync-plugin)) — this one is for **Streamlabs Desktop**.

## Features

- Real-time volume sync: GoXLR fader (0-255) → Streamlabs source volume slider
- Mute sync with stream-aware logic: only mutes the source when the GoXLR mute actually affects the stream (configurable)
- Any GoXLR channel can be mapped to any number of Streamlabs sources
- Works with the GoXLR Full and GoXLR Mini, and with multiple devices
- Zero npm dependencies, single small Node.js process, auto-reconnects to both ends
- Local web dashboard (live volumes, mute states, logs) + windowless launcher — nothing cluttering your taskbar
- `--list` mode to discover your channels and exact source names
- `--dry-run` mode to test safely

## Requirements

- Windows with [Node.js 22+](https://nodejs.org/)
- [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) running (the unofficial replacement for the official GoXLR App)
- Streamlabs Desktop

## Installation

```
git clone https://github.com/YOUR_USER/goxlr-streamlabs-sync.git
cd goxlr-streamlabs-sync
```

(or download the ZIP from GitHub and extract it — there is nothing to build and no `npm install` needed)

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

```
copy config.example.json config.json
```

Edit `config.json` — map GoXLR channels to the **exact** source names you created:

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

Valid channels: `Mic`, `LineIn`, `Console`, `System`, `Game`, `Chat`, `Sample`, `Music`, `Headphones`, `MicMonitor`, `LineOut`.

Not sure about names? Run:

```
node src/index.js --list
```

It prints your GoXLR channels (with live volumes) and every Streamlabs audio source name.

### 3. Run it

**Recommended (no window):** double-click **`start-hidden.vbs`** — the sync runs silently in the background and the dashboard opens in your browser. Double-clicking it again just reopens the dashboard (single instance). Stop it with `stop.bat` or the dashboard's *Quit* button.

**With a console:** double-click `start.bat`, or run `npm start`.

Move a fader on the GoXLR — the matching Streamlabs volume slider follows. 🎚️

To launch it automatically with Windows: press `Win+R`, type `shell:startup`, and drop a shortcut to `start-hidden.vbs` there.

### The dashboard

The tool serves a small local web page (no external service, no dependency): connection status of both ends, live channel volumes, mute states, mapped sources and recent logs — plus a *Quit* button. Default address: **http://127.0.0.1:14571**. Set `ui.host` to `"0.0.0.0"` if you want to open it from another device on your network. Closing the tab never stops the sync.

## Connecting to Streamlabs: pipe vs websocket

By default (`"transport": "auto"`), the tool connects through Streamlabs' local **named pipe** (`\\.\pipe\slobs`) — zero configuration needed.

**Known Streamlabs quirk:** the pipe listener is single-use. If a client disconnects (e.g. you stop this tool), Streamlabs does not recreate the pipe until it restarts. So if you restart the sync while Streamlabs stays open, the pipe will be unavailable. Two options:

- restart Streamlabs Desktop, or
- set a **token** so the tool can fall back to the websocket: in Streamlabs go to *Settings → Remote Control*, click the QR code, *Show details*, copy the API token into `streamlabs.token` in `config.json`.

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
| `sync.syncOnConnect` | `true` | Push the full GoXLR state to Streamlabs on (re)connect |
| `sync.mappings[]` | — | `{ channel, source, syncVolume?, syncMute? }` |
| `ui.enabled` | `true` | Serve the local web dashboard |
| `ui.host` | `127.0.0.1` | Dashboard bind address (`0.0.0.0` to allow LAN access) |
| `ui.port` | `14571` | Dashboard port (also used as the single-instance lock) |
| `ui.openBrowser` | `false` | Open the dashboard on startup (the `--open` flag does the same) |

### Mute modes

The GoXLR mute button can target different outputs (mute to All / Stream / Voice Chat / Phones / Line Out — and *hold* always mutes everywhere).

- `follow_stream` (default): the Streamlabs source is muted only when the GoXLR mute affects the stream mix (`MutedToAll`, or `MutedToX` with target `All`/`ToStream`). A "mute to headphones" press won't mute your recording — which is usually what you want.
- `any`: any mute state on the channel mutes the source.
- `off`: never touch mutes.

The mic **cough button** is handled too (counts as a mute on the `Mic` channel).

## Limitations

- One-way sync (GoXLR → Streamlabs). Moving a slider in Streamlabs does not move the motorized fader.
- GoXLR **submixes** are not supported yet — the main channel volume is used.
- Channels not assigned to a fader can still sync volume (changed via the Utility UI), but have no mute button to sync.

## Troubleshooting

- **`GoXLR Utility unreachable`** — make sure the [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) daemon is running (its icon sits in the system tray). The official GoXLR App must not be used at the same time.
- **`Cannot reach Streamlabs Desktop`** — Streamlabs isn't running, or its named pipe is stale (see [pipe vs websocket](#connecting-to-streamlabs-pipe-vs-websocket)).
- **`Sources not found in Streamlabs`** — the `source` names in `config.json` must match the Streamlabs source names exactly (case-sensitive). Run `node src/index.js --list`.
- Run with `--verbose` to see every patch and API call, and `--dry-run` to test without touching Streamlabs.

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

- [GoXLR-on-Linux / goxlr-utility](https://github.com/GoXLR-on-Linux/goxlr-utility) — the community project that makes all of this possible
- Inspired by [goxlr-obs-fader-sync](https://github.com/FrostyCoolSlug/goxlr-obs-fader-sync) and [obs-goxlr-fader-sync-plugin](https://github.com/parzival-space/obs-goxlr-fader-sync-plugin) (OBS Studio equivalents)

## License

[MIT](LICENSE)
