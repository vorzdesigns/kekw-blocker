#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { signConfig } = require("./remote-config-v2");

const ROOT = path.resolve(__dirname, "..");
const REMOTE_CONFIG_PATH = path.join(ROOT, "remote-config.json");

function main() {
  const privateKey = process.env.REMOTE_CONFIG_ED25519_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("REMOTE_CONFIG_ED25519_PRIVATE_KEY is required");
  }

  const keyId = process.env.REMOTE_CONFIG_KEY_ID || "k1";
  const current = JSON.parse(fs.readFileSync(REMOTE_CONFIG_PATH, "utf8"));
  const signed = signConfig(current, privateKey, keyId);
  fs.writeFileSync(REMOTE_CONFIG_PATH, JSON.stringify(signed, null, 2) + "\n");
  console.log("Signed remote-config.json with key " + keyId);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
