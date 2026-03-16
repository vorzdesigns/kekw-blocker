#!/usr/bin/env node
/**
 * extract-config.js — Automated Twitch config extraction
 *
 * Fetches Twitch's production JS bundles and extracts volatile values:
 *   - PlaybackAccessToken persisted query hash
 *   - Client-ID
 *   - GQL operation names (ad-related)
 *   - Known CSS data-a-target selectors
 *
 * Usage:
 *   node scripts/extract-config.js              # check & print diff
 *   node scripts/extract-config.js --update     # write changes to remote-config.json
 *   node scripts/extract-config.js --ci         # exit code 1 if changes detected
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const REMOTE_CONFIG_PATH = path.resolve(__dirname, "..", "remote-config.json");
const TWITCH_URL = "https://www.twitch.tv/";

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function fetch(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetch(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout: " + url)); });
  });
}

// ─── Bundle discovery ────────────────────────────────────────────────────────

async function discoverBundleUrls(html) {
  // Twitch loads JS from static.twitchcdn.net or assets.twitch.tv
  const scriptPattern = /(?:src|href)=["'](https?:\/\/(?:static\.twitchcdn\.net|assets\.twitch\.tv)[^"']+\.js)["']/g;
  const urls = new Set();
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    urls.add(match[1]);
  }

  // Also check for dynamically-loaded chunk patterns in inline scripts
  const chunkPattern = /["'](https?:\/\/(?:static\.twitchcdn\.net|assets\.twitch\.tv)\/assets\/[^"']+\.js)["']/g;
  while ((match = chunkPattern.exec(html)) !== null) {
    urls.add(match[1]);
  }

  return Array.from(urls);
}

// ─── Value extraction ────────────────────────────────────────────────────────

function extractPlaybackAccessTokenHash(bundleText) {
  // Pattern 1: persisted query definition near PlaybackAccessToken
  // e.g., "PlaybackAccessToken"...sha256Hash:"<hash>"
  const patterns = [
    // Direct association: operationName + sha256Hash nearby
    /PlaybackAccessToken[^}]{0,500}sha256Hash\s*:\s*["']([a-f0-9]{64})["']/,
    /sha256Hash\s*:\s*["']([a-f0-9]{64})["'][^}]{0,500}PlaybackAccessToken/,
    // Persisted query object pattern
    /["']PlaybackAccessToken["']\s*[,:]\s*[^}]*?["']([a-f0-9]{64})["']/,
    // operationName assignment near hash
    /operationName\s*:\s*["']PlaybackAccessToken["'][^}]{0,800}sha256Hash\s*:\s*["']([a-f0-9]{64})["']/,
  ];

  for (const pattern of patterns) {
    const match = bundleText.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractClientId(bundleText) {
  // Twitch Client-ID is typically a 30-char alphanumeric string
  // Often appears near "Client-ID" header assignment
  const patterns = [
    /["']Client-ID["']\s*[,:]\s*["']([a-z0-9]{30,32})["']/i,
    /clientId\s*[=:]\s*["']([a-z0-9]{30,32})["']/,
    /CLIENT_ID\s*[=:]\s*["']([a-z0-9]{30,32})["']/,
  ];

  for (const pattern of patterns) {
    const match = bundleText.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractSelectors(bundleText) {
  // Extract data-a-target and data-test-selector values related to ads/player
  const selectorPattern = /data-(?:a-target|test-selector)=["']([^"']*(?:ad|commercial|overlay|player)[^"']*)["']/gi;
  const selectors = new Set();
  let match;
  while ((match = selectorPattern.exec(bundleText)) !== null) {
    selectors.add(match[1]);
  }
  return Array.from(selectors).sort();
}

// ─── Live validation ────────────────────────────────────────────────────────
// Instead of escalating to AI when regex can't find a value, probe Twitch's
// GQL endpoint to check whether the current value still works. One small POST
// vs an OpenAI call + bundle re-download.

function validateHash(hash, clientId) {
  return new Promise((resolve) => {
    if (!hash || !clientId) return resolve(false);

    const body = JSON.stringify({
      operationName: "PlaybackAccessToken",
      variables: { isLive: true, login: "twitch", isVod: false, vodID: "", playerType: "site" },
      extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
    });

    const req = https.request(
      {
        hostname: "gql.twitch.tv",
        path: "/gql",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Client-ID": clientId,
        },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            // PersistedQueryNotFound means the hash is stale
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              if (item.errors) {
                for (const err of item.errors) {
                  if (err.message && err.message.includes("PersistedQueryNotFound")) {
                    return resolve(false);
                  }
                }
              }
            }
            // Any non-error response means the hash is accepted
            resolve(true);
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

// ─── Main extraction pipeline ────────────────────────────────────────────────

async function extractConfig() {
  console.log("[extract] Fetching twitch.tv...");
  const html = await fetch(TWITCH_URL);

  console.log("[extract] Discovering JS bundles...");
  const bundleUrls = await discoverBundleUrls(html);
  console.log(`[extract] Found ${bundleUrls.length} bundle(s)`);

  if (bundleUrls.length === 0) {
    throw new Error("No JS bundles found — Twitch may have changed their HTML structure");
  }

  // Fetch all bundles (limit concurrency to 5)
  const results = {
    playbackAccessTokenHash: null,
    clientId: null,
    discoveredSelectors: [],
  };

  const allBundleText = [];

  for (let i = 0; i < bundleUrls.length; i += 5) {
    const batch = bundleUrls.slice(i, i + 5);
    console.log(`[extract] Fetching bundles ${i + 1}-${Math.min(i + 5, bundleUrls.length)} of ${bundleUrls.length}...`);
    const texts = await Promise.all(
      batch.map((url) => fetch(url).catch((e) => { console.warn(`[extract] Failed to fetch ${url}: ${e.message}`); return ""; }))
    );
    allBundleText.push(...texts);
  }

  const combined = allBundleText.join("\n");

  console.log("[extract] Extracting PlaybackAccessToken hash...");
  results.playbackAccessTokenHash = extractPlaybackAccessTokenHash(combined);

  console.log("[extract] Extracting Client-ID...");
  results.clientId = extractClientId(combined);

  console.log("[extract] Extracting ad-related selectors...");
  results.discoveredSelectors = extractSelectors(combined);

  results.bundleCount = bundleUrls.length;
  return results;
}

// ─── Diff + update logic ─────────────────────────────────────────────────────

function loadCurrentConfig() {
  try {
    return JSON.parse(fs.readFileSync(REMOTE_CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function computeDiff(current, extracted) {
  const changes = [];

  if (extracted.playbackAccessTokenHash && extracted.playbackAccessTokenHash !== current.playbackAccessTokenHash) {
    changes.push({
      field: "playbackAccessTokenHash",
      old: current.playbackAccessTokenHash || "(not set)",
      new: extracted.playbackAccessTokenHash,
    });
  }

  if (extracted.clientId && extracted.clientId !== current.clientId) {
    changes.push({
      field: "clientId",
      old: current.clientId || "(not set)",
      new: extracted.clientId,
    });
  }

  return changes;
}

function applyChanges(current, changes) {
  const updated = { ...current };
  for (const change of changes) {
    updated[change.field] = change.new;
  }
  updated._lastChecked = new Date().toISOString();
  updated._version = (current._version || 0) + 1;
  updated._lastUpdateSource = "regex-extraction";
  return updated;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const shouldUpdate = args.includes("--update");
  const ciMode = args.includes("--ci");

  try {
    const extracted = await extractConfig();
    const current = loadCurrentConfig();

    console.log("\n[extract] Results:");
    console.log("  PlaybackAccessToken hash:", extracted.playbackAccessTokenHash || "NOT FOUND");
    console.log("  Client-ID:", extracted.clientId || "NOT FOUND");
    console.log("  Ad selectors found:", extracted.discoveredSelectors.length > 0 ? extracted.discoveredSelectors.join(", ") : "none");

    const changes = computeDiff(current, extracted);

    // Check for missing fields BEFORE early exit — even if no changes were
    // detected, regex may have failed to find values entirely (null vs existing).
    const missing = [];
    if (!extracted.playbackAccessTokenHash) missing.push("playbackAccessTokenHash");
    if (!extracted.clientId) missing.push("clientId");

    if (changes.length === 0 && missing.length === 0) {
      console.log("\n[extract] No changes detected. Config is up to date.");
      process.exit(0);
    }

    if (changes.length > 0) {
      console.log(`\n[extract] ${changes.length} change(s) detected:`);
      for (const change of changes) {
        if (change.added) {
          console.log(`  ${change.field}: added ${change.added.join(", ")}`);
        } else {
          console.log(`  ${change.field}: ${change.old} -> ${change.new}`);
        }
      }

      // Write any successful changes first, regardless of failures
      if (shouldUpdate || ciMode) {
        const updated = applyChanges(current, changes);
        fs.writeFileSync(REMOTE_CONFIG_PATH, JSON.stringify(updated, null, 2) + "\n");
        console.log(`\n[extract] Updated ${REMOTE_CONFIG_PATH}`);
      } else {
        console.log("\n[extract] Run with --update to apply changes.");
      }
    }

    if (missing.length > 0) {
      console.warn(`\n[extract] WARNING: Regex could not find: ${missing.join(", ")}`);

      // Before escalating to AI, validate whether the current values still work.
      // One lightweight GQL probe saves an expensive AI call when the regex just
      // can't find the value but the existing config is perfectly fine.
      const effectiveClientId = extracted.clientId || current.clientId;
      const effectiveHash = extracted.playbackAccessTokenHash || current.playbackAccessTokenHash;
      const trueFailures = [];

      if (!extracted.playbackAccessTokenHash && current.playbackAccessTokenHash) {
        console.log("[extract] Validating current playbackAccessTokenHash against Twitch GQL...");
        const hashOk = await validateHash(current.playbackAccessTokenHash, effectiveClientId);
        if (hashOk) {
          console.log("[extract] Current hash still valid — no escalation needed.");
        } else {
          console.warn("[extract] Current hash REJECTED by Twitch — escalation required.");
          trueFailures.push("playbackAccessTokenHash");
        }
      } else if (!extracted.playbackAccessTokenHash) {
        trueFailures.push("playbackAccessTokenHash");
      }

      if (!extracted.clientId && current.clientId) {
        // If we got this far with a working GQL call above, the clientId is fine too.
        // But if we didn't test it yet, do a quick probe.
        console.log("[extract] Validating current clientId against Twitch GQL...");
        const clientOk = await validateHash(effectiveHash, current.clientId);
        if (clientOk) {
          console.log("[extract] Current clientId still valid — no escalation needed.");
        } else {
          console.warn("[extract] Current clientId REJECTED by Twitch — escalation required.");
          trueFailures.push("clientId");
        }
      } else if (!extracted.clientId) {
        trueFailures.push("clientId");
      }

      if (trueFailures.length > 0) {
        console.warn(`\n[extract] CONFIRMED stale: ${trueFailures.join(", ")}`);
        console.warn("[extract] Escalating to AI fallback.");

        if (ciMode) {
          const failureReport = {
            timestamp: new Date().toISOString(),
            failedFields: trueFailures,
            bundleCount: extracted.bundleCount,
            message: "Values confirmed stale via live validation. AI fallback needed.",
          };
          fs.writeFileSync(
            path.resolve(__dirname, "..", "extraction-failure.json"),
            JSON.stringify(failureReport, null, 2)
          );
          process.exit(2); // Exit code 2 = extraction failure (triggers AI fallback)
        }
      } else {
        console.log("\n[extract] All current values validated — regex miss is benign.");
      }
    }

    if (ciMode && changes.length > 0) {
      process.exit(1); // Exit code 1 = changes written
    }
  } catch (e) {
    console.error("[extract] Fatal error:", e.message);

    if (ciMode) {
      const failureReport = {
        timestamp: new Date().toISOString(),
        failedFields: ["all"],
        error: e.message,
        message: "Complete extraction failure. Twitch may be unreachable or fundamentally changed.",
      };
      fs.writeFileSync(
        path.resolve(__dirname, "..", "extraction-failure.json"),
        JSON.stringify(failureReport, null, 2)
      );
      process.exit(2);
    }
    process.exit(1);
  }
}

main();
