const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const envModulePath = path.join(backendRoot, "config", "env.js");
const pipelineModulePath = path.join(backendRoot, "services", "pipeline.js");
const extractorModulePath = path.join(backendRoot, "services", "aiExtractor.js");
const retrieverModulePath = path.join(backendRoot, "services", "retriever.js");
const decisionModulePath = path.join(backendRoot, "services", "decisionEngine.js");
const dbModulePath = path.join(backendRoot, "db", "index.js");

const ORIGINAL_ENV = { ...process.env };

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, ORIGINAL_ENV);
}

function mockModule(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function loadPipelineWithMocks({ envOverrides = {}, extractor, retriever, decision, db }) {
  restoreEnvironment();
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
    ALLOW_DEGRADED_AI_FALLBACK: "true",
    ...envOverrides,
  });

  delete require.cache[envModulePath];
  delete require.cache[pipelineModulePath];

  mockModule(extractorModulePath, { extractClaimData: extractor });
  mockModule(retrieverModulePath, { retrieveRelevantPolicy: retriever });
  mockModule(decisionModulePath, { evaluateClaim: decision });
  mockModule(dbModulePath, { persistProcessedClaim: db });

  return require(pipelineModulePath);
}

test.afterEach(() => {
  restoreEnvironment();
  delete require.cache[envModulePath];
  delete require.cache[pipelineModulePath];
  delete require.cache[extractorModulePath];
  delete require.cache[retrieverModulePath];
  delete require.cache[decisionModulePath];
  delete require.cache[dbModulePath];
});

function createPersistResult() {
  return {
    claimId: 1,
    patientRecordId: 2,
    createdAt: "2026-04-19T10:00:00.000Z",
    persisted: true,
    warning: null,
  };
}

test("processClaim forces manual review and degraded metadata for fallback extraction", async () => {
  const { processClaim } = loadPipelineWithMocks({
    extractor: async () => ({
      data: {
        patientId: "PT-1001",
        diagnosis: "Cataract",
        symptomDuration: 4,
        requestedProcedure: "Cataract Surgery",
        age: 67,
        confidence: 0.38,
      },
      meta: {
        mode: "fallback-local",
        degraded: true,
        provider: "gemini",
        reasonCode: "quota_exceeded",
        reason: "Quota exceeded.",
      },
    }),
    retriever: async () => ({
      id: "policy-1",
      procedure: "Cataract Surgery",
      procedureNormalized: "cataract surgery",
      allowedDiagnoses: ["Cataract"],
      allowedDiagnosesNormalized: ["cataract"],
      minDurationMonths: 2,
      ageMin: 48,
      ageMax: 84,
      clause: "Covered when symptoms persist for 2 months.",
      score: 0.92,
      retrievalMode: "pinecone",
      fallbackReason: null,
      topMatches: [],
    }),
    decision: () => ({
      status: "APPROVED",
      reason: "Approved.",
      policy_clause: "Covered when symptoms persist for 2 months.",
    }),
    db: async () => createPersistResult(),
  });

  const result = await processClaim({
    buffer: Buffer.from("claim"),
    mimeType: "image/png",
    fileName: "claim.png",
  });

  assert.equal(result.decision.manualReview, true);
  assert.equal(result.metadata.degraded, true);
  assert.equal(result.metadata.processingMode, "degraded");
  assert.match(result.metadata.warnings[0], /Gemini extraction was unavailable/i);
});

test("processClaim marks degraded mode when retrieval falls back to the local catalog", async () => {
  const { processClaim } = loadPipelineWithMocks({
    extractor: async () => ({
      data: {
        patientId: "PT-1001",
        diagnosis: "Cataract",
        symptomDuration: 4,
        requestedProcedure: "Cataract Surgery",
        age: 67,
        confidence: 0.91,
      },
      meta: {
        mode: "gemini",
        degraded: false,
        provider: "gemini",
        reasonCode: null,
        reason: null,
      },
    }),
    retriever: async () => ({
      id: "policy-1",
      procedure: "Cataract Surgery",
      procedureNormalized: "cataract surgery",
      allowedDiagnoses: ["Cataract"],
      allowedDiagnosesNormalized: ["cataract"],
      minDurationMonths: 2,
      ageMin: 48,
      ageMax: 84,
      clause: "Covered when symptoms persist for 2 months.",
      score: 0.88,
      retrievalMode: "local-catalog",
      fallbackReason: "PINECONE_API_KEY is not configured.",
      topMatches: [],
    }),
    decision: () => ({
      status: "APPROVED",
      reason: "Approved.",
      policy_clause: "Covered when symptoms persist for 2 months.",
    }),
    db: async () => createPersistResult(),
  });

  const result = await processClaim({
    buffer: Buffer.from("claim"),
    mimeType: "image/png",
    fileName: "claim.png",
  });

  assert.equal(result.metadata.degraded, true);
  assert.equal(result.policy.retrievalMode, "local-catalog");
  assert.match(result.metadata.warnings[0], /Pinecone retrieval was unavailable/i);
});

test("processClaim returns full-ai metadata when extraction and retrieval both succeed", async () => {
  const { processClaim } = loadPipelineWithMocks({
    extractor: async () => ({
      data: {
        patientId: "PT-1001",
        diagnosis: "Cataract",
        symptomDuration: 4,
        requestedProcedure: "Cataract Surgery",
        age: 67,
        confidence: 0.91,
      },
      meta: {
        mode: "gemini",
        degraded: false,
        provider: "gemini",
        reasonCode: null,
        reason: null,
      },
    }),
    retriever: async () => ({
      id: "policy-1",
      procedure: "Cataract Surgery",
      procedureNormalized: "cataract surgery",
      allowedDiagnoses: ["Cataract"],
      allowedDiagnosesNormalized: ["cataract"],
      minDurationMonths: 2,
      ageMin: 48,
      ageMax: 84,
      clause: "Covered when symptoms persist for 2 months.",
      score: 0.92,
      retrievalMode: "pinecone",
      fallbackReason: null,
      topMatches: [],
    }),
    decision: () => ({
      status: "APPROVED",
      reason: "Approved.",
      policy_clause: "Covered when symptoms persist for 2 months.",
    }),
    db: async () => createPersistResult(),
  });

  const result = await processClaim({
    buffer: Buffer.from("claim"),
    mimeType: "image/png",
    fileName: "claim.png",
  });

  assert.equal(result.metadata.degraded, false);
  assert.equal(result.metadata.processingMode, "full-ai");
  assert.deepEqual(result.metadata.warnings, []);
});
