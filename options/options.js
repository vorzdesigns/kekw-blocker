(function () {
  var DEFAULTS = {
    forcePlayerType: "popout",
    reloadAfterAd: true,
    blockTracking: true,
    bufferingFix: true,
    visibilitySpoofing: true,
    autoClaimPoints: true,
    showNotifications: true,
  };

  var KEYS = Object.keys(DEFAULTS);
  var DEBUG_FIELDS = {
    source: "debugSource",
    schemaVersion: "debugSchemaVersion",
    clientId: "debugClientId",
    hash: "debugHash",
    querySource: "debugQuerySource",
    signature: "debugSignature",
    lastFetch: "debugLastFetch",
    lastKnownGood: "debugLastKnownGood",
    tempFallbacks: "debugTempFallbacks"
  };

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function formatTimestamp(value) {
    if (!value) return "n/a";
    try {
      return new Date(value).toLocaleString();
    } catch (e) {
      return String(value);
    }
  }

  function setDebugStatus(message) {
    setText("debugStatus", message || "");
  }

  function load() {
    chrome.storage.local.get("ttvOptions", function (result) {
      var opts = Object.assign({}, DEFAULTS, result && result.ttvOptions || {});
      for (var i = 0; i < KEYS.length; i++) {
        var el = document.getElementById(KEYS[i]);
        if (!el) continue;
        if (el.type === "checkbox") {
          el.checked = !!opts[KEYS[i]];
        } else {
          el.value = opts[KEYS[i]];
        }
      }
    });
  }

  function save() {
    var opts = {};
    for (var i = 0; i < KEYS.length; i++) {
      var el = document.getElementById(KEYS[i]);
      if (!el) continue;
      if (el.type === "checkbox") {
        opts[KEYS[i]] = el.checked;
      } else {
        opts[KEYS[i]] = el.value;
      }
    }
    chrome.storage.local.set({ ttvOptions: opts });
    chrome.runtime.sendMessage({ type: "OPTIONS_UPDATED", options: opts });
  }

  function requestDebugState(callback) {
    chrome.runtime.sendMessage({ type: "GET_REMOTE_CONFIG_DEBUG_STATE" }, function (response) {
      if (chrome.runtime.lastError) {
        setDebugStatus("Debug unavailable: " + chrome.runtime.lastError.message);
        if (callback) callback(null);
        return;
      }
      if (callback) callback(response || null);
    });
  }

  function renderDebugState(state) {
    if (!state || !state.effectiveConfig) {
      setText(DEBUG_FIELDS.source, "Unavailable");
      setText(DEBUG_FIELDS.schemaVersion, "Unavailable");
      setText(DEBUG_FIELDS.clientId, "Unavailable");
      setText(DEBUG_FIELDS.hash, "Unavailable");
      setText(DEBUG_FIELDS.querySource, "Unavailable");
      setText(DEBUG_FIELDS.signature, "Unavailable");
      setText(DEBUG_FIELDS.lastFetch, "Unavailable");
      setText(DEBUG_FIELDS.lastKnownGood, "Unavailable");
      setText(DEBUG_FIELDS.tempFallbacks, "Unavailable");
      setText("debugRaw", "No debug state returned.");
      return;
    }

    var effective = state.effectiveConfig;
    var lastFetch = state.lastRemoteFetch || {};
    var lastKnownGood = state.lastKnownGood || {};
    var signature = state.signature || {};
    var tempFallbackKeys = Object.keys(state.temporaryRuntimeFallback || {});

    setText(DEBUG_FIELDS.source, effective.source || "unknown");
    setText(DEBUG_FIELDS.schemaVersion, String(effective.schema || 0) + " / " + String(effective.remoteConfigVersion || 0));
    setText(DEBUG_FIELDS.clientId, effective.clientId || "n/a");
    setText(DEBUG_FIELDS.hash, effective.playbackAccessTokenHash || "n/a");
    setText(DEBUG_FIELDS.querySource, effective.activeQuerySource || "bundled");
    setText(DEBUG_FIELDS.signature, signature.verified
      ? ("verified (" + (signature.keyId || "?") + ")")
      : ((effective.source && effective.source.indexOf("signed") !== -1)
        ? ("rejected" + (signature.message ? ": " + signature.message : ""))
        : "not loaded"));
    setText(DEBUG_FIELDS.lastFetch, (lastFetch.status || "idle") + " @ " + formatTimestamp(state.lastRemoteFetchAt));
    setText(DEBUG_FIELDS.lastKnownGood, lastKnownGood.version
      ? ("v" + lastKnownGood.version + " @ " + formatTimestamp(lastKnownGood.generatedAt))
      : "n/a");
    setText(DEBUG_FIELDS.tempFallbacks, tempFallbackKeys.length ? tempFallbackKeys.join(", ") : "none");
    setText("debugRaw", JSON.stringify(state.raw || state, null, 2));
  }

  function refreshDebug() {
    requestDebugState(function (state) {
      renderDebugState(state);
      setDebugStatus("");
    });
  }

  function bindDebugButtons() {
    var refreshButton = document.getElementById("refreshDebug");
    var resetRuntimeButton = document.getElementById("resetRuntimeLearning");
    var resetSignedCacheButton = document.getElementById("resetSignedCache");

    if (refreshButton) {
      refreshButton.addEventListener("click", function () {
        setDebugStatus("Refreshing debug state...");
        refreshDebug();
      });
    }
    if (resetRuntimeButton) {
      resetRuntimeButton.addEventListener("click", function () {
        setDebugStatus("Resetting runtime learning...");
        chrome.runtime.sendMessage({ type: "RESET_RUNTIME_LEARNED_STATE" }, function () {
          if (chrome.runtime.lastError) {
            setDebugStatus("Reset failed: " + chrome.runtime.lastError.message);
            return;
          }
          setDebugStatus("Runtime learning reset.");
          refreshDebug();
        });
      });
    }
    if (resetSignedCacheButton) {
      resetSignedCacheButton.addEventListener("click", function () {
        setDebugStatus("Resetting signed cache...");
        chrome.runtime.sendMessage({ type: "RESET_REMOTE_CONFIG_CACHE" }, function () {
          if (chrome.runtime.lastError) {
            setDebugStatus("Reset failed: " + chrome.runtime.lastError.message);
            return;
          }
          setDebugStatus("Signed cache reset.");
          refreshDebug();
        });
      });
    }
  }

  document.addEventListener("change", function (e) {
    if (KEYS.indexOf(e.target.id) !== -1) save();
  });

  load();
  bindDebugButtons();
  refreshDebug();
})();
