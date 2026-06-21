import { render, screen } from "@testing-library/react";

import DecisionCard from "../DecisionCard";

const decision = {
  status: "APPROVED",
  reason: "Approved.",
  policy_clause: "Covered when symptoms persist for 2 months.",
  manualReview: true,
};

test("DecisionCard renders degraded mode and manual review badges together", () => {
  render(
    <DecisionCard
      decision={decision}
      metadata={{
        degraded: true,
        processedAt: "2026-04-19T10:00:00.000Z",
      }}
    />
  );

  expect(screen.getByText("Degraded Mode")).toBeInTheDocument();
  expect(screen.getByText("Manual Review")).toBeInTheDocument();
});

test("DecisionCard omits the degraded badge for full-ai results", () => {
  render(
    <DecisionCard
      decision={{ ...decision, manualReview: false }}
      metadata={{
        degraded: false,
        processedAt: "2026-04-19T10:00:00.000Z",
      }}
    />
  );

  expect(screen.queryByText("Degraded Mode")).not.toBeInTheDocument();
});
