import { render, screen } from "@testing-library/react";

import ResultPanel from "../ResultPanel";

const baseResult = {
  extractedData: {
    patientId: "PT-1001",
    diagnosis: "Cataract",
    symptomDuration: 4,
    requestedProcedure: "Cataract Surgery",
    age: 67,
    confidence: 0.38,
  },
  policy: {
    id: "policy-1",
    procedure: "Cataract Surgery",
    allowedDiagnoses: ["Cataract"],
    minDurationMonths: 2,
    ageMin: 48,
    ageMax: 84,
    clause: "Covered when symptoms persist for 2 months.",
    score: 0.88,
    retrievalMode: "local-catalog",
    fallbackReason: "PINECONE_API_KEY is not configured.",
    topMatches: [
      {
        id: "policy-1",
        procedure: "Cataract Surgery",
        clause: "Covered when symptoms persist for 2 months.",
        score: 0.88,
      },
    ],
  },
  decision: {
    status: "APPROVED",
    reason: "Approved.",
    policy_clause: "Covered when symptoms persist for 2 months.",
    manualReview: true,
  },
  metadata: {
    confidence: 0.38,
    manualReview: true,
    degraded: true,
    processingMode: "degraded",
    warnings: [],
    extraction: {
      mode: "fallback-local",
      degraded: true,
      provider: "gemini",
      reasonCode: "quota_exceeded",
      reason: "Quota exceeded.",
    },
    processedAt: "2026-04-19T10:00:00.000Z",
    persisted: true,
    persistenceWarning: null,
  },
};

test("ResultPanel relabels fallback extraction output and shows the local retrieval badge", () => {
  render(<ResultPanel result={baseResult} />);

  expect(screen.getByText("Fallback output")).toBeInTheDocument();
  expect(screen.getByText("Local Retrieval")).toBeInTheDocument();
});
