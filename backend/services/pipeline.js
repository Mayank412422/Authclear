const { persistProcessedClaim } = require("../db");
const { env } = require("../config/env");
const { extractClaimData } = require("./aiExtractor");
const { retrieveRelevantPolicy } = require("./retriever");
const { evaluateClaim } = require("./decisionEngine");
const { claimExtractionSchema } = require("../utils/validator");

function createLogger(logs) {
  return (stage, message, context = {}, level = "INFO") => {
    logs.push({
      stage,
      level,
      message,
      context,
    });
  };
}

async function processClaim({ buffer, mimeType, fileName }) {
  const logs = [];
  const log = createLogger(logs);

  log("input", "Claim image received.", {
    fileName,
    mimeType,
    sizeBytes: buffer.length,
  });

  const extractedData = claimExtractionSchema.parse(
    await extractClaimData({ buffer, mimeType })
  );

  log("extraction", "Structured medical fields extracted.", {
    patientId: extractedData.patientId,
    diagnosis: extractedData.diagnosis,
    requestedProcedure: extractedData.requestedProcedure,
    confidence: extractedData.confidence,
  });

  const policy = await retrieveRelevantPolicy(extractedData);

  log("retrieval", "Relevant policy clause retrieved from Pinecone.", {
    policyId: policy.id,
    score: policy.score,
    procedure: policy.procedure,
  });

  const decision = evaluateClaim(extractedData, policy);
  const manualReview =
    extractedData.confidence < env.manualReviewThreshold ||
    policy.score < env.policyMatchThreshold ||
    policy.retrievalMode !== "pinecone";

  log("decision", "Deterministic decision completed.", {
    status: decision.status,
    manualReview,
  });

  const persisted = await persistProcessedClaim({
    extractedData,
    policy,
    decision,
    confidence: extractedData.confidence,
    manualReview,
    mimeType,
    fileName,
    logs,
  });

  if (policy.retrievalMode !== "pinecone") {
    log("retrieval", "Fallback policy retrieval used.", {
      mode: policy.retrievalMode,
      reason: policy.fallbackReason,
    }, "WARN");
  }

  if (!persisted.persisted) {
    log("storage", "Claim could not be written to PostgreSQL.", {
      warning: persisted.warning,
    }, "WARN");
  }

  return {
    claimId: persisted.claimId,
    patientRecordId: persisted.patientRecordId,
    extractedData,
    policy: {
      id: policy.id,
      procedure: policy.procedure,
      allowedDiagnoses: policy.allowedDiagnoses,
      minDurationMonths: policy.minDurationMonths,
      ageMin: policy.ageMin,
      ageMax: policy.ageMax,
      clause: policy.clause,
      score: policy.score,
      retrievalMode: policy.retrievalMode,
      fallbackReason: policy.fallbackReason,
      topMatches: policy.topMatches,
    },
    decision: {
      ...decision,
      manualReview,
    },
    metadata: {
      confidence: extractedData.confidence,
      manualReview,
      processedAt: persisted.createdAt,
      persisted: persisted.persisted,
      persistenceWarning: persisted.warning,
    },
  };
}

module.exports = {
  processClaim,
};
