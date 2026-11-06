# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

EasyEnglish is a local-first English-learning app for Chinese speakers. Users save their own vocabulary (words / phrases / sentences), chat with a built-in AI tutor that references their saved material, generate a daily study summary, and review items on an Ebbinghaus schedule. The UI is Chinese; the learning content is English.

The app is deliberately light: one Vue 3 SPA + one small Hono process + one SQLite file. No ORM, no UI component library, no cloud services.

## Commands

Node 24 + pnpm 11 are required. `better-sqlite3`/`esbuild` build scripts are already approved in `pnpm-workspace.yaml`.

- `pnpm dev` — start Hono (`:3001`) and Vite (`:5173`) together; open http://localhost:5173
- `pnpm dev:server` / `pnpm dev:web` — run one side only
- `pnpm build` — `vue-tsc` type check + Vite build into `dist/`
- `pnpm start` — production mode: Hono serves both API and `dist/` on `:3001`
- `pnpm typecheck` — type check only
- No automated test runner yet. For API smoke tests, start the server and `curl localhost:3001/api/...`.

AI is optional at boot: without configuration the UI works, while chat/summary return a friendly `400`. Configure in the in-app Settings page, or copy `.env.example` to `.env`.

## Architecture

Single package, three source areas:

- `src/` — Vue 3 + TypeScript SPA (Vite, Pinia, Vue Router). Pages in `src/pages`, reusable components in `src/components`, API/NDJSON client in `src/lib/api.ts`, design tokens and global CSS in `src/styles/main.css`.
- `server/` — Hono app (`server/index.ts`) on port 3001. Routes in `server/routes`, SQLite connection in `server/db.ts`, domain helpers in `server/lib`, AI integration in `server/ai`.
- `shared/types.ts` — API DTOs and constants shared by both sides (`@shared/*` alias). This is the contract; update it when endpoints change.

Dev flow: Vite proxies `/api` to `:3001`. Production: `pnpm start` sets `NODE_ENV=production`; Hono serves `dist/` and falls back to `index.html` for SPA routes.

### Data layer

SQLite via `better-sqlite3` at `data/easy-english.db` (override with `DB_PATH`). WAL mode, foreign keys on. `server/schema.sql` is applied inside a transaction when `PRAGMA user_version < SCHEMA_VERSION` (see `server/db.ts`). To evolve the schema, bump `SCHEMA_VERSION` and add a versioned migration block — editing `schema.sql` alone will not touch existing databases.

Tables: `entries`, `review_states`, `review_logs`, `chat_sessions`, `chat_messages`, `daily_summaries`, `settings`, plus `entries_fts` (FTS5 trigram) kept in sync by triggers.

- `entries.type` is `word | phrase | sentence`; `examples` / `tags` are JSON text.
- Timestamps are UTC ISO strings; "today" boundaries are computed in the server's local timezone in `server/lib/time.ts`.
- API uses camelCase, DB uses snake_case; mapping lives in `server/lib/mappers.ts`.
- Search: `server/lib/queries.ts` uses FTS5 MATCH for queries ≥ 3 chars and falls back to LIKE for shorter/CJK queries. Tag filters use `json_each`.

### Review scheduling

`server/lib/scheduler.ts`: intervals `[1, 2, 4, 7, 15, 30, 60, 120, 240]` days. New entries are due immediately. "Remembered" advances one stage and schedules `INTERVALS[stage - 1]` days out; "forgot" resets to stage 0 and returns in 10 minutes; past the ladder the entry becomes `mastered` (365-day interval). Review is active recall only — never multiple choice.

### AI

OpenAI-compatible providers only (OpenAI, DeepSeek, Qwen, Ollama, etc.). Config resolution in `server/ai/config.ts`: DB settings > `EASYENGLISH_BASE_URL` / `EASYENGLISH_API_KEY` / `EASYENGLISH_MODEL` > defaults. Deliberately do **not** read generic `OPENAI_*` env vars — they may belong to unrelated tools on the machine. Localhost URLs may run without an API key.

- Built-in prompts: `server/ai/prompts.ts` (tutor persona + learner-memory block; summary JSON contract).
- Chat memory: `server/routes/chat.ts` retrieves FTS-relevant entries + today's entries + recent entries, dedupes, and injects up to 30 into the system prompt.
- Streaming: `POST /api/chat/stream` emits newline-delimited JSON (`meta` / `delta` / `done` / `error`), not SSE. Client parser is `streamChat()` in `src/lib/api.ts`.
- Daily summary: `POST /api/summary/today/generate` asks the model for `{ summary, entries[] }`, tolerates code fences, upserts `daily_summaries`, and returns candidate entries the UI can bulk-add.
- The API key is stored in the local SQLite `settings` table in plaintext and masked in responses. This is a personal local app; keep it that way unless asked to add OS keychain support.

## Frontend conventions

- Chinese UI. Type labels/constants live in `shared/types.ts`.
- Pages: Today (`/today`), Chat (`/chat/:id?`), Review (`/review`), Library (`/library`), Settings (`/settings`).
- `useAppStore` (`src/stores/app.ts`) owns review stats/settings; call `refreshStats()` after any mutation that affects counts.
- AI Markdown is rendered by `MarkdownView.vue` (marked + DOMPurify). Sanitization is mandatory; keep it.
- Review keyboard shortcuts (1/J remember, 2/K forget, Space/Enter continue) live in `ReviewPage.vue`.
- The chat composer guards IME composition before sending on Enter.
- Styling is plain CSS with tokens at the top of `src/styles/main.css`. No component library; avoid adding one.
- **UI style constraint pending**: the user will provide a long frontend style prompt. It belongs in `docs/UI_STYLE.md`; apply it by updating tokens/global CSS rather than scattering hard-coded colors.

## Current state

- Working: entries CRUD + search, Ebbinghaus review, AI chat streaming, daily summary, settings, responsive desktop/mobile layout.
- Verified by manual API smoke tests and Playwright screenshots; no automated tests yet.
- `docs/ARCHITECTURE.md` has endpoint/data-model detail; `docs/UI_STYLE.md` is the pending visual contract.
