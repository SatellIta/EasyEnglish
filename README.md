# EasyEnglish

**English** | [简体中文](README.zh-CN.md)

EasyEnglish is a local-first English learning app for Chinese speakers. It keeps words, phrases and full sentences in one place, helps you learn them with a two-step "recognize, then study" flow, and schedules them with spaced repetition.

It is deliberately small: one Vue SPA, one Hono process, one SQLite file. Your vocabulary, review history and chat history stay on your own machine.

## Features

- **A library for phrases and sentences, not just words.** Save words, collocations, idioms and complete sentences with meanings, explanations, examples, phonetics, notes, tags and images. Search and filter by type, tag, date or scene. Duplicate English text is detected before it enters the library.

- **Anki import with rich fields.** Import `.apkg` decks and `.colpkg` collections while keeping Chinese meanings, English definitions, phonetics, examples, tags and referenced images. The preview lets you remap fields, choose note types and decide whether to update, skip or create duplicates. A built-in link opens AnkiWeb in your browser so you can find and download shared decks yourself before uploading them.

- **A two-phase Learn flow.** Pick a batch size and, optionally, one Anki tag group to study from. First recognize the whole batch as known or unknown, then study only the unknown words with their full stored details. Known words are scheduled one day out; unknown words enter review immediately.

- **Active-recall spaced repetition.** New entries are due immediately, then follow a configurable Ebbinghaus ladder (default 1/2/4/7/15/30/60/120/240 days). Forgetting resets the item and brings it back after a configurable retry window. Reviews show English first and reveal the answer only after you try to recall it.

- **An AI tutor that remembers your material.** Chat with an OpenAI-compatible model about meaning, nuance, grammar or natural phrasing. The tutor can reference the words and sentences you have saved, use a selected persona, and run scene-based role-play. Responses stream into the page as they are generated.

- **Daily summaries.** Ask the AI to organize today's conversation and newly learned entries into a reviewable summary. It also suggests entries worth adding to your library and stores recurring learner errors. Generation runs in the background, so navigating away does not cancel it.

- **Four ways to browse the library.** View entries by date, type, tag or scene, with keyword search and sorting by time or dictionary order. Click any entry title to open a full detail view, or jump straight to editing. Bulk delete can remove entries by type, tag, date or scene, with select-all and an exact count before confirmation.

- **Scenes for associative memory.** Group related words and sentences into user-defined scenes such as travel, work or a movie. Scene entries join daily review by default, with a one-click "add all / remove all from review" action for each scene. Scene membership never changes an existing entry's own review setting.

- **Markdown import, export and file sync.** Paste or upload structured Markdown using `# words`, `# collocations`, `# sentences` or `# Scenery` sections, with named table columns for meaning, English definition, examples, phonetics and tags. HTML comments are ignored, so your own notes stay out of the import. You can also save a local Markdown file path in Settings and sync it from the Review page, so new expressions become reviewable immediately.

- **Pronunciation practice.** Read entries aloud with the browser's built-in speech synthesis. On supported browsers, shadowing mode uses speech recognition to compare what you said with the target sentence and gives local feedback.

- **Two themes, each with light and dark modes.** Choose Neumorphism (soft UI) or Swiss International in Settings, and switch light/dark from the sidebar. Chinese and English interfaces are both available.

- **Local data by default.** Everything is stored in `data/easy-english.db` with full-text search; there is no cloud account and no telemetry. Back up by copying the `data/` directory, and never commit it or your `.env` file to a public repository.

## Getting started

Requirements: **Node.js 24+** and **pnpm 11+**.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The Hono API runs on port 3001 and Vite proxies `/api` to it.

AI is optional. Without a model, the library, Learn flow, review, Markdown import/export and Anki import all work; chat and summaries return a friendly "not configured" message. To enable AI, open **Settings → AI**, choose a preset or enter any OpenAI-compatible Base URL, model and API key, then test the connection.

| Provider | Base URL | Example model |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Ollama (local) | `http://localhost:11434/v1` | `qwen2.5:7b` |

You can also copy `.env.example` to `.env` and fill in `EASYENGLISH_BASE_URL`, `EASYENGLISH_API_KEY` and `EASYENGLISH_MODEL`. Values saved in Settings take precedence.

## A typical workflow

1. Add entries manually, import Markdown, or import an Anki deck.
2. Open **Learn**, choose a batch size and optionally a tag, then mark each item as known or unknown.
3. Study the words you did not know, then let them enter the review queue.
4. Review a few minutes each day; the scheduler handles the intervals.
5. Chat with the AI about anything you meet, and generate a daily summary at the end of the day.

## Commands

```bash
pnpm dev          # Hono (3001) + Vite (5173)
pnpm dev:server   # API only
pnpm dev:web      # frontend only
pnpm build        # type check + build into dist/
pnpm start        # production mode: Hono serves API and dist/ on 3001
pnpm typecheck    # type check only
```

## Tech stack

- Frontend: Vue 3, TypeScript, Vite, Vue Router, Pinia, marked + DOMPurify
- Backend: Hono, better-sqlite3 (SQLite + FTS5), Node's built-in `node:sqlite` for reading Anki databases
- AI: any OpenAI-compatible Chat Completions endpoint, streamed as NDJSON
- UI: plain CSS variables, no component library

The project intentionally has no ORM, no UI kit and no external database service.

## Data and privacy

The database lives at `data/easy-english.db` (override with `DB_PATH`). `data/`, `test/`, `.env` and imported Anki packages are gitignored. The API key and review history are stored locally in SQLite; the API only returns a masked key. This is a personal local app, so treat the database as you would any private study notebook.

## Why I built EasyEnglish

Most vocabulary apps are built around single words. But the things I actually wanted to remember were phrases, collocations and whole sentences I met while reading, listening to podcasts, or talking with people — expressions that a word list cannot hold well.

I also wanted an English-learning tool that treats AI as a first-class part of the workflow, not an add-on: an assistant that can see what I have saved, discuss nuance in context, and help turn everyday encounters into material I will actually review.

EasyEnglish is my attempt to build that space for myself: a quiet, local-first notebook for phrases and sentences, with just enough AI and spaced repetition to keep them alive. If it is useful to you too, that makes me very happy.

## Contributing

Issues and pull requests are welcome. Bug reports, feature ideas, translations, new themes, import-format improvements and documentation fixes are all appreciated. If you are planning a larger change, opening an issue first is the easiest way to align on the approach.

Before submitting a PR, please run `pnpm typecheck` and `pnpm build`. Keep the project lightweight: no ORM, no UI component library, and no cloud dependency unless there is a compelling reason. All UI strings should live in `src/i18n/messages.ts` and work in both Chinese and English.
