/**
 * Early injection — runs at document_start BEFORE Twitch's scripts load.
 * This ensures we hook Worker and fetch before the HLS player initializes.
 */
(function () {
  "use strict";

  // Generate a random nonce to prevent page scripts from spoofing our events.
  // Stored on documentElement so player-monitor.js (separate content script) can read it.
  var nonce = Math.random().toString(36).substring(2);
  document.documentElement.setAttribute("data-ttv-nonce", nonce);

  // Bridge TTV_CONFIG into the page context (page-inject.js cannot use
  // chrome.runtime or ES imports — it needs the config as a page global).
  var configScript = document.createElement("script");
  configScript.textContent = "window.__TTV_CONFIG = " + JSON.stringify(TTV_CONFIG) + ";" +
    "window.__TTV_NONCE = " + JSON.stringify(nonce) + ";";
  (document.documentElement || document.head || document.body).appendChild(configScript);
  configScript.remove();

  var script = document.createElement("script");
  script.src = chrome.runtime.getURL("src/content/page-inject.js");

  // Must be synchronous to beat Twitch's script loading
  // Using document.documentElement ensures it runs before <head> scripts
  (document.documentElement || document.head || document.body).appendChild(script);

  // Don't remove — some CSP configurations need it to stay
  script.onload = function () {
    script.remove();
  };

  // Load options from storage and forward to page context via custom event
  chrome.storage.local.get("ttvOptions", function (result) {
    var opts = result && result.ttvOptions || {};
    window.dispatchEvent(new CustomEvent("ttv-" + nonce + "-options", { detail: opts }));
  });

  // Forward option updates and enable/disable from background to page context
  chrome.runtime.onMessage.addListener(function (message) {
    if (!message) return;
    if (message.type === "OPTIONS_UPDATED") {
      window.dispatchEvent(new CustomEvent("ttv-" + nonce + "-options", { detail: message.options }));
    }
    if (message.type === "SET_ENABLED") {
      window.dispatchEvent(new CustomEvent("ttv-" + nonce + "-enabled", { detail: { enabled: message.enabled } }));
    }
    if (message.type === "REMOTE_CONFIG_UPDATED") {
      window.dispatchEvent(new CustomEvent("ttv-" + nonce + "-config", { detail: message.config }));
    }
  });
})();
