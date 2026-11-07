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

SQLite via `better-sqlite3` at `data/easy-english.db` (override with `DB_PATH`). WAL mode, foreign keys on. `server/schema.sql` is applied for fresh databases; versioned migrations live in `server/migrations/` and are applied by `server/db.ts` when `PRAGMA user_version` is behind. Current schema version is **6** (`002_scenes`, `003_learning_signals`, `004_scene_chat`, `005_personas`, `006_rich_entries`). To evolve the schema, bump `SCHEMA_VERSION`, add a numbered migration, and reflect the final shape in `schema.sql`.

Anki media files live in `data/media/` (content-addressed, served at `/api/media/:name`); uploaded Anki packages are unpacked under `data/imports/<uuid>/` and deleted after commit/cancel or after one hour.

Tables: `entries`, `review_states`, `review_logs`, `chat_sessions`, `chat_messages`, `daily_summaries`, `settings`, `scenes`, `scene_entries`, `learner_errors`, `personas`, plus `entries_fts` (FTS5 trigram) kept in sync by triggers.

- `entries.type` is `word | phrase | sentence`; `examples` / `tags` / `images` are JSON text.
- `entries.review_enabled` (0/1) decides whether an entry enters `/api/review/queue` and due stats. Scene imports default to 0; manual entries default to 1.
- Rich Anki fields: `phonetic`, `english_definition`, `images` (local `/api/media/...` URLs), and `external_id` (Anki GUID, used for re-import matching). `learned_at` is NULL for imported entries that still need the Learn flow; manual/summary/Markdown entries are learned immediately. `POST /api/learn/complete` sets `learned_at`, enables review, and schedules known words one day out / unknown words immediately.
- `entries.error_rate` / `error_samples` store the recency-weighted error rate used by the scheduler; `normalized_text` backs dedupe lookups; `source_session_id` / `source_message_id` link summary-added entries back to the conversation.
- `scenes` are user-defined associative-memory spaces. `scene_entries` is many-to-many and stores `section` (H3 segment; legacy data uses the type label), `subsection` (H4 heading, usually the type label), `position`, and `added_at`. Scene membership never changes review scheduling.
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

- `server/lib/markdown-import.ts` turns the agreed format into `ParsedImportItem[]`. `# words` / `# collocations` / `# sentences` force types; `# Scenery` maps H2 → scene, H3 → free-form segment (`scene_entries.section`), H4 → 单词/短语/句子 classification (`scene_entries.subsection`). The old `## scene` + `### 单词` layout still works. Plain scene lines use the current H4/H3 type; list lines in scenes are always sentences.
- Tables accept named columns in any order and any subset: English / 含义 / 英英释义 / 例句 / 补充 / 笔记 / 音标 / 标签 (Chinese or English headers). The legacy `English | 含义 | 补充` positional table and an unrecognized-header fallback still work. Rows with an empty English cell are skipped; escaped `\|` is supported. Fields map to `meaning`, `englishDefinition`, `examples`, `explanation`, `notes`, `phonetic`, `tags`.
- Plain lines can use `text = explanation` or `text — 中文`. Indented continuation lines (`英英释义：…`, `例句：…`, `音标：…`, …) attach fields to the previous entry, and `>` quote lines attach **example sentences** — this is how a one-sentence English definition or example is attached to a word. Continuation labels are listed in `src/assets/import-format.md`.
- Slash splitting is limited to explicit word directories (`# words`, `#### 单词`, legacy `### 单词`); phrases/sentences are never slash-split. There is no bold-label/lead-in subsection handling. Unknown H1 falls back to `detectType()` with a preview warning; inside Scenery, an unrecognized H3 is treated as a free-form segment (new intended behavior) rather than a warning.
- Dedup is text-only via `server/lib/dedupe.ts`. `POST /api/entries` and `PATCH /api/entries/:id` return 409 on collisions; bulk/import skip existing text. `POST /api/import/markdown/commit` inserts with `source = 'markdown-import'`, creates/links scenes, and defaults scene entries to `review_enabled = 0`.
- The import page (`/import`) is a preview/selection UI: collapsible groups, per-item type override, group select, duplicate handling, a global "场景词条也加入每日复习" toggle, and a `?` help modal fed by `src/assets/import-format.md` / `import-format.en.md`. The Anki import entry point lives in the Library page, not on this page.
- Export: `server/routes/export.ts` exposes `GET /api/export/options` and `POST /api/export/markdown`. The Library page's export modal selects unscened type groups and/or scenes; output uses named-column tables (only columns that actually have data) and scene `### segment` → `#### 单词/短语/句子`. Legacy scene data without a segment exports `### 单词/短语/句子`. `englishDefinition`, examples, explanation, notes, phonetic and tags stay separate columns. Review progress and images are not exported.
- `docs/SCENERY_IMPORT.md` documents the mapping, export, and trade-offs.

