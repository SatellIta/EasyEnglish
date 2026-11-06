# 架构说明

## 总览

```
浏览器
  └─ Vue 3 SPA (Vite, 开发时 :5173)
       ├─ /api/*  ──开发代理──▶ Hono (:3001)
       └─ 静态资源            └─ better-sqlite3 ──▶ data/easy-english.db
                                    └─ OpenAI 兼容接口（流式）
```

生产模式下 `pnpm start` 由 Hono 同时提供 API 和 `dist/` 静态页面，只需要一个进程。

前端通过 `src/lib/api.ts` 访问后端；所有类型来自 `shared/types.ts`。后端使用 Hono 路由，SQLite 连接在 `server/db.ts` 中单例创建。AI 调用集中在 `server/ai/client.ts`，提示词在 `server/ai/prompts.ts`。

## 数据模型

数据库启用 WAL、外键和 5 秒 busy timeout。时间统一存 UTC ISO 字符串（`YYYY-MM-DDTHH:mm:ss.sssZ`），本地「今天」的边界由 `server/lib/time.ts` 计算。

### entries

用户记录的词条。

| 字段 | 说明 |
| --- | --- |
| `id` | 自增主键 |
| `type` | `word` / `phrase` / `sentence` |
| `text` | 英文内容 |
| `meaning` | 中文含义 |
| `explanation` | 用法、搭配、易混点等 |
| `examples` | JSON 字符串数组 |
| `notes` | 个人笔记 |
| `tags` | JSON 字符串数组 |
| `source` | `manual` / `summary` 等 |
| `created_at`, `updated_at` | UTC ISO |

### review_states

每个词条一行，保存当前调度状态。

| 字段 | 说明 |
| --- | --- |
| `entry_id` | 主键，外键到 entries |
| `stage` | 已成功通过的阶段数；0 表示新词/重学 |
| `interval_days` | 当前间隔天数（0 表示立即/重试） |
| `next_review_at` | 下次到期时间 |
| `last_reviewed_at` | 上次复习时间 |
| `lapses` | 遗忘次数 |
| `total_reviews` | 总复习次数 |
| `status` | `learning` / `reviewing` / `mastered` |

### review_logs

每次「记得 / 不记得」都写一条。用于今日统计、连续天数和未来的参数调优。

### chat_sessions / chat_messages

对话列表与消息。`chat_messages.role` 只有 `user` / `assistant`；系统提示词不落库，每次请求时动态构建。

### daily_summaries

按本地日期唯一。`content` 是 Markdown 总结，`entries` 是 AI 抽取的候选词条 JSON（等待用户确认后加入词库）。

### settings

简单 key-value。目前使用 `ai.baseUrl`、`ai.model`、`ai.apiKey`，以及复习配置 `review.intervalsDays`（JSON 数字数组）和 `review.forgotRetryMinutes`。

### entries_fts

FTS5 虚拟表，`tokenize='trigram'`，内容来自 entries，通过 INSERT/UPDATE/DELETE 触发器同步。trigram 对中英文子串搜索都友好；少于 3 个字符的查询回退到 LIKE。

## API

所有接口返回 JSON（流式接口除外）。错误格式为 `{ "error": string, "details"?: unknown }`。

### 词条

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/entries?types=word,phrase&q=&tag=&from=&to=&limit=&offset=` | 列表 + 搜索 + 分页 |
| POST | `/api/entries` | 新建，自动创建复习状态（立即到期） |
| POST | `/api/entries/bulk` | 批量新建（最多 50） |
| GET | `/api/entries/:id` | 详情 |
| PATCH | `/api/entries/:id` | 部分更新 |
| DELETE | `/api/entries/:id` | 删除（级联复习状态/日志） |

### 复习

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/review/queue?types=&limit=` | 当前到期的词条，按到期时间升序 |
| POST | `/api/review/:id/rate` | body `{ rating: "remembered" \| "forgot" }` |
| GET | `/api/review/stats` | 到期数（按类型）、今日复习/新增、总数、已掌握、连续天数 |

### 对话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/chat/sessions` | 对话列表（标题、条数、最后一条用户消息预览） |
| POST | `/api/chat/sessions` | 新建空对话 |
| PATCH | `/api/chat/sessions/:id` | 重命名 |
| DELETE | `/api/chat/sessions/:id` | 删除 |
| GET | `/api/chat/sessions/:id/messages` | 消息列表 |
| POST | `/api/chat/stream` | 发送消息并以 NDJSON 流式返回 |

