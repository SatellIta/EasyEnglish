# 学习信号：错误率、错误档案与上下文预算

本文记录本次「非场景」增强的数据契约和算法，方便和正在开发的场景功能合并时对齐。

## 1. 词条新增字段

`entries` 表新增：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `error_rate` | REAL NOT NULL DEFAULT 0 | 近期加权错误率，0..1 |
| `error_samples` | INTEGER NOT NULL DEFAULT 0 | 参与计算的复习样本数 |
| `normalized_text` | TEXT | 去重用的归一化文本 |
| `source_session_id` | INTEGER | 来源对话；会话删除时置空 |
| `source_message_id` | INTEGER | 来源消息；会话删除时置空 |

API 的 `Entry` DTO 同步增加 `errorRate`、`errorSamples`、`sourceSessionId`、`sourceMessageId`。`EntryInput` 可选接收来源 ID。

## 2. 错误率算法

每次复习评分后更新：

- 观测值：`forgot = 1`，`remembered = 0`
- 指数平滑：`newRate = α × observed + (1 − α) × oldRate`
- `α = max(配置的近期权重, 1 / (样本数 + 1))`

第一次评分直接采用观测值；之后近期权重下限保证最近的回答始终有足够影响。默认近期权重 `0.35`，可在设置页调整。

`error_rate` 的初始历史回填使用复习日志的指数衰减：越新的日志权重越高（衰减系数 `0.7`）。

## 3. 复习间隔

`实际间隔 = 基础间隔 × (1 − error_rate × 惩罚系数)`，并限制最小调整系数为 `0.2`。默认惩罚系数 `0.6`。

- 错误率越高 → 间隔越短 → 同样的阶梯需要更多次成功回忆，表现为「复习前进得更慢」。
- 阶梯走完后，如果 `error_rate >= 0.5`，不标记为 `mastered`，而是停在最后一档继续复习。
- `forgot` 仍按配置的重试窗口（默认 10 分钟）回到 stage 0。

相关配置键：`review.errorRateRecentWeight`、`review.errorRateIntervalPenalty`。

## 4. 错误档案

新表 `learner_errors`：

- 唯一键：归一化后的 `pattern`（大小写不敏感）
- 字段：`category`、`explanation`、`correction`、`example`、`occurrences`、`first_seen_at`、`last_seen_at`、`status`
- 状态：`active | resolved | ignored`

由「今日总结」从对话中抽取并 upsert；同一模式再次出现时累加 `occurrences`。用户可以把错误标记为已解决或忽略，被忽略的错误不会因为再次出现而自动恢复。

接口：

- `GET /api/errors?status=active&limit=20`
- `PATCH /api/errors/:id` `{ "status": "resolved" | "ignored" | "active" }`
- `DELETE /api/errors/:id`

聊天系统提示词会注入最多 8 条 active 错误，要求模型只在相关时做简短修正，避免每轮重复说教。

## 5. 去重

`normalizeEntryText()`：NFKC → 弯引号归一 → 小写 → 合并空白 → 去掉首尾标点。

- 单条新增仍允许重复（用户可能有意保留不同释义）。
- `POST /api/entries/bulk` 按 `type + 归一化文本`（`server/lib/dedupe.ts`）去重，返回 `{ count, skipped, duplicates[] }`，重复项带 `existingEntryId`。
- 今日总结的候选词条会带 `duplicate` / `existingEntryId`，前端默认只加入未重复项；批量接口仍会兜底跳过。
- 数据库同时保存 `normalized_text` 供快速查询；所有写入口统一走 `server/lib/entry-store.ts`，会同时维护该字段，场景导入不需要额外处理。

## 6. 词条溯源

总结生成后，服务端在当天的 `chat_messages` 中查找包含候选词条文本的最新消息，写入 `source_session_id` / `source_message_id`。前端在总结候选、复习卡片显示「来自对话」链接。

删除对话时会清空相关词条的来源指针，避免跳转到不存在的会话。

## 7. AI 上下文预算

新配置 `AiBehaviorSettings`：

| 设置 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| `memoryLimit` | 12 | 1–30 | 每轮注入的记忆条数 |
| `memoryCharBudget` | 2400 | 200–12000 | 记忆部分最大字符数 |
| `historyLimit` | 20 | 2–50 | 携带的历史消息条数 |

接口：`GET/PUT /api/settings/ai-behavior`。

记忆选择顺序：

1. 现在到期、按错误率降序
2. 错误率 ≥ 0.35 的高风险词
3. 与当前问题 FTS 相关的词
4. 今天新增
5. 最近记录兜底

## 8. 迁移版本

当前 `SCHEMA_VERSION = 3`，迁移按顺序执行：

- 版本 2：`server/migrations/002_scenes.sql`（场景表与 `review_enabled`）
- 版本 3：`server/migrations/003_learning_signals.sql`（错误档案、错误率、去重、溯源）

全新数据库由 `server/schema.sql` 一次建好全部结构；旧库会依次执行缺少的迁移。场景导入、Markdown 导入和总结入库都走 `entry-store`，因此 `normalized_text`、`error_rate` 默认值会自动维护。

## 9. 暂不包含

- 场景化对话 / 总结智能归并到场景
- 个性化例句
- 发音跟读
