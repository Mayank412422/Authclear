import { useEffect, useState, startTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";

import UploadBox from "../components/UploadBox";
import ResultPanel from "../components/ResultPanel";
import Loader from "../components/Loader";
import { processClaim } from "../services/api";

function Dashboard() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile]);

  async function handleSubmit(file) {
    setLoading(true);
    setError("");
    setSelectedFile(file);

    try {
      const response = await processClaim(file);
      startTransition(() => {
        setResult(response);
      });
    } catch (requestError) {
      setResult(null);
      setError(
        requestError.response?.data?.message ||
          "Claim processing failed. Check backend connectivity and credentials."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-sand text-ink">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-[-6rem] h-72 w-72 rounded-full bg-teal/20 blur-3xl" />
        <div className="absolute bottom-[-8rem] right-[-4rem] h-96 w-96 rounded-full bg-coral/15 blur-3xl" />
        <div className="absolute left-1/2 top-24 h-48 w-48 -translate-x-1/2 rounded-full border border-ink/10 bg-white/30 blur-2xl animate-drift" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 lg:flex-row lg:px-8">
        <motion.section
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex w-full flex-col justify-between rounded-[2rem] border border-ink/10 bg-white/70 p-6 shadow-glow backdrop-blur lg:w-[42%] lg:p-8"
        >
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-teal">
              AuthClear
            </p>
            <div className="space-y-3">
              <h1 className="font-display text-4xl leading-tight lg:text-5xl">
                AI-first claim triage for handwritten prescriptions.
              </h1>
              <p className="max-w-xl text-sm leading-6 text-ink/70">
                Upload a prescription image to extract clinical fields with Gemini,
                retrieve the most relevant insurance clause from Pinecone, and run
                deterministic approval logic.
              </p>
            </div>
          </div>

          <div className="mt-8">
            <UploadBox
              selectedFile={selectedFile}
              previewUrl={previewUrl}
              onFileSubmit={handleSubmit}
              loading={loading}
            />
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-6 flex w-full flex-1 flex-col rounded-[2rem] border border-ink/10 bg-ink px-5 py-6 text-sand shadow-glow lg:mt-0 lg:ml-6 lg:p-8"
        >
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-wheat">
                Analysis
              </p>
              <h2 className="mt-2 font-display text-2xl">Claim Results</h2>
            </div>
            {result?.metadata && (
              <div className="rounded-full border border-sand/20 bg-white/5 px-4 py-2 font-mono text-xs uppercase tracking-[0.24em] text-sand/80">
                Confidence {(result.metadata.confidence * 100).toFixed(0)}%
              </div>
            )}
          </div>

          {error ? (
            <div className="rounded-3xl border border-coral/40 bg-coral/10 px-5 py-4 text-sm text-sand">
              {error}
            </div>
          ) : null}

          {result?.metadata?.degraded ? (
            <div className="mt-4 rounded-3xl border border-wheat/35 bg-wheat/10 px-5 py-4 text-sm leading-6 text-sand">
              {result.metadata.extraction?.degraded
                ? "Gemini extraction was unavailable for this request. AuthClear returned unknown fields and marked the result for manual review."
                : "AuthClear completed this request in degraded mode because external retrieval services were unavailable."}
            </div>
          ) : null}

          <div className="mt-4 flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              {loading ? (
                <Loader key="loader" />
              ) : (
                <ResultPanel key="results" result={result} />
              )}
            </AnimatePresence>
          </div>
        </motion.section>
      </div>
    </main>
  );
}

export default Dashboard;
