const { performance } = require("node:perf_hooks");
const { Pinecone } = require("@pinecone-database/pinecone");

const { env } = require("../config/env");
const { EMBEDDING_DIMENSION, embedPolicyChunks, embedQuery } = require("./embeddingService");
const { normalizeText } = require("../utils/validator");
const { log } = require("../utils/logger");

// NOTE: the local policy catalog JSON is intentionally NOT used as a
// fallback data source anymore. Retrieval always goes through Pinecone —
// there is no in-process fallback path left to accidentally fall into.
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
  fallbackActivated: false, // kept for API/shape compatibility; always stays false now
};

function sanitizeFallbackReason(reason) {
  const normalized = String(reason || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

/**
 * Builds a rich, explicit error for any Pinecone/retrieval failure.
 * Every caller of this MUST let the error propagate (throw), never catch
 * it and silently substitute local data.
 */
function createRetrievalError(message, code = null, details = null, cause = null) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  error.details = details || undefined;
  error.stage = "pinecone";
  if (cause) {
    error.cause = cause;
    // Preserve the original stack trace chain for debugging.
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
    pinecone = new Pinecone({
      apiKey: env.pineconeApiKey,
    });
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
    if (rightTokens.has(token)) {
      return true;
    }
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

  if (!metadata.policyId || !metadata.policyClause) {
    return null;
  }

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

  if (phraseMatches(candidate.procedure, extractedData.requestedProcedure)) {
    rankingScore += 0.2;
  }

  if (candidate.allowedDiagnoses.some((diagnosis) => phraseMatches(diagnosis, extractedData.diagnosis))) {
    rankingScore += 0.15;
  }

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
    console.error(`[PINECONE] listIndexes() failed: ${error.message}`);
    throw createRetrievalError(
      "Could not reach Pinecone to list indexes. This almost always means " +
      "PINECONE_API_KEY is missing/invalid, or the key does not have access " +
      "to this project.",
      "PINECONE_UNREACHABLE",
      { originalMessage: error.message },
      error
    );
  }

  const indexes = indexList.indexes || [];
  const existing = indexes.find((index) => index.name === env.pineconeIndexName);

  if (!existing) {
    console.log(`[PINECONE] Index "${env.pineconeIndexName}" not found. Creating it with dimension=${EMBEDDING_DIMENSION}...`);
    log("INFO", "pinecone.index.create.start", {
      indexName: env.pineconeIndexName,
      dimension: EMBEDDING_DIMENSION,
      cloud: env.pineconeCloud,
      region: env.pineconeRegion,
    });

    try {
      await client.createIndex({
        name: env.pineconeIndexName,
        dimension: EMBEDDING_DIMENSION,
        metric: "cosine",
        waitUntilReady: true,
        suppressConflicts: true,
        spec: {
          serverless: {
            cloud: env.pineconeCloud,
            region: env.pineconeRegion,
          },
        },
      });
    } catch (error) {
      console.error(`[PINECONE] createIndex() failed: ${error.message}`);
      throw createRetrievalError(
        `Failed to create Pinecone index "${env.pineconeIndexName}" in ` +
        `${env.pineconeCloud}/${env.pineconeRegion}. Check that this ` +
        "cloud/region combination is enabled for your Pinecone plan.",
        "INDEX_CREATE_FAILED",
        { originalMessage: error.message },
        error
      );
    }

    console.log(`[PINECONE] Index "${env.pineconeIndexName}" created successfully.`);
  } else {
    const actualDimension = Number(existing.dimension);
    console.log(`[PINECONE] Found existing index "${env.pineconeIndexName}" (dimension=${actualDimension}, metric=${existing.metric}, host=${existing.host || "n/a"}).`);

    if (actualDimension !== EMBEDDING_DIMENSION) {
      const message =
        `Pinecone index "${env.pineconeIndexName}" has dimension ${actualDimension}, ` +
        `but AuthClear's embedding model ("${env.geminiEmbeddingModel}") produces ` +
        `${EMBEDDING_DIMENSION}-dimensional vectors. Either delete/recreate the index ` +
        `with dimension ${EMBEDDING_DIMENSION}, or point PINECONE_INDEX_NAME at a ` +
        "fresh index name so AuthClear can create a correctly-dimensioned one.";
      console.error(`[PINECONE] DIMENSION MISMATCH: ${message}`);
      throw createRetrievalError(message, "INDEX_DIMENSION_MISMATCH", {
        expectedDimension: EMBEDDING_DIMENSION,
        actualDimension,
      });
    }
  }

  retrievalState.indexExists = true;

  const index = client.index(env.pineconeIndexName);
  console.log(`[PINECONE] Connection status: connected. Using namespace="${env.pineconeNamespace}".`);

  return {
    index,
    namespaceIndex: index.namespace(env.pineconeNamespace),
  };
}

async function getNamespaceVectorCount(index) {
  const stats = await index.describeIndexStats();
  const vectorCount = Number(stats.namespaces?.[env.pineconeNamespace]?.recordCount || 0);
  retrievalState.vectorCount = vectorCount;
  console.log(`[PINECONE] Namespace "${env.pineconeNamespace}" currently has ${vectorCount} vector(s).`);
  return vectorCount;
}

async function upsertVectors(namespaceIndex, records) {
  if (!records || records.length === 0) {
    console.log("[PINECONE] No valid records to upsert.");
    return;
  }

  console.log(`[PINECONE] Upserting ${records.length} vector(s) in batches...`);
  
  // GUARANTEED FIX: Batch processing. Pinecone SDK handles small batches perfectly.
  const BATCH_SIZE = 50;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    await namespaceIndex.upsert(batch);
    console.log(`[PINECONE] Upserted batch ${i / BATCH_SIZE + 1} (${batch.length} vectors).`);
  }
  
  console.log("[PINECONE] Upsert complete.");
}

