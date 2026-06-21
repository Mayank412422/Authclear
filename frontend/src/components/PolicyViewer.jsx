import { motion } from "framer-motion";

function PolicyViewer({ policy }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="rounded-[1.5rem] border border-sand/15 bg-white/5 p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-xl">Retrieved Policy</h3>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-sand/55">
            Match score {(policy.score * 100).toFixed(0)}%
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {policy.retrievalMode !== "pinecone" ? (
            <div className="rounded-full border border-wheat/35 bg-wheat/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] text-wheat">
              Local Retrieval
            </div>
          ) : null}
          <div className="rounded-full border border-sand/15 px-4 py-2 font-mono text-xs uppercase tracking-[0.2em] text-sand/70">
            {policy.procedure}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-black/20 p-4 text-sm leading-7 text-sand/90">
        {policy.clause}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-sand/10 bg-white/5 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sand/50">
            Coverage Criteria
          </p>
          <p className="mt-2 text-sm text-sand/85">
            Duration: {policy.minDurationMonths}+ months
          </p>
          <p className="text-sm text-sand/85">
            Age: {policy.ageMin}-{policy.ageMax}
          </p>
        </div>

        <div className="rounded-2xl border border-sand/10 bg-white/5 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sand/50">
            Covered Diagnoses
          </p>
          <p className="mt-2 text-sm text-sand/85">
            {policy.allowedDiagnoses.join(", ")}
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sand/50">
          Top Matches
        </p>
        {policy.topMatches.map((match) => (
          <div
            key={match.id}
            className="rounded-2xl border border-sand/10 bg-white/5 p-4"
          >
            <div className="flex items-center justify-between gap-4">
              <p className="font-display text-lg">{match.procedure}</p>
              <span className="font-mono text-xs uppercase tracking-[0.24em] text-sand/55">
                {(match.score * 100).toFixed(0)}%
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-sand/75">{match.clause}</p>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

export default PolicyViewer;