## Anki import and Learn flow

- Import endpoints: `POST /api/import/anki/preview` (multipart `file`), `POST /api/import/anki/commit` (`{ importId, options }`), `DELETE /api/import/anki/:importId`. Uploads are capped at 200MB and unpacked under `data/imports/<uuid>/`; sessions expire after one hour.
- AnkiWeb shared decks: the import modal's "AnkiWeb shared decks" tab only links to `https://ankiweb.net/shared/decks` in a new browser tab. Users find/download the `.apkg` themselves, then upload it through the normal file tab. There is no in-app AnkiWeb search or download, no AnkiWeb login/cookie handling, and no proxy endpoint; this avoids AnkiWeb's anonymous rate limits and credential storage.
- Parser: `server/lib/import/zip.ts` is a dependency-free ZIP reader (stored/deflate), `anki-package.ts` handles `collection.anki21b` (zstd), `.anki21`, `.anki2`, schema 11 and 18, and reads with `node:sqlite` because `better-sqlite3` lacks Anki's `unicase` collation. Notes are streamed in batches; the limits are 300MB decompressed SQLite and 100,000 notes.
- Mapping: `server/lib/import/anki-mapper.ts` cleans HTML/cloze/`[sound:]`, auto-maps fields by name (单词/基本释义/英英释义/音标/图片/考纲/柯林斯英汉, plus Front/Back), extracts Collins example pairs, and infers word/phrase/sentence. Users can override the primary note type's mapping in the preview.
- Images: only referenced raster images are extracted, hashed, and stored under `data/media/`; `/api/media/:name` serves them with immutable caching. SVG and audio are skipped. `images` on an entry is a JSON array of local URLs.
- Commit dedupes by Anki GUID (`source = 'anki'`, `external_id`) first, then normalized English text. Modes are skip / update (content only, review state preserved) / new. `.colpkg` is always merged; existing entries are never deleted. `addToReview` off (default) leaves `learned_at = NULL` and `review_enabled = 0` so the words enter the Learn flow first.
- Learn endpoints: `GET /api/learn/stats?tag=`, `GET /api/learn/queue?size=5..50&types=&tag=`, `POST /api/learn/complete { known, unknown }`. The optional `tag` narrows both stats and the queue to a single Anki tag group. The queue draws random entries with `learned_at IS NULL`. Completing sets `learned_at`, enables review, and schedules known words one day later / unknown words immediately.
- The Learn page (`/learn`, nav between Today and Chat) is a two-phase flow: recognize the whole batch (known/unknown), then study only the unknown entries with the full stored details (Chinese meaning, English definition, phonetics, examples, images). The setup card offers a tag-group selector (persisted under `easyenglish.learnTag`) and a batch size. Details come entirely from the user's library; no AI generation.
- `GET /api/tags` returns every tag with total/unlearned counts (`TagSummary`); the Library tag view and the Learn selector share it.

### AI

OpenAI-compatible providers only (OpenAI, DeepSeek, Qwen, Ollama, etc.). Config resolution in `server/ai/config.ts`: DB settings > `EASYENGLISH_BASE_URL` / `EASYENGLISH_API_KEY` / `EASYENGLISH_MODEL` > defaults. Deliberately do **not** read generic `OPENAI_*` env vars — they may belong to unrelated tools on the machine. Localhost URLs may run without an API key.