async function syncPolicyCatalog(options = {}) {
  const { force = false } = options;
  const syncStarted = performance.now();

  log("INFO", "retrieval.sync.start", {
    force,
    policyCount: policyCatalog.length,
    namespace: env.pineconeNamespace,
  });

  const { index, namespaceIndex } = await ensurePolicyIndex();
  const existingCount = await getNamespaceVectorCount(index);

  if (!force && existingCount >= policyCatalog.length) {
    retrievalState.ready = true;
    retrievalState.mode = "pinecone";
    retrievalState.lastSyncAt = new Date().toISOString();
    retrievalState.lastError = null;
    retrievalState.lastErrorCode = null;
    retrievalState.fallbackActivated = false;

    console.log(`[PINECONE] Sync skipped — namespace already has ${existingCount} vector(s).`);
    return { indexed: false, count: existingCount, mode: "pinecone", ready: true };
  }

  const chunks = policyCatalog.map(buildPolicyChunk);

  console.log(`[EMBEDDING] Generating embeddings for ${chunks.length} policy chunk(s)...`);
  const vectors = await embedPolicyChunks(chunks);
  console.log(`[EMBEDDING] Generation success — produced ${vectors.length} vector(s), dimension=${vectors[0]?.length ?? "unknown"}.`);

  if (vectors[0] && vectors[0].length !== EMBEDDING_DIMENSION) {
    throw createRetrievalError(
      `Embedding model returned ${vectors[0].length}-dimensional vectors but AuthClear expects ${EMBEDDING_DIMENSION}.`,
      "EMBEDDING_DIMENSION_MISMATCH"
    );
  }

  // GUARANTEED FIX: Bulletproof record mapping to satisfy Pinecone's strict validator
  const records = vectors.map((values, indexPosition) => {
    const policy = policyCatalog[indexPosition];
    
    // 1. MUST have a valid string ID
    const recordId = String(policy.id || policy.policyId || `policy-chunk-${indexPosition}`);
    
    // 2. Strict Metadata Cleaning (Pinecone rejects undefined/null)
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
      policyClause: policy.policyClause ? String(policy.policyClause) : "",
      chunkText: String(chunks[indexPosition] || ""),
    };

    // Remove any accidental undefined values
    const cleanMetadata = Object.fromEntries(
      Object.entries(rawMetadata).filter(([_, v]) => v !== undefined && v !== null)
    );

    return {
      id: recordId,
      // Ensure values is a standard array
      values: Array.isArray(values) ? values : Array.from(values),
      metadata: cleanMetadata,
    };
  });

  await upsertVectors(namespaceIndex, records);
  const vectorCount = await getNamespaceVectorCount(index);

  retrievalState.ready = vectorCount > 0;
  retrievalState.mode = retrievalState.ready ? "pinecone" : "unavailable";
  retrievalState.lastSyncAt = new Date().toISOString();
  retrievalState.lastError = retrievalState.ready ? null : "No vectors available in Pinecone namespace after upsert.";
  retrievalState.lastErrorCode = retrievalState.ready ? null : "EMPTY_NAMESPACE";
  retrievalState.fallbackActivated = false;

  log("INFO", "retrieval.sync.complete", {
    indexedCount: records.length,
    namespaceVectorCount: vectorCount,
    ready: retrievalState.ready,
    latencyMs: Math.round(performance.now() - syncStarted),
  });

  if (!retrievalState.ready) {
    throw createRetrievalError("Pinecone retrieval is not ready because no vectors are available after upsert.", "EMPTY_NAMESPACE");
  }

  return { indexed: true, count: records.length, mode: "pinecone", ready: true };
}

