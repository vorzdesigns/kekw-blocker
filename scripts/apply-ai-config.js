#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  applyCandidates,
  createValueRecord,
  getBundledPlaybackAccessTokenQuery,
  isValidClientId,
  isValidHash,
  isValidQuery,
  normalizeV2Config,
  signConfig,
  validateClientId,
  validateHash,
  validateQuery
} = require("./remote-config-v2");

const ROOT = path.resolve(__dirname, "..");
const REMOTE_CONFIG_PATH = path.join(ROOT, "remote-config.json");
const AI_RESULT_PATH = process.argv[2] ? path.resolve(process.argv[2]) : "/tmp/ai_result.json";
const SHOULD_OPEN_ISSUE_PATH = process.env.AI_FALLBACK_SHOULD_OPEN_ISSUE_FILE || "";

function loadAiResult() {
  const raw = fs.readFileSync(AI_RESULT_PATH, "utf8").trim();
  const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

async function main() {
  const aiResult = loadAiResult();
  if (aiResult.confidence === "low") {
    if (SHOULD_OPEN_ISSUE_PATH) {
      fs.writeFileSync(SHOULD_OPEN_ISSUE_PATH, "true");
    }
    console.log("AI confidence is low - skipping auto-update");
    process.exit(0);
  }

  const current = JSON.parse(fs.readFileSync(REMOTE_CONFIG_PATH, "utf8"));
  const bundledQuery = getBundledPlaybackAccessTokenQuery();
  const currentNormalized = normalizeV2Config(current, bundledQuery);
  const currentClientId = currentNormalized.gql.clientId.active && currentNormalized.gql.clientId.active.value || "";
  const currentHash = currentNormalized.gql.playbackAccessToken.hash.active && currentNormalized.gql.playbackAccessToken.hash.active.value || "";
  const currentQuery = currentNormalized.gql.playbackAccessToken.query.active && currentNormalized.gql.playbackAccessToken.query.active.value || bundledQuery;
  const candidates = {};

  if (isValidClientId(aiResult.clientId) && await validateClientId(aiResult.clientId, aiResult.playbackAccessTokenHash || currentHash, aiResult.playbackAccessTokenQuery || currentQuery)) {
    candidates.clientId = createValueRecord(aiResult.clientId, "ai", aiResult.confidence === "medium" ? "medium" : "high");
  }

  const effectiveClientId = candidates.clientId && candidates.clientId.value || currentClientId;
  if (isValidHash(aiResult.playbackAccessTokenHash) && await validateHash(aiResult.playbackAccessTokenHash, effectiveClientId)) {
    candidates.playbackAccessTokenHash = createValueRecord(aiResult.playbackAccessTokenHash, "ai", aiResult.confidence === "medium" ? "medium" : "high");
  }
  if (isValidQuery(aiResult.playbackAccessTokenQuery) && await validateQuery(aiResult.playbackAccessTokenQuery, effectiveClientId)) {
    candidates.playbackAccessTokenQuery = createValueRecord(aiResult.playbackAccessTokenQuery, "ai", aiResult.confidence === "medium" ? "medium" : "high");
  }

  const applied = applyCandidates(current, candidates, bundledQuery);
  if (!applied.changed) {
    console.log("AI found no validated updates to apply");
    process.exit(0);
  }

  const privateKey = process.env.REMOTE_CONFIG_ED25519_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("REMOTE_CONFIG_ED25519_PRIVATE_KEY is required");
  }
  const keyId = process.env.REMOTE_CONFIG_KEY_ID || "k1";
  const signed = signConfig(applied.config, privateKey, keyId);
  fs.writeFileSync(REMOTE_CONFIG_PATH, JSON.stringify(signed, null, 2) + "\n");
  console.log("Config updated via AI fallback");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