- Prompt layers in `server/ai/prompts.ts` (top to bottom): language base (Chinese-assisted / English-only) → persona → task/rules → scene practice → learner memory → recurring errors → current context. The language layer only locks output language; persona/rules/scene/memory/error layers still apply.
- Personas: `server/lib/personas.ts` + `server/routes/personas.ts`. Defaults are `serious`, `homie`, `catgirl`; users can edit default prompts, reset them, or add/delete custom personas. Selection is stored in `ai.personaId`. Default persona names/descriptions are localized by key in the frontend.
- Explanation language: `server/lib/ai-teaching.ts`, setting `ai.explanationMode` (`bilingual` / `english`). Applies to chat and personalized examples. Endpoint `GET/PUT /api/settings/ai-teaching`. Daily summaries additionally follow the interface locale: an English UI always uses the English summary prompt, even when explanations are bilingual; a Chinese UI follows this setting.
- Chat memory: `server/routes/chat.ts` prioritizes due/high-error entries, scene entries, FTS-relevant entries, today's entries and recent entries. Limits come from `ai.memoryLimit`, `ai.historyLimit`, `ai.memoryCharBudget` (`server/lib/ai-behavior.ts`, `/api/settings/ai-behavior`).
- Recurring errors: `server/lib/errors.ts` + `server/routes/errors.ts`; top active errors are injected into chat and updated by summary generation.
- Streaming: `POST /api/chat/stream` emits newline-delimited JSON (`meta` / `delta` / `done` / `error`), not SSE. Client parser is `streamChat()` in `src/lib/api.ts`.
- Scene chat: `chat_sessions.scene_id` binds a session to a scene; scene entries are injected and the prompt switches to role-play. `POST /api/chat/sessions { sceneId }` creates one.
- Daily summary: `POST /api/summary/today/generate` accepts an optional `{ locale: 'zh' | 'en' }` body and asks the model for `{ summary, entries[], errors[] }`, tolerates code fences, upserts `daily_summaries`, stores recurring errors, and returns candidate entries. It is not called when today has neither conversation messages nor entries learned today (review-only activity returns `400 { code: 'no_study' }`), and the client shows an inline notice instead of the failure modal. Anki imports that have not gone through Learn (`learned_at IS NULL`) are excluded so a large deck cannot flood the prompt. Candidates include `duplicate` / `existingEntryId`, `sourceSessionId` / `sourceMessageId`, and validated `sceneSuggestion` (`existing` / `new` / `none`). Bulk add checks again and reports `skipped`.
- Personalized examples: `POST /api/entries/:id/examples` generates 2–3 examples from the entry, its scenes, recurring errors and existing examples; appends deduped examples. In English-only mode no Chinese translation is appended.
- Summary generation is a **background job** in `src/stores/summary.ts`. Triggering it from Chat or Today keeps it running across route changes; `SummaryJobHost.vue` (mounted in `AppShell`) shows the confirmation modal on any page, with a persistent pill while pending candidates remain.
- The API key is stored in the local SQLite `settings` table in plaintext and masked in responses. This is a personal local app; keep it that way unless asked to add OS keychain support.

## Frontend conventions

