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
| `phonetic` | 音标，来自 Anki 或手动填写 |
| `english_definition` | 英英释义，来自 Anki |
| `images` | JSON 字符串数组，存放本地图片地址 `/api/media/...` |
| `external_id` | Anki GUID，用于重复导入时识别同一条词 |
| `source` | `manual` / `summary` / `markdown-import` / `anki` 等 |
| `review_enabled` | 是否进入每日复习；Markdown 导入默认 1，Anki 导入默认 0，学完后打开 |
| `learned_at` | 通过学习流程的时间；NULL 表示还在「待学习」 |
| `created_at`, `updated_at` | UTC ISO |

### scenes / scene_entries

场景是用户自定义的联想记忆空间，也是词库的第三种整理维度。

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `scenes` | `id`, `name`, `description` | 场景名不区分大小写唯一 |
| | `created_at`, `updated_at` | UTC ISO |
| `scene_entries` | `scene_id`, `entry_id` | 多对多关联，主键 |
| | `section` | 场景内 H3 片段，例如 `Opening an account`；旧数据为类型标签 |
| | `subsection` | 场景内 H4 标题，例如 `单词` / `短语` / `句子`；旧数据可能为 `null` |
| | `position` | 导入/添加顺序，用于「导入顺序」排列 |
| | `added_at` | 加入场景时间 |

一个词条可以出现在多个场景里。场景成员关系不改变复习调度：是否进入每日复习只看 `entries.review_enabled`。Markdown 导入的场景词条默认打开该开关；已有词条保留自己的开关。场景详情页提供批量「全部加入复习 / 全部移出复习」，对应 `POST /api/scenes/:id/review`。场景视图按 `section`（H3 片段）折叠分组，组内再按 `subsection`（H4 类型）显示为本地化类型徽标；工具栏按钮统一「全部折叠 / 全部展开」。

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
| GET | `/api/entries?types=word,phrase&q=&tag=&from=&to=&sort=&limit=&offset=` | 列表 + 搜索 + 标签过滤 + 排序 + 分页；`sort` 取 `newest`（默认）/ `oldest` / `alpha` / `alphaDesc` |
| POST | `/api/entries` | 新建，自动创建复习状态（立即到期）；主要英文内容重复时返回 409 |
| POST | `/api/entries/bulk` | 批量新建（最多 50）；默认按规范化后的主要英文内容跳过词库中和批次内重复项（不看释义/例句），返回 `count` / `skipped` / `duplicates` |
| POST | `/api/entries/bulk-delete/preview` | body `{ ids }` 或 `{ filter }`；返回匹配条数，不删除 |
| POST | `/api/entries/bulk-delete` | 同预览条件；删除词条并级联清理复习状态/日志/场景关联 |
| GET | `/api/entries/:id` | 详情 |
| GET | `/api/entries/lookup?text=` | 按规范化英文内容精确查词；返回 `{ text, entry }`，未命中时 `entry` 为 `null`（详情页点词使用） |
| POST | `/api/entries/explain` | body `{ text }`；让 AI 为一个尚未入库的单词生成释义草稿（不写入词库） |
| PATCH | `/api/entries/:id` | 部分更新；改成已存在的英文内容时返回 409 |
| DELETE | `/api/entries/:id` | 删除（级联复习状态/日志） |

### 场景与词库整理

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/scenes` | 场景列表，含总条数和单词/短语/句子计数 |
| POST | `/api/scenes` | 新建场景；重名返回 409 |
| GET | `/api/scenes/:id` | 场景详情，返回场景内词条及 `section` / `subsection` |
| PATCH | `/api/scenes/:id` | 修改名称或描述 |
| DELETE | `/api/scenes/:id` | 删除场景；词条本身保留 |
| POST | `/api/scenes/:id/entries` | body `{ entryIds, section?, subsection? }`，把已有词条加入场景 |
| DELETE | `/api/scenes/:id/entries/:entryId` | 从场景移除词条 |
| GET | `/api/library/overview` | 按本地日期聚合的条数、类型总数、场景列表 |
| GET | `/api/library/date/:date?type=&q=` | 某一天（本地时区）的词条，可按类型和关键词过滤 |
| GET | `/api/tags` | 所有标签及总数 / 待学习数（`TagSummary[]`），供词库标签分类与学习页筛选 |
| GET | `/api/export/options` | 导出分组：常规类型计数（不含场景词条）和场景列表 |
| POST | `/api/export/markdown` | body `{ types, sceneIds }`，返回 `text/markdown` |

### Markdown 导入

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/import/markdown/preview` | body `{ markdown, filename? }`，解析并标记重复项 |
| POST | `/api/import/markdown/commit` | body `{ items, updateExisting? }`，写入选中词条，按需复用/关联场景 |
| POST | `/api/import/markdown/sync` | 读取设置中的本地 Markdown 文件并同步（等价于 `updateExisting: true`） |
| GET/PUT | `/api/settings/markdown` | 读取/保存 `{ path }`，路径必须是 `.md` / `.markdown` / `.txt` |

