import { motion } from "framer-motion";

import DecisionCard from "./DecisionCard";
import PolicyViewer from "./PolicyViewer";

function EmptyState() {
  return (
    <div className="flex h-full min-h-[24rem] items-center justify-center rounded-[1.75rem] border border-dashed border-sand/20 bg-white/5 px-6 text-center">
      <div className="max-w-md space-y-3">
        <p className="font-display text-2xl">Awaiting claim input</p>
        <p className="text-sm leading-6 text-sand/70">
          Upload a handwritten prescription to view structured extraction, policy
          retrieval, and the deterministic coverage decision.
        </p>
      </div>
    </div>
  );
}

function ResultPanel({ result }) {
  if (!result) {
    return <EmptyState />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 18 }}
      transition={{ duration: 0.35 }}
      className="grid h-full gap-4 overflow-y-auto pr-1"
    >
      <DecisionCard decision={result.decision} metadata={result.metadata} />

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-[1.5rem] border border-sand/15 bg-white/5 p-5"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-xl">Extracted JSON</h3>
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-sand/55">
              AI output
            </span>
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-black/20 p-4 font-mono text-xs leading-6 text-sand/90">
            {JSON.stringify(result.extractedData, null, 2)}
          </pre>
        </motion.section>

        <PolicyViewer policy={result.policy} />
      </div>
    </motion.div>
  );
}

export default ResultPanel;
