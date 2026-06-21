const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const envModulePath = path.join(backendRoot, "config", "env.js");
const extractorModulePath = path.join(backendRoot, "services", "aiExtractor.js");
const googleModulePath = require.resolve("@langchain/google-genai", {
  paths: [backendRoot],
});

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_GOOGLE_MODULE = require.cache[googleModulePath];

function mockGoogleGenAi(invokeImpl) {
  require.cache[googleModulePath] = {
    id: googleModulePath,
    filename: googleModulePath,
    loaded: true,
    exports: {
      ChatGoogleGenerativeAI: class MockChatGoogleGenerativeAI {
        withStructuredOutput() {
          return {
            invoke: invokeImpl,
          };
        }
      },
    },
  };
}

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  Object.assign(process.env, ORIGINAL_ENV);
}

function loadExtractorWithEnv(envOverrides, invokeImpl) {
  restoreEnvironment();
  Object.assign(process.env, envOverrides);
  mockGoogleGenAi(invokeImpl);
  delete require.cache[envModulePath];
  delete require.cache[extractorModulePath];
  return require(extractorModulePath);
}

test.afterEach(() => {
  restoreEnvironment();
  delete require.cache[envModulePath];
  delete require.cache[extractorModulePath];

  if (ORIGINAL_GOOGLE_MODULE) {
    require.cache[googleModulePath] = ORIGINAL_GOOGLE_MODULE;
  } else {
    delete require.cache[googleModulePath];
  }
});

test("extractClaimData returns Gemini metadata on success", async () => {
  const { extractClaimData } = loadExtractorWithEnv(
    {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
      ALLOW_DEGRADED_AI_FALLBACK: "true",
      GEMINI_API_KEY: "test-key",
    },
    async () => ({
      patientId: "PT-1001",
      diagnosis: "Cataract",
      symptomDuration: 4,
      requestedProcedure: "Cataract Surgery",
      age: 67,
      confidence: 0.91,
    })
  );

  const result = await extractClaimData({
    buffer: Buffer.from("claim-image"),
    mimeType: "image/png",
  });

  assert.equal(result.meta.mode, "gemini");
  assert.equal(result.meta.degraded, false);
  assert.equal(result.meta.reasonCode, null);
  assert.equal(result.data.patientId, "PT-1001");
});

test("extractClaimData falls back on quota errors when degraded mode is enabled", async () => {
  const { extractClaimData } = loadExtractorWithEnv(
    {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
      ALLOW_DEGRADED_AI_FALLBACK: "true",
      GEMINI_API_KEY: "test-key",
    },
    async () => {
      throw new Error("429 Too Many Requests: quota exceeded for model.");
    }
  );

  const result = await extractClaimData({
    buffer: Buffer.from("claim-image"),
    mimeType: "image/png",
  });

  assert.equal(result.meta.mode, "fallback-local");
  assert.equal(result.meta.degraded, true);
  assert.equal(result.meta.reasonCode, "quota_exceeded");
  assert.equal(result.data.confidence, 0.38);
});

test("extractClaimData throws on quota errors when degraded mode is disabled", async () => {
  const { extractClaimData } = loadExtractorWithEnv(
    {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
      ALLOW_DEGRADED_AI_FALLBACK: "false",
      GEMINI_API_KEY: "test-key",
      PINECONE_API_KEY: "pinecone-key",
    },
    async () => {
      throw new Error("429 Too Many Requests: quota exceeded for model.");
    }
  );

  await assert.rejects(
    extractClaimData({
      buffer: Buffer.from("claim-image"),
      mimeType: "image/png",
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.details.reasonCode, "quota_exceeded");
      return true;
    }
  );
});

test("extractClaimData degrades for a missing Gemini API key only in degraded mode", async () => {
  const degradedExtractor = loadExtractorWithEnv(
    {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
      ALLOW_DEGRADED_AI_FALLBACK: "true",
      GEMINI_API_KEY: "",
    },
    async () => {
      throw new Error("should not be called");
    }
  );

  const degradedResult = await degradedExtractor.extractClaimData({
    buffer: Buffer.from("claim-image"),
    mimeType: "image/png",
  });

  assert.equal(degradedResult.meta.reasonCode, "missing_api_key");
  assert.equal(degradedResult.meta.degraded, true);
});

test("strict mode rejects a missing Gemini API key during configuration", () => {
  restoreEnvironment();
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
    ALLOW_DEGRADED_AI_FALLBACK: "false",
    GEMINI_API_KEY: "",
    PINECONE_API_KEY: "pinecone-key",
  });
  mockGoogleGenAi(async () => {
    throw new Error("should not be called");
  });
  delete require.cache[envModulePath];
  delete require.cache[extractorModulePath];

  assert.throws(() => {
    require(extractorModulePath);
  }, (error) => {
    assert.match(
      error.message,
      /GEMINI_API_KEY is required when ALLOW_DEGRADED_AI_FALLBACK is false/i
    );
    return true;
  });
});

test("extractClaimData throws on invalid structured output instead of silently degrading", async () => {
  const { extractClaimData } = loadExtractorWithEnv(
    {
      DATABASE_URL: "postgresql://postgres:password@localhost:5432/postgres",
      ALLOW_DEGRADED_AI_FALLBACK: "true",
      GEMINI_API_KEY: "test-key",
    },
    async () => ({
      patientId: "PT-1001",
      diagnosis: "Cataract",
    })
  );

  await assert.rejects(
    extractClaimData({
      buffer: Buffer.from("claim-image"),
      mimeType: "image/png",
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.details.reasonCode, "invalid_response");
      return true;
    }
  );
});
