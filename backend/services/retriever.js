const { performance } = require("node:perf_hooks");
const { Pinecone } = require("@pinecone-database/pinecone");

const { env } = require("../config/env");
const policyCatalog = require("../data/policies.json");
const { EMBEDDING_DIMENSION, embedPolicyChunks, embedQuery } = require("./embeddingService");
const { normalizeText } = require("../utils/validator");
const { log } = require("../utils/logger");

let pinecone;

const retrievalState = {
  ready: false,
  mode: "uninitialized",
  indexExists: false,
  vectorCount: 0,
  lastSyncAt: null,
  lastError: null,
  fallbackActivated: false,
};

function sanitizeFallbackReason(reason) {
  const normalized = String(reason || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`;
}

function createRetrievalError(message, code = null, details = null) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  error.details = details || undefined;
  return error;
}

function getPineconeClient() {
  if (!pinecone) {
    if (!env.pineconeApiKey) {
      throw createRetrievalError("PINECONE_API_KEY is not configured.", "MISSING_API_KEY");
    }

    pinecone = new Pinecone({
      apiKey: env.pineconeApiKey,
    });
  }

  return pinecone;
}

function buildPolicyChunk(policy) {
  return [
    `Procedure: ${policy.procedure}`,
    `Covered diagnoses: ${policy.allowedDiagnoses.join(", ")}`,
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

function createPolicyCandidate(policy, score, retrievalMode, fallbackReason = null) {
  return {
    id: policy.id,
    source: policy.source,
    procedure: policy.procedure,
    procedureNormalized: normalizeText(policy.procedure),
    allowedDiagnoses: policy.allowedDiagnoses,
    allowedDiagnosesNormalized: policy.allowedDiagnoses.map(normalizeText),
    keywords: policy.keywords || [],
    keywordsNormalized: (policy.keywords || []).map(normalizeText),
    minDurationMonths: Number(policy.minDurationMonths),
    ageMin: Number(policy.ageMin),
    ageMax: Number(policy.ageMax),
    clause: policy.policyClause,
    score: normalizeScore(score),
    retrievalMode,
    fallbackReason,
    chunkText: buildPolicyChunk(policy),
  };
}

function scoreLocalPolicy(policy, extractedData) {
  let score = 0.15;
  const normalizedProcedure = normalizeText(extractedData.requestedProcedure);
  const policyProcedure = normalizeText(policy.procedure);

  if (phraseMatches(policy.procedure, extractedData.requestedProcedure)) {
    score += 0.55;
  } else if (policyProcedure.includes(normalizedProcedure) || normalizedProcedure.includes(policyProcedure)) {
    score += 0.25;
  }

  if (policy.allowedDiagnoses.some((diagnosis) => phraseMatches(diagnosis, extractedData.diagnosis))) {
    score += 0.25;
  }

  const queryText = buildQueryText(extractedData);
  const keywordMatches = (policy.keywords || []).filter((keyword) => phraseMatches(keyword, queryText)).length;
  score += Math.min(keywordMatches * 0.05, 0.25);

  if (extractedData.symptomDuration >= policy.minDurationMonths) {
    score += 0.03;
  }

  if (extractedData.age >= policy.ageMin && extractedData.age <= policy.ageMax) {
    score += 0.02;
  }

  return normalizeScore(score);
}

function retrieveLocalPolicy(extractedData, fallbackReason) {
  const sanitizedReason = sanitizeFallbackReason(fallbackReason);
  const candidates = policyCatalog
    .map((policy) => createPolicyCandidate(
      policy,
      scoreLocalPolicy(policy, extractedData),
      "local-catalog",
      sanitizedReason,
    ))
    .sort((left, right) => rankCandidate(right, extractedData) - rankCandidate(left, extractedData));

  if (candidates.length === 0) {
    const error = new Error("No local policy clauses are available.");
    error.statusCode = 404;
    throw error;
  }

  const bestMatch = candidates[0];

  return {
    ...bestMatch,
    topMatches: candidates.slice(0, 3).map((candidate) => ({
      id: candidate.id,
      procedure: candidate.procedure,
      clause: candidate.clause,
      score: candidate.score,
      chunkText: candidate.chunkText,
    })),
  };
}

async function ensurePolicyIndex() {
  const client = getPineconeClient();
  const indexList = await client.listIndexes();
  const indexes = indexList.indexes || [];
  const exists = indexes.some((index) => index.name === env.pineconeIndexName);

  if (!exists) {
    log("INFO", "pinecone.index.create.start", {
      indexName: env.pineconeIndexName,
      dimension: EMBEDDING_DIMENSION,
      cloud: env.pineconeCloud,
      region: env.pineconeRegion,
    });

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
  }

  retrievalState.indexExists = true;

  const index = client.index(env.pineconeIndexName);
  return {
    index,
    namespaceIndex: index.namespace(env.pineconeNamespace),
  };
}

async function getNamespaceVectorCount(index) {
  const stats = await index.describeIndexStats();
  const vectorCount = Number(stats.namespaces?.[env.pineconeNamespace]?.recordCount || 0);
  retrievalState.vectorCount = vectorCount;
  return vectorCount;
}

async function upsertVectors(namespaceIndex, records) {
  await namespaceIndex.upsert(records);
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
    degraded: retrievalState.mode !== "pinecone",
    fallbackActivated: retrievalState.fallbackActivated,
    namespace: env.pineconeNamespace,
    indexName: env.pineconeIndexName,
  };
}

async function syncPolicyCatalog(options = {}) {
  const { force = false } = options;
  const syncStarted = performance.now();

  try {
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
      retrievalState.fallbackActivated = false;

      log("INFO", "retrieval.sync.skip", {
        reason: "sufficient_vectors",
        existingCount,
        latencyMs: Math.round(performance.now() - syncStarted),
      });

      return {
        indexed: false,
        count: existingCount,
        mode: "pinecone",
        ready: true,
      };
    }

    const chunks = policyCatalog.map(buildPolicyChunk);
    const vectors = await embedPolicyChunks(chunks);

    const records = vectors.map((values, indexPosition) => {
      const policy = policyCatalog[indexPosition];
      return {
        id: policy.id,
        values,
        metadata: {
          policyId: policy.id,
          source: policy.source,
          procedure: policy.procedure,
          procedureNormalized: normalizeText(policy.procedure),
          allowedDiagnoses: policy.allowedDiagnoses,
          allowedDiagnosesNormalized: policy.allowedDiagnoses.map(normalizeText),
          keywords: policy.keywords || [],
          keywordsNormalized: (policy.keywords || []).map(normalizeText),
          minDurationMonths: policy.minDurationMonths,
          ageMin: policy.ageMin,
          ageMax: policy.ageMax,
          policyClause: policy.policyClause,
          chunkText: chunks[indexPosition],
        },
      };
    });

    await upsertVectors(namespaceIndex, records);
    const vectorCount = await getNamespaceVectorCount(index);

    retrievalState.ready = vectorCount > 0;
    retrievalState.mode = retrievalState.ready ? "pinecone" : "unavailable";
    retrievalState.lastSyncAt = new Date().toISOString();
    retrievalState.lastError = retrievalState.ready
      ? null
      : "No vectors available in Pinecone namespace after upsert.";
    retrievalState.fallbackActivated = false;

    log("INFO", "retrieval.sync.complete", {
      indexedCount: records.length,
      namespaceVectorCount: vectorCount,
      ready: retrievalState.ready,
      latencyMs: Math.round(performance.now() - syncStarted),
    });

    if (!retrievalState.ready) {
      throw createRetrievalError(
        "Pinecone retrieval is not ready because no vectors are available.",
        "EMPTY_NAMESPACE",
      );
    }

    return {
      indexed: true,
      count: records.length,
      mode: "pinecone",
      ready: true,
    };
  } catch (error) {
    retrievalState.ready = false;
    retrievalState.mode = env.allowDegradedAiFallback ? "local-catalog" : "unavailable";
    retrievalState.lastError = sanitizeFallbackReason(error.message);
    retrievalState.lastSyncAt = new Date().toISOString();

    log("ERROR", "retrieval.sync.failed", {
      namespace: env.pineconeNamespace,
      fallbackEnabled: env.allowDegradedAiFallback,
      latencyMs: Math.round(performance.now() - syncStarted),
    }, error);

    return {
      indexed: false,
      count: policyCatalog.length,
      mode: env.allowDegradedAiFallback ? "local-catalog" : "unavailable",
      error: sanitizeFallbackReason(error.message),
      errorCode: error.code || null,
      ready: false,
    };
  }
}

async function retrieveRelevantPolicy(extractedData) {
  const retrievalStarted = performance.now();

  try {
    const { namespaceIndex } = await ensurePolicyIndex();
    const queryText = buildQueryText(extractedData);

    log("INFO", "retrieval.query.embed.start", {
      queryPreview: queryText.slice(0, 120),
    });

    const queryVector = await embedQuery(queryText);
    const response = await namespaceIndex.query({
      vector: queryVector,
      topK: 3,
      includeMetadata: true,
    });

    const matches = response.matches || [];

    log("INFO", "retrieval.query.complete", {
      retrievedDocumentCount: matches.length,
      latencyMs: Math.round(performance.now() - retrievalStarted),
    });

    if (matches.length === 0) {
      const notFound = createRetrievalError(
        "No matching policy clause was found in Pinecone.",
        "NO_MATCHES",
      );
      notFound.statusCode = 404;
      throw notFound;
    }

    const candidates = matches
      .map(mapPolicyMetadata)
      .filter(Boolean)
      .sort((left, right) => rankCandidate(right, extractedData) - rankCandidate(left, extractedData));

    if (candidates.length === 0) {
      const metadataError = createRetrievalError(
        "Policy matches were returned without usable metadata.",
        "INVALID_METADATA",
      );
      metadataError.statusCode = 502;
      throw metadataError;
    }

    retrievalState.ready = true;
    retrievalState.mode = "pinecone";
    retrievalState.lastError = null;
    retrievalState.fallbackActivated = false;

    const bestMatch = candidates[0];

    return {
      ...bestMatch,
      retrievalMode: "pinecone",
      fallbackReason: null,
      topMatches: toTopMatches(candidates),
    };
  } catch (error) {
    log("ERROR", "retrieval.query.failed", {
      fallbackEnabled: env.allowDegradedAiFallback,
      latencyMs: Math.round(performance.now() - retrievalStarted),
    }, error);

    if (!env.allowDegradedAiFallback) {
      throw createRetrievalError(
        "Pinecone retrieval failed and degraded fallback is disabled.",
        error.code || "RETRIEVAL_FAILED",
        {
          reason: sanitizeFallbackReason(error.message),
        },
      );
    }

    retrievalState.fallbackActivated = true;
    retrievalState.mode = "local-catalog";
    retrievalState.lastError = sanitizeFallbackReason(error.message);

    log("WARN", "retrieval.fallback.activated", {
      reason: sanitizeFallbackReason(error.message),
    });

    return retrieveLocalPolicy(extractedData, error.message);
  }
}

module.exports = {
  getRetrievalStatus,
  retrieveRelevantPolicy,
  syncPolicyCatalog,
};
