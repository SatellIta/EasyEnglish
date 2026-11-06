# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

EasyEnglish is a local-first English-learning app for Chinese speakers. Users save their own vocabulary (words / phrases / sentences), chat with a built-in AI tutor that references their saved material, generate a daily study summary, and review items on an Ebbinghaus schedule. The interface supports Chinese and English; the learning content is English.

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

SQLite via `better-sqlite3` at `data/easy-english.db` (override with `DB_PATH`). WAL mode, foreign keys on. `server/schema.sql` is applied for fresh databases; versioned migrations live in `server/migrations/` and are applied by `server/db.ts` when `PRAGMA user_version` is behind. Current schema version is **5** (`002_scenes`, `003_learning_signals`, `004_scene_chat`, `005_personas`). To evolve the schema, bump `SCHEMA_VERSION`, add a numbered migration, and reflect the final shape in `schema.sql`.

Tables: `entries`, `review_states`, `review_logs`, `chat_sessions`, `chat_messages`, `daily_summaries`, `settings`, `scenes`, `scene_entries`, `learner_errors`, `personas`, plus `entries_fts` (FTS5 trigram) kept in sync by triggers.

- `entries.type` is `word | phrase | sentence`; `examples` / `tags` are JSON text.
- `entries.review_enabled` (0/1) decides whether an entry enters `/api/review/queue` and due stats. Scene imports default to 0; manual entries default to 1.
- `entries.error_rate` / `error_samples` store the recency-weighted error rate used by the scheduler; `normalized_text` backs dedupe lookups; `source_session_id` / `source_message_id` link summary-added entries back to the conversation.
- `scenes` are user-defined associative-memory spaces. `scene_entries` is many-to-many and stores `section` (H3), `subsection` (bold label / lead-in), `position`, and `added_at`. Scene membership never changes review scheduling.
- `learner_errors` stores recurring mistakes extracted by the daily summary, deduped by normalized `pattern`; `personas` stores the selected/default/custom tutoring personas.
- `chat_sessions.scene_id` binds a conversation to a scene for scene-practice chat.
- Timestamps are UTC ISO strings; "today" boundaries are computed in the server's local timezone in `server/lib/time.ts`. Library date grouping uses SQLite `date(created_at, 'localtime')`.
- API uses camelCase, DB uses snake_case; mapping lives in `server/lib/mappers.ts`.
- Search: `server/lib/queries.ts` uses FTS5 MATCH for queries ≥ 3 chars and falls back to LIKE for shorter/CJK queries. Tag filters use `json_each`.
- Dedupe: `server/lib/dedupe.ts` normalizes the main English text (case, whitespace, surrounding quotes, trailing punctuation) and keys by **text only** — type, meaning, explanation, examples, and tags are not part of the key. Manual create/update returns 409 on a text collision; `POST /api/entries/bulk` skips existing/batch duplicates by default and returns `count` / `skipped` / `duplicates` (with `existingEntryId`); summary candidates, import preview/commit use the same key.
- `ENTRY_SELECT` includes `review_enabled`, error-rate fields, source pointers and a JSON `scene_refs` aggregate; `SCENE_ENTRY_SELECT` adds scene metadata.

### Review scheduling

`server/lib/scheduler.ts`: default intervals `[1, 2, 4, 7, 15, 30, 60, 120, 240]` days and a 10-minute forgot-retry window. Both are configurable from the Settings page and stored in the `settings` table as `review.intervalsDays` (JSON array) and `review.forgotRetryMinutes`. Error-rate tuning uses `review.errorRateRecentWeight` and `review.errorRateIntervalPenalty`: each review updates a recency-weighted `error_rate`, and the effective interval is `base × (1 − errorRate × penalty)`. `getReviewConfig()` in `server/lib/review-config.ts` normalizes/falls back; `nextSchedule()` reads it on every rating. New entries are due immediately. "Remembered" advances one stage and schedules `intervals[stage - 1]` days out; "forgot" resets to stage 0 and returns after the configured retry window; past the ladder the entry becomes `mastered` (365-day interval), unless the high error rate keeps it reviewing. Only entries with `review_enabled = 1` appear in the queue or due stats. Review is active recall only — never multiple choice.

## Markdown import and scenes

- `server/lib/markdown-import.ts` turns the agreed format into `ParsedImportItem[]`. `# words` / `# collocations` / `# sentences` force types; `# Scenery` maps H2 → scene and H3 → 单词/短语/句子 classification. Plain scene lines use the H3 type; list lines in scenes are always sentences.
- Tables are three columns: English, meaning, supplement. Fourth and later columns are dropped; rows with an empty first column are skipped. Escaped `\|` is supported. Line entries can optionally use `text = explanation` or `text — 中文`.
- Slash splitting is limited to explicit word directories (`# words` and scene `### 单词`); phrases/sentences are never slash-split. There is no double-space splitting, no bold-label/lead-in subsection handling, and no arbitrary H3 sections. Unknown H1/H3 fall back to `detectType()` with a preview warning.
- Dedup is text-only via `server/lib/dedupe.ts`. `POST /api/entries` and `PATCH /api/entries/:id` return 409 on collisions; bulk/import skip existing text. `POST /api/import/markdown/commit` inserts with `source = 'markdown-import'`, creates/links scenes, and defaults scene entries to `review_enabled = 0`.
- The import page (`/import`) is a preview/selection UI: collapsible groups, per-item type override, group select, duplicate handling, a global "场景词条也加入每日复习" toggle, and a `?` help modal fed by `src/assets/import-format.md`.
- Export: `server/routes/export.ts` exposes `GET /api/export/options` and `POST /api/export/markdown`. The Library page's export modal selects unscened type groups and/or scenes; output uses the same H1/H2/H3 + three-column tables, with explanation/examples/notes/tags merged into the supplement column. Review progress is not exported.
- `docs/SCENERY_IMPORT.md` documents the mapping, export, and trade-offs.

