const { syncPolicyCatalog } = require("../services/retriever");

async function main() {
  const result = await syncPolicyCatalog({ force: true });

  if (result.mode !== "pinecone") {
    throw new Error(
      result.error || "Policy indexing completed without Pinecone connectivity."
    );
  }

  console.log("[AuthClear] Policy indexing complete.", result);
}

main().catch((error) => {
  console.error("[AuthClear] Policy indexing failed.", error.message);
  process.exit(1);
});
