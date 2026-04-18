import { motion } from "framer-motion";

function Loader() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full min-h-[24rem] flex-col items-center justify-center rounded-[1.75rem] border border-sand/15 bg-white/5 px-6 text-center"
    >
      <div className="relative h-20 w-20">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          className="absolute inset-0 rounded-full border-4 border-sand/15 border-t-teal"
        />
        <motion.div
          animate={{ scale: [0.92, 1, 0.92] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          className="absolute inset-3 rounded-full bg-coral/20"
        />
      </div>
      <p className="mt-6 font-display text-2xl text-sand">
        Analyzing Claim with AI...
      </p>
      <p className="mt-3 max-w-md text-sm leading-6 text-sand/70">
        Gemini extraction, Pinecone retrieval, and deterministic approval logic are
        running in sequence.
      </p>
    </motion.div>
  );
}

export default Loader;