- UI is bilingual: Chinese and English, switchable in Settings and persisted in `localStorage` under `easyenglish.locale`. All display strings live in `src/i18n/messages.ts` and are accessed through `t()`; never hard-code UI text in pages/components. `src/i18n/index.ts` owns `locale`, `setLocale`, label helpers and server-error localization. The inline `index.html` script restores `<html lang>` before paint.
- Type labels use `entryTypeLabel()` / `errorCategoryLabel()` from `src/i18n`, not the Chinese constants in `shared/types.ts` (those remain for server prompts).
- Compact entry previews use `definitionPreview()` from `src/lib/format.ts`: the English UI shows the English definition first, the Chinese UI shows the Chinese meaning first, falling back to the other and then to `explanation` when the preferred fields are missing. Review orders its full reveal blocks the same way.
- Pages: Today (`/today`), Learn (`/learn`), Chat (`/chat/:id?`), Review (`/review`), Library (`/library`), Import (`/import`), Settings (`/settings`).
- Library has four views: date (`DateView.vue`), type (`TypeView.vue`), tag (`TagView.vue`), scene (`SceneView.vue`). The tag view groups entries by Anki tag and supports newest / oldest / dictionary A→Z / Z→A sorting. The page owns search debouncing and the shared `EntryForm`; views own their own data loads. `EntryCard.vue` is the shared row component; clicking an entry title opens `EntryDetailModal.vue` with the full stored details (and an edit shortcut).
- `BulkDeleteModal.vue` opens from the Library header and deletes by type / tag / date / scene, with category-level select-all and an exact server-side preview. It calls `POST /api/entries/bulk-delete/preview` then `POST /api/entries/bulk-delete`; filters within one dimension are OR, across dimensions AND, and empty filters are rejected.
- Scene creation/editing uses `SceneFormModal.vue`; adding existing entries uses `SceneEntryPicker.vue`. New entries created from a scene default to `reviewEnabled: false`.
- `ImportMarkdownPage.vue` owns the two-step import flow; `ImportItemRow.vue` renders each preview item and allows a per-item type override.
- `useAppStore` (`src/stores/app.ts`) owns review stats/settings; call `refreshStats()` after any mutation that affects counts.
- `useSummaryStore` (`src/stores/summary.ts`) owns the background summary job and its modal state. `SummaryJobHost.vue` is mounted once in `AppShell`; don't tie generation to a page component's lifecycle. `TodayPage` mirrors the store result into its summary panel and watches `revision` to reload after adds.
- AI Markdown is rendered by `MarkdownView.vue` (marked + DOMPurify). Sanitization is mandatory; keep it.
- Review keyboard shortcuts (1/J remember, 2/K forget, Space/Enter continue) live in `ReviewPage.vue`.
- The chat composer guards IME composition before sending on Enter.
- Speech playback uses the browser's built-in Web Speech API (`src/lib/speech.ts`, `SpeakButton.vue`), including voice selection, chunking, cancel/resume, and support/error feedback. Do not add bundled audio or a server-side TTS dependency.
- Styling is plain CSS. Shared structure lives in `src/styles/main.css`; theme tokens live in `src/styles/themes/neumorphism.css` and `src/styles/themes/swiss.css`. No component library; avoid adding one.
- Two visual themes are supported: **Neumorphism / Soft UI** (default) and **Swiss International**, each with light and dark palettes. Binding contracts: `docs/UI_STYLE_NEUMORPHISM.md`, `docs/UI_STYLE_SWISS.md`, indexed in `docs/UI_STYLE.md`.
- Visual theme and color mode are independent: `<html data-theme="neumorphism|swiss" data-mode="light|dark">`. `src/stores/theme.ts` owns both (`theme` / `colorMode`, `setTheme` / `setColorMode`). Persisted under `easyenglish.theme` and `easyenglish.colorMode`; the inline script in `index.html` restores both before paint. The app sidebar button toggles light/dark only; the visual theme is chosen in Settings → Appearance, which now uses a category sidebar (General / Appearance / Review / AI / Persona / Local data). Dark tokens live in `[data-theme="…"][data-mode="dark"]` blocks in each theme CSS file; `main.css` must use tokens (for example `--type-sentence-bg`, `--danger-ink`, `--overlay`) rather than hard-coded light colors.
- Prefer tokens (`--bg`, `--ink`, `--accent`, `--border-*`, `--radius-*`, shadows, `--transition`, typography) over hard-coded colors so both themes keep working.
- Neumorphism rules: `#e0e5ec` surfaces, dual shadows (white top-left, `#b8bcc2` bottom-right), no borders/gradients/pure white backgrounds/translate, hover shrinks shadows, active goes inset, inputs inset and relax on focus.
- Swiss rules: white/black/red, sharp corners, 1px black borders, no shadows, Helvetica-like sans, `150ms ease-out`, buttons carry a `→`, left-aligned, generous negative space.
- Apply visual changes through tokens and global classes, not hard-coded colors in pages.

## Current state

- Working: entries CRUD + text-only dedupe, configurable Ebbinghaus review with error-rate weighting, AI chat streaming with language/persona/scene/memory/error layers, daily summary with scene suggestions and traceability, personalized examples, pronunciation shadowing, categorized settings (AI / persona / forgetting curve / explanation language / interface language / theme / light-dark mode), Markdown import preview/commit, Anki `.apkg`/`.colpkg` import with rich fields and images, an AnkiWeb browser link-out in the import modal, the two-phase Learn flow with tag filtering, scenes, export, entry detail modal, bulk delete by type/tag/date/scene, and four library views (date / type / tag / scene).
- Daily summary generation is background-safe across route changes and confirms candidates in a global modal; bulk/summary adds are deduped by normalized English text.
- Two visual themes (Neumorphism and Swiss International), each with light and dark palettes, persisted independently; the sidebar button toggles light/dark and the theme is selected in Settings.
- Speech uses the browser Web Speech API for TTS; `src/lib/pronunciation.ts` adds local shadowing feedback via `SpeechRecognition` (Chrome/Edge).
- Schema version 5 adds `review_enabled`, `scenes`, `scene_entries`, `learner_errors`, `personas`, error-rate fields, dedupe text, source pointers, and `chat_sessions.scene_id`; schema version 6 adds `phonetic`, `english_definition`, `images`, `external_id`, and `learned_at`. Existing databases migrate automatically.
- `docs/LEARNING_SIGNALS.md` documents error rate, learner errors, dedupe, traceability, context budget, scenes/chat, scene suggestions, examples, pronunciation, prompt layers, Anki import and the Learn flow.
- Verified by manual API smoke tests and Playwright screenshots; no automated tests yet.
- `docs/ARCHITECTURE.md` has endpoint/data-model detail; `docs/SCENERY_IMPORT.md` documents the import/scene mapping; `docs/UI_STYLE.md` indexes the two binding visual contracts.
