/**
 * Minimal browser polyfill shim for cross-browser compatibility.
 *
 * Firefox already exposes a chrome.* compatibility layer for most
 * WebExtension APIs, so this shim only patches the handful of edge
 * cases where the two browsers diverge in MV2.
 *
 * Must be loaded as the FIRST background / content script.
 */
(function browserPolyfill() {
  'use strict';

  // Nothing to do if chrome is already defined (Chromium or Firefox compat layer).
  if (typeof chrome === 'undefined') {
    // Should never happen in a properly loaded extension, but guard anyway.
    if (typeof browser !== 'undefined') {
      // eslint-disable-next-line no-global-assign
      window.chrome = browser;
    } else {
      console.warn('[ttv-adblock] Neither chrome nor browser global found.');
      return;
    }
  }

  // Detect Firefox by the presence of browser.runtime.
  var isFirefox = typeof browser !== 'undefined' &&
                  typeof browser.runtime !== 'undefined' &&
                  typeof browser.runtime.getURL === 'function';

  // ---- runtime.getURL guard ----
  // In rare edge cases the chrome.runtime object can become invalidated
  // (e.g. after an update). Re-bind from browser.* when available.
  if (isFirefox && chrome.runtime && !chrome.runtime.getURL && browser.runtime.getURL) {
    chrome.runtime.getURL = browser.runtime.getURL.bind(browser.runtime);
  }

  // ---- Promise-based API wrappers ----
  // Firefox natively returns Promises from most chrome.* calls, but
  // Chromium uses callbacks.  Wrap the small set of APIs this extension
  // actually uses so callers can always use Promises.

  function promisify(api, method) {
    if (!api || !api[method]) return;

    var original = api[method];

    // If the method already returns a Promise (Firefox), leave it alone.
    // We detect this by calling with no callback and checking the return.
    // Safer: just check for Firefox and skip.
    if (isFirefox) return;

    api[method] = function promisified() {
      var args = Array.prototype.slice.call(arguments);
      var hasCallback = typeof args[args.length - 1] === 'function';

      // If the caller already supplied a callback, pass through.
      if (hasCallback) {
        return original.apply(api, args);
      }

      return new Promise(function (resolve, reject) {
        args.push(function callbackShim() {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve.apply(null, arguments);
          }
        });
        original.apply(api, args);
      });
    };
  }

  // Wrap storage APIs — the extension uses chrome.storage.local.
  if (chrome.storage && chrome.storage.local) {
    promisify(chrome.storage.local, 'get');
    promisify(chrome.storage.local, 'set');
    promisify(chrome.storage.local, 'remove');
  }

  if (chrome.storage && chrome.storage.sync) {
    promisify(chrome.storage.sync, 'get');
    promisify(chrome.storage.sync, 'set');
    promisify(chrome.storage.sync, 'remove');
  }

  // Wrap tabs.sendMessage — used for content script communication.
  if (chrome.tabs) {
    promisify(chrome.tabs, 'sendMessage');
    promisify(chrome.tabs, 'query');
  }

  // Wrap runtime.sendMessage.
  if (chrome.runtime) {
    promisify(chrome.runtime, 'sendMessage');
  }

  // ---- browserAction / action normalisation ----
  // MV2 uses browserAction everywhere, but guard in case code references
  // chrome.action (MV3 style) by accident.
  if (!chrome.action && chrome.browserAction) {
    chrome.action = chrome.browserAction;
  }

  // ---- webRequest.filterResponseData ----
  // Only Firefox supports filterResponseData.  On Chromium, create a
  // no-op stub so feature-detection works cleanly:
  //   if (chrome.webRequest.filterResponseData) { ... }
  // The stub is intentionally absent so the falsy check works as-is.
  // No action needed here.

  // Expose detection flag for the rest of the extension.
  if (typeof window !== 'undefined') {
    window.__ttvAdblockIsFirefox = isFirefox;
  }
})();
