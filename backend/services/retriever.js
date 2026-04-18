const { Pinecone } = require("@pinecone-database/pinecone");

const { env } = require("../config/env");
const policyCatalog = require("../data/policies.json");
const { EMBEDDING_DIMENSION, embedPolicyChunks, embedQuery } = require("./embeddingService");
const { normalizeText } = require("../utils/validator");

let pinecone;

function getPineconeClient() {
  if (!pinecone) {
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
    `Minimum symptom duration: ${policy.minDurationMonths} months`,
    `Eligible age range: ${policy.ageMin} to ${policy.ageMax}`,
    `Clause: ${policy.policyClause}`,
  ].join("\n");
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
    minDurationMonths: Number(metadata.minDurationMonths),
    ageMin: Number(metadata.ageMin),
    ageMax: Number(metadata.ageMax),
    clause: metadata.policyClause,
    score: normalizeScore(record.score),
  };
}

function rankCandidate(candidate, extractedData) {
  let rankingScore = candidate.score;

  if (
    candidate.procedureNormalized === normalizeText(extractedData.requestedProcedure)
  ) {
    rankingScore += 0.2;
  }

  if (
    candidate.allowedDiagnosesNormalized.includes(
      normalizeText(extractedData.diagnosis)
    )
  ) {
    rankingScore += 0.15;
  }

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
    minDurationMonths: Number(policy.minDurationMonths),
    ageMin: Number(policy.ageMin),
    ageMax: Number(policy.ageMax),
    clause: policy.policyClause,
    score: normalizeScore(score),
    retrievalMode,
    fallbackReason,
  };
}

function scoreLocalPolicy(policy, extractedData) {
  let score = 0.15;
  const normalizedProcedure = normalizeText(extractedData.requestedProcedure);
  const normalizedDiagnosis = normalizeText(extractedData.diagnosis);
  const policyProcedure = normalizeText(policy.procedure);
  const allowedDiagnoses = policy.allowedDiagnoses.map(normalizeText);

  if (policyProcedure === normalizedProcedure) {
    score += 0.55;
  } else if (
    policyProcedure.includes(normalizedProcedure) ||
    normalizedProcedure.includes(policyProcedure)
  ) {
    score += 0.25;
  }

  if (allowedDiagnoses.includes(normalizedDiagnosis)) {
    score += 0.25;
  }

  if (extractedData.symptomDuration >= policy.minDurationMonths) {
    score += 0.03;
  }

  if (extractedData.age >= policy.ageMin && extractedData.age <= policy.ageMax) {
    score += 0.02;
  }

  return normalizeScore(score);
}

function retrieveLocalPolicy(extractedData, fallbackReason) {
  const candidates = policyCatalog
    .map((policy) =>
      createPolicyCandidate(
        policy,
        scoreLocalPolicy(policy, extractedData),
        "local-catalog",
        fallbackReason
      )
    )
    .sort((left, right) => {
      return rankCandidate(right, extractedData) - rankCandidate(left, extractedData);
    });

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
    })),
  };
}

async function ensurePolicyIndex() {
  const client = getPineconeClient();
  const indexList = await client.listIndexes();
  const indexes = indexList.indexes || [];
  const exists = indexes.some((index) => index.name === env.pineconeIndexName);

  if (!exists) {
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

  return client.index({ name: env.pineconeIndexName }).namespace(env.pineconeNamespace);
}

async function syncPolicyCatalog(options = {}) {
  const { force = false } = options;
  try {
    const index = await ensurePolicyIndex();
    const stats = await index.describeIndexStats();
    const existingCount =
      stats.namespaces?.[env.pineconeNamespace]?.recordCount || 0;

    if (!force && existingCount >= policyCatalog.length) {
      return {
        indexed: false,
        count: existingCount,
        mode: "pinecone",
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
          minDurationMonths: policy.minDurationMonths,
          ageMin: policy.ageMin,
          ageMax: policy.ageMax,
          policyClause: policy.policyClause,
        },
      };
    });

    await index.upsert({
      records,
    });

    return {
      indexed: true,
      count: records.length,
      mode: "pinecone",
    };
  } catch (error) {
    return {
      indexed: false,
      count: policyCatalog.length,
      mode: "local-catalog",
      error: error.message,
    };
  }
}

async function retrieveRelevantPolicy(extractedData) {
  try {
    const index = await ensurePolicyIndex();
    const queryVector = await embedQuery(buildQueryText(extractedData));
    const response = await index.query({
      vector: queryVector,
      topK: 3,
      includeMetadata: true,
    });

    if (!response.matches || response.matches.length === 0) {
      const error = new Error("No matching policy clause was found in Pinecone.");
      error.statusCode = 404;
      throw error;
    }

    const candidates = response.matches
      .map(mapPolicyMetadata)
      .filter(Boolean)
      .sort((left, right) => {
        return rankCandidate(right, extractedData) - rankCandidate(left, extractedData);
      });

    if (candidates.length === 0) {
      const error = new Error("Policy matches were returned without usable metadata.");
      error.statusCode = 404;
      throw error;
    }

    const bestMatch = candidates[0];

    return {
      ...bestMatch,
      retrievalMode: "pinecone",
      fallbackReason: null,
      topMatches: candidates.map((candidate) => ({
        id: candidate.id,
        procedure: candidate.procedure,
        clause: candidate.clause,
        score: candidate.score,
      })),
    };
  } catch (error) {
    return retrieveLocalPolicy(extractedData, error.message);
  }
}

module.exports = {
  retrieveRelevantPolicy,
  syncPolicyCatalog,
};
