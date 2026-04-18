import { motion } from "framer-motion";

function DecisionCard({ decision, metadata }) {
  const approved = decision.status === "APPROVED";

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-[1.75rem] border p-5 ${
        approved
          ? "border-moss/40 bg-moss/15"
          : "border-coral/40 bg-coral/15"
      }`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-white/20 bg-white/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.24em] text-sand">
              {decision.status}
            </span>
            {decision.manualReview ? (
              <span className="rounded-full border border-wheat/40 bg-wheat/15 px-4 py-2 font-mono text-xs uppercase tracking-[0.24em] text-wheat">
                Manual Review
              </span>
            ) : null}
          </div>
          <p className="max-w-3xl text-sm leading-6 text-sand/90">{decision.reason}</p>
          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-sand/55">
              Policy Clause
            </p>
            <p className="mt-2 text-sm leading-6 text-sand/85">
              {decision.policy_clause}
            </p>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-sand/55">
            Processed
          </p>
          <p className="mt-2 text-sm text-sand/90">
            {new Date(metadata.processedAt).toLocaleString()}
          </p>
        </div>
      </div>
    </motion.section>
  );
}

export default DecisionCard;