### 总结与设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/summary/today` | 读取当天已保存的总结 |
| POST | `/api/summary/today/generate` | 调 AI 生成/覆盖当天总结 |
| GET | `/api/settings` | 返回 URL、模型、Key 掩码、是否已配置 |
| PUT | `/api/settings` | 更新设置；`clearApiKey: true` 清除 Key |
| POST | `/api/settings/test` | 用当前或传入的配置做一次最小请求 |
| GET | `/api/settings/review` | 读取复习间隔阶梯与遗忘重试窗口 |
| PUT | `/api/settings/review` | 更新复习配置；服务端会排序、去重并限制范围 |

## 复习调度

`server/lib/scheduler.ts` 使用 `server/lib/review-config.ts` 提供的配置：

- 默认间隔阶梯：`[1, 2, 4, 7, 15, 30, 60, 120, 240]` 天，可在设置页的「遗忘曲线」中修改（排序、去重，最多 20 项）。
- 默认遗忘重试窗口：10 分钟，可在设置页修改。
- 新词条：`stage = 0`，`next_review_at = now`，立即进入队列。
- 记得：`stage += 1`，下次间隔为 `intervals[stage - 1]`；超过阶梯后 `status = mastered`，下次 365 天。
- 不记得：`stage = 0`，`lapses += 1`，按配置的重试分钟数重新出现，`status = learning`。

复习界面只展示英文，用户先主动回忆，再选择「记得 / 不记得」。不使用选择题，避免只记选项差异。修改配置只影响之后的评分，不会重排已有词条的下次复习时间。

## AI 流程

### 配置解析

优先级：设置页（SQLite） > `EASYENGLISH_*` 环境变量 > 默认值（OpenAI 官方地址 + `gpt-4o-mini`）。不读取通用 `OPENAI_*`，避免误用本机其他工具的凭据。本地地址（localhost / 127.0.0.1）允许无 Key。

### 对话上下文

1. 保存用户消息。
2. 用用户消息做 FTS 搜索，取最多 8 条相关词条。
3. 加入今天新增的词条（最多 12 条）。
4. 加入最近记录（最多 15 条）。
5. 去重后最多 30 条，格式化进系统提示词的「学习者记忆」。
6. 拼接最近 30 条对话消息，调用流式 Chat Completions。

### 流式协议

`POST /api/chat/stream` 返回 `application/x-ndjson`，每行一个 JSON 对象：

```json
{"type":"meta","sessionId":1,"userMessageId":10}
{"type":"delta","content":"分片文本"}
{"type":"done","sessionId":1,"messageId":11}
{"type":"error","error":"..."}
```

客户端在 `src/lib/api.ts` 的 `streamChat()` 中解析。中断时服务端保留已生成的部分内容。

### 今日总结

`POST /api/summary/today/generate` 收集当天对话（从最近消息向前截断到约 12k 字符）和当天新增/复习过的词条，要求模型只输出：

```json
{
  "summary": "Markdown 总结",
  "entries": [
    { "type": "word", "text": "...", "meaning": "...", "explanation": "..." }
  ]
}
```

解析时容忍 Markdown 代码围栏；解析失败则退化为纯 Markdown 总结、候选词条为空。结果按日期 upsert 到 `daily_summaries`。

## 主题

界面支持两套主题，通过 `<html data-theme="...">` 切换：

- `neumorphism`（默认）：新拟物派，浅灰同色系、双光源阴影。
- `swiss`：瑞士国际风格，白底、黑框、红色强调、直角、无阴影。

主题状态由 `src/stores/theme.ts` 管理，持久化在 `localStorage` 的 `easyenglish.theme`；`index.html` 的内联脚本在首屏绘制前恢复主题，避免闪烁。结构样式在 `src/styles/main.css`，主题变量与覆盖在 `src/styles/themes/`。设置页的「外观」区块和侧栏底部按钮都可以切换。

## 扩展点

- **新词条类型**：同步修改 `shared/types.ts` 的 `EntryType`、`server/schema.sql` 的 CHECK 约束（需要迁移），以及前端类型标签。
- **更复杂的调度**：可替换 `scheduler.ts` 为 FSRS/SM-2，`review_logs` 已保留每次评分的历史。
- **更多 AI Provider**：当前所有兼容 OpenAI Chat Completions 的服务共用一条代码路径；若接入 Anthropic 原生协议，在 `server/ai/` 下增加适配器并在配置中区分 provider。
- **多设备同步**：当前是单机 SQLite。若要做同步，建议保持服务端数据模型不变，增加远端存储或同步层，而不是把数据库搬到浏览器里。
- **新增主题**：在 `src/styles/themes/` 下新增变量与覆盖文件，在 `src/stores/theme.ts` 注册，并在设置页加入主题选项；按对应风格文档自检。
- **测试**：尚无测试。优先为 `scheduler.ts`、`review-config.ts`、`queries.ts` 和 API 路由补单元/集成测试。
