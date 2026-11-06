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

- `src/` — Vue 3 + TypeScript SPA (Vite, Pinia, Vue Router). Pages in `src/pages`, reusable components in `src/components`, API/NDJSON client in `src/lib/api.ts`, design tokens and global CSS in `src/styles/main.css`. Library views live in `src/components/library/`; import preview rows in `src/components/import/`.
- `server/` — Hono app (`server/index.ts`) on port 3001. Routes in `server/routes`, SQLite connection in `server/db.ts`, domain helpers in `server/lib`, AI integration in `server/ai`. Markdown parsing is `server/lib/markdown-import.ts`; scene helpers are `server/lib/scenes.ts`; entry writes are `server/lib/entry-store.ts`.
- `shared/types.ts` — API DTOs and constants shared by both sides (`@shared/*` alias). This is the contract; update it when endpoints change.

Dev flow: Vite proxies `/api` to `:3001`. Production: `pnpm start` sets `NODE_ENV=production`; Hono serves `dist/` and falls back to `index.html` for SPA routes.

### Data layer

SQLite via `better-sqlite3` at `data/easy-english.db` (override with `DB_PATH`). WAL mode, foreign keys on. `server/schema.sql` is applied for fresh databases; versioned migrations live in `server/migrations/` and are applied by `server/db.ts` when `PRAGMA user_version` is behind. Current schema version is **2**. To evolve the schema, bump `SCHEMA_VERSION`, add a numbered migration, and reflect the final shape in `schema.sql`.

Tables: `entries`, `review_states`, `review_logs`, `chat_sessions`, `chat_messages`, `daily_summaries`, `settings`, `scenes`, `scene_entries`, plus `entries_fts` (FTS5 trigram) kept in sync by triggers.

- `entries.type` is `word | phrase | sentence`; `examples` / `tags` are JSON text.
- `entries.review_enabled` (0/1) decides whether an entry enters `/api/review/queue` and due stats. Scene imports default to 0; manual entries default to 1.
- `scenes` are user-defined associative-memory spaces. `scene_entries` is many-to-many and stores `section` (H3), `subsection` (bold label / lead-in), `position`, and `added_at`. Scene membership never changes review scheduling.
- Timestamps are UTC ISO strings; "today" boundaries are computed in the server's local timezone in `server/lib/time.ts`. Library date grouping uses SQLite `date(created_at, 'localtime')`.
- API uses camelCase, DB uses snake_case; mapping lives in `server/lib/mappers.ts`.
- Search: `server/lib/queries.ts` uses FTS5 MATCH for queries ≥ 3 chars and falls back to LIKE for shorter/CJK queries. Tag filters use `json_each`.
- Dedupe: `server/lib/dedupe.ts` normalizes text (case, whitespace, surrounding quotes, trailing punctuation) and keys by `type + text`. `POST /api/entries/bulk` skips existing/batch duplicates by default and returns `count` / `skipped` / `duplicates`; summary candidates and Markdown import previews use the same key.
- `ENTRY_SELECT` includes `review_enabled` and a JSON `scene_refs` aggregate; `SCENE_ENTRY_SELECT` adds scene metadata.

### Review scheduling

`server/lib/scheduler.ts`: default intervals `[1, 2, 4, 7, 15, 30, 60, 120, 240]` days and a 10-minute forgot-retry window. Both are configurable from the Settings page and stored in the `settings` table as `review.intervalsDays` (JSON array) and `review.forgotRetryMinutes`. `getReviewConfig()` in `server/lib/review-config.ts` normalizes/falls back; `nextSchedule()` reads it on every rating. New entries are due immediately. "Remembered" advances one stage and schedules `intervals[stage - 1]` days out; "forgot" resets to stage 0 and returns after the configured retry window; past the ladder the entry becomes `mastered` (365-day interval). Only entries with `review_enabled = 1` appear in the queue or due stats. Review is active recall only — never multiple choice.

## Markdown import and scenes

- `server/lib/markdown-import.ts` turns H1/H2/H3 notes into `ParsedImportItem[]`. `# words`, `# collocations`, `# sentences` become normal entries; `# Scenery` maps H2 → scene, H3 → `section`, bold labels / `At a bank:` → `subsection`.
- The parser splits `a / b / c` into alternatives for words/phrases/scene lists, parses `text = explanation` and `text — 中文`, handles tables, bullets, quotes, trailing parenthetical notes, and one malformed pipe-table row.
- `POST /api/import/markdown/preview` marks duplicates by `type + lower(trim(text))` against the DB and within the batch. `POST /api/import/markdown/commit` dedupes again, inserts with `source = 'markdown-import'`, creates/links scenes, and defaults scene entries to `review_enabled = 0`.
- The import page (`/import`) is a preview/selection UI: collapsible groups, per-item type override, group select, duplicate handling, and a global "场景词条也加入每日复习" toggle.
- `docs/SCENERY_IMPORT.md` documents the mapping and trade-offs.

### AI

OpenAI-compatible providers only (OpenAI, DeepSeek, Qwen, Ollama, etc.). Config resolution in `server/ai/config.ts`: DB settings > `EASYENGLISH_BASE_URL` / `EASYENGLISH_API_KEY` / `EASYENGLISH_MODEL` > defaults. Deliberately do **not** read generic `OPENAI_*` env vars — they may belong to unrelated tools on the machine. Localhost URLs may run without an API key.

