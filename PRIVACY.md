# KEKW Blocker Privacy Policy

Last updated: March 18, 2026

## Summary

KEKW Blocker is a Twitch-focused browser extension. It does not require an account, does not sell user data, and does not include analytics, telemetry, advertising beacons, or crash-reporting services.

## What The Extension Processes

To block Twitch ads and recover playback, the extension processes Twitch page and player data locally in the browser, including:

- Twitch page URLs and channel identifiers
- Twitch player state and media playlist responses
- Twitch request metadata needed to request backup streams and recover playback
- Extension settings and cached runtime state stored locally in the browser

## What The Extension Transmits

KEKW Blocker transmits only the data necessary to perform its functionality:

- Requests to Twitch endpoints used to load and recover stream playback
- Requests to Twitch media playlist endpoints used to compare and switch stream variants
- Periodic requests to the extension's signed remote configuration file hosted on GitHub Pages

The extension does not transmit user data to the developer for analytics, profiling, advertising, or resale.

## Local Storage

The extension stores the following locally in browser extension storage:

- User options
- Global enabled/disabled state
- Cached signed remote configuration
- Temporary runtime-learned Twitch request values used for recovery
- Learned backup-player ranking data

This local storage stays in the user's browser profile unless the user clears it or resets it from the extension.

## Third Parties

The extension interacts with the following third-party services as part of its core functionality:

- `twitch.tv`, `gql.twitch.tv`, `usher.ttvnw.net`, and Twitch media CDN endpoints for playback and ad-blocking behavior
- `dorquex-ctrl.github.io` for the signed remote configuration file

These services may receive standard network metadata that comes with normal HTTPS requests, such as IP address, user agent, and request timing, subject to their own policies.

## What The Extension Does Not Do

KEKW Blocker does not:

- create user profiles
- sell or rent personal data
- inject third-party advertising
- send analytics or usage reports to the developer
- collect payment information
- require a login or account

## Contact

For privacy questions, use the support/contact channel associated with the project repository or distribution page.
