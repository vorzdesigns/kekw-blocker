/**
 * KEKW Blocker — Centralized Configuration
 *
 * ALL frequently-changing values live here. When Twitch breaks something,
 * this is the ONLY file you should need to edit.
 *
 * Each section has a `_updated` field (ISO date) so maintainers know
 * when the values were last verified against Twitch's live site.
 *
 * CONSUMPTION:
 *   - Background scripts: loaded first via manifest.json background.scripts,
 *     so TTV_CONFIG is a global in the background page context.
 *   - Content scripts (inject-early.js, player-monitor.js): loaded via
 *     manifest.json content_scripts, so they read TTV_CONFIG from the
 *     content script world. inject-early.js serializes it into page context.
 *   - page-inject.js: receives config via inject-early.js which sets
 *     window.__TTV_CONFIG before the script tag loads.
 */

// eslint-disable-next-line no-unused-vars
var TTV_CONFIG = Object.freeze({

  // =========================================================================
  // Version — bump when you change this file
  // =========================================================================
  _configVersion: "2026-03-15.1",

  // =========================================================================
  // GQL — GraphQL operation hashes, endpoints, and field names
  // =========================================================================
  gql: Object.freeze({
    _updated: "2026-03-15",

    /** GQL endpoint URL */
    url: "https://gql.twitch.tv/gql",

    /** Twitch Client-ID for GQL requests */
    clientId: "b31o4btkqth5bzbvr9ub2ovr79umhh",

    /** SHA256 hash for PlaybackAccessToken persisted query */
    playbackAccessTokenHash: "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9",
  }),

  // =========================================================================
  // HLS / M3U8 — ad markers, segment patterns, URL patterns
  // =========================================================================
  hls: Object.freeze({
    _updated: "2026-03-15",

    /** The string Twitch uses inside m3u8 to mark ad content.
     *  Used by page-inject worker to detect ad playlists. */
    adSignifier: "stitched",

    /** Regex pattern (as string) matching ad segment URLs */
    adSegmentUrlPattern: "\\/stitched-ad\\/",

    /** URL patterns for segment interception */
    segmentUrlPatterns: Object.freeze([
      "*://*.hls.ttvnw.net/*.ts*",
      "*://*.ttvnw.net/*.ts*",
      "*://*.cloudfront.net/*.ts*",
    ]),
  }),

  // =========================================================================
  // Player Types — backup streams for ad-free content
  // =========================================================================
  player: Object.freeze({
    _updated: "2026-03-15",

    /** Ordered list of playerType values to try for backup streams.
     *  First one that returns an ad-free m3u8 wins. */
    backupPlayerTypes: Object.freeze([
      "embed",
      "site",
      "popout",
      "autoplay",
    ]),

    /** Which playerType to use as last-resort fallback (even if it has ads) */
    fallbackPlayerType: "embed",

    /** Which playerType to force for the primary access token request */
    forceAccessTokenPlayerType: "popout",

  }),

  // =========================================================================
  // CSS Selectors — Twitch UI elements that change with redesigns
  // =========================================================================
  selectors: Object.freeze({
    _updated: "2026-03-15",

    /** Ad overlay elements to detect and hide */
    adOverlay: Object.freeze([
      '[data-a-target="player-ad-overlay"]',
      ".ad-banner",
      ".video-ad",
      '[class*="ad-overlay"]',
      '[data-test-selector="ad-banner-default-id"]',
    ]),

    /** Purple "Commercial Break" screen elements */
    purpleScreen: Object.freeze([
      '[data-a-target="player-overlay-commercial-break"]',
      ".commercial-break",
      '[class*="commercial"]',
      '[data-test-selector="ads-overlay"]',
    ]),

    /** Channel points claim button */
    channelPointsClaim: Object.freeze([
      "button[aria-label='Claim Bonus']",
      "[data-test-selector='community-points-summary'] .claimable-bonus__icon",
    ]),
  }),

  // =========================================================================
  // React Internals — fiber tree node method/property names
  // =========================================================================
  react: Object.freeze({
    _updated: "2026-03-15",

    /** Method on the React node that indicates it controls the player */
    playerActiveMethod: "setPlayerActive",

    /** Property path to the media player instance */
    mediaPlayerProp: "mediaPlayerInstance",

    /** Methods on the state node used for player reload */
    setSrcMethod: "setSrc",
    setInitialPlaybackMethod: "setInitialPlaybackSettings",

    /** The React container key prefix on the DOM root */
    containerKeyPrefix: "__reactContainer",
  }),

  // =========================================================================
  // Tracking / Ad Network URLs — blocked at the network level
  // =========================================================================
  tracking: Object.freeze({
    _updated: "2026-03-15",

    /** URL patterns to block via webRequest. Also used in manifest.json
     *  permissions (those must be updated manually if domains change). */
    blockedUrlPatterns: Object.freeze([
      // Twitch internal tracking
      "*://spade.twitch.tv/*",
      "*://countess.twitch.tv/*",
      "*://*.twitch.tv/ads/*",
      "*://ads.twitch.tv/*",
      // Google ad network
      "*://ad.doubleclick.net/*",
      "*://imasdk.googleapis.com/*",
      "*://pubads.g.doubleclick.net/*",
      "*://www.googleadservices.com/*",
      "*://video-ad-stats.googlesyndication.com/*",
      "*://pagead2.googlesyndication.com/*",
      "*://securepubads.g.doubleclick.net/*",
      // Amazon ad network
      "*://*.amazon-adsystem.com/*",
      "*://aax.amazon-adsystem.com/*",
    ]),
  }),

  // =========================================================================
  // URL Routing — reserved Twitch path segments (not channels)
  // =========================================================================
  routing: Object.freeze({
    _updated: "2026-03-15",

    /** URL path segments that are NOT channel names */
    reservedPaths: Object.freeze([
      "directory", "videos", "settings", "subscriptions",
      "inventory", "drops", "u", "moderator", "downloads",
      "turbo", "store", "jobs", "p",
    ]),
  }),
});
