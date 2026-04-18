import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useDropzone } from "react-dropzone";

function UploadBox({ selectedFile, previewUrl, onFileSubmit, loading }) {
  const [localFile, setLocalFile] = useState(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");

  useEffect(() => {
    setLocalFile(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    if (!localFile) {
      setLocalPreviewUrl("");
      return undefined;
    }

    if (previewUrl && selectedFile?.name === localFile.name) {
      setLocalPreviewUrl(previewUrl);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(localFile);
    setLocalPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [localFile, previewUrl, selectedFile]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: {
      "image/*": []
    },
    multiple: false,
    noClick: true,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles[0]) {
        setLocalFile(acceptedFiles[0]);
      }
    }
  });

  async function handleAnalyze() {
    if (!localFile || loading) {
      return;
    }

    await onFileSubmit(localFile);
  }

  return (
    <div className="space-y-4">
      <motion.div
        {...getRootProps()}
        animate={{
          boxShadow: isDragActive
            ? "0 0 0 1px rgba(15,139,141,0.65), 0 0 32px rgba(15,139,141,0.35)"
            : "0 0 0 1px rgba(18,32,51,0.1), 0 20px 40px rgba(18,32,51,0.1)"
        }}
        className="relative overflow-hidden rounded-[1.75rem] border border-ink/10 bg-gradient-to-br from-white to-sand p-5"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(15,139,141,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(217,93,57,0.18),transparent_40%)]" />
        <div className="relative">
          <input {...getInputProps()} />
          <div className="rounded-[1.4rem] border border-dashed border-ink/20 px-6 py-10 text-center">
            <p className="font-display text-2xl">Drop prescription image here</p>
            <p className="mt-3 text-sm text-ink/65">
              Supports handwritten prescription photos and scans.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={open}
                className="rounded-full bg-ink px-5 py-3 font-mono text-xs uppercase tracking-[0.25em] text-sand transition hover:bg-ink/90"
              >
                Choose File
              </button>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!localFile || loading}
                className="rounded-full border border-teal bg-teal px-5 py-3 font-mono text-xs uppercase tracking-[0.25em] text-white transition disabled:cursor-not-allowed disabled:border-ink/20 disabled:bg-ink/20"
              >
                Analyze Claim
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {localFile ? (
        <div className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {localPreviewUrl ? (
              <img
                src={localPreviewUrl}
                alt="Selected prescription preview"
                className="h-24 w-full rounded-2xl object-cover sm:w-40"
              />
            ) : null}
            <div className="space-y-2">
              <p className="font-display text-xl">{localFile.name}</p>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink/55">
                {(localFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default UploadBox;
