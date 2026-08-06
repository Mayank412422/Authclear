const { performance } = require("node:perf_hooks");
const { Pinecone } = require("@pinecone-database/pinecone");

const { env } = require("../config/env");
const { EMBEDDING_DIMENSION, embedPolicyChunks, embedQuery } = require("./embeddingService");
const { normalizeText } = require("../utils/validator");
const { log } = require("../utils/logger");

const policyCatalog = require("../data/policies.json");

let pinecone;

const retrievalState = {
  ready: false,
  mode: "uninitialized",
  indexExists: false,
  vectorCount: 0,
  lastSyncAt: null,
  lastError: null,
  lastErrorCode: null,
  fallbackActivated: false, 
};

function sanitizeFallbackReason(reason) {
  const normalized = String(reason || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

function createRetrievalError(message, code = null, details = null, cause = null) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  error.details = details || undefined;
  error.stage = "pinecone";
  if (cause) {
    error.cause = cause;
    error.stack = `${error.stack}\nCaused by: ${cause.stack || cause.message}`;
  }
  return error;
}

function getPineconeClient() {
  if (!pinecone) {
    if (!env.pineconeApiKey) {
      console.error("[PINECONE] Missing PINECONE_API_KEY — cannot initialize client.");
      throw createRetrievalError(
        "PINECONE_API_KEY is not configured. Set it in backend/.env.",
        "MISSING_API_KEY"
      );
    }
    console.log("[PINECONE] Initializing Pinecone client...");
    pinecone = new Pinecone({ apiKey: env.pineconeApiKey });
    console.log("[PINECONE] Client initialized.");
  }
  return pinecone;
}

function buildPolicyChunk(policy) {
  return [
    `Procedure: ${policy.procedure}`,
    `Covered diagnoses: ${(policy.allowedDiagnoses || []).join(", ")}`,
    policy.keywords?.length ? `Keywords: ${policy.keywords.join(", ")}` : null,
    `Minimum symptom duration: ${policy.minDurationMonths} months`,
    `Eligible age range: ${policy.ageMin} to ${policy.ageMax}`,
    `Clause: ${policy.policyClause}`,
  ].filter(Boolean).join("\n");
}

function buildQueryText(extractedData) {
  return [
    `Procedure request: ${extractedData.requestedProcedure}`,
    `Diagnosis: ${extractedData.diagnosis}`,
    `Symptom duration: ${extractedData.symptomDuration} months`,
    `Age: ${extractedData.age}`,
  ].join("\n");
}

function normalizeScore(score) {
  return Math.max(0, Math.min(score || 0, 1));
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function hasMeaningfulOverlap(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  for (const token of leftTokens) {
    if (rightTokens.has(token)) return true;
  }
  return false;
}

function phraseMatches(policyValue, extractedValue) {
  const policyNormalized = normalizeText(policyValue);
  const extractedNormalized = normalizeText(extractedValue);

  return (
    policyNormalized === extractedNormalized
    || policyNormalized.includes(extractedNormalized)
    || extractedNormalized.includes(policyNormalized)
    || hasMeaningfulOverlap(policyNormalized, extractedNormalized)
  );
}

function mapPolicyMetadata(record) {
  const metadata = record.metadata || {};
  if (!metadata.policyId || !metadata.policyClause) return null;

  return {
    id: metadata.policyId,
    source: metadata.source,
    procedure: metadata.procedure,
    procedureNormalized: metadata.procedureNormalized,
    allowedDiagnoses: metadata.allowedDiagnoses || [],
    allowedDiagnosesNormalized: metadata.allowedDiagnosesNormalized || [],
    keywords: metadata.keywords || [],
    keywordsNormalized: metadata.keywordsNormalized || [],
    minDurationMonths: Number(metadata.minDurationMonths),
    ageMin: Number(metadata.ageMin),
    ageMax: Number(metadata.ageMax),
    clause: metadata.policyClause,
    score: normalizeScore(record.score),
    chunkText: metadata.chunkText || metadata.policyClause,
  };
}

function rankCandidate(candidate, extractedData) {
  let rankingScore = candidate.score;

  if (phraseMatches(candidate.procedure, extractedData.requestedProcedure)) rankingScore += 0.2;
  if (candidate.allowedDiagnoses.some((diagnosis) => phraseMatches(diagnosis, extractedData.diagnosis))) rankingScore += 0.15;

  const queryText = buildQueryText(extractedData);
  const keywordMatches = (candidate.keywords || []).filter((keyword) => phraseMatches(keyword, queryText)).length;
  rankingScore += Math.min(keywordMatches * 0.05, 0.2);

  return rankingScore;
}

function toTopMatches(candidates) {
  return candidates.map((candidate) => ({
    id: candidate.id,
    procedure: candidate.procedure,
    clause: candidate.clause,
    score: candidate.score,
    chunkText: candidate.chunkText,
  }));
}

function getRetrievalStatus() {
  return {
    ready: retrievalState.ready,
    mode: retrievalState.mode,
    indexExists: retrievalState.indexExists,
    vectorCount: retrievalState.vectorCount,
    lastSyncAt: retrievalState.lastSyncAt,
    lastError: retrievalState.lastError,
    lastErrorCode: retrievalState.lastErrorCode,
    degraded: retrievalState.mode !== "pinecone",
    fallbackActivated: retrievalState.fallbackActivated,
    namespace: env.pineconeNamespace,
    indexName: env.pineconeIndexName,
  };
}

async function ensurePolicyIndex() {
  const client = getPineconeClient();
  console.log(`[PINECONE] Checking for index "${env.pineconeIndexName}" (cloud=${env.pineconeCloud}, region=${env.pineconeRegion})...`);

  let indexList;
  try {
    indexList = await client.listIndexes();
  } catch (error) {
    throw createRetrievalError("Could not reach Pinecone to list indexes.", "PINECONE_UNREACHABLE", { originalMessage: error.message }, error);
  }

  const indexes = indexList.indexes || [];
  const existing = indexes.find((index) => index.name === env.pineconeIndexName);

  if (!existing) {
    console.log(`[PINECONE] Index "${env.pineconeIndexName}" not found. Creating it with dimension=${EMBEDDING_DIMENSION}...`);
    try {
      await client.createIndex({
        name: env.pineconeIndexName,
        dimension: EMBEDDING_DIMENSION,
        metric: "cosine",
        waitUntilReady: true,
        suppressConflicts: true,
        spec: { serverless: { cloud: env.pineconeCloud, region: env.pineconeRegion } },
      });
    } catch (error) {
      throw createRetrievalError(`Failed to create Pinecone index "${env.pineconeIndexName}".`, "INDEX_CREATE_FAILED", { originalMessage: error.message }, error);
    }
  } else {
    const actualDimension = Number(existing.dimension);
    console.log(`[PINECONE] Found existing index "${env.pineconeIndexName}" (dimension=${actualDimension}).`);
    if (actualDimension !== EMBEDDING_DIMENSION) {
      throw createRetrievalError(`Dimension mismatch. Index is ${actualDimension}, expected ${EMBEDDING_DIMENSION}.`, "INDEX_DIMENSION_MISMATCH", { expectedDimension: EMBEDDING_DIMENSION, actualDimension });
    }
  }

  retrievalState.indexExists = true;
  const index = client.index(env.pineconeIndexName);
  console.log(`[PINECONE] Connection status: connected. Using namespace="${env.pineconeNamespace}".`);

  return { index, namespaceIndex: index.namespace(env.pineconeNamespace) };
}

async function getNamespaceVectorCount(index) {
  const stats = await index.describeIndexStats();
  const vectorCount = Number(stats.namespaces?.[env.pineconeNamespace]?.recordCount || 0);
  retrievalState.vectorCount = vectorCount;
  console.log(`[PINECONE] Namespace "${env.pineconeNamespace}" currently has ${vectorCount} vector(s).`);
  return vectorCount;
}

// THE FIX: Strict Array Mapping and removed broken fallback syntax
async function upsertVectors(namespaceIndex, records) {
  if (!records || records.length === 0) {
    console.log("[PINECONE] No valid records to upsert.");
    return;
  }

  console.log(`[PINECONE] Upserting ${records.length} vector(s) in batches...`);
  const BATCH_SIZE = 50;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    // 1. Ensure a pure array of standard objects (strips hidden properties)
    const batch = records.slice(i, i + BATCH_SIZE).map(record => ({
      id: String(record.id),
      values: Array.from(record.values),
      metadata: record.metadata
    }));

    // 2. Strict empty guard
    if (batch.length === 0) continue;

    try {
      // 3. Modern SDK syntax strictly requires a flat array. No object fallbacks.
      await namespaceIndex.upsert(batch);
      console.log(`[PINECONE] Upserted batch ${i / BATCH_SIZE + 1} (${batch.length} vectors).`);
    } catch (error) {
      console.error(`[PINECONE] FATAL error on batch ${i / BATCH_SIZE + 1}:`, error.message);
      // Fail loudly to trigger a clean 503 instead of silent corruption
      throw error; 
    }
  }
  console.log("[PINECONE] Upsert complete.");
}

async function syncPolicyCatalog(options = {}) {
  const { force = false } = options;
  const syncStarted = performance.now();

  const { index, namespaceIndex } = await ensurePolicyIndex();
  const existingCount = await getNamespaceVectorCount(index);

  if (!force && existingCount >= policyCatalog.length) {
    retrievalState.ready = true;
    retrievalState.mode = "pinecone";
    return { indexed: false, count: existingCount, mode: "pinecone", ready: true };
  }

  const chunks = policyCatalog.map(buildPolicyChunk);
  const vectors = await embedPolicyChunks(chunks);

  // ULTIMATE METADATA CLEANER: Prevents Pinecone from silently dropping records
  const records = vectors.map((values, indexPosition) => {
    const policy = policyCatalog[indexPosition];
    const recordId = String(policy.id || policy.policyId || `policy-chunk-${indexPosition}`).trim();

    const rawMetadata = {
      policyId: recordId,
      source: policy.source ? String(policy.source) : "unknown",
      procedure: policy.procedure ? String(policy.procedure) : "unknown",
      procedureNormalized: normalizeText(policy.procedure || ""),
      allowedDiagnoses: Array.isArray(policy.allowedDiagnoses) ? policy.allowedDiagnoses.map(String) : [],
      allowedDiagnosesNormalized: Array.isArray(policy.allowedDiagnoses) ? policy.allowedDiagnoses.map(normalizeText) : [],
      keywords: Array.isArray(policy.keywords) ? policy.keywords.map(String) : [],
      keywordsNormalized: Array.isArray(policy.keywords) ? policy.keywords.map(normalizeText) : [],
      minDurationMonths: Number(policy.minDurationMonths || 0),
      ageMin: Number(policy.ageMin || 0),
      ageMax: Number(policy.ageMax || 999),
      policyClause: policy.policyClause ? String(policy.policyClause) : "unknown",
      chunkText: String(chunks[indexPosition] || ""),
    };

    // Strip ALL empty arrays, empty strings, and nulls that crash Pinecone
    const cleanMetadata = Object.fromEntries(
      Object.entries(rawMetadata).filter(([_, v]) => {
        if (v === undefined || v === null) return false;
        if (Array.isArray(v) && v.length === 0) return false; // Fixes the drop bug
        if (typeof v === "string" && v.trim() === "") return false;
        if (typeof v === "number" && isNaN(v)) return false;
        return true;
      })
    );

    // Guarantee values are pure numbers
    const safeValues = Array.from(values).map(n => (typeof n === 'number' && !isNaN(n)) ? n : 0.00001);

    return {
      id: recordId,
      values: safeValues,
      metadata: cleanMetadata,
    };
  });

  await upsertVectors(namespaceIndex, records);
  const vectorCount = await getNamespaceVectorCount(index);

  retrievalState.ready = vectorCount > 0;
  retrievalState.mode = retrievalState.ready ? "pinecone" : "unavailable";

  if (!retrievalState.ready) {
    throw createRetrievalError("Pinecone retrieval is not ready because no vectors are available after upsert.", "EMPTY_NAMESPACE");
  }

  return { indexed: true, count: records.length, mode: "pinecone", ready: true };
}

async function retrieveRelevantPolicy(extractedData) {
  try {
    const { namespaceIndex } = await ensurePolicyIndex();
    const queryText = buildQueryText(extractedData);
    const queryVector = await embedQuery(queryText);

    const response = await namespaceIndex.query({
      vector: queryVector,
      topK: 3,
      includeMetadata: true,
    });

    const matches = response.matches || [];
    if (matches.length === 0) throw createRetrievalError("No matches found.", "NO_MATCHES");

    const candidates = matches
      .map(mapPolicyMetadata)
      .filter(Boolean)
      .sort((left, right) => rankCandidate(right, extractedData) - rankCandidate(left, extractedData));

    if (candidates.length === 0) throw createRetrievalError("Invalid metadata.", "INVALID_METADATA");

    retrievalState.ready = true;
    retrievalState.mode = "pinecone";
    
    return {
      ...candidates[0],
      retrievalMode: "pinecone",
      fallbackReason: null,
      topMatches: toTopMatches(candidates),
    };
  } catch (error) {
    retrievalState.ready = false;
    retrievalState.mode = "unavailable";
    throw createRetrievalError(`Pinecone retrieval failed: ${error.message}`, error.code || "RETRIEVAL_FAILED", { reason: sanitizeFallbackReason(error.message) }, error);
  }
}

module.exports = {
  getRetrievalStatus,
  retrieveRelevantPolicy,
  syncPolicyCatalog,
};