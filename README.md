# EasyEnglish

一个本地优先的英语学习工具，用来记录自己的词句、和 AI 对话、按遗忘曲线复习。

传统背单词 App 往往只支持「单词」，很难把阅读、播客、对话里遇到的**句子、短语、地道表达**一起收进来。EasyEnglish 想解决的就是这件事：任何值得记住的英文片段都可以变成一张卡片，AI 会在对话里参考你学过的内容，复习时用主动回忆而不是选择题。

## 功能

- **自建语料**：单词、短语、句子统一管理，支持释义、用法、例句、笔记和标签。
- **AI 英语助手**：内置面向中文学习者的提示词，直接在 App 内问词义、辨析、语法和表达。AI 会读取你记录的词句作为联想记忆。
- **一键今日总结**：让 AI 把今天的对话和词条整理成可复习的总结，并抽取值得加入词库的候选条目。
- **艾宾浩斯复习**：新词条立即进入队列；记得则推进到 1 / 2 / 4 / 7 / 15 / 30 / 60 / 120 / 240 天，不记得则 10 分钟后重试。复习只展示英文，先主动回忆，再展开答案。
- **本地数据**：所有内容保存在一个 SQLite 文件里，离线可用，备份只需复制 `data/`。
- **响应式界面**：桌面和手机浏览器都可用。

## 快速开始

要求：Node.js 24+、pnpm 11+。

```bash
pnpm install
pnpm dev
```

打开 http://localhost:5173。

首次启动时 AI 尚未配置，其余功能可以正常使用。进入「设置」页填写任意 OpenAI 兼容接口即可开启 AI：

| 服务 | Base URL | 模型示例 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Ollama（本地） | `http://localhost:11434/v1` | `qwen2.5:7b` |

也可以在项目根目录复制 `.env.example` 为 `.env`，填写 `EASYENGLISH_BASE_URL`、`EASYENGLISH_API_KEY`、`EASYENGLISH_MODEL`。设置页保存的配置优先级更高。

## 常用命令

```bash
pnpm dev          # 同时启动前端 (5173) 和后端 (3001)
pnpm dev:server   # 只启动 Hono 后端
pnpm dev:web      # 只启动 Vite 前端
pnpm build        # 类型检查 + 构建到 dist/
pnpm start        # 生产模式，由 Hono 同时提供 API 和静态页面 (3001)
pnpm typecheck    # 仅类型检查
```

## 技术栈

- 前端：Vue 3、TypeScript、Vite、Vue Router、Pinia、marked + DOMPurify
- 后端：Hono、better-sqlite3（SQLite + FTS5 全文检索）
- AI：OpenAI 兼容 Chat Completions（流式 NDJSON）

项目刻意保持轻量：没有 ORM、没有 UI 组件库、没有数据库服务。

## 目录

```
src/                 Vue 前端
  pages/             今日 / 对话 / 复习 / 词库 / 设置
  components/        AppShell、词条表单、Markdown 渲染等
  lib/               API 客户端、时间格式化、朗读
  stores/            Pinia 状态
  styles/main.css    设计变量与全局样式
server/              Hono 后端
  routes/            词条、复习、对话、总结、设置
  lib/               调度算法、查询、映射、时间
  ai/                提示词、配置、OpenAI 兼容客户端
  schema.sql         SQLite 表结构与 FTS5 触发器
shared/types.ts      前后端共享的 API 类型
docs/                架构说明与 UI 风格约束
data/                运行时生成的 SQLite 数据库（已 gitignore）
```

## 数据与备份

数据库默认位于 `data/easy-english.db`（可用 `DB_PATH` 覆盖），启用 WAL 模式。备份时直接复制整个 `data/` 目录；删除该目录即可从空白开始。

API Key 以明文保存在本地 SQLite 的 `settings` 表中，接口只返回掩码。这个项目定位为个人本地应用，请不要把 `data/` 目录或 `.env` 提交到公开仓库。

## 开发文档

- [CLAUDE.md](CLAUDE.md) — 给 AI 编码助手的仓库指南
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 数据模型、接口、调度与 AI 流程
- [docs/UI_STYLE.md](docs/UI_STYLE.md) — 视觉风格约束（待补充）
