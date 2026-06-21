const { normalizeText } = require("../utils/validator");

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function hasMeaningfulOverlap(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      return true;
    }
  }

  return false;
}

function phraseMatches(policyValue, extractedValue) {
  const policyNormalized = normalizeText(policyValue);
  const extractedNormalized = normalizeText(extractedValue);

  return (
    policyNormalized === extractedNormalized ||
    policyNormalized.includes(extractedNormalized) ||
    extractedNormalized.includes(policyNormalized) ||
    hasMeaningfulOverlap(policyNormalized, extractedNormalized)
  );
}

function evaluateClaim(extractedData, policy) {
  if (!phraseMatches(policy.procedure, extractedData.requestedProcedure)) {
    return {
      status: "DENIED",
      reason: `Requested procedure ${extractedData.requestedProcedure} does not match the retrieved coverage clause for ${policy.procedure}.`,
      policy_clause: policy.clause,
    };
  }

  if (!policy.allowedDiagnoses.some((diagnosis) => {
    return phraseMatches(diagnosis, extractedData.diagnosis);
  })) {
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
