// Remote config — fetches updated GQL hashes and client ID every hour.
// URL overridable via chrome.storage.local key 'ttvRemoteConfigUrl'.

const RemoteConfig = {
  // Default: GitHub raw URL. Replace 'YOUR_USERNAME/YOUR_REPO' with actual values.
  // Users can override via chrome.storage.local key 'ttvRemoteConfigUrl'.
  _defaultUrl: "https://dorquex-ctrl.github.io/kekw-blocker/remote-config.json",
  _url: "",
  _checkIntervalMs: 60 * 60 * 1000, // 1 hour
  _intervalId: null,
  _lastVersion: 0,

  init() {
    // Load URL from storage (allows override without rebuilding)
    chrome.storage.local.get(["ttvRemoteConfigUrl", "ttvRemoteConfigVersion"], (result) => {
      var candidateUrl = result.ttvRemoteConfigUrl || this._defaultUrl;

      // Only allow HTTPS URLs from trusted domains
      if (candidateUrl && !candidateUrl.startsWith("https://")) {
        console.warn("[TTV] Remote config: Rejecting non-HTTPS URL");
        candidateUrl = this._defaultUrl;
      }
      var TRUSTED_DOMAINS = ["dorquex-ctrl.github.io", "raw.githubusercontent.com"];
      if (candidateUrl) {
        try {
          var urlHost = new URL(candidateUrl).hostname;
          if (!TRUSTED_DOMAINS.some(function (d) { return urlHost === d || urlHost.endsWith("." + d); })) {
            console.warn("[TTV] Remote config: Rejecting untrusted URL domain: " + urlHost);
            candidateUrl = this._defaultUrl;
          }
        } catch (e) {
          candidateUrl = this._defaultUrl;
        }
      }

      this._url = candidateUrl;
      this._lastVersion = result.ttvRemoteConfigVersion || 0;

      if (!this._url) {
        console.log("[TTV] Remote config: No URL configured — skipping. Set ttvRemoteConfigUrl in storage.");
        return;
      }

      console.log("[TTV] Remote config: URL = " + this._url);

      // Initial check after a short delay (let everything else init first)
      setTimeout(() => this._check(), 10000);

      // Periodic checks
      this._intervalId = setInterval(() => this._check(), this._checkIntervalMs);
    });
  },

  async _check() {
    if (!this._url) return;

    try {
      const response = await fetch(this._url, {
        cache: "no-cache",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) {
        console.warn("[TTV] Remote config: HTTP " + response.status);
        return;
      }

      const config = await response.json();

      // Only process if version is a valid positive number and newer
      if (typeof config._version !== "number" || config._version <= 0) {
        console.warn("[TTV] Remote config: Invalid or missing version");
        return;
      }
      if (config._version <= this._lastVersion) {
        return;
      }

      console.log("[TTV] Remote config: New version " + config._version + " (was " + this._lastVersion + ")");
      this._lastVersion = config._version;
      chrome.storage.local.set({ ttvRemoteConfigVersion: config._version });

      this._applyUpdates(config);
    } catch (e) {
      console.warn("[TTV] Remote config: Fetch error —", e.message);
    }
  },

  _applyUpdates(config) {
    // Build an update payload for content scripts / page-inject
    const updates = {};
    let hasUpdates = false;

    // Validate playbackAccessTokenHash: must be a 64-char hex string
    if (typeof config.playbackAccessTokenHash === "string" &&
        /^[a-f0-9]{64}$/.test(config.playbackAccessTokenHash)) {
      updates.playbackAccessTokenHash = config.playbackAccessTokenHash;
      hasUpdates = true;
    } else if (config.playbackAccessTokenHash) {
      console.warn("[TTV] Remote config: Rejected invalid playbackAccessTokenHash");
    }

    // Validate clientId: must be a 30-32 char alphanumeric string
    if (typeof config.clientId === "string" &&
        /^[a-z0-9]{30,32}$/.test(config.clientId)) {
      updates.clientId = config.clientId;
      hasUpdates = true;
    } else if (config.clientId) {
      console.warn("[TTV] Remote config: Rejected invalid clientId");
    }

    if (!hasUpdates) return;

    console.log("[TTV] Remote config: Applying updates —", Object.keys(updates).join(", "));

    // Broadcast to all Twitch tabs so page-inject can pick up new values
    chrome.tabs.query({ url: "*://*.twitch.tv/*" }, (tabs) => {
      for (var i = 0; i < tabs.length; i++) {
        chrome.tabs.sendMessage(tabs[i].id, {
          type: "REMOTE_CONFIG_UPDATED",
          config: updates
        });
      }
    });
  },
};
