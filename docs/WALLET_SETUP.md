# Wallet setup

XO's orderbook uses two identities at once:

- **Smart account:** the funded XO trading address. It is the order `maker` and `signer`.
- **Owner wallet:** the EOA that authorizes the smart account and signs order digests.

They are usually different addresses. Do not replace the smart-account address with the owner address.

## 1. Create the XO wallet

1. Open the official XO site yourself; do not follow wallet links copied from chat or social media.
2. Create or sign in to your XO account.
3. In the account/wallet view, copy the XO **smart-account address**.
4. Verify the address in two places before funding it.

This project does not create, recover, or scrape an XO wallet.

## 2. Fund and approve it

1. Fund the smart account with the collateral required by XO on chain ID `3223`.
2. In the official XO app, complete the current collateral and Conditional Token approvals for the production CTF Exchange.
3. Confirm the balance and approvals in XO before using this client.

The TUI intentionally does not send approvals or change allowances.

## 3. Obtain CLOB API credentials

Private XO endpoints require an API-key triplet:

- API key
- HMAC secret
- API passphrase

Use XO's official **Create API key** or **Derive API key** flow. It requires the owner to sign XO's `ClobAuth` EIP-712 message for the smart account. Save the returned triplet in a password manager. The secret/passphrase may not be returned again.

Do not copy another user's triplet, browser cookies, Privy tokens, captured headers, or session exports. This repository contains no credential-generation shortcut because smart-account validation and deployments can change.

## 4. Choose how to provide credentials

Safest for occasional use — temporary, hidden prompts:

```bash
xo-tui --wallet
```

Enter the following into hidden prompts:

1. Smart-account address.
2. Owner signing private key.
3. API key.
4. HMAC secret.
5. API passphrase.
6. HMAC canonicalization mode. Use the live XO compatibility option unless the current XO docs/server require path-with-query.

Nothing is written to disk. Quit the process to erase the in-memory session.

For repeated local use, copy the blank public template and lock down its permissions:

```bash
cp .env.example .env
chmod 600 .env
```

If XO TUI was installed as a package instead of cloned from source, run `xo-tui setup` and copy the complete blank template it prints into a new `.env` in your current directory.

Fill only your own values. The TUI loads this local file at startup:

```text
XO_TUI_SMART_ACCOUNT
XO_TUI_OWNER_PRIVATE_KEY
XO_TUI_API_KEY
XO_TUI_API_SECRET
XO_TUI_API_PASSPHRASE
XO_TUI_HMAC_MODE=path-only
```

The `.env` file is ignored by Git and excluded from the npm package, but it is still plaintext on your computer. Prefer the temporary prompts or a shell secret manager on shared or weakly protected machines. Never put values in `.env.example`, shell history, screenshots, source code, commits, or issue reports.

If `.env` is absent, incomplete, or invalid, startup explains the problem without showing any supplied value and offers read-only mode or a temporary session. Use `npm start -- --read-only` (source) or `xo-tui --read-only` (installed package) to bypass that question. Use `npm run setup` or `xo-tui setup`, respectively, to print these instructions.

## 5. Test safely

1. Start in read-only mode and verify live books.
2. Open Wallet and confirm the abbreviated smart-account address shown in the footer.
3. Use a one-share post-only order far from the touch, if XO's current minimum size permits it.
4. Confirm it appears under Open Orders.
5. Cancel it and verify the result in XO's official UI.
6. Only then use larger orders or a ladder.

## 6. Remove access

1. Quit the TUI.
2. Remove temporary environment variables and securely delete `.env` if you created one.
3. Revoke/delete the API key using XO's official API-key management flow if the machine or session may be compromised.
4. Rotate the owner key using XO's supported smart-account recovery path when owner-key exposure is suspected.

Never paste secrets into a bug report. Provide redacted response codes, timestamps, order hashes, and public smart-account addresses only.
