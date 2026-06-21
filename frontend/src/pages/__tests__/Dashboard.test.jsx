import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import Dashboard from "../Dashboard";

const processClaimMock = vi.fn();

vi.mock("../../services/api", () => ({
  processClaim: (...args) => processClaimMock(...args),
}));

vi.mock("../../components/UploadBox", () => ({
  default: function UploadBoxMock({ onFileSubmit, loading }) {
    return (
      <button
        type="button"
        onClick={() =>
          onFileSubmit(new File(["claim"], "claim.png", { type: "image/png" }))
        }
        disabled={loading}
      >
        Submit Claim
      </button>
    );
  },
}));

beforeEach(() => {
  processClaimMock.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:claim-preview");
  URL.revokeObjectURL = vi.fn();
});

test("Dashboard shows the degraded warning banner for fallback extraction", async () => {
  processClaimMock.mockResolvedValue({
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
      retrievalMode: "pinecone",
      fallbackReason: null,
      topMatches: [],
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
  });

  render(<Dashboard />);
  fireEvent.click(screen.getByRole("button", { name: "Submit Claim" }));

  await waitFor(() => {
    expect(
      screen.getByText(/Gemini extraction was unavailable for this request/i)
    ).toBeInTheDocument();
  });
});
