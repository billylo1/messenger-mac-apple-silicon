# Messenger for Mac (Apple Silicon)

A standalone desktop app for Facebook Messenger on macOS. Chat with friends without opening a browser.

**Why this exists:** Meta discontinued the official Messenger desktop app. This is a lightweight replacement that lets you use Messenger without keeping a browser tab open.

### Why this fork?

Upstream [stefanminch/messenger-mac](https://github.com/stefanminch/messenger-mac) ships an **x86_64** build. On Apple Silicon Macs that requires Rosetta, and future macOS versions may drop Rosetta support entirely.

This fork delivers a **universal** macOS binary (Apple Silicon + Intel) so the app runs natively on arm64 and on Intel Macs without juggling separate builds.

<img src="icon.png" width="128" alt="Messenger for Mac">

## Download

**[Download Messenger for Mac v1.8.3 (universal DMG)](https://github.com/billylo1/messenger-mac-apple-silicon/releases/download/v1.8.3/MessengerApp-1.8.3-universal.dmg)** | Apple Silicon + Intel · macOS 10.13+

[Zip build](https://github.com/billylo1/messenger-mac-apple-silicon/releases/download/v1.8.3/MessengerApp-1.8.3-universal-mac.zip) · [All releases](https://github.com/billylo1/messenger-mac-apple-silicon/releases)

> Universal binary — Apple Silicon + Intel.

## Features

- **Native macOS App** - Runs as a standalone application in your dock
- **No Browser Required** - Access Messenger without opening Chrome, Safari, or Firefox
- **Persistent Login** - Stay logged in between app restarts
- **Native Notifications** - Get notified of new messages (dock badge + macOS alerts)
- **Minimal & Fast** - Lightweight app with low memory footprint
- **Privacy Focused** - No tracking, no analytics, no data collection
- **Dark Mode Support** - Follows your macOS appearance settings
- **External Links** - Shared links open in your default browser
- **Background Delivery** - Stays connected when unfocused so new messages still arrive
- **Auto-Update** - Detects new versions and installs in-app (restart to apply)
- **Keyboard Shortcuts** - Quick navigation with custom shortcuts

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd + N` | New message |
| `Cmd + 1-9` | Switch to conversation 1-9 |
| `Cmd + Shift + S` | Toggle sidebar visibility |

All settings (sidebar visibility) are persisted across app restarts.

## Screenshots

| Chat View | Login |
|-----------|-------|
| Native macOS window | Secure Facebook login |

## Installation

1. Download the [universal DMG](https://github.com/billylo1/messenger-mac-apple-silicon/releases/download/v1.8.3/MessengerApp-1.8.3-universal.dmg)
2. Open the DMG
3. Drag **MessengerApp** to your **Applications** folder
4. Launch from Applications or Spotlight

If Gatekeeper blocks the first launch, right-click the app → **Open**.

## Build from Source

### Prerequisites

- Node.js 18+
- npm or yarn
- macOS with Node.js 18+ (universal builds are produced via electron-builder’s `universal` arch)
- For signed + notarized builds: a **Developer ID Application** certificate in your login keychain (with private key), plus an Apple ID with an [app-specific password](https://appleid.apple.com/account/manage)

### Steps

```bash
# Clone this fork
git clone https://github.com/billylo1/messenger-mac-apple-silicon.git
cd messenger-mac-apple-silicon

# Install dependencies
npm install

# Run in development mode
npm start
```

### Production build (signed + notarized)

Credentials live in a local `.env` (gitignored). Copy the example and fill in your Apple ID + [app-specific password](https://appleid.apple.com/account/manage):

```bash
cp .env.example .env
# edit .env — set APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD

npm run build
```

`scripts/build.sh` loads `.env` and runs electron-builder. Required vars:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID` (defaults to Evergreen Labs in `.env.example`)
- Optional `CSC_NAME` to pin the Developer ID signing identity
- `APTABASE_APP_KEY` / `APTABASE_HOST` for analytics (baked into the build as `aptabase.config.json`, which is gitignored)

Outputs land in `dist/`:

- `MessengerApp-<version>-universal.dmg`
- `MessengerApp-<version>-universal-mac.zip`
- `latest-mac.yml` — **required** on every GitHub release for in-app self-update

When creating a GitHub release, upload all three (DMG, zip, and `latest-mac.yml`). Self-update uses the zip + YAML feed; without `latest-mac.yml`, installed apps cannot find the new version.

Without `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`, the build may still sign locally but notarization will be skipped or fail. Notarization requires a **Developer ID Application** cert — Apple Development / Apple Distribution will not work for outside-the-store distribution.

## Tech Stack

- [Electron](https://www.electronjs.org/) - Cross-platform desktop apps
- JavaScript/Node.js

## Upstream

Based on [stefanminch/messenger-mac](https://github.com/stefanminch/messenger-mac). This fork ships a **universal** (arm64 + x64) macOS binary.

## FAQ

### Is this the official Messenger app?
No, this is an unofficial wrapper around messenger.com. It's not affiliated with Meta/Facebook.

### Is it safe?
The app loads messenger.com in a native window — no modifications to Messenger itself. Release builds from this fork are intended to be code-signed; notarization depends on a valid Developer ID Application certificate and Apple notarization credentials at build time.

### Why use this instead of the browser?
- Dedicated app in your dock
- Separate from browser tabs
- Stays logged in
- Cleaner experience
- Less resource usage than a full browser

### Why not the upstream release?
Upstream v1.3.0 is **x86_64** and needs Rosetta on Apple Silicon. This fork’s builds are **universal** (native arm64 + Intel).

### Does it support voice/video calls?
Yes, all Messenger features work including voice and video calls.

### My login isn't persisting?
Quit with `Cmd+Q` (or Messenger → Quit) so the session is flushed. The red close button only minimizes and keeps the app running.

## Keywords

Facebook Messenger Mac, Messenger Desktop App, Messenger macOS, Facebook Chat Mac App, Messenger without browser, Standalone Messenger Mac, Messenger Mac download, Facebook Messenger native app, Messenger Electron app, Mac Messenger client, Messenger Apple Silicon, Messenger arm64

## License

MIT License - feel free to modify and distribute.

## Disclaimer

This project is not affiliated with, authorized, maintained, sponsored, or endorsed by Meta/Facebook or any of its affiliates or subsidiaries. This is an independent and unofficial app. Use at your own risk.
