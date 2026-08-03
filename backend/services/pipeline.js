const { persistProcessedClaim } = require("../db");
const { env } = require("../config/env");
const { extractClaimData } = require("./aiExtractor");
const { retrieveRelevantPolicy } = require("./retriever");
const { evaluateClaim } = require("./decisionEngine");
const { generateRagAnswer } = require("./ragGenerator");
const { claimExtractionSchema } = require("../utils/validator");

function createExtractionWarning(extractionMeta) {
  if (!extractionMeta.degraded) {
    return null;
  }

  return "Gemini extraction was unavailable for this request. AuthClear returned explicit unknown fields and marked the result for manual review.";
}

function createRetrievalWarning(policy) {
  if (policy.retrievalMode === "pinecone") {
    return null;
  }

  return "Pinecone retrieval was unavailable for this request. AuthClear matched against the bundled local policy catalog.";
}

function createGenerationWarning(generationMeta) {
  if (!generationMeta.degraded) {
    return null;
  }

  return "Gemini answer generation was unavailable. AuthClear returned the deterministic decision explanation.";
}

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

  const extractionResult = await extractClaimData({ buffer, mimeType });
  const extractedData = claimExtractionSchema.parse(extractionResult.data);
  const extractionMeta = extractionResult.meta;

  log("extraction", "Structured medical fields extracted.", {
    patientId: extractedData.patientId,
    diagnosis: extractedData.diagnosis,
    requestedProcedure: extractedData.requestedProcedure,
    confidence: extractedData.confidence,
    mode: extractionMeta.mode,
    degraded: extractionMeta.degraded,
    reasonCode: extractionMeta.reasonCode,
  });

  const policy = await retrieveRelevantPolicy(extractedData);
  const extractionWarning = createExtractionWarning(extractionMeta);
  const retrievalWarning = createRetrievalWarning(policy);

  log("retrieval", "Relevant policy clause selected.", {
    policyId: policy.id,
    score: policy.score,
    procedure: policy.procedure,
    retrievalMode: policy.retrievalMode,
  });

  const deterministicDecision = evaluateClaim(extractedData, policy);
  let generatedAnswer = deterministicDecision.reason;
  let generationMeta = {
    mode: "gemini",
    degraded: false,
    reason: null,
  };

  try {
    generatedAnswer = await generateRagAnswer({
      extractedData,
      policy,
      deterministicDecision,
    });
  } catch (error) {
    if (!env.allowDegradedAiFallback) {
      error.statusCode = error.statusCode || 502;
      error.details = error.details || {
        stage: "generation",
        reason: error.message,
      };
      throw error;
    }

    generationMeta = {
      mode: "fallback-deterministic",
      degraded: true,
      reason: error.message,
    };

    log("generation", "Fallback answer generation used.", {
      reason: error.message,
    }, "WARN");
  }

  const decision = {
    ...deterministicDecision,
    reason: generatedAnswer,
    deterministicReason: deterministicDecision.reason,
  };
  const generationWarning = createGenerationWarning(generationMeta);
  const manualReview =
    extractionMeta.degraded ||
    extractedData.confidence < env.manualReviewThreshold ||
    policy.score < env.policyMatchThreshold ||
    policy.retrievalMode !== "pinecone" ||
    generationMeta.degraded;

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

  if (extractionMeta.degraded) {
    log("extraction", "Fallback extraction used.", {
      mode: extractionMeta.mode,
      reasonCode: extractionMeta.reasonCode,
      reason: extractionMeta.reason,
    }, "WARN");
  }

  if (!persisted.persisted) {
    log("storage", "Claim could not be written to PostgreSQL.", {
      warning: persisted.warning,
    }, "WARN");
  }

  const warnings = [extractionWarning, retrievalWarning, generationWarning].filter(Boolean);
  const degraded = extractionMeta.degraded || policy.retrievalMode !== "pinecone" || generationMeta.degraded;

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
      degraded,
      processingMode: degraded ? "degraded" : "full-ai",
      warnings,
      extraction: extractionMeta,
      generation: generationMeta,
      processedAt: persisted.createdAt,
      persisted: persisted.persisted,
      persistenceWarning: persisted.warning,
    },
  };
}

module.exports = {
  processClaim,
};
