# AuthClear

AuthClear is a hybrid AI claim-processing demo for handwritten medical prescriptions. It combines Gemini multimodal extraction, Pinecone policy retrieval, and a deterministic decision engine with a React dashboard.

## Backend

1. Create `backend/.env` from `backend/.env.example`.
2. Add `DATABASE_URL`.
3. Choose an AI fallback mode:

```bash
ALLOW_DEGRADED_AI_FALLBACK=true
```

- `true`: demo/dev mode. Gemini and Pinecone are optional, and the API returns degraded-but-usable responses when those providers are unavailable.
- `false`: strict mode. `GEMINI_API_KEY` and `PINECONE_API_KEY` are required, and provider failures surface as startup or request errors.

4. If strict mode is enabled, also add `GEMINI_API_KEY` and `PINECONE_API_KEY`.
5. Run:

```bash
cd backend
npm install
npm run dev
```

The backend will:

- create PostgreSQL tables automatically from `backend/db/schema.sql`
- create or reuse the Pinecone index `insurance-policies`
- seed the bundled policy corpus into Pinecone on startup
- expose degraded execution details in `/api/process-claim` metadata when external AI dependencies are unavailable

Optional manual re-index:

```bash
cd backend
npm run index:policies
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

The UI runs on `http://localhost:5173` and posts claim images to `http://localhost:5000/api/process-claim`.
