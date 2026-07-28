# Release Notes

## v1.5.0 (2026-07-28)

### Changes
- **Bundle ID** - Now `org.evergreenlabs.MacMessenger`
- **Notarized builds** - Local `.env` credentials for Apple notarization via `npm run build`

---

## v1.4.0 (2026-07-28)

### Improvements
- **Close minimizes** - The red close button (and Cmd+W) minimizes the window instead of quitting, so Messenger stays loaded and resumes instantly. Quit via the menu or Cmd+Q.

---

## v1.3.0 (2025-12-27)

### New Features
- **Native Title Bar** - Standard macOS title bar for better window management
- **External Links** - Shared/forwarded links now open in your default browser instead of inside the app

### Bug Fixes
- Fixed issue where forwarded links (via l.messenger.com) were opening inside Electron

---

## v1.2.0 (2025-12-26)

### New Features
- **Auto-Update Check** - Automatically checks for new versions on startup
- **Keyboard Shortcuts** - Cmd+N for new message, Cmd+1-9 for conversations
- **Toggle Sidebar** - Cmd+Shift+S to show/hide sidebar
- **Welcome Screen** - First-launch guide showing features and shortcuts
- **Power Saving** - Background throttling to reduce CPU/battery usage

---

## v1.1.0 (2025-12-25)

### New Features
- Persistent login sessions
- Native macOS notifications

---

## v1.0.0 (2025-12-24)

- Initial release
- Basic Messenger wrapper for macOS