解析器在 `server/lib/markdown-import.ts`，只处理文本，不执行 Markdown 中的任何内容。HTML 注释会被整体忽略。预览会按规范化英文内容标记数据库中和本批次内的重复项；普通分组的重复项默认不勾选，场景分组的重复项默认勾选。提交逻辑在 `server/lib/markdown-commit.ts`：已存在文本会复用词条并加入场景；`updateExisting` 只更新 Markdown 实际提供的字段（标签取并集），并保留 `review_enabled`、`learned_at`、错误率和来源；裸词不会清空已有释义。

### Anki 导入

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/import/anki/preview` | `multipart/form-data` 的 `file`；返回牌组、笔记类型、字段映射、示例和媒体数量 |
| POST | `/api/import/anki/commit` | body `{ importId, options }`；按映射写入词条并提取图片 |
| DELETE | `/api/import/anki/:importId` | 删除临时导入会话 |
| GET | `/api/media/:name` | 读取已提取的本地图片，长缓存 |

Anki 包解析在 `server/lib/import/`：

- `zip.ts`：不依赖第三方库的 ZIP 读取器，支持 stored/deflate；超过 65,535 个条目的 ZIP64 目录暂不支持。
- `anki-package.ts`：从 `collection.anki21b`（zstd）、`collection.anki21`、`collection.anki2` 中选择集合，解压到 `data/imports/<uuid>/collection.sqlite`，用 Node 内置 `node:sqlite` 只读打开。Anki schema 的 `unicase` 排序规则在 `better-sqlite3` 中不可用，但 `node:sqlite` 可以读取 `fields` 等表；`tags` 表本身不参与导入。
- `anki-mapper.ts`：清洗 HTML、`<br>`、cloze、`[sound:]`，按字段名自动映射（单词 / 基本释义 / 英英释义 / 音标 / 图片 / 考纲 / 柯林斯英汉 / Front-Back），从柯林斯字段提取「英文例句 — 中文翻译」，并推断 word/phrase/sentence。
- `media-store.ts`：只提取词条引用到的图片，按内容 SHA-256 命名放入 `data/media/`，避免重复；跳过 SVG 和音频。

导入时先按 `source = 'anki'` + `external_id`（GUID）查重，再按规范化英文文本查重。`duplicateMode` 支持 `skip` / `update`（只更新内容，保留复习状态）/ `new`。`.colpkg` 一律合并导入，不删除现有词条。默认 `addToReview = false`：词条写入时 `learned_at = NULL`、`review_enabled = 0`，先进入学习流程。

### AnkiWeb 共享牌组

应用不代理 AnkiWeb。导入弹窗的「AnkiWeb 共享牌组」页签只提供一个外链，在浏览器打开 `https://ankiweb.net/shared/decks`；用户自行下载 `.apkg` 后回到「上传文件」页签导入。这样不需要处理 AnkiWeb 匿名搜索/下载的 429 限流，也不保存 AnkiWeb 登录凭证。

### 批量删除

`POST /api/entries/bulk-delete/preview` 和 `POST /api/entries/bulk-delete` 接受 `{ ids }` 或 `{ filter }`。`filter` 支持 `types` / `tags` / `dates` / `sceneIds` / `q`：同一维度内是 OR，不同维度之间是 AND；空条件会被拒绝，避免误删整库。删除依赖 SQLite 外键级联清理 `review_states`、`review_logs` 和 `scene_entries`，FTS 触发器同步删除索引。词库的「批量删除」弹窗按类型 / 标签 / 日期 / 场景分类展示选项，支持分类内全选，删除前由服务端返回精确数量并二次确认。

