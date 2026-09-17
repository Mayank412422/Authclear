const fs = require('fs');
const path = require('path');

const { evaluateClaim } = require('../backend/services/decisionEngine');

const seed = 20260916;
const totalCases = 500;
const policiesPath = path.join(__dirname, '..', 'backend', 'data', 'policies.json');
const outputPath = path.join(__dirname, 'data', 'benchmark.json');

function mulberry32(a) {
  return function random() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(seed);

function randomInt(min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function randomItem(items) {
  return items[randomInt(0, items.length - 1)];
}

function confidenceValue() {
  return Number((0.5 + random() * 0.49).toFixed(2));
}

function durationAtOrAbove(minDurationMonths) {
  return minDurationMonths + randomInt(0, 12);
}

function toDecisionPolicy(policy) {
  return {
    id: policy.id,
    procedure: policy.procedure,
    allowedDiagnoses: policy.allowedDiagnoses,
    minDurationMonths: policy.minDurationMonths,
    ageMin: policy.ageMin,
    ageMax: policy.ageMax,
    clause: policy.policyClause,
  };
}

function toBenchmarkPolicy(policy) {
  return {
    id: policy.id,
    procedure: policy.procedure,
    allowedDiagnoses: policy.allowedDiagnoses,
    minDurationMonths: policy.minDurationMonths,
    ageMin: policy.ageMin,
    ageMax: policy.ageMax,
    policyClause: policy.policyClause,
    source: policy.source,
  };
}

const rawPolicies = JSON.parse(fs.readFileSync(policiesPath, 'utf8'));
const policies = rawPolicies.map((policy) => ({
  ...policy,
  keywords: Array.isArray(policy.keywords) ? policy.keywords : [],
}));

if (policies.length === 0) {
  throw new Error('No policies found in backend/data/policies.json');
}

const policiesWithMinAge = policies.filter((policy) => policy.ageMin > 0);
const policiesWithMaxBelow120 = policies.filter((policy) => policy.ageMax < 120);
const policiesWithDurationRequirement = policies.filter((policy) => policy.minDurationMonths > 0);

if (policiesWithMinAge.length === 0 || policiesWithMaxBelow120.length === 0) {
  throw new Error('Not enough age-bounded policies to generate age boundary denial cases.');
}

const categoryTargets = {
  approved: 150,
  procedureMismatch: 90,
  diagnosisMismatch: 90,
  ageBelowMin: 75,
  ageAboveMax: 75,
  boundaryAgeMin: 10,
  boundaryAgeMax: 10,
};

const targetSum = Object.values(categoryTargets).reduce((sum, count) => sum + count, 0);
if (targetSum !== totalCases) {
  throw new Error(`Category counts must sum to ${totalCases}, received ${targetSum}`);
}

const benchmarkCases = [];
let caseIndex = 1;

function addCase(extractedData, policy, category) {
  const decisionPolicy = toDecisionPolicy(policy);
  const result = evaluateClaim(extractedData, decisionPolicy);

  benchmarkCases.push({
    caseId: `CASE-${String(caseIndex).padStart(4, '0')}`,
    category,
    extractedData,
    policy: toBenchmarkPolicy(policy),
    expectedStatus: result.status,
    expectedReason: result.reason,
  });

  caseIndex += 1;
}

function makeApprovedCase(policy) {
  addCase(
    {
      patientId: `PT-${randomInt(100000, 999999)}`,
      diagnosis: randomItem(policy.allowedDiagnoses),
      symptomDuration: durationAtOrAbove(policy.minDurationMonths),
      requestedProcedure: policy.procedure,
      age: randomInt(policy.ageMin, policy.ageMax),
      confidence: confidenceValue(),
    },
    policy,
    'approved'
  );
}

function makeProcedureMismatchCase(policy) {
  let mismatchedProcedure = policy.procedure;
  while (mismatchedProcedure === policy.procedure) {
    mismatchedProcedure = randomItem(policies).procedure;
  }

  addCase(
    {
      patientId: `PT-${randomInt(100000, 999999)}`,
      diagnosis: randomItem(policy.allowedDiagnoses),
      symptomDuration: durationAtOrAbove(policy.minDurationMonths),
      requestedProcedure: mismatchedProcedure,
      age: randomInt(policy.ageMin, policy.ageMax),
      confidence: confidenceValue(),
    },
    policy,
    'procedure_mismatch'
  );
}

function makeDiagnosisMismatchCase(policy) {
  addCase(
    {
      patientId: `PT-${randomInt(100000, 999999)}`,
      diagnosis: `Unrelated Condition ${randomInt(1, 10000)}`,
      symptomDuration: durationAtOrAbove(policy.minDurationMonths),
      requestedProcedure: policy.procedure,
      age: randomInt(policy.ageMin, policy.ageMax),
      confidence: confidenceValue(),
    },
    policy,
    'diagnosis_mismatch'
  );
}

function makeAgeBelowMinCase(policy) {
  const belowAge = randomInt(0, policy.ageMin - 1);

  addCase(
    {
      patientId: `PT-${randomInt(100000, 999999)}`,
      diagnosis: randomItem(policy.allowedDiagnoses),
      symptomDuration: durationAtOrAbove(policy.minDurationMonths),
      requestedProcedure: policy.procedure,
      age: belowAge,
      confidence: confidenceValue(),
    },
    policy,
    'age_below_min'
  );
}

function makeAgeAboveMaxCase(policy) {
  addCase(
    {
      patientId: `PT-${randomInt(100000, 999999)}`,
      diagnosis: randomItem(policy.allowedDiagnoses),
      symptomDuration: durationAtOrAbove(policy.minDurationMonths),
      requestedProcedure: policy.procedure,
      age: policy.ageMax + randomInt(1, 10),
      confidence: confidenceValue(),
    },
    policy,
    'age_above_max'
  );
}

function makeBoundaryAgeMinCase(policy) {
  addCase(
    {
      patientId: `PT-${randomInt(100000, 999999)}`,
      diagnosis: randomItem(policy.allowedDiagnoses),
      symptomDuration: policy.minDurationMonths,
      requestedProcedure: policy.procedure,
      age: policy.ageMin,
      confidence: confidenceValue(),
    },
    policy,
    'boundary_age_min'
  );
}

function makeBoundaryAgeMaxCase(policy) {
  addCase(
    {
      patientId: `PT-${randomInt(100000, 999999)}`,
      diagnosis: randomItem(policy.allowedDiagnoses),
      symptomDuration: policy.minDurationMonths,
      requestedProcedure: policy.procedure,
      age: policy.ageMax,
      confidence: confidenceValue(),
    },
    policy,
    'boundary_age_max'
  );
}

for (let i = 0; i < categoryTargets.approved; i += 1) {
  makeApprovedCase(randomItem(policies));
}

for (let i = 0; i < categoryTargets.procedureMismatch; i += 1) {
  makeProcedureMismatchCase(randomItem(policies));
}

for (let i = 0; i < categoryTargets.diagnosisMismatch; i += 1) {
  makeDiagnosisMismatchCase(randomItem(policies));
}

for (let i = 0; i < categoryTargets.ageBelowMin; i += 1) {
  makeAgeBelowMinCase(randomItem(policiesWithMinAge));
}

for (let i = 0; i < categoryTargets.ageAboveMax; i += 1) {
  makeAgeAboveMaxCase(randomItem(policiesWithMaxBelow120));
}

for (let i = 0; i < categoryTargets.boundaryAgeMin; i += 1) {
  makeBoundaryAgeMinCase(randomItem(policiesWithMinAge));
}

for (let i = 0; i < categoryTargets.boundaryAgeMax; i += 1) {
  makeBoundaryAgeMaxCase(randomItem(policiesWithMaxBelow120));
}

if (policiesWithDurationRequirement.length > 0) {
  for (const policy of policiesWithDurationRequirement) {
    addCase(
      {
        patientId: `PT-${randomInt(100000, 999999)}`,
        diagnosis: randomItem(policy.allowedDiagnoses),
        symptomDuration: Math.max(0, policy.minDurationMonths - 1),
        requestedProcedure: policy.procedure,
        age: randomInt(policy.ageMin, policy.ageMax),
        confidence: confidenceValue(),
      },
      policy,
      'duration_below_min'
    );
  }
}

if (benchmarkCases.length !== totalCases) {
  throw new Error(`Expected exactly ${totalCases} cases but generated ${benchmarkCases.length}`);
}

const output = {
  benchmarkName: 'authclear-synthetic-e2e-benchmark',
  sourcePolicyFile: 'backend/data/policies.json',
  generationSeed: seed,
  totalCases,
  notes: {
    durationDenialCasesGenerated: policiesWithDurationRequirement.length,
    durationRulePolicyCount: policiesWithDurationRequirement.length,
  },
  cases: benchmarkCases,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Generated ${benchmarkCases.length} benchmark cases at ${outputPath}`);
