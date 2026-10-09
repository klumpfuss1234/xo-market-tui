# Security policy

## Supported versions

Only the latest release is supported.

## Reporting

Report vulnerabilities privately to the repository maintainer. Do not include private keys, API secrets, passphrases, cookies, or live auth headers. Revoke compromised XO credentials before reporting.

## Design guarantees

- No credentials are committed or persisted by the app. Users may create their own git-ignored plaintext `.env`; the app only reads it.
- `.env` files, keys, sessions, and credential files are ignored.
- Public market browsing works without authentication.
- WebSocket input cannot trigger order mutations.
- Every submit and cancel action requires explicit selection and a typed phrase.
- Mutating requests are sent once and are never retried automatically.
- Error messages are redacted before display.

## Local credential file

`.env.example` contains blank placeholders only. If you choose persistent local setup, copy it to `.env`, set mode `0600`, and never commit or share it. The completed `.env` is plaintext and should not be used on a shared or compromised machine. Prefer `--wallet` hidden prompts for a memory-only session.

## Non-guarantees

This client cannot protect a key on an already compromised computer. It cannot guarantee XO availability, settlement, smart-account behavior, current contract deployments, or that an order is unfilled after a timeout. Always reconcile uncertain responses using both Open Orders and the official XO interface.