### 复习

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/review/queue?types=&limit=` | 当前到期的词条，按到期时间升序 |
| POST | `/api/review/:id/rate` | body `{ rating: "remembered" \| "forgot" }` |
| GET | `/api/review/stats` | 到期数（按类型）、今日复习/新增、总数、已掌握、连续天数 |

### 学习

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/learn/stats?tag=` | 待学习 / 已学习 / 词库总数；可选 `tag` 只统计该标签组 |
| GET | `/api/learn/queue?size=&types=&tag=` | 随机抽取一批 `learned_at IS NULL` 的词条；`size` 限制 1–50，`tag` 只抽该标签组 |
| POST | `/api/learn/complete` | body `{ known: number[], unknown: number[] }`，标记已学习并写入复习队列 |

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
| POST | `/api/summary/today/generate` | 调 AI 生成/覆盖当天总结（可带 `locale`；今天无对话且无新词时返回 `no_study`） |
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
- 只有 `entries.review_enabled = 1` 的词条会进入 `/api/review/queue` 和到期统计。Markdown 导入默认打开该开关；场景详情页可以批量切换。

复习界面只展示英文，用户先主动回忆，再选择「记得 / 不记得」。不使用选择题，避免只记选项差异。修改配置只影响之后的评分，不会重排已有词条的下次复习时间。

## 学习流程

`/learn` 是 Anki 导入词条的入口，也是独立于每日复习的「先认识，再记忆」流程：

1. 设置每组数量（5 / 10 / 20 / 30 / 50，保存在 `localStorage` 的 `easyenglish.learnBatchSize`）。
2. 可选标签筛选：从 `/api/tags` 选择某个 Anki 标签组（保存在 `easyenglish.learnTag`），统计卡片和抽取范围都会随之收窄。
3. `GET /api/learn/queue?tag=...` 随机抽取 `learned_at IS NULL` 的词条。
4. 辨别阶段：整组逐个显示单词、音标和朗读按钮，用户选择「认识 / 不认识」，不显示释义。
5. 学习阶段：只展示本组标记为「不认识」的词条，显示词库里的中文释义、英英释义、例句、图片、笔记和标签；内容全部来自用户词库，不调用 AI。
6. `POST /api/learn/complete`：把本组词条标记为已学习并打开 `review_enabled`。认识的词条在 1 天后到期；不认识的词条立即到期。学习的词条随后进入普通复习队列。

学习进度只保存在当前页面；中途离开会提示确认，未提交的词条保持「待学习」。

## Markdown 导入与场景映射

导入器面向约定的 Markdown 格式，规则如下：

- `# words`：一行一个词条，类型固定为单词；明确是单词的目录允许用 ` / ` 分隔多个单词。
- `# collocations`：一行一个词条，类型固定为短语；不按 `/` 拆分；可选 `text = explanation` / `text — 中文`。
- `# sentences`：一行一个词条，类型固定为句子；不按 `/` 拆分；`##` / `###` 作为预览分组和标签保留。
- `# Scenery`：推荐 `##` 场景 → `###` 片段 → `####` 单词/短语/句子；旧格式 `##` 场景 → `###` 类型仍然兼容。普通行按当前类型标题；单词片段下允许用 ` / ` 分隔多个单词；列表行在场景中一律按句子。`section` 保存 H3 片段，`subsection` 保存 H4 标题。
- 表格支持具名列：`English` / `含义` / `英英释义` / `例句` / `补充` / `笔记` / `音标` / `标签`，顺序任意、可省略；旧的 `English | 含义 | 补充` 三列仍可用。
- 普通行支持 `text = explanation` / `text — 中文`，也支持缩进标签续行（`英英释义：…`、`例句：…`）和 `>` 例句续行，用来给上一条词条补充独立字段。
- HTML 注释（`<!-- ... -->`）不参与解析，支持行内、单行和跨行；未闭合时给出提示并忽略其后内容。
- 非场景分类的 H2/H3 进入标签和预览分组；未知 H1 会按内容自动判断并给出预览提示；Scenery 中未识别的 H3 视为片段名，不告警。
- 所有新建导入词条的 `source = 'markdown-import'`；Markdown 导入默认进入每日复习，已有词条保留原有复习开关和学习状态。
- 导入预览按分组折叠，支持逐条改类型、按组全选、只选新词条；提交时按英文内容复用已有词条并关联场景，`updateExisting` 可同步字段内容。

用户可选的 Markdown 导出实现在 `server/routes/export.ts`：

- `GET /api/export/options` 返回常规类型计数和场景列表。
- `POST /api/export/markdown` 按选中的类型/场景生成 Markdown。
- 常规词条只包含未归入场景的内容；场景词条按场景导出。
- 导出使用具名列，只输出该分组里实际有内容的列；场景按 `### 片段` → `#### 类型` 输出。
- 不包含复习进度和图片。

更完整的格式说明见 `docs/SCENERY_IMPORT.md`，页面内的提示内容来自 `src/assets/import-format.md`。

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

`POST /api/summary/today/generate` 收集当天对话（从最近消息向前截断到约 12k 字符）和当天真正学过的词条（`learned_at` 在当天），要求模型只输出：

