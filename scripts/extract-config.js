#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  applyCandidates,
  createValueRecord,
  fetchText,
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

const REMOTE_CONFIG_PATH = path.resolve(__dirname, "..", "remote-config.json");
const FAILURE_REPORT_PATH = path.resolve(__dirname, "..", "extraction-failure.json");
const TWITCH_URL = "https://www.twitch.tv/";

async function discoverBundleUrls(html) {
  const scriptPattern = /(?:src|href)=["'](https?:\/\/(?:static\.twitchcdn\.net|assets\.twitch\.tv)[^"']+\.js)["']/g;
  const chunkPattern = /["'](https?:\/\/(?:static\.twitchcdn\.net|assets\.twitch\.tv)\/assets\/[^"']+\.js)["']/g;
  const urls = new Set();
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    urls.add(match[1]);
  }
  while ((match = chunkPattern.exec(html)) !== null) {
    urls.add(match[1]);
  }
  return Array.from(urls);
}

function extractPlaybackAccessTokenHash(bundleText) {
  const patterns = [
    /PlaybackAccessToken[^}]{0,500}sha256Hash\s*:\s*["']([a-f0-9]{64})["']/,
    /sha256Hash\s*:\s*["']([a-f0-9]{64})["'][^}]{0,500}PlaybackAccessToken/,
    /["']PlaybackAccessToken["']\s*[,:]\s*[^}]*?["']([a-f0-9]{64})["']/,
    /operationName\s*:\s*["']PlaybackAccessToken["'][^}]{0,800}sha256Hash\s*:\s*["']([a-f0-9]{64})["']/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = bundleText.match(patterns[i]);
    if (match) return match[1];
  }
  return null;
}

function extractClientId(bundleText) {
  const patterns = [
    /["']Client-ID["']\s*[,:]\s*["']([a-z0-9]{30,32})["']/i,
    /clientId\s*[=:]\s*["']([a-z0-9]{30,32})["']/,
    /CLIENT_ID\s*[=:]\s*["']([a-z0-9]{30,32})["']/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = bundleText.match(patterns[i]);
    if (match) return match[1];
  }
  return null;
}

function extractPlaybackAccessTokenDocument(bundleText) {
  const anchor = 'value:"PlaybackAccessToken"}';
  const anchorIndex = bundleText.indexOf(anchor);
  if (anchorIndex === -1) return null;

  const start = bundleText.lastIndexOf('{kind:"Document"', anchorIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < bundleText.length; i++) {
    const ch = bundleText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return bundleText.slice(start, i + 1);
    }
  }

  return null;
}

function joinPrinted(parts, separator) {
  return (parts || []).filter(Boolean).join(separator || "") || "";
}

function wrapPrinted(prefix, value, suffix) {
  return value != null && value !== "" ? prefix + value + (suffix || "") : "";
}

function indentPrinted(value) {
  return wrapPrinted("  ", value.replace(/\n/g, "\n  "));
}

function blockPrinted(parts) {
  return wrapPrinted("{\n", indentPrinted(joinPrinted(parts, "\n")), "\n}");
}

function hasMultiline(parts) {
  return parts != null && parts.some((part) => typeof part === "string" && part.includes("\n"));
}

function printGraphqlNode(node) {
  switch (node.kind) {
    case "Name":
      return node.value;
    case "Variable":
      return "$" + printGraphqlNode(node.name);
    case "Document":
      return joinPrinted(node.definitions.map(printGraphqlNode), "\n\n") + "\n";
    case "OperationDefinition": {
      const op = node.operation;
      const name = node.name ? printGraphqlNode(node.name) : "";
      const vars = wrapPrinted("(", joinPrinted((node.variableDefinitions || []).map(printGraphqlNode), ", "), ")");
      const directives = joinPrinted((node.directives || []).map(printGraphqlNode), " ");
      const selectionSet = printGraphqlNode(node.selectionSet);
      return name || directives || vars || op !== "query"
        ? joinPrinted([op, joinPrinted([name, vars]), directives, selectionSet], " ")
        : selectionSet;
    }
    case "VariableDefinition":
      return printGraphqlNode(node.variable) + ": " + printGraphqlNode(node.type) +
        wrapPrinted(" = ", node.defaultValue ? printGraphqlNode(node.defaultValue) : "") +
        wrapPrinted(" ", joinPrinted((node.directives || []).map(printGraphqlNode), " "));
    case "SelectionSet":
      return blockPrinted((node.selections || []).map(printGraphqlNode));
    case "Field": {
      const alias = node.alias ? printGraphqlNode(node.alias) + ": " : "";
      const name = printGraphqlNode(node.name);
      const args = (node.arguments || []).map(printGraphqlNode);
      const directives = joinPrinted((node.directives || []).map(printGraphqlNode), " ");
      let head = alias + name + wrapPrinted("(", joinPrinted(args, ", "), ")");
      if (head.length > 80 || hasMultiline(args)) {
        head = alias + name + wrapPrinted("(\n", indentPrinted(joinPrinted(args, "\n")), "\n)");
      }
      return joinPrinted([head, directives, node.selectionSet ? printGraphqlNode(node.selectionSet) : ""], " ");
    }
    case "Argument":
      return printGraphqlNode(node.name) + ": " + printGraphqlNode(node.value);
    case "Directive":
      return "@" + printGraphqlNode(node.name) +
        wrapPrinted("(", joinPrinted((node.arguments || []).map(printGraphqlNode), ", "), ")");
    case "NamedType":
      return printGraphqlNode(node.name);
    case "ListType":
      return "[" + printGraphqlNode(node.type) + "]";
    case "NonNullType":
      return printGraphqlNode(node.type) + "!";
    case "StringValue":
      return JSON.stringify(node.value);
    case "BooleanValue":
      return node.value ? "true" : "false";
    case "NullValue":
      return "null";
    case "EnumValue":
      return node.value;
    case "IntValue":
    case "FloatValue":
      return node.value;
    case "ListValue":
      return "[" + joinPrinted((node.values || []).map(printGraphqlNode), ", ") + "]";
    case "ObjectValue":
      return "{" + joinPrinted((node.fields || []).map(printGraphqlNode), ", ") + "}";
    case "ObjectField":
      return printGraphqlNode(node.name) + ": " + printGraphqlNode(node.value);
    default:
      throw new Error("Unsupported AST node kind: " + node.kind);
  }
}

function derivePlaybackAccessTokenQuery(bundleText) {
  try {
    const documentLiteral = extractPlaybackAccessTokenDocument(bundleText);
    if (!documentLiteral) return null;
    const documentAst = Function('"use strict"; return (' + documentLiteral + ");")();
    if (!documentAst || documentAst.kind !== "Document") return null;
    return printGraphqlNode(documentAst);
  } catch {
    return null;
  }
}

function extractSelectors(bundleText) {
  const selectorPattern = /data-(?:a-target|test-selector)=["']([^"']*(?:ad|commercial|overlay|player)[^"']*)["']/gi;
  const selectors = new Set();
  let match;
  while ((match = selectorPattern.exec(bundleText)) !== null) {
    selectors.add(match[1]);
  }
  return Array.from(selectors).sort();
}

async function extractConfig() {
  console.log("[extract] Fetching twitch.tv...");
  const html = await fetchText(TWITCH_URL);

  console.log("[extract] Discovering JS bundles...");
  const bundleUrls = await discoverBundleUrls(html);
  console.log("[extract] Found " + bundleUrls.length + " bundle(s)");

  if (!bundleUrls.length) {
    throw new Error("No JS bundles found");
  }

  const allBundleText = [];
  for (let i = 0; i < bundleUrls.length; i += 5) {
    const batch = bundleUrls.slice(i, i + 5);
    console.log("[extract] Fetching bundles " + (i + 1) + "-" + Math.min(i + 5, bundleUrls.length) + " of " + bundleUrls.length + "...");
    const texts = await Promise.all(batch.map((url) => fetchText(url).catch((error) => {
      console.warn("[extract] Failed to fetch " + url + ": " + error.message);
      return "";
    })));
    allBundleText.push.apply(allBundleText, texts);
  }

  const combined = allBundleText.join("\n");
  const directHash = extractPlaybackAccessTokenHash(combined);
  const derivedQuery = derivePlaybackAccessTokenQuery(combined);

  return {
    playbackAccessTokenHash: directHash || (derivedQuery ? crypto.createHash("sha256").update(derivedQuery).digest("hex") : null),
    playbackAccessTokenHashSource: directHash ? "regex" : (derivedQuery ? "ast" : null),
    playbackAccessTokenQuery: derivedQuery,
    playbackAccessTokenQuerySource: derivedQuery ? "ast" : null,
    clientId: extractClientId(combined),
    clientIdSource: "regex",
    discoveredSelectors: extractSelectors(combined),
    bundleCount: bundleUrls.length
  };
}

function loadCurrentConfig() {
  try {
    return JSON.parse(fs.readFileSync(REMOTE_CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function buildFailureReport(failedFields, extracted, message, error) {
  const report = {
    timestamp: new Date().toISOString(),
    failedFields: failedFields,
    bundleCount: extracted && extracted.bundleCount || 0,
    message: message
  };
  if (error) report.error = error;
  return report;
}

function writeFailureReport(report) {
  fs.writeFileSync(FAILURE_REPORT_PATH, JSON.stringify(report, null, 2));
}

async function buildValidatedCandidates(extracted, currentNormalized, bundledQuery) {
  const candidates = {};
  const extractionNotes = [];
  const candidateStatus = {
    clientId: "missing",
    playbackAccessTokenHash: "missing",
    playbackAccessTokenQuery: "missing"
  };

  const currentClientId = currentNormalized.gql.clientId.active && currentNormalized.gql.clientId.active.value || "";
  const currentHash = currentNormalized.gql.playbackAccessToken.hash.active && currentNormalized.gql.playbackAccessToken.hash.active.value || "";
  const currentQuery = currentNormalized.gql.playbackAccessToken.query.active && currentNormalized.gql.playbackAccessToken.query.active.value || bundledQuery;

  let candidateClientId = null;
  if (isValidClientId(extracted.clientId)) {
    const clientOk = await validateClientId(extracted.clientId, extracted.playbackAccessTokenHash || currentHash, extracted.playbackAccessTokenQuery || currentQuery);
    if (clientOk) {
      candidateClientId = createValueRecord(extracted.clientId, extracted.clientIdSource || "regex", "high");
      candidates.clientId = candidateClientId;
      candidateStatus.clientId = "validated";
    } else {
      candidateStatus.clientId = "invalid";
      extractionNotes.push("clientId-validation-failed");
    }
  } else {
    extractionNotes.push("clientId-missing");
  }

  const effectiveClientId = candidateClientId && candidateClientId.value || currentClientId;

  if (isValidHash(extracted.playbackAccessTokenHash)) {
    const hashOk = await validateHash(extracted.playbackAccessTokenHash, effectiveClientId);
    if (hashOk) {
      const confidence = extracted.playbackAccessTokenHashSource === "ast" ? "medium" : "high";
      candidates.playbackAccessTokenHash = createValueRecord(
        extracted.playbackAccessTokenHash,
        extracted.playbackAccessTokenHashSource || "regex",
        confidence
      );
      candidateStatus.playbackAccessTokenHash = "validated";
    } else {
      candidateStatus.playbackAccessTokenHash = "invalid";
      extractionNotes.push("playbackAccessTokenHash-validation-failed");
    }
  } else {
    extractionNotes.push("playbackAccessTokenHash-missing");
  }

  if (isValidQuery(extracted.playbackAccessTokenQuery)) {
    const queryOk = await validateQuery(extracted.playbackAccessTokenQuery, effectiveClientId);
    if (queryOk) {
      const confidence = extracted.playbackAccessTokenQuerySource === "ast" ? "high" : "medium";
      candidates.playbackAccessTokenQuery = createValueRecord(
        extracted.playbackAccessTokenQuery,
        extracted.playbackAccessTokenQuerySource || "ast",
        confidence
      );
      candidateStatus.playbackAccessTokenQuery = "validated";
    } else {
      candidateStatus.playbackAccessTokenQuery = "invalid";
      extractionNotes.push("playbackAccessTokenQuery-validation-failed");
    }
  } else {
    extractionNotes.push("playbackAccessTokenQuery-missing");
  }

  return {
    candidates: candidates,
    extractionNotes: extractionNotes,
    candidateStatus: candidateStatus
  };
}

async function detectTrueFailures(validated, currentNormalized, bundledQuery) {
  const failedFields = [];
  const currentClientId = currentNormalized.gql.clientId.active && currentNormalized.gql.clientId.active.value;
  const currentHash = currentNormalized.gql.playbackAccessToken.hash.active && currentNormalized.gql.playbackAccessToken.hash.active.value;
  const currentQuery = currentNormalized.gql.playbackAccessToken.query.active && currentNormalized.gql.playbackAccessToken.query.active.value || bundledQuery;

  if (validated.candidateStatus.clientId !== "validated") {
    const clientOk = await validateClientId(currentClientId, currentHash, currentQuery);
    if (!clientOk) failedFields.push("clientId");
  }

  if (validated.candidateStatus.playbackAccessTokenHash !== "validated") {
    const hashOk = await validateHash(currentHash, currentClientId);
    if (!hashOk) failedFields.push("playbackAccessTokenHash");
  }

  if (validated.candidateStatus.playbackAccessTokenQuery !== "validated") {
    const queryOk = await validateQuery(currentQuery, currentClientId);
    if (!queryOk) failedFields.push("playbackAccessTokenQuery");
  }

  return failedFields;
}

function ensureSigningKey() {
  const privateKey = process.env.REMOTE_CONFIG_ED25519_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("REMOTE_CONFIG_ED25519_PRIVATE_KEY is required to write remote-config.json");
  }
  return {
    privateKey: privateKey,
    keyId: process.env.REMOTE_CONFIG_KEY_ID || "k1"
  };
}

async function main() {
  const args = process.argv.slice(2);
  const shouldWrite = args.includes("--update") || args.includes("--ci");
  const ciMode = args.includes("--ci");

  try {
    const bundledQuery = getBundledPlaybackAccessTokenQuery();
    const extracted = await extractConfig();
    const current = loadCurrentConfig();
    const currentNormalized = normalizeV2Config(current, bundledQuery);
    const validated = await buildValidatedCandidates(extracted, currentNormalized, bundledQuery);
    const applied = applyCandidates(current, validated.candidates, bundledQuery);

    console.log("\n[extract] Results:");
    console.log("  PlaybackAccessToken hash:", extracted.playbackAccessTokenHash || "NOT FOUND");
    console.log("  PlaybackAccessToken query:", extracted.playbackAccessTokenQuery ? "FOUND" : "NOT FOUND");
    console.log("  Client-ID:", extracted.clientId || "NOT FOUND");
    console.log("  Ad selectors found:", extracted.discoveredSelectors.length ? extracted.discoveredSelectors.join(", ") : "none");
    if (validated.extractionNotes.length) {
      console.log("  Notes:", validated.extractionNotes.join(", "));
    }

    if (applied.changed) {
      console.log("\n[extract] Config update prepared:");
      if (validated.candidates.clientId) {
        console.log("  clientId ->", validated.candidates.clientId.value);
      }
      if (validated.candidates.playbackAccessTokenHash) {
        console.log("  playbackAccessTokenHash ->", validated.candidates.playbackAccessTokenHash.value);
      }
      if (validated.candidates.playbackAccessTokenQuery) {
        console.log("  playbackAccessTokenQuery -> updated");
      }

      if (shouldWrite) {
        const signing = ensureSigningKey();
        const signed = signConfig(applied.config, signing.privateKey, signing.keyId);
        fs.writeFileSync(REMOTE_CONFIG_PATH, JSON.stringify(signed, null, 2) + "\n");
        console.log("\n[extract] Updated " + REMOTE_CONFIG_PATH);
      } else {
        console.log("\n[extract] Run with --update to apply changes.");
      }
    }

    const trueFailures = await detectTrueFailures(validated, currentNormalized, bundledQuery);
    if (trueFailures.length) {
      console.warn("\n[extract] Confirmed stale:", trueFailures.join(", "));
      if (ciMode) {
        writeFailureReport(buildFailureReport(
          trueFailures,
          extracted,
          "Values confirmed stale via live validation. AI fallback needed."
        ));
        process.exit(2);
      }
    } else if (!applied.changed) {
      console.log("\n[extract] No effective config changes detected.");
    }

    if (ciMode && applied.changed) {
      process.exit(1);
    }
  } catch (error) {
    console.error("[extract] Fatal error:", error.message);
    if (process.argv.slice(2).includes("--ci")) {
      writeFailureReport(buildFailureReport(
        ["all"],
        null,
        "Complete extraction failure. Twitch may be unreachable or fundamentally changed.",
        error.message
      ));
      process.exit(2);
    }
    process.exit(1);
  }
}

main();