### AI

OpenAI-compatible providers only (OpenAI, DeepSeek, Qwen, Ollama, etc.). Config resolution in `server/ai/config.ts`: DB settings > `EASYENGLISH_BASE_URL` / `EASYENGLISH_API_KEY` / `EASYENGLISH_MODEL` > defaults. Deliberately do **not** read generic `OPENAI_*` env vars — they may belong to unrelated tools on the machine. Localhost URLs may run without an API key.

- Prompt layers in `server/ai/prompts.ts` (top to bottom): language base (Chinese-assisted / English-only) → persona → task/rules → scene practice → learner memory → recurring errors → current context. The language layer only locks output language; persona/rules/scene/memory/error layers still apply.
- Personas: `server/lib/personas.ts` + `server/routes/personas.ts`. Defaults are `serious`, `homie`, `catgirl`; users can edit default prompts, reset them, or add/delete custom personas. Selection is stored in `ai.personaId`. Default persona names/descriptions are localized by key in the frontend.
- Explanation language: `server/lib/ai-teaching.ts`, setting `ai.explanationMode` (`bilingual` / `english`). Applies to chat, summary and personalized examples. Endpoint `GET/PUT /api/settings/ai-teaching`.
- Chat memory: `server/routes/chat.ts` prioritizes due/high-error entries, scene entries, FTS-relevant entries, today's entries and recent entries. Limits come from `ai.memoryLimit`, `ai.historyLimit`, `ai.memoryCharBudget` (`server/lib/ai-behavior.ts`, `/api/settings/ai-behavior`).
- Recurring errors: `server/lib/errors.ts` + `server/routes/errors.ts`; top active errors are injected into chat and updated by summary generation.
- Streaming: `POST /api/chat/stream` emits newline-delimited JSON (`meta` / `delta` / `done` / `error`), not SSE. Client parser is `streamChat()` in `src/lib/api.ts`.
- Scene chat: `chat_sessions.scene_id` binds a session to a scene; scene entries are injected and the prompt switches to role-play. `POST /api/chat/sessions { sceneId }` creates one.
- Daily summary: `POST /api/summary/today/generate` asks the model for `{ summary, entries[], errors[] }`, tolerates code fences, upserts `daily_summaries`, stores recurring errors, and returns candidate entries. Candidates include `duplicate` / `existingEntryId`, `sourceSessionId` / `sourceMessageId`, and validated `sceneSuggestion` (`existing` / `new` / `none`). Bulk add checks again and reports `skipped`.
- Personalized examples: `POST /api/entries/:id/examples` generates 2–3 examples from the entry, its scenes, recurring errors and existing examples; appends deduped examples. In English-only mode no Chinese translation is appended.
- Summary generation is a **background job** in `src/stores/summary.ts`. Triggering it from Chat or Today keeps it running across route changes; `SummaryJobHost.vue` (mounted in `AppShell`) shows the confirmation modal on any page, with a persistent pill while pending candidates remain.
- The API key is stored in the local SQLite `settings` table in plaintext and masked in responses. This is a personal local app; keep it that way unless asked to add OS keychain support.

## Frontend conventions

- UI is bilingual: Chinese and English, switchable in Settings and persisted in `localStorage` under `easyenglish.locale`. All display strings live in `src/i18n/messages.ts` and are accessed through `t()`; never hard-code UI text in pages/components. `src/i18n/index.ts` owns `locale`, `setLocale`, label helpers and server-error localization. The inline `index.html` script restores `<html lang>` before paint.
- Type labels use `entryTypeLabel()` / `errorCategoryLabel()` from `src/i18n`, not the Chinese constants in `shared/types.ts` (those remain for server prompts).
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

- Working: entries CRUD + text-only dedupe, configurable Ebbinghaus review with error-rate weighting, AI chat streaming with language/persona/scene/memory/error layers, daily summary with scene suggestions and traceability, personalized examples, pronunciation shadowing, settings (AI / persona / forgetting curve / explanation language / interface language / theme), Markdown import preview/commit, scenes, export, and three library views (date / type / scene).
- Daily summary generation is background-safe across route changes and confirms candidates in a global modal; bulk/summary adds are deduped by normalized English text.
- Two themes: Neumorphism and Swiss International, with persistence and a sidebar toggle.
- Speech uses the browser Web Speech API for TTS; `src/lib/pronunciation.ts` adds local shadowing feedback via `SpeechRecognition` (Chrome/Edge).
- Schema version 5 adds `review_enabled`, `scenes`, `scene_entries`, `learner_errors`, `personas`, error-rate fields, dedupe text, source pointers, and `chat_sessions.scene_id`; existing databases migrate automatically.
- `docs/LEARNING_SIGNALS.md` documents error rate, learner errors, dedupe, traceability, context budget, scenes/chat, scene suggestions, examples, pronunciation and the prompt layers.
- Verified by manual API smoke tests and Playwright screenshots; no automated tests yet.
- `docs/ARCHITECTURE.md` has endpoint/data-model detail; `docs/SCENERY_IMPORT.md` documents the import/scene mapping; `docs/UI_STYLE.md` indexes the two binding visual contracts.