- Built-in prompts: `server/ai/prompts.ts` (tutor persona + learner-memory block; summary JSON contract).
- Chat memory: `server/routes/chat.ts` retrieves FTS-relevant entries + today's entries + recent entries, dedupes, and injects up to 30 into the system prompt.
- Streaming: `POST /api/chat/stream` emits newline-delimited JSON (`meta` / `delta` / `done` / `error`), not SSE. Client parser is `streamChat()` in `src/lib/api.ts`.
- Daily summary: `POST /api/summary/today/generate` asks the model for `{ summary, entries[] }`, tolerates code fences, upserts `daily_summaries`, and returns candidate entries the UI can bulk-add. Candidates are marked `duplicate` by `server/lib/dedupe.ts`; bulk add checks again and reports `skipped`.
- Summary generation is a **background job** in `src/stores/summary.ts`. Triggering it from Chat or Today keeps it running across route changes; `SummaryJobHost.vue` (mounted in `AppShell`) shows the confirmation modal on any page, with a persistent "今日总结已生成" pill while pending candidates remain.
- The API key is stored in the local SQLite `settings` table in plaintext and masked in responses. This is a personal local app; keep it that way unless asked to add OS keychain support.

## Frontend conventions

- Chinese UI. Type labels/constants live in `shared/types.ts`.
- Pages: Today (`/today`), Chat (`/chat/:id?`), Review (`/review`), Library (`/library`), Import (`/import`), Settings (`/settings`).
- Library has three views: date (`DateView.vue`), type (`TypeView.vue`), scene (`SceneView.vue`). The page owns search debouncing and the shared `EntryForm`; views own their own data loads. `EntryCard.vue` is the shared row component.
- Scene creation/editing uses `SceneFormModal.vue`; adding existing entries uses `SceneEntryPicker.vue`. New entries created from a scene default to `reviewEnabled: false`.
- `ImportMarkdownPage.vue` owns the two-step import flow; `ImportItemRow.vue` renders each preview item and allows a per-item type override.
- `useAppStore` (`src/stores/app.ts`) owns review stats/settings; call `refreshStats()` after any mutation that affects counts.
- `useSummaryStore` (`src/stores/summary.ts`) owns the background summary job and its modal state. `SummaryJobHost.vue` is mounted once in `AppShell`; don't tie generation to a page component's lifecycle. `TodayPage` mirrors the store result into its summary panel and watches `revision` to reload after adds.
- AI Markdown is rendered by `MarkdownView.vue` (marked + DOMPurify). Sanitization is mandatory; keep it.
- Review keyboard shortcuts (1/J remember, 2/K forget, Space/Enter continue) live in `ReviewPage.vue`.
- The chat composer guards IME composition before sending on Enter.
- Speech playback uses the browser's built-in Web Speech API (`src/lib/speech.ts`, `SpeakButton.vue`), including voice selection, chunking, cancel/resume, and support/error feedback. Do not add bundled audio or a server-side TTS dependency.
- Styling is plain CSS. Shared structure lives in `src/styles/main.css`; theme tokens live in `src/styles/themes/neumorphism.css` and `src/styles/themes/swiss.css`. No component library; avoid adding one.
- Two themes are supported and switchable from Settings or the sidebar footer: **Neumorphism / Soft UI** (default) and **Swiss International**. Binding contracts: `docs/UI_STYLE_NEUMORPHISM.md`, `docs/UI_STYLE_SWISS.md`, indexed in `docs/UI_STYLE.md`.
- Theme state is `<html data-theme="...">`, persisted in `localStorage` under `easyenglish.theme`; `src/stores/theme.ts` owns it. The inline script in `index.html` restores it before paint.
- Prefer tokens (`--bg`, `--ink`, `--accent`, `--border-*`, `--radius-*`, shadows, `--transition`, typography) over hard-coded colors so both themes keep working.
- Neumorphism rules: `#e0e5ec` surfaces, dual shadows (white top-left, `#b8bcc2` bottom-right), no borders/gradients/pure white backgrounds/translate, hover shrinks shadows, active goes inset, inputs inset and relax on focus.
- Swiss rules: white/black/red, sharp corners, 1px black borders, no shadows, Helvetica-like sans, `150ms ease-out`, buttons carry a `→`, left-aligned, generous negative space.
- Apply visual changes through tokens and global classes, not hard-coded colors in pages.

## Current state

- Working: entries CRUD + search, configurable Ebbinghaus review, AI chat streaming, daily summary, settings (AI / forgetting curve / theme), Markdown import preview/commit, scenes, and three library views (date / type / scene).
- Daily summary generation is background-safe across route changes and confirms candidates in a global modal; bulk/summary adds are deduped by type + normalized text.
- Two themes: Neumorphism and Swiss International, with persistence and a sidebar toggle.
- Speech uses the browser Web Speech API with graceful support/error feedback.
- Schema version 2 adds `entries.review_enabled`, `scenes`, and `scene_entries`; existing databases migrate automatically.
- Verified by manual API smoke tests and Playwright screenshots; no automated tests yet.
- `docs/ARCHITECTURE.md` has endpoint/data-model detail; `docs/SCENERY_IMPORT.md` documents the import/scene mapping; `docs/UI_STYLE.md` indexes the two binding visual contracts.
