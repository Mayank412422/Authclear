const { z } = require("zod");

const claimExtractionSchema = z
  .object({
    patientId: z.string().min(2),
    diagnosis: z.string().min(2),
    symptomDuration: z.number().int().min(0),
    requestedProcedure: z.string().min(2),
    age: z.number().int().min(0),
    confidence: z.number().min(0).max(1),
  })
  .strict();

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

module.exports = {
  claimExtractionSchema,
  normalizeText,
};
