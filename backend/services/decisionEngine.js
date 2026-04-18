const { normalizeText } = require("../utils/validator");

function evaluateClaim(extractedData, policy) {
  const normalizedProcedure = normalizeText(extractedData.requestedProcedure);
  const normalizedDiagnosis = normalizeText(extractedData.diagnosis);

  if (policy.procedureNormalized !== normalizedProcedure) {
    return {
      status: "DENIED",
      reason: `Requested procedure ${extractedData.requestedProcedure} does not match the retrieved coverage clause for ${policy.procedure}.`,
      policy_clause: policy.clause,
    };
  }

  if (!policy.allowedDiagnosesNormalized.includes(normalizedDiagnosis)) {
    return {
      status: "DENIED",
      reason: `Diagnosis ${extractedData.diagnosis} is not covered for ${policy.procedure}.`,
      policy_clause: policy.clause,
    };
  }

  if (extractedData.symptomDuration < policy.minDurationMonths) {
    return {
      status: "DENIED",
      reason: `Symptoms documented for ${extractedData.symptomDuration} months; minimum required is ${policy.minDurationMonths} months.`,
      policy_clause: policy.clause,
    };
  }

  if (extractedData.age < policy.ageMin || extractedData.age > policy.ageMax) {
    return {
      status: "DENIED",
      reason: `Patient age ${extractedData.age} falls outside the eligible range of ${policy.ageMin}-${policy.ageMax}.`,
      policy_clause: policy.clause,
    };
  }

  return {
    status: "APPROVED",
    reason: `${policy.procedure} meets the duration, diagnosis, and age requirements in the selected policy clause.`,
    policy_clause: policy.clause,
  };
}

module.exports = {
  evaluateClaim,
};