async function retrieveRelevantPolicy(extractedData) {
  const retrievalStarted = performance.now();

  try {
    const { namespaceIndex } = await ensurePolicyIndex();
    const queryText = buildQueryText(extractedData);

    console.log(`[EMBEDDING] Generating query embedding: "${queryText.slice(0, 80).replace(/\n/g, " ")}..."`);
    log("INFO", "retrieval.query.embed.start", { queryPreview: queryText.slice(0, 120) });

    const queryVector = await embedQuery(queryText);
    console.log(`[EMBEDDING] Generation success — query vector dimension=${queryVector.length}.`);

    if (queryVector.length !== EMBEDDING_DIMENSION) {
      throw createRetrievalError(
        `Query embedding returned dimension ${queryVector.length}, expected ${EMBEDDING_DIMENSION}.`,
        "EMBEDDING_DIMENSION_MISMATCH"
      );
    }

    console.log(`[PINECONE] Executing vector search (topK=3) against namespace "${env.pineconeNamespace}"...`);
    const response = await namespaceIndex.query({
      vector: queryVector,
      topK: 3,
      includeMetadata: true,
    });

    const matches = response.matches || [];
    console.log(`[PINECONE] Vector search complete — retrieved ${matches.length} document(s).`);

    log("INFO", "retrieval.query.complete", {
      retrievedDocumentCount: matches.length,
      latencyMs: Math.round(performance.now() - retrievalStarted),
    });

    if (matches.length === 0) {
      throw createRetrievalError("No matching policy clause was found in Pinecone for this query.", "NO_MATCHES");
    }

    const candidates = matches
      .map(mapPolicyMetadata)
      .filter(Boolean)
      .sort((left, right) => rankCandidate(right, extractedData) - rankCandidate(left, extractedData));

    if (candidates.length === 0) {
      throw createRetrievalError("Pinecone matches were returned without usable metadata.", "INVALID_METADATA");
    }

    retrievalState.ready = true;
    retrievalState.mode = "pinecone";
    retrievalState.lastError = null;
    retrievalState.lastErrorCode = null;
    retrievalState.fallbackActivated = false;

    const bestMatch = candidates[0];

    return {
      ...bestMatch,
      retrievalMode: "pinecone",
      fallbackReason: null,
      topMatches: toTopMatches(candidates),
    };
  } catch (error) {
    retrievalState.ready = false;
    retrievalState.mode = "unavailable";
    retrievalState.lastError = sanitizeFallbackReason(error.message);
    retrievalState.lastErrorCode = error.code || "RETRIEVAL_FAILED";
    retrievalState.fallbackActivated = false;

    console.error(`[PINECONE] Retrieval FAILED — no fallback will be used. Reason: ${error.message}`);
    log("ERROR", "retrieval.query.failed", { latencyMs: Math.round(performance.now() - retrievalStarted), code: error.code || null }, error);

    throw createRetrievalError(
      `Pinecone retrieval failed: ${error.message}`,
      error.code || "RETRIEVAL_FAILED",
      { reason: sanitizeFallbackReason(error.message) },
      error
    );
  }
}

module.exports = {
  getRetrievalStatus,
  retrieveRelevantPolicy,
  syncPolicyCatalog,
};