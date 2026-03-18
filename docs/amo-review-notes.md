# KEKW Blocker AMO Reviewer Notes

Last updated: March 18, 2026

## Build Instructions

Use the AMO-targeted Firefox build:

```bash
npm ci
npm run build:firefox:amo
npm run lint:firefox:amo
npm run package:firefox:amo
```

This produces:

- unpacked AMO build in `dist/firefox-amo/`
- packaged AMO artifact in `dist/ttv-adblock-firefox-amo-v<version>.xpi`

## Extension Purpose

KEKW Blocker is a Twitch-only ad blocker. It modifies Twitch playback behavior to avoid ad-backed stream variants, recover from Twitch commercial-break overlays, and reduce playback disruption during ad transitions.

## Host Permissions

The extension requests Twitch host permissions because it needs to:

- inject content scripts on Twitch pages
- request backup playback access tokens
- read and compare Twitch HLS playlists
- block Twitch and ad-network tracking requests tied to ads

It also requests access to `dorquex-ctrl.github.io` to download a signed remote configuration file used to keep Twitch request constants current.

## Remote Configuration

The extension fetches a static JSON file from:

- `https://dorquex-ctrl.github.io/kekw-blocker/remote-config.json`

Important review note:

- this file contains signed configuration data only
- the extension verifies the Ed25519 signature before accepting schema-v2 updates
- unsigned or invalid signed payloads are rejected
- the remote configuration does not contain executable code
- the extension does not execute remote JavaScript from the developer-controlled config host

## Worker Hooking

Twitch playback logic runs inside a site-created Worker. To intercept Twitch ad markers and playlist handling, the extension reconstructs the Twitch worker into a local blob worker and prepends extension hook code.

Important review note:

- the extension now assembles the worker source directly into the local blob worker
- the extension does not use `eval` to execute the Twitch worker source
- the worker source comes from the page's own Twitch worker URL so the player can continue functioning
- no external script from the developer-controlled config host is loaded into the worker

## Data Collection / Transmission Disclosure

The AMO-targeted manifest declares:

- `websiteContent`
- `browsingActivity`

Rationale:

- the extension inspects Twitch page/player state and HLS playlist content to perform its primary function
- the extension makes Twitch playback requests that inherently include Twitch stream/channel context needed for stream playback and ad blocking

The extension does not include:

- analytics
- telemetry
- crash reporting
- advertising SDKs
- sale of user data

## Local Storage

The extension stores the following in browser extension storage:

- user settings
- enabled/disabled state
- cached signed remote configuration
- temporary runtime-learned Twitch request values
- learned backup-player ranking data

## Suggested Functional Test

1. Install the built AMO package in Firefox.
2. Open a Twitch live stream.
3. Confirm the popup shows channel/status and the global toggle.
4. Open the options page and verify the Debug panel shows signed remote-config status.
5. During an ad break or commercial-break overlay, verify the stream recovers and playback continues.

## Source Package Notes

The repository includes:

- build script: `scripts/build.js`
- lockfile: `package-lock.json`
- Firefox manifests for dev and AMO builds
- privacy policy: `PRIVACY.md`

No code generation or transpilation step is required for the shipped extension bundle beyond the packaging/build copy step.
