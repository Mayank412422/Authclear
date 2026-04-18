const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const { env } = require("../config/env");

function shouldUseSsl(databaseUrl) {
  return !/localhost|127\.0\.0\.1/i.test(databaseUrl);
}

const pool = new Pool({
  connectionString: env.databaseUrl,
  connectionTimeoutMillis: 5000,
  ssl: shouldUseSsl(env.databaseUrl)
    ? {
        rejectUnauthorized: false,
      }
    : false,
});

async function initializeDatabase() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schemaSql);
}

async function persistProcessedClaim({
  extractedData,
  policy,
  decision,
  confidence,
  manualReview,
  mimeType,
  fileName,
  logs,
}) {
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const patientResult = await client.query(
      `
        INSERT INTO patients (patient_identifier, age, latest_diagnosis)
        VALUES ($1, $2, $3)
        ON CONFLICT (patient_identifier)
        DO UPDATE SET
          age = EXCLUDED.age,
          latest_diagnosis = EXCLUDED.latest_diagnosis,
          updated_at = NOW()
        RETURNING id
      `,
      [extractedData.patientId, extractedData.age, extractedData.diagnosis]
    );

    const claimResult = await client.query(
      `
        INSERT INTO claims (
          patient_id,
          image_file_name,
          image_mime_type,
          extracted_data,
          retrieved_policy,
          decision_result,
          confidence_score,
          manual_review
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
        RETURNING id, created_at
      `,
      [
        patientResult.rows[0].id,
        fileName,
        mimeType,
        JSON.stringify(extractedData),
        JSON.stringify(policy),
        JSON.stringify(decision),
        confidence,
        manualReview,
      ]
    );

    const persistedLogs = [
      ...logs,
      {
        stage: "storage",
        level: "INFO",
        message: "Claim persisted to PostgreSQL.",
        context: {
          claimId: claimResult.rows[0].id,
        },
      },
    ];

    if (persistedLogs.length > 0) {
      const valuePlaceholders = [];
      const values = [];

      persistedLogs.forEach((entry, index) => {
        const offset = index * 5;
        valuePlaceholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}::jsonb)`
        );
        values.push(
          claimResult.rows[0].id,
          entry.stage,
          entry.level,
          entry.message,
          JSON.stringify(entry.context || {})
        );
      });

      await client.query(
        `
          INSERT INTO claim_logs (claim_id, stage, level, message, context)
          VALUES ${valuePlaceholders.join(", ")}
        `,
        values
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      claimId: claimResult.rows[0].id,
      patientRecordId: patientResult.rows[0].id,
      createdAt: claimResult.rows[0].created_at,
      persisted: true,
      warning: null,
    };
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (_rollbackError) {
        // Ignore rollback failures and return a degraded response.
      }
    }

    return {
      claimId: null,
      patientRecordId: null,
      createdAt: new Date().toISOString(),
      persisted: false,
      warning: `PostgreSQL persistence skipped: ${error.message}`,
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

module.exports = {
  initializeDatabase,
  persistProcessedClaim,
  pool,
};
