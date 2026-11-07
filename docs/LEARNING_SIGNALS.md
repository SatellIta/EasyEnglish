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
- 版本 4：`server/migrations/004_scene_chat.sql`（对话绑定场景）

全新数据库由 `server/schema.sql` 一次建好全部结构；旧库会依次执行缺少的迁移。场景导入、Markdown 导入和总结入库都走 `entry-store`，因此 `normalized_text`、`error_rate` 默认值会自动维护。

## 9. 场景化对话

- `chat_sessions.scene_id` 记录会话绑定的场景；普通对话为 NULL。
- `POST /api/chat/sessions` 接受 `{ sceneId }`，默认标题为「场景名 · 场景练习」。
- 场景会话的聊天记忆会优先注入该场景的词句（最多 12 条），并在系统提示词中加入场景说明、小节和角色练习规则。
- 场景词句在学习者记忆中标记为「本场景」；AI 每轮只推进 1-2 个问题，优先自然带出 2-3 个场景词。
- 入口：词库 → 场景详情 →「和 AI 练习」。

## 10. 个性化例句

- `POST /api/entries/:id/examples` `{ count?: 1-5 }` 让 AI 结合词条、所属场景和近期错误生成 2-3 个例句。
- 返回 `{ entry, added, examples, message? }`；新例句以「英文 — 中文」追加到 `entries.examples`，并按英文部分去重。
- 全英文模式下只追加英文例句，不追加中文翻译。
- 入口：复习卡片展开答案后 →「AI 个性化例句」。
- 发送给模型的上下文只有：当前词条、场景名、近期错误和已有例句，不发送整库内容。

## 11. 总结场景建议

- 今日总结的每个候选词条会带 `sceneSuggestion`：`existing`（归入已有场景）、`new`（新建场景）或 `none`。
- 服务端只接受真实存在的 `sceneId`；模型给出未知 ID 时按 `sceneName` 匹配，匹配不到则丢弃建议。
- 新场景名如果与已有场景重名，会自动转成 `existing`，避免重复建场景。
- 候选默认 `sceneAccepted = true`；用户可在「今日」页或总结弹窗里取消勾选。
- 触发条件：今天至少有一段对话，或至少新增了一个词条；只有复习记录、既无对话也无新词时不调用 AI，直接返回 `code: 'no_study'`，前端显示「今天还没有学习记录」提示。
- 总结语言由界面语言和 `ai.explanationMode` 共同决定：英文界面下始终输出英文总结（即使解释语言为双语）；中文界面下跟随解释语言设置。英文模式下系统提示词和用户提示词骨架均为英文。
- 入库时先创建词条，再按建议调用 `POST /api/scenes/:id/entries`；新场景先 `POST /api/scenes`。场景归并失败不会回滚已入库词条。
- 全英文模式下，summary、entries 的 meaning/explanation、errors 的 pattern/explanation 全部使用英文；只有已有场景的 sceneName 可以保留原中文名。

## 12. 发音跟读

- 复习卡片在朗读按钮旁提供「跟读练习」：先播放 TTS，再用浏览器 `SpeechRecognition`（Chrome/Edge）识别学习者复述。
- 评分在本机完成：单词用字符级编辑距离，句子用词级 LCS；只作为练习反馈，不是音素级发音评分。
- 不录音、不上传音频，识别结果只显示在本地。
- 浏览器不支持识别时按钮禁用并给出提示；麦克风权限被拒绝时显示可操作的中文错误。

## 13. 解释语言基础层

- 设置键 `ai.explanationMode`：`bilingual`（默认，中文辅助）或 `english`（全英文英译英）。
- 接口：`GET/PUT /api/settings/ai-teaching`；设置页「解释语言」可切换。
- 系统提示词按以下顺序分层：
  1. 语言基础层（中文辅助 / 全英文）
  2. 人格 / 用户偏好层（默认人格 + 自定义人格）
  3. 任务与回答规则
  4. 场景练习
  5. 学习者记忆
  6. 易错模式
  7. 当前上下文
- 全英文模式只锁定「用什么语言解释」：要求模型用简单英文定义、同反义词、搭配和例句解释英文，禁止输出中文；不改变场景、记忆、错误注入和人格/偏好内容。
- 英文模式会在提示词末尾追加 Final reminder，降低模型回退到中文的概率；记忆和错误数据中的中文会明确标注为「仅供理解，不要输出」。
- 今日总结的语言跟随界面语言：英文界面下始终使用英文总结提示词（系统提示词和用户提示词骨架均为英文），不受 `ai.explanationMode` 的双语设置影响；中文界面下则跟随 `ai.explanationMode`（`english` 时仍输出英文）。
  - 总结：summary、词条 meaning/explanation、错误 pattern/explanation 使用英文；已有场景的 sceneName 允许保留中文。
- 个性化例句跟随该设置：
  - 例句：只生成并追加英文例句，不追加中文翻译。

## 14. 人格 / 用户偏好层

- 新表 `personas`：`key`（默认人格稳定标识）、`name`、`description`、`prompt`、`is_default`、`sort_order`。
- 默认人格（迁移 005 种子）：
  - `serious`：严肃老师
  - `homie`：嘻哈好哥们（老外）
  - `catgirl`：猫娘女仆
- 接口：
  - `GET/POST /api/personas`
  - `PATCH/DELETE /api/personas/:id`
  - `POST /api/personas/:id/reset`（仅默认人格）
  - `GET/PUT /api/settings/ai-persona`
- 默认人格只允许修改提示词；名称/描述按 `key` 在界面本地化。恢复默认会还原名称、描述和提示词。
- 自定义人格可以新增、编辑名称/描述/提示词、删除；删除当前选中人格后回退到第一个人格。
- 人格层只影响语气、称呼和互动风格，不改变语言模式、事实准确性、纠错规则和输出格式。总结和例句不使用人格层。

## 15. 暂不包含

- 音素级发音评分与可视化
- 云端 ASR / 音频上传
- 场景对话结果自动回写复习调度
