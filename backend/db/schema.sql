CREATE TABLE IF NOT EXISTS patients (
  id BIGSERIAL PRIMARY KEY,
  patient_identifier TEXT NOT NULL UNIQUE,
  age INTEGER NOT NULL CHECK (age >= 0),
  latest_diagnosis TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS claims (
  id BIGSERIAL PRIMARY KEY,
  patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  image_file_name TEXT NOT NULL,
  image_mime_type TEXT NOT NULL,
  extracted_data JSONB NOT NULL,
  retrieved_policy JSONB NOT NULL,
  decision_result JSONB NOT NULL,
  confidence_score NUMERIC(4, 3) NOT NULL,
  manual_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE claims
ADD COLUMN IF NOT EXISTS manual_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS claim_logs (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_patient_id ON claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_claims_manual_review ON claims(manual_review);
CREATE INDEX IF NOT EXISTS idx_claim_logs_claim_id ON claim_logs(claim_id);
