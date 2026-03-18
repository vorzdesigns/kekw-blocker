// Runs at document_start - injects the page hook with persisted startup state.
(function () {
  "use strict";
  if (window !== window.top) return;

  var nonce = Math.random().toString(36).substring(2);
  var root = document.documentElement || document.head || document.body;
  var queuedMessages = [];
  var pageReady = false;
  var RUNTIME_STATE_KEY = "ttvRuntimeState";
  var RUNTIME_STATE_TTL_MS = 6 * 60 * 60 * 1000;
  var PLAYER_TYPE_RANKING_KEY = "ttvPlayerTypeRanking";
  var PLAYER_TYPE_RANKING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var PLAYER_TYPE_RANKING_MAX_CHANNELS = 50;
  var pendingRuntimeStatePatch = {};
  var runtimeStateFlushTimer = null;
  var runtimeStateSendInFlight = false;
  var pendingPlayerTypeRankingPatches = [];
  var playerTypeRankingFlushTimer = null;
  var playerTypeRankingSendInFlight = false;

  document.documentElement.setAttribute("data-ttv-nonce", nonce);

  function mergePageConfig(remoteConfig) {
    var pageConfig = JSON.parse(JSON.stringify(TTV_CONFIG));
    if (remoteConfig && typeof remoteConfig === "object") {
      if (typeof remoteConfig.clientId === "string") {
        pageConfig.gql.clientId = remoteConfig.clientId;
      }
      if (typeof remoteConfig.playbackAccessTokenHash === "string") {
        pageConfig.gql.playbackAccessTokenHash = remoteConfig.playbackAccessTokenHash;
      }
    }
    return pageConfig;
  }

  function dispatchToPage(message) {
    if (!message || !message.type) return;
    if (message.type === "OPTIONS_UPDATED") {
      window.dispatchEvent(new CustomEvent("ttv-" + nonce + "-options", { detail: message.options }));
    }
    if (message.type === "SET_ENABLED") {
      window.dispatchEvent(new CustomEvent("ttv-" + nonce + "-enabled", { detail: { enabled: message.enabled } }));
    }
    if (message.type === "REMOTE_CONFIG_UPDATED") {
      window.dispatchEvent(new CustomEvent("ttv-" + nonce + "-config", { detail: message.config }));
    }
  }

  function sanitizeRuntimeState(patch) {
    var clean = {};
    if (!patch || typeof patch !== "object") return clean;

    function keepString(key, maxLength, pattern) {
      if (typeof patch[key] !== "string") return;
      var value = patch[key].trim();
      if (!value || value.length > maxLength) return;
      if (pattern && !pattern.test(value)) return;
      clean[key] = value;
    }

    keepString("gqlDeviceId", 128, /^[a-z0-9-]{16,128}$/i);
    keepString("clientIntegrityHeader", 4096);
    keepString("authorizationHeader", 4096);
    keepString("clientVersion", 256);
    keepString("clientSession", 256, /^[a-z0-9-]{8,256}$/i);
    return clean;
  }

  function mergeRuntimeStatePatch(target, patch) {
    for (var key in patch) {
      target[key] = patch[key];
    }
  }

  function scheduleRuntimeStateFlush(delayMs) {
    if (runtimeStateFlushTimer) return;
    runtimeStateFlushTimer = setTimeout(function () {
      runtimeStateFlushTimer = null;
      flushRuntimeState();
    }, typeof delayMs === "number" ? delayMs : 0);
  }

  function flushRuntimeState() {
    if (runtimeStateSendInFlight) return;
    if (!Object.keys(pendingRuntimeStatePatch).length) return;

    var payload = pendingRuntimeStatePatch;
    pendingRuntimeStatePatch = {};
    runtimeStateSendInFlight = true;
    chrome.runtime.sendMessage({
      type: "PERSIST_RUNTIME_STATE",
      patch: payload
    }, function () {
      runtimeStateSendInFlight = false;
      if (chrome.runtime.lastError) {
        mergeRuntimeStatePatch(pendingRuntimeStatePatch, payload);
        scheduleRuntimeStateFlush(1000);
        return;
      }
      if (Object.keys(pendingRuntimeStatePatch).length) {
        scheduleRuntimeStateFlush(0);
      }
    });
  }

  function persistRuntimeState(patch) {
    var clean = sanitizeRuntimeState(patch);
    if (!Object.keys(clean).length) return;
    mergeRuntimeStatePatch(pendingRuntimeStatePatch, clean);
    scheduleRuntimeStateFlush(0);
  }

  function getAllowedPlayerTypes() {
    var configured = TTV_CONFIG && TTV_CONFIG.player && TTV_CONFIG.player.backupPlayerTypes;
    return Array.isArray(configured) && configured.length ? configured : ["embed", "site", "popout", "autoplay"];
  }

  function clampPlayerTypeScore(score) {
    return Math.max(-20, Math.min(40, Math.round(score)));
  }

  function sanitizePlayerTypeScores(scores) {
    var clean = {};
    var allowed = getAllowedPlayerTypes();
    if (!scores || typeof scores !== "object") return clean;
    for (var i = 0; i < allowed.length; i++) {
      var playerType = allowed[i];
      if (typeof scores[playerType] !== "number" || !isFinite(scores[playerType])) continue;
      var value = clampPlayerTypeScore(scores[playerType]);
      if (value !== 0) clean[playerType] = value;
    }
    return clean;
  }

  function isValidChannelName(value) {
    return typeof value === "string" && /^[a-z0-9_]{1,50}$/i.test(value.trim());
  }

  function sanitizePlayerTypeRankingPatch(patch) {
    if (!patch || typeof patch !== "object" || !patch.deltas) return null;
    var clean = {
      channelName: null,
      deltas: sanitizePlayerTypeScores(patch.deltas)
    };
    if (!Object.keys(clean.deltas).length) return null;
    if (isValidChannelName(patch.channelName)) {
      clean.channelName = patch.channelName.trim().toLowerCase();
    }
    return clean;
  }

  function prunePlayerTypeRanking(ranking) {
    var clean = { updatedAt: 0, global: {}, channels: {} };
    if (!ranking || typeof ranking !== "object") return clean;

    clean.updatedAt = typeof ranking.updatedAt === "number" ? ranking.updatedAt : 0;
    clean.global = sanitizePlayerTypeScores(ranking.global);

    var channels = ranking.channels || {};
    var now = Date.now();
    var kept = [];
    for (var name in channels) {
      if (!isValidChannelName(name)) continue;
      var entry = channels[name];
      if (!entry || typeof entry !== "object") continue;
      var updatedAt = typeof entry.updatedAt === "number" ? entry.updatedAt : 0;
      if (!updatedAt || now - updatedAt > PLAYER_TYPE_RANKING_TTL_MS) continue;
      var scores = sanitizePlayerTypeScores(entry.scores);
      if (!Object.keys(scores).length) continue;
      kept.push({
        name: name.trim().toLowerCase(),
        updatedAt: updatedAt,
        scores: scores
      });
    }
    kept.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    for (var i = 0; i < kept.length && i < PLAYER_TYPE_RANKING_MAX_CHANNELS; i++) {
      clean.channels[kept[i].name] = {
        updatedAt: kept[i].updatedAt,
        scores: kept[i].scores
      };
    }
    return clean;
  }

  function applyPlayerTypeScoreDeltas(target, deltas) {
    var allowed = getAllowedPlayerTypes();
    for (var i = 0; i < allowed.length; i++) {
      var playerType = allowed[i];
      if (typeof deltas[playerType] !== "number") continue;
      var nextValue = clampPlayerTypeScore((target[playerType] || 0) + deltas[playerType]);
      if (nextValue) target[playerType] = nextValue;
      else delete target[playerType];
    }
  }

  function persistPlayerTypeRanking(patch) {
    var clean = sanitizePlayerTypeRankingPatch(patch);
    if (!clean) return;
    pendingPlayerTypeRankingPatches.push(clean);
    schedulePlayerTypeRankingFlush(0);
  }

  function schedulePlayerTypeRankingFlush(delayMs) {
    if (playerTypeRankingFlushTimer) return;
    playerTypeRankingFlushTimer = setTimeout(function () {
      playerTypeRankingFlushTimer = null;
      flushPlayerTypeRanking();
    }, typeof delayMs === "number" ? delayMs : 0);
  }

  function flushPlayerTypeRanking() {
    if (playerTypeRankingSendInFlight) return;
    if (!pendingPlayerTypeRankingPatches.length) return;

    var payload = pendingPlayerTypeRankingPatches.shift();
    playerTypeRankingSendInFlight = true;
    chrome.runtime.sendMessage({
      type: "PERSIST_PLAYER_TYPE_RANKING",
      patch: payload
    }, function () {
      playerTypeRankingSendInFlight = false;
      if (chrome.runtime.lastError) {
        pendingPlayerTypeRankingPatches.unshift(payload);
        schedulePlayerTypeRankingFlush(1000);
        return;
      }
      if (pendingPlayerTypeRankingPatches.length) {
        schedulePlayerTypeRankingFlush(0);
      }
    });
  }

  window.addEventListener("ttv-" + nonce + "-runtime", function (event) {
    if (!event || !event.detail) return;
    persistRuntimeState(event.detail);
  });
  window.addEventListener("ttv-" + nonce + "-player-rank", function (event) {
    if (!event || !event.detail) return;
    persistPlayerTypeRanking(event.detail);
  });
  window.addEventListener("ttv-" + nonce + "-runtime-candidate", function (event) {
    if (!event || !event.detail || !event.detail.type || typeof event.detail.value !== "string") return;
    chrome.runtime.sendMessage({
      type: "REMOTE_CONFIG_RUNTIME_CANDIDATE",
      candidate: {
        type: event.detail.type,
        value: event.detail.value
      }
    });
  });
  window.addEventListener("ttv-" + nonce + "-remote-config-failure", function (event) {
    if (!event || !event.detail || !event.detail.type || typeof event.detail.value !== "string") return;
    chrome.runtime.sendMessage({
      type: "REMOTE_CONFIG_FAILURE",
      failure: {
        type: event.detail.type,
        value: event.detail.value,
        reason: typeof event.detail.reason === "string" ? event.detail.reason : ""
      }
    });
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message) return;
    if (!pageReady) {
      queuedMessages.push(message);
      return;
    }
    dispatchToPage(message);
  });

  function injectPage(startupState) {
    var configScript = document.createElement("script");
    configScript.textContent =
      "window.__TTV_CONFIG = " + JSON.stringify(mergePageConfig(startupState.remoteConfig)) + ";" +
      "window.__TTV_NONCE = " + JSON.stringify(nonce) + ";" +
      "window.__TTV_STARTUP = " + JSON.stringify({
        enabled: startupState.enabled !== false,
        options: startupState.options || {},
        remoteConfig: startupState.remoteConfig || {},
        runtime: startupState.runtime || {},
        playerTypeRanking: startupState.playerTypeRanking || { global: {}, channels: {} }
      }) + ";";
    root.appendChild(configScript);
    configScript.remove();

    var script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/content/page-inject.js");
    script.onload = function () {
      pageReady = true;
      script.remove();
      for (var i = 0; i < queuedMessages.length; i++) {
        dispatchToPage(queuedMessages[i]);
      }
      queuedMessages = [];
    };
    root.appendChild(script);
  }

  chrome.storage.local.get(["ttvOptions", "ttvEnabled", "ttvRemoteConfigCache", RUNTIME_STATE_KEY, PLAYER_TYPE_RANKING_KEY], function (result) {
    var runtimeState = result && result[RUNTIME_STATE_KEY];
    var runtimeValues = {};
    if (runtimeState && runtimeState.values) {
      var now = Date.now();
      var timestamps = runtimeState.updatedAtByKey || {};
      for (var key in runtimeState.values) {
        var updatedAt = timestamps[key] || runtimeState.updatedAt || 0;
        if (updatedAt && now - updatedAt < RUNTIME_STATE_TTL_MS) {
          runtimeValues[key] = runtimeState.values[key];
        }
      }
    }
    injectPage({
      options: result && result.ttvOptions || {},
      enabled: !(result && result.ttvEnabled === false),
      remoteConfig: result && result.ttvRemoteConfigCache || {},
      runtime: runtimeValues,
      playerTypeRanking: prunePlayerTypeRanking(result && result[PLAYER_TYPE_RANKING_KEY])
    });
  });
})();
