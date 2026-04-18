const { syncPolicyCatalog } = require("../services/retriever");

async function main() {
  const result = await syncPolicyCatalog({ force: true });
  console.log("[AuthClear] Policy indexing complete.", result);
}

main().catch((error) => {
  console.error("[AuthClear] Policy indexing failed.", error.message);
  process.exit(1);
});
