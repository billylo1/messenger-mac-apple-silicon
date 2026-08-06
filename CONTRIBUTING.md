# Contributing

Thanks for interest in Messenger for Mac.

## Development

```bash
npm install
npm start
```

Signed release builds need a local `.env` (see `.env.example`). Never commit `.env` or `aptabase.config.json`.

## Pull requests

- Keep changes focused and match existing code style.
- Don’t commit secrets, notarization credentials, or analytics config with real keys.
- Update `RELEASE_NOTES.md` for user-facing changes.

## Reporting issues

Open an issue on GitHub with macOS version, app version, and steps to reproduce.
For security-sensitive reports, see [SECURITY.md](SECURITY.md).
