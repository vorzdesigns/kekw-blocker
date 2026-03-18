#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const {
  applyCandidates,
  canonicalizeForSignature,
  createValueRecord,
  normalizeV2Config,
  signConfig,
  verifyConfig
} = require("./remote-config-v2");

function main() {
  const bundledQuery = 'query PlaybackAccessToken($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }';
  const legacyConfig = {
    _version: 3,
    _lastChecked: "2026-03-16T04:16:57.440Z",
    playbackAccessTokenHash: "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9",
    clientId: "b31o4btkqth5bzbvr9ub2ovr79umhh",
    _lastUpdateSource: "regex-extraction"
  };

  const normalized = normalizeV2Config(legacyConfig, bundledQuery);
  assert.equal(normalized._schema, 2);
  assert.equal(normalized.gql.clientId.active.value, legacyConfig.clientId);
  assert.equal(normalized.gql.playbackAccessToken.hash.active.value, legacyConfig.playbackAccessTokenHash);
  assert.equal(normalized.gql.playbackAccessToken.query.active.value, bundledQuery);

  const applied = applyCandidates(legacyConfig, {
    clientId: createValueRecord("kimne78kx3ncx6brgo4mv6wki5h1ko", "ai", "medium", "2026-03-18T00:00:00.000Z"),
    playbackAccessTokenHash: createValueRecord("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "ai", "medium", "2026-03-18T00:00:00.000Z"),
    playbackAccessTokenQuery: createValueRecord(bundledQuery + " ", "ai", "medium", "2026-03-18T00:00:00.000Z")
  }, bundledQuery);
  assert.equal(applied.changed, true);
  assert.equal(applied.config.gql.clientId.active.value, "kimne78kx3ncx6brgo4mv6wki5h1ko");
  assert.equal(applied.config.gql.clientId.fallbacks[0].value, legacyConfig.clientId);
  assert.equal(applied.config.gql.playbackAccessToken.hash.fallbacks[0].value, legacyConfig.playbackAccessTokenHash);

  const keys = crypto.generateKeyPairSync("ed25519");
  const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = keys.publicKey.export({ type: "spki", format: "pem" });
  const signed = signConfig(applied.config, privatePem, "k-test");

  assert.ok(verifyConfig(signed, { "k-test": publicPem }));
  assert.equal(verifyConfig(signed, { other: publicPem }), false);
  assert.equal(canonicalizeForSignature(signed).indexOf("\"signature\""), -1);

  console.log("remote-config-v2 tests passed");
}

main();
