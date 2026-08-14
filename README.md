# Mizan Canada

**A fully local, privacy-first AI legal assistant for Canadian law.**

Mizan Canada is a free, open-source desktop application for licensed Canadian lawyers and notaries. All AI inference runs on your machine via [Ollama](https://ollama.com). Your documents, queries, and client matters never leave your device. Zero bytes sent.

---

## Features

**Attorney Workspace**

| Tool | Description |
|---|---|
| Legal Research | Multi-turn Q&A grounded in ingested Canadian statutes with section-level citations |
| Document Review | Structured analysis of contracts and filings: risks, missing clauses, favorability score |
| Draft Generator | Canadian-compliant document drafts from structured inputs |
| Contract Redlining | Inline clause-level redline suggestions against Canadian law |
| Legal Translation | French to English and English to French using official bilingual terminology |
| Clause Playbook | Standard clause positions for common Canadian contract types |
| Deadline Extractor | Extracts every obligation and notice period from contract text |
| Law Library | Upload your own statutes and sync pre-ingested laws |
| Activity Monitor | Full audit log of sessions, tool usage, and security events |

**Privacy Architecture**

- AI inference runs at `127.0.0.1` via Ollama. No network request is made during inference.
- SQLite database stored locally. No cloud database.
- Vector store (LanceDB) stored locally. No external vector service.
- Lockdown mode: auto-locks after 15 minutes of inactivity, requires PIN to resume.

---

## Requirements

- **macOS** (arm64 or x64), Windows, or Linux
- [Ollama](https://ollama.com) installed and running
- Node.js 20+
- 8 GB RAM minimum (16 GB recommended for `qwen2.5:7b`)

---

## Quick Start

### 1. Install Ollama and pull models

```bash
# Install Ollama from https://ollama.com, then:
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

### 2. Clone and install dependencies

```bash
git clone https://github.com/ablugg/mizan-canada.git
cd mizan-canada
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
DATABASE_URL="file:./prisma/dev.db"

# Optional (defaults shown)
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
VECTOR_DB_PATH=./data/vector-store
```

### 4. Set up the database

```bash
npm run db:push
```

### 5. Build the Canadian law vector store

```bash
npm run build:vectors
```

This clones the [Justice Canada laws-lois-xml](https://github.com/justicecanada/laws-lois-xml) repo and ingests all federal Acts and Regulations (English and French) into LanceDB. Run once. Re-run to pull the latest amendments.

### 6. Run

**Dev server:**
```bash
npm run dev
```

**Electron desktop app (dev):**
```bash
npm run electron:dev
```

**Production build:**
```bash
npm run electron:build
```

The DMG (macOS) or installer will appear in `dist-electron/`.

---

## Law Library

Lawyers can upload their own statutes directly from the app under **Law Library**. Uploaded files are chunked and embedded locally into a separate `user_chunks` table in LanceDB. They persist independently and are never affected by law sync operations.

---

## Architecture

```
Electron shell
    |
    +-- Next.js app (standalone)
            |
            +-- /attorney/*         Attorney workspace (9 tools)
            |       |
            |       +-- lib/rag.ts              LanceDB vector retrieval
            |       |     +-- legal_chunks      Pre-ingested Canadian statutes
            |       |     +-- user_chunks       Lawyer-uploaded laws
            |       |
            |       +-- lib/llm.ts              Ollama chat + streaming
            |
            +-- /chat/*             General legal chat
            |
            +-- /api/*              API routes (all server-side, local only)

All AI inference: Ollama at 127.0.0.1:11434
Database: SQLite via Prisma (local file)
Vector store: LanceDB (local directory)
```

---

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron 34 |
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| AI inference | Ollama (qwen2.5:7b default) |
| Embeddings | nomic-embed-text via Ollama |
| Vector store | LanceDB (local) |
| Database | SQLite via Prisma |
| Styling | Tailwind CSS |

---

## Project Structure

```
app/
  (attorney)/attorney/*    Attorney workspace pages (9 tools)
  api/attorney/*           Attorney API routes
  chat/[id]                General chat
components/
  attorney/                Attorney UI components
lib/
  llm.ts                   Ollama wrapper, system prompts
  rag.ts                   LanceDB retrieval, addUserLaw, deleteUserLawChunks
  db.ts                    Prisma client
  local-auth.ts            Local session auth
data/
  sources/                 Cloned Canadian law XML repo (gitignored)
  ingestion/               Vector build pipeline
prisma/
  schema.prisma            SQLite schema
electron/                  Electron main process
```

---

## Law Coverage

The vector store is built from the official [Justice Canada Consolidated Laws](https://github.com/justicecanada/laws-lois-xml) repository, which includes:

- 967 federal Acts (English and French)
- 3,000+ federal Regulations (English and French)
- Criminal Code (R.S.C. 1985, c. C-46)
- Canada Labour Code (R.S.C. 1985, c. L-2)
- Income Tax Act (R.S.C. 1985, c. 1 (5th Supp.))
- Canada Business Corporations Act (R.S.C. 1985, c. C-44)
- PIPEDA (S.C. 2000, c. 5)
- Canadian Charter of Rights and Freedoms
- And every other federal statute and regulation in force

Additional statutes (including provincial laws) can be uploaded directly through the Law Library tool in the app.

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss the approach.

Areas where contributions are particularly useful:

- Provincial statute ingestion pipelines
- Windows and Linux packaging and testing
- French UI improvements
- Additional legal tool types

---

## License

MIT. See [LICENSE](./LICENSE).