```json
{
  "summary": "Markdown 总结",
  "entries": [
    { "type": "word", "text": "...", "meaning": "...", "explanation": "..." }
  ]
}
```

生成前先检查：当天既没有对话也没有今天学过的词条（只复习旧词、或只导入了还没学习的 Anki 词条都不算）时直接返回 400 `{ code: 'no_study' }`，不调用 AI。请求体可带 `{ locale: 'zh' | 'en' }`；英文界面下强制使用英文总结提示词。解析时容忍 Markdown 代码围栏；解析失败则退化为纯 Markdown 总结、候选词条为空。结果按日期 upsert 到 `daily_summaries`。

候选词条在生成和读取时都会通过 `server/lib/dedupe.ts` 标重：规范化文本会忽略大小写、首尾引号和结尾标点，只以主要英文内容与词库及本批次比较；类型、释义、例句、标签都不参与判重。`POST /api/entries/bulk` 在写入前再次查重，并返回 `skipped` / `duplicates`，所以「全部加入」不会把已有词条重复塞进复习队列。

前端把整理任务放在 `src/stores/summary.ts`，由 `ChatPage` 或 `TodayPage` 触发；任务不依赖页面生命周期，切换路由不会中断。完成或失败后，`AppShell` 里的 `SummaryJobHost` 会在任意页面弹出确认框；关闭后仍保留右下角「今日总结已生成」入口（只有在还有未处理候选时显示）。

## 主题

界面支持两套视觉主题和独立的深浅色模式，通过 `<html data-theme="..." data-mode="...">` 切换：

- `neumorphism`（默认）：新拟物派，浅灰同色系、双光源阴影；深色版使用深灰表面与低对比双阴影。
- `swiss`：瑞士国际风格，白底、黑框、红色强调、直角、无阴影；深色版为近黑底、近白文字与边框，仍以红色为强调色。
- `data-mode` 取 `light` / `dark`，与视觉主题正交。

主题与模式由 `src/stores/theme.ts` 管理（`theme` / `colorMode`，`setTheme` / `setColorMode`），分别持久化在 `localStorage` 的 `easyenglish.theme` 和 `easyenglish.colorMode`；`index.html` 的内联脚本在首屏绘制前恢复两者，避免闪烁。结构样式在 `src/styles/main.css`，两套主题的浅色与 `[data-mode="dark"]` 深色变量都在 `src/styles/themes/`。设置页「外观」分类负责切换视觉主题与深浅色，侧栏底部按钮只切换深浅色。深色覆盖依赖 token；在 `main.css` 中新增颜色时应使用变量，避免写死浅色值。

词库有四个视图：按日期、按类型、按标签、按场景。标签视图用 `/api/tags` 展示 Anki 标签分组，进入分组后可按最新 / 最早 / 字典升降序排列；点击词条标题会打开 `EntryDetailModal`，直接展示完整的中文释义、英英释义、音标、例句、图片和标签，并可跳转编辑。

详情弹窗里的短语、句子、英英释义、补充说明和例句使用 `ClickableText`：第一次点击单词会框选高亮，再点同一个词会按规范化英文内容查词。已存在的词条直接在当前弹窗中打开；不存在的词会显示空状态，提供「问 AI」（`POST /api/entries/explain` 生成草稿）和「加入词库」按钮，并提示可以导入 Anki 词库补充资料。查词层级保存在返回栈里，「返回」只退回上一层，关闭按钮才关闭整个弹窗；点击空白区域会取消高亮。

## 扩展点

- **新词条类型**：同步修改 `shared/types.ts` 的 `EntryType`、`server/schema.sql` 的 CHECK 约束（需要迁移），以及前端类型标签。
- **更复杂的调度**：可替换 `scheduler.ts` 为 FSRS/SM-2，`review_logs` 已保留每次评分的历史。
- **更多 AI Provider**：当前所有兼容 OpenAI Chat Completions 的服务共用一条代码路径；若接入 Anthropic 原生协议，在 `server/ai/` 下增加适配器并在配置中区分 provider。
- **多设备同步**：当前是单机 SQLite。若要做同步，建议保持服务端数据模型不变，增加远端存储或同步层，而不是把数据库搬到浏览器里。
- **新增主题**：在 `src/styles/themes/` 下新增变量与覆盖文件，在 `src/stores/theme.ts` 注册，并在设置页加入主题选项；按对应风格文档自检。
- **测试**：尚无测试。优先为 `scheduler.ts`、`review-config.ts`、`queries.ts` 和 API 路由补单元/集成测试。
