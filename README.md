# AuthClear

AuthClear is a hybrid AI claim-processing demo for handwritten medical prescriptions. It combines Gemini multimodal extraction, Pinecone policy retrieval, and a deterministic decision engine with a React dashboard.

## Backend

1. Create `backend/.env` from `backend/.env.example`.
2. Add `DATABASE_URL`.
3. Set the allowed frontend origin:

```bash
CLIENT_ORIGIN=https://authclear.vercel.app
```

For local development plus production, use a comma-separated list:

```bash
CLIENT_ORIGIN=http://localhost:5173,https://authclear.vercel.app
```

4. Choose an AI fallback mode:

```bash
ALLOW_DEGRADED_AI_FALLBACK=false
```

- `false`: strict production mode (default). `GEMINI_API_KEY` and `PINECONE_API_KEY` are required, and provider failures surface as startup or request errors.
- `true`: optional degraded mode for demos. Retrieval or generation can fall back with explicit warnings and health degradation.

5. If strict mode is enabled, also add `GEMINI_API_KEY` and `PINECONE_API_KEY`.
6. Run:

```bash
cd backend
npm install
npm run dev
```

The backend will:

- create PostgreSQL tables automatically from `backend/db/schema.sql`
- create or reuse the Pinecone index `insurance-policies`
- seed the bundled policy corpus into Pinecone on startup
- run a true RAG path (`query -> embedding -> Pinecone top-k -> context assembly -> Gemini answer`)
- expose dependency readiness in `/api/health` and degraded execution details in `/api/process-claim` metadata

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

For the deployed Vercel frontend, set:

```bash
VITE_API_URL=https://authclear.onrender.com
```

If `VITE_API_URL` is not set, the frontend defaults to `https://authclear.onrender.com`.
