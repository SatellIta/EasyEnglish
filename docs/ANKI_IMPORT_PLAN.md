# AnkiDroid 词库导入实现方案

> **实现状态（2026-11-07）**：MVP 已落地。实际实现与本文的差异：
>
> - ZIP 读取没有引入 `fflate`，改为 `server/lib/import/zip.ts` 的最小实现（stored/deflate）。
> - Anki SQLite 用 Node 内置 `node:sqlite` 读取，因为 `better-sqlite3` 无法加载 Anki 的 `unicase` 排序规则。
> - 图片会提取被词条引用的栅格文件，存到 `data/media/`，通过 `/api/media/:name` 提供；音频和 SVG 跳过。
> - 导入词条默认 `learned_at = NULL`、`review_enabled = 0`，先进入 `/learn` 学习流程；也可在预览中勾选直接加入每日复习。
> - AnkiWeb 官方共享牌组不做站内代理：导入弹窗只提供外链，在浏览器打开 AnkiWeb 让用户自行下载 `.apkg`，再回到上传页签导入。这样避开 AnkiWeb 的匿名搜索/下载限流，也不需要保存登录凭证。
> - Anki 标签会随词条导入（`useAnkiTags` 默认开启）。`GET /api/tags` 汇总标签总数/待学习数，词库「按标签」视图和学习页标签筛选都基于它；词库标签视图支持时间/字典排序，点击词条可直接打开完整详情。
> - 近似保留 Anki 复习进度（`scheduling: 'approximate'`）未实现。
>
> 当前代码入口：`server/routes/anki-import.ts`、`server/lib/import/*`、`src/components/AnkiImportModal.vue`、`src/pages/LearnPage.vue`。

> 本文是给编码 agent 的实现规范，不是用户文档。实现前请先读 `CLAUDE.md`、`docs/ARCHITECTURE.md` 和现有 `server/routes/entries.ts`、`src/lib/api.ts`、`src/components/BaseModal.vue`。
>
> 目标：让 EasyEnglish 能导入 Anki / AnkiDroid 的词库文件，覆盖 AnkiDroid 当前全部导入能力（`.apkg` 牌组包、`.colpkg` 集合包），并额外支持 Anki 桌面端的文本/CSV 导入作为第二阶段。

---

## 1. 背景与结论

AnkiDroid 官方手册（最后更新 2026-10-17）明确：

- 直接支持 **`.apkg`** 导入
- 文件名以 **`.colpkg`** 结尾的包按集合包处理，导入时**替换全部内容**
- 其他 `.apkg` 按牌组包处理，**合并**到现有内容
- **不支持** CSV / TXT / TSV 直接导入
- **不支持** 直接导入 `.anki2` 数据库
- 导出侧也只导出 `.apkg`，没有 CSV/文本导出

因此“兼容 AnkiDroid 的全部导入功能”= 解析 `.apkg` / `.colpkg` 里的 **ZIP + SQLite** 数据，不是 CSV。

Anki 包不是简单的 JSON/CSV，而是一个 ZIP，里面至少包含一个 SQLite 数据库。实现时必须处理：

1. ZIP 解包（只取需要的成员，不要解压媒体）
2. `collection.anki21b` 的 zstd 解压
3. SQLite 读取（schema 11 和 schema 18）
4. Anki 字段的 HTML / cloze / 媒体引用清洗
5. 字段映射到 EasyEnglish 的 `Entry`
6. 去重、复习状态、错误与告警

---

## 2. 已核实的 Anki 包格式

### 2.1 ZIP 成员

| 成员 | 内容 | 处理方式 |
|---|---|---|
| `meta` | protobuf 元数据 | **MVP 不解析**，仅用于未来兼容 |
| `collection.anki21b` | zstd 压缩的 SQLite，schema 18 | 优先读取 |
| `collection.anki21` | SQLite，schema 11（旧版本可能 zstd） | 按魔数判断是否解压 |
| `collection.anki2` | SQLite，schema 11 | 直接读取 |
| `media` | 媒体索引：旧版 JSON `{"0":"foo.jpg"}`；新版 protobuf | **MVP 不解析** |
| `0`、`1`、`2`… | 图片/音频文件 | **MVP 不提取**，只计数并告警 |

读取顺序建议：

```text
1. collection.anki21b  → 一定是 zstd → 解压 → SQLite
2. collection.anki21   → 看前 4 字节是否为 28 B5 2F FD → 是则解压
3. collection.anki2    → 直接当 SQLite
4. 都没有              → 返回 400「不是有效的 Anki 词库文件」
```

不要依赖 `meta` 判断版本。直接按成员名探测 + zstd/SQLite 魔数检测，兼容性最好。

### 2.2 魔数

```ts
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]       // PK\x03\x04
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const SQLITE_MAGIC = 'SQLite format 3\0'
```

Node 24 自带 zstd，不需要额外依赖：

```ts
import { zstdDecompressSync } from 'node:zlib'
```

### 2.3 SQLite 核心表

新旧格式共有：

```sql
notes(id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
cards(id, nid, did, ord, mod, usn, type, queue, due, ivl, factor,
      reps, lapses, left, odue, odid, flags, data)
revlog(id, cid, usn, ease, ivl, lastIvl, factor, time, type)
graves(usn, oid, type)
col(id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
```

Schema 14/15 之后新增规范化表：

```sql
notetypes(id, name, mtime_secs, usn, config)
fields(ntid, ord, name, config)
templates(ntid, ord, name, mtime_secs, usn, config)
decks(id, name, mtime_secs, usn, common, kind)
deck_config(id, name, mtime_secs, usn, config)
config(key, usn, mtime_secs, val)
tags(tag, usn)
```

### 2.4 字段与标签

- `notes.flds`：字段用 **`\x1f`**（Unit Separator）拼接
- `notes.tags`：**空格分隔**，通常首尾各有一个空格，例如 `" tag1 tag2 "`
- `notes.mid`：note type id
- `cards.nid` → `notes.id`
- `cards.did` → deck id；如果 `cards.odid != 0`，说明在筛选牌组里，**优先用 `odid`** 作为原牌组
- 一个 note 可能有多张 card（正反面、填空题多个空），**按 note 导入，不按 card 导入**，否则会重复

字段名来源：

- Schema 11：`SELECT models FROM col LIMIT 1`，JSON 形如：

```json
{
  "100": {
    "id": 100,
    "name": "Basic",
    "type": 0,
    "flds": [{ "name": "Front", "ord": 0 }, { "name": "Back", "ord": 1 }],
    "tmpls": []
  }
}
```

- Schema 18：直接查：

```sql
SELECT id, name FROM notetypes;
SELECT ntid, ord, name FROM fields ORDER BY ntid, ord;
```

牌组名来源：

- Schema 11：`SELECT decks FROM col LIMIT 1`，JSON 形如 `{"1": {"id": 1, "name": "Default"}}`
- Schema 18：`SELECT id, name FROM decks`

### 2.5 字段内容

Anki 字段不是纯文本，常见：

```text
<b>word</b>
line one<br>line two
{{c1::answer::hint}}
[sound:audio.mp3]
<img src="image.jpg">
```

必须清洗后再写入 EasyEnglish。EasyEnglish 目前以纯文本/纯 Markdown 展示，不能把 Anki 字段当 HTML 直接渲染。

---

## 3. 范围

### 3.1 MVP（必须完成）

- 上传 `.apkg` / `.colpkg`
- 支持三种集合成员：
  - `collection.anki2`（schema 11）
  - `collection.anki21`（schema 11，纯 SQLite 或 zstd）
  - `collection.anki21b`（schema 18，zstd）
- 预览：牌组、note type、字段名、note 数、媒体数、示例行
- 字段映射（自动 + 预览页手动调整）
- HTML / cloze / 媒体引用清洗
- 去重：GUID 优先，规范化 text 兜底；支持跳过/更新/作为新词
- 媒体不落盘，保留占位文本并告警
- 默认全部作为新词（复习状态立即到期）
- `.colpkg` 只做**合并导入**，绝不删除现有词条，并显示明确警告
- `source = 'anki'`，新增 `external_id` 存储 Anki GUID

### 3.2 第二阶段（可选，不在 MVP 验收内）

- Anki 桌面端文本/CSV/TSV 导入，支持 `#separator`、`#html`、`#tags`、`#columns`、`#notetype`、`#deck`、`#notetype column`、`#deck column`、`#tags column`、`#guid column`
- 近似保留 Anki 复习进度
- `.anki2` 原始数据库直接导入
- 集合包“清空后导入”选项

### 3.3 明确不做

- 图片/音频落盘与展示（EasyEnglish 没有媒体表和静态媒体路由）
- `revlog` 复习历史导入（EasyEnglish 只有 remembered/forgot 二元评分，映射会失真）
- Image Occlusion 牌组（无法用纯文本表达，跳过并告警）
- Anki 1 的 `.anki` 格式
- 精确的 SM-2 / FSRS → EasyEnglish 阶梯换算
- 解析 `meta` / `media` protobuf

---

## 4. 新增/修改文件

```text
server/routes/import.ts                   新增：导入接口
server/lib/import/anki-package.ts         新增：ZIP + zstd + SQLite 读取
server/lib/import/mapper.ts               新增：字段清洗、映射、类型判断
server/lib/import/text-import.ts          第二阶段：CSV/文本解析
server/lib/entry-store.ts                 新增/重构：从 entries.ts 抽出的写入逻辑
server/routes/entries.ts                  修改：复用 entry-store
server/db.ts                              修改：SCHEMA_VERSION = 2 + 迁移
server/schema.sql                         修改：entries.external_id + 索引
server/index.ts                           修改：挂载 import 路由 + bodyLimit
shared/types.ts                           修改：导入 DTO
src/lib/api.ts                            修改：FormData 上传 + import API
src/components/ImportModal.vue            新增：三步导入向导
src/components/Icon.vue                   修改：增加 upload 图标
src/pages/LibraryPage.vue                 修改：导入按钮 + 成功后刷新
docs/ARCHITECTURE.md                      修改：补充导入接口
package.json                              修改：新增 fflate
```

依赖只加一个：

```bash
pnpm add fflate
```

不引入 protobuf、zstd、CSV 库。zstd 用 Node 内置，CSV 手写解析器。

---

## 5. 共享类型（`shared/types.ts`）

追加以下类型；不要改动现有 `Entry` 的字段顺序，只追加 `externalId`。

```ts
export type ImportFormat = 'apkg' | 'colpkg' | 'text'
export type ImportPackageVersion = 'legacy1' | 'legacy2' | 'latest'
export type ImportDuplicateMode = 'skip' | 'update' | 'new'
export type ImportSchedulingMode = 'reset' | 'approximate'
export type ImportMediaMode = 'placeholder' | 'strip'

export interface ImportNotetypeSummary {
  id: number
  name: string
  fields: string[]
  isCloze: boolean
  noteCount: number
}

export interface ImportSampleRow {
  fields: string[]
  tags: string[]
  deck: string | null
  notetype: string
}

export interface ImportTextPreview {
  separator: string
  hasHeader: boolean
  columns: string[]
  directives: Record<string, string>
  totalRows: number
  sampleRows: string[][]
}

export interface ImportPreview {
  importId: string
  format: ImportFormat
  packageVersion: ImportPackageVersion | null
  schemaVersion: number | null
  decks: string[]
  notetypes: ImportNotetypeSummary[]
  totals: {
    notes: number
    cards: number
    media: number
  }
  sample: ImportSampleRow[]
  warnings: string[]
  text?: ImportTextPreview
}

export interface ImportFieldMapping {
  /** 哪一列作为 text（从 0 开始） */
  text: number
  meaning?: number | null
  explanation?: number | null
  examples?: number[]
  notes?: number[]
  /** auto 表示按内容自动判断 word/phrase/sentence */
  type: 'auto' | EntryType
}

export interface ImportOptions {
  /** 主要 note type 的映射；其他 note type 自动映射 */
  mapping: ImportFieldMapping
  /** 可选：按 note type id 覆盖映射 */
  mappingByNotetype?: Record<string, ImportFieldMapping>
  useAnkiTags: boolean
  addDeckTag: boolean
  duplicateMode: ImportDuplicateMode
  scheduling: ImportSchedulingMode
  media: ImportMediaMode
}

export interface ImportResult {
  imported: number
  updated: number
  skipped: number
  failed: number
  warnings: string[]
  errors: Array<{ row: number; message: string }>
}
```

`Entry` 追加：

```ts
export interface Entry {
  // ...现有字段
  externalId: string | null
}
```

`DraftEntry` / `EntryInput` 不追加 `externalId`，避免公开 API 被滥用。

---

## 6. 数据库迁移

### 6.1 `server/schema.sql`

`entries` 增加一列和索引：

```sql
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('word', 'phrase', 'sentence')),
  text TEXT NOT NULL,
  meaning TEXT,
  explanation TEXT,
  examples TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_external
  ON entries(source, external_id);
```

**不要**给 `(source, external_id)` 加唯一索引。否则“仍然作为新词导入”会被约束挡住。

### 6.2 `server/db.ts`

当前逻辑是 `if (user_version < SCHEMA_VERSION) db.exec(schema.sql)`。升级为：

```ts
const SCHEMA_VERSION = 2
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const currentVersion = db.pragma('user_version', { simple: true }) as number

function hasColumn(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.some((row) => row.name === column)
}

if (currentVersion < SCHEMA_VERSION) {
  db.transaction(() => {
    if (currentVersion === 0) {
      // 全新数据库：schema.sql 已经包含 external_id
      db.exec(schema)
    }

    // 幂等：无论当前版本如何，都确保列和索引存在
    if (!hasColumn('entries', 'external_id')) {
      db.exec('ALTER TABLE entries ADD COLUMN external_id TEXT;')
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entries_external
        ON entries(source, external_id);
    `)

    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  })()
}
```

注意：

- 不要只改 `schema.sql`，已有数据库不会自动加列。
- `ALTER TABLE ADD COLUMN` 不能重复执行，必须先检查列是否存在。
- 迁移必须在一个事务里完成。

### 6.3 `server/lib/mappers.ts`

`mapEntry` 增加：

```ts
externalId: row.external_id ?? null,
```

`ENTRY_SELECT` 使用 `e.*`，无需额外列。

---

## 7. 后端实现

### 7.1 重构 `insertEntry`

当前 `insertEntry` 是 `server/routes/entries.ts` 的模块私有函数。把它抽到 `server/lib/entry-store.ts`：

```ts
import type { Entry, EntryInput, EntryType } from '../../shared/types'
import { db } from '../db'
import { getEntryById } from './queries'
import { initialSchedule } from './scheduler'
import { nowIso } from './time'

export interface EntryWriteInput extends EntryInput {
  source?: string
  externalId?: string | null
}

export function insertEntry(input: EntryWriteInput): Entry {
  // 保留现有实现：INSERT entries → INSERT review_states(initialSchedule) → getEntryById
}

export function updateEntryContent(id: number, input: EntryWriteInput): Entry {
  // UPDATE 内容字段，保留 review_states；updated_at = nowIso()
}

export function findEntryByExternalId(source: string, externalId: string): Entry | null {
  // SELECT ... WHERE source = ? AND external_id = ? LIMIT 1
}

export function findEntryByNormalizedText(normalized: string): Entry | null {
  // 见 7.7：导入时一次性构建 Map，而不是逐条 SQL
}
```

`server/routes/entries.ts` 改为：

```ts
import { insertEntry } from '../lib/entry-store'
```

`insertEntry` 的 `INSERT` 增加 `external_id` 列；`source` 默认 `'manual'`。

### 7.2 上传与临时文件

在 `server/index.ts` 挂载：

```ts
import { bodyLimit } from 'hono/body-limit'

const MAX_IMPORT_BYTES = 200 * 1024 * 1024

app.use(
  '/api/import/*',
  bodyLimit({
    maxSize: MAX_IMPORT_BYTES,
    onError: (c) => c.json({ error: '文件过大，最大支持 200MB' }, 413),
  }),
)
```

`server/routes/import.ts`：

```ts
import { mkdtemp, writeFile, rm, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

const IMPORTS_ROOT = join(process.cwd(), 'data', 'imports')

async function saveUpload(file: File): Promise<{ importId: string; filePath: string; dir: string }> {
  const importId = randomUUID()
  const dir = join(IMPORTS_ROOT, importId)
  await mkdir(dir, { recursive: true })
  const buf = Buffer.from(await file.arrayBuffer())
  const filePath = join(dir, 'package.bin')
  await writeFile(filePath, buf)
  return { importId, filePath, dir }
}
```

要点：

- `importId` 必须是 UUID 或 `[a-zA-Z0-9-]+`，任何路径参数都要校验，防路径穿越。
- 原文件名不可信，只用于展示；不要用原文件名拼接路径。
- 临时目录 `data/imports/<uuid>/`，提交成功或取消后删除。
- 预览时顺手清理 1 小时前的旧目录；服务器启动时也清理一次。
- 上传大小限制 200MB；解析时再限制集合解压后 100MB、note 数 100,000。

### 7.3 ZIP 读取

使用 `fflate`：

```ts
import { unzipSync } from 'fflate'

const COLLECTION_NAMES = ['collection.anki21b', 'collection.anki21', 'collection.anki2']

let mediaCount = 0
const files = unzipSync(new Uint8Array(buf), {
  filter: (file) => {
    if (/^\d+$/.test(file.name)) {
      mediaCount += 1
      return false // 不解压媒体
    }
    return COLLECTION_NAMES.includes(file.name)
  },
})
```

要点：

- `filter` 对每个条目调用，可以在不解压的情况下统计媒体数量。
- 只解压集合成员，**绝不解压数字媒体文件**。
- 不要按 ZIP 内路径写磁盘；只把集合字节写到固定的 `collection.sqlite`。
- 检查 ZIP 魔数 `PK\x03\x04`；不是 ZIP 直接 400。
- 如果将来遇到 ZIP64 或超大文件，可改用 `yauzl` 流式读取；MVP 用 fflate 足够。

### 7.4 选择集合成员并解压

```ts
function pickCollection(files: Record<string, Uint8Array>): {
  name: string
  version: ImportPackageVersion
  bytes: Uint8Array
} | null {
  const latest = files['collection.anki21b']
  if (latest) return { name: 'collection.anki21b', version: 'latest', bytes: latest }

  const legacy2 = files['collection.anki21']
  if (legacy2) return { name: 'collection.anki21', version: 'legacy2', bytes: legacy2 }

  const legacy1 = files['collection.anki2']
  if (legacy1) return { name: 'collection.anki2', version: 'legacy1', bytes: legacy1 }

  return null
}
```

解压：

```ts
function isZstd(buf: Uint8Array): boolean {
  return buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd
}

function toSqliteBuffer(buf: Uint8Array): Buffer {
  let out = Buffer.from(buf)
  if (isZstd(out)) {
    out = zstdDecompressSync(out, { maxOutputLength: 100 * 1024 * 1024 })
  }
  if (out.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0') {
    throw new ImportError('包内数据库格式不受支持')
  }
  if (out.byteLength > 100 * 1024 * 1024) {
    throw new ImportError('数据库解压后过大')
  }
  return out
}
```

注意：`collection.anki21` 在旧版本 Anki 里可能是 zstd，当前版本可能是纯 SQLite。统一按魔数判断。

### 7.5 读取 SQLite

把 SQLite 字节写到临时文件，用 `better-sqlite3` 只读打开：

```ts
import Database from 'better-sqlite3'

const db = new Database(sqlitePath, { readonly: true, fileMustExist: true })
db.pragma('busy_timeout = 5000')
```

不要对用户文件执行任何写操作、`ATTACH`、扩展加载。

#### 版本检测

```ts
const colVer = db.prepare('SELECT ver FROM col LIMIT 1').pluck().get() as number | undefined
const schemaVersion = colVer ?? (db.pragma('user_version', { simple: true }) as number)
```

- `11` → schema 11
- `18` → schema 18
- 其他 / 更高 → 返回「暂不支持该 Anki 数据库版本（schema X）」，不要硬解析

#### 读 note

```ts
const noteRows = db
  .prepare('SELECT id, guid, mid, tags, flds FROM notes ORDER BY id')
  .all() as Array<{
    id: number
    guid: string
    mid: number
    tags: string
    flds: string
  }>

const notes = noteRows.map((row, index) => ({
  row: index + 1,
  guid: row.guid,
  notetypeId: row.mid,
  fields: row.flds.split('\x1f'),
  tags: row.tags.trim() ? row.tags.trim().split(/\s+/) : [],
}))
```

#### 读 card

```ts
const cardRows = db
  .prepare('SELECT nid, did, odid, type, queue, due, ivl, reps, lapses FROM cards ORDER BY nid')
  .all() as Array<{
    nid: number
    did: number
    odid: number
    type: number
    queue: number
    due: number
    ivl: number
    reps: number
    lapses: number
  }>
```

建立 `Map<noteId, card[]>`。

#### 读 note type

Schema 18：

```ts
const notetypeRows = db
  .prepare('SELECT id, name FROM notetypes')
  .all() as Array<{ id: number; name: string }>

const fieldRows = db
  .prepare('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')
  .all() as Array<{ ntid: number; ord: number; name: string }>
```

Schema 11：

```ts
const modelsJson = db.prepare('SELECT models FROM col LIMIT 1').pluck().get() as string
const models = JSON.parse(modelsJson) as Record<string, {
  id: number
  name: string
  type: number
  flds: Array<{ name: string; ord: number }>
}>
```

`models[mid].type === 1` 表示 cloze。Schema 18 不解析 protobuf，用字段内容正则判断：

```ts
const isCloze = /\{\{c\d+::/.test(fields.join('\n')) || /cloze|填空/i.test(notetypeName)
```

#### 读牌组

Schema 18：

```ts
const decks = db.prepare('SELECT id, name FROM decks').all() as Array<{ id: number; name: string }>
```

Schema 11：

```ts
const decksJson = db.prepare('SELECT decks FROM col LIMIT 1').pluck().get() as string
const decks = Object.values(JSON.parse(decksJson)) as Array<{ id: number; name: string }>
```

Note → deck：

```ts
const card = cardsByNote.get(noteId)?.[0]
const deckId = card && card.odid !== 0 ? card.odid : card?.did
const deckName = deckId != null ? deckNameById.get(deckId) ?? '默认牌组' : null
```

一个 note 可能有多张 card，收集所有唯一牌组名，用于 `addDeckTag`。

#### 媒体计数

`mediaCount` 来自 ZIP 数字成员数量。同时统计字段里的媒体引用：

```ts
const mediaRefs = notes.reduce((n, note) =>
  n + note.fields.reduce((m, f) =>
    m + (f.match(/<img\b/gi)?.length ?? 0) + (f.match(/\[sound:[^\]]+\]/gi)?.length ?? 0), 0), 0)
```

返回 `totals.media` 和告警文案。

### 7.6 字段清洗

`server/lib/import/mapper.ts` 提供：

```ts
export function ankiFieldToText(value: string, media: ImportMediaMode): string
export function inferEntryType(text: string, isCloze: boolean): EntryType
export function splitExamples(value: string): string[]
```

`ankiFieldToText` 顺序：

1. 删除 `<style>...</style>`、`<script>...</script>` 整段
2. `<br>`、`</div>`、`</p>`、`</li>` → `\n`
3. `<li>` → `- `
4. `<img ... src="x">` → `media === 'placeholder' ? '[图片: x]' : ''`
5. `[sound:x]` → `media === 'placeholder' ? '[音频: x]' : ''`
6. cloze：循环替换 `/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/gs` → `$1`，直到没有匹配
7. 删除剩余的 `{{...}}` 模板标记
8. 删除剩余 HTML 标签
9. 解码实体：`&nbsp;`、`&amp;`、`&lt;`、`&gt;`、`&quot;`、`&#39;`、`&#x...;`、`&#...;`
10. `\r\n` → `\n`，连续 3 个以上换行压成 2 个，`trim()`

注意：

- 不要使用 `DOMParser`（Node 端没有），用正则即可。
- 不要保留原始 HTML 到 `entries` 字段，EasyEnglish 前端是纯文本/受控 Markdown。
- 字段里如果有字面量 `\x1f`，会在 split 时变成额外字段；这是 Anki 格式本身的分隔符，按额外字段处理即可。

`inferEntryType`：

```ts
const compact = text.trim()
if (!compact) return 'word'
if (isCloze || /[.!?。！？]$/.test(compact) || compact.split(/\s+/).length > 4) return 'sentence'
if (compact.split(/\s+/).length > 1) return 'phrase'
return 'word'
```

### 7.7 字段映射

#### 自动映射（按字段名）

先规范化字段名：`name.trim().toLowerCase()`。

```ts
const TEXT_NAMES = [
  'front', 'word', 'expression', 'question', 'sentence',
  '单词', '英文', '原文', '句子',
]
const MEANING_NAMES = [
  'back', 'meaning', 'definition', 'translation', 'answer',
  '释义', '中文', '翻译', '答案',
]
const EXAMPLE_NAMES = ['example', 'examples', 'example sentence', '例句']
const NOTES_NAMES = ['notes', 'note', 'extra', 'explanation', '备注', '说明', '解释']
const PHONETIC_NAMES = ['phonetic', 'pronunciation', '音标', '发音']
```

匹配策略：

1. 先精确匹配，再 `includes` 匹配
2. `text`：第一个命中 `TEXT_NAMES` 的字段；没有则第 0 列
3. `meaning`：第一个命中 `MEANING_NAMES` 的字段；没有则第 1 列（如果存在）
4. `examples`：所有命中 `EXAMPLE_NAMES` 的字段
5. `notes`：所有命中 `NOTES_NAMES` 的字段
6. `PHONETIC_NAMES` 字段追加到 `meaning` 或 `explanation`（带 `音标：` 前缀）
7. 剩余未映射字段：按 `字段名：内容` 追加到 `explanation`，避免丢数据
8. 如果 `explanation` 为空但剩余字段有多行，直接拼接剩余字段

#### 用户覆盖

`ImportOptions.mapping` 覆盖主要 note type 的映射。其他 note type 使用自动映射。MVP 预览页只需要为主 note type 提供下拉框；如果检测到多个 note type，显示提示「其他笔记类型将自动映射」。

Phase 2 可增加 `mappingByNotetype` 的 UI。

#### 字段长度限制

EasyEnglish 后端 zod 限制：

- `text` ≤ 2000
- `meaning` ≤ 4000
- `explanation` ≤ 8000
- `notes` ≤ 8000
- `examples` ≤ 50 条，每条 ≤ 1000
- `tags` ≤ 50 个，每个 ≤ 50

导入时必须截断并累计告警：

```ts
function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}
```

- `text` 清洗后为空 → 跳过该行，记 `errors`，不算失败整个导入
- `examples` 按行拆分，去空行，去重，截断到 50 条
- `tags` 去重，每个截断到 50 字符，最多 50 个
- 超长字段截断时，在 `warnings` 里累计一次，不要每行刷屏

### 7.8 去重与写入

#### 查找顺序

1. `source = 'anki'` 且 `external_id = notes.guid` → 命中
2. 规范化 `text` 命中已有词条 → 命中
3. 未命中 → 新增

规范化：

```ts
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}
```

导入开始时一次性构建：

```ts
const existingByText = new Map<string, number>()
for (const row of db.prepare('SELECT id, text FROM entries').all()) {
  existingByText.set(normalizeText(row.text), row.id)
}
```

GUID 查询用 `Map` 或 prepared statement。个人本地库通常 < 100k 条，一次性加载可接受。

#### 三种模式

| 模式 | 行为 |
|---|---|
| `skip`（默认） | 命中已有词条 → `skipped++`，不修改 |
| `update` | 命中 → 更新内容字段，保留 `review_states`；`updated++` |
| `new` | 忽略命中，插入新词条；新词条的 `external_id` 设为 `null`，避免下次导入继续命中同一 GUID |

`update` 时：

- 更新 `type`、`text`、`meaning`、`explanation`、`examples`、`notes`、`tags`、`updated_at`
- 保留 `source`（如果原来是 `manual`，是否改成 `anki`？建议改成 `anki`，因为内容来自 Anki）
- 保留 `review_states`、`review_logs`
- FTS 触发器会自动更新

#### 写入事务

```ts
const run = db.transaction((rows: EntryWriteInput[]) => {
  for (const row of rows) {
    // insert / update / skip
  }
})
run(rows)
```

- 所有写入在一个事务里；失败回滚。
- 逐行 `try/catch` 不能放在事务里并继续写，否则部分失败会提交。推荐先完成所有映射/校验，再在一个事务里写入；单行插入失败视为异常，整体回滚并返回 500，或预校验后跳过。
- 更稳妥的做法：映射阶段收集 `errors`，只把合法 rows 放进事务。
- note 数上限 100,000；超过直接 413/400，避免内存和事件循环阻塞。

#### 复习状态

- `reset`（默认）：`insertEntry` 内部已经调用 `initialSchedule(now)`，立即到期。
- `approximate`（可选）：
  - 取该 note 所有 card 中 `reps` 最大的一张
  - 若 `card.type === 2 && card.ivl > 0`：
    - 读取 `getReviewConfig().intervalsDays`
    - `stage` = 满足 `intervals[stage-1] <= ivl` 的最大 stage
    - `interval_days = ivl`
    - `next_review_at = now + ivl 天`
    - `lapses = card.lapses`
    - `total_reviews = card.reps`
    - `status = ivl >= 240 ? 'mastered' : stage > 0 ? 'reviewing' : 'learning'`
  - 否则按新词处理
  - 插入 entry 后 `UPDATE review_states SET ... WHERE entry_id = ?`

记录一条 warning：「复习进度为近似映射，可能与 Anki 不一致」。

### 7.9 接口

#### `POST /api/import/preview`

`multipart/form-data`：

- `file`: File（必填）
- `formatHint`: `apkg` | `colpkg` | `text`（可选）

处理：

1. 校验文件存在、扩展名、ZIP 魔数
2. 保存临时文件
3. 解析包，返回 `ImportPreview`
4. 失败时删除临时目录，返回 400

响应示例：

```json
{
  "importId": "5b0c...",
  "format": "apkg",
  "packageVersion": "latest",
  "schemaVersion": 18,
  "decks": ["英语词汇", "英语词汇::Unit 1"],
  "notetypes": [
    {
      "id": 100,
      "name": "Basic",
      "fields": ["Front", "Back"],
      "isCloze": false,
      "noteCount": 1200
    }
  ],
  "totals": { "notes": 1200, "cards": 1250, "media": 36 },
  "sample": [
    {
      "fields": ["apple", "苹果"],
      "tags": ["fruit"],
      "deck": "英语词汇",
      "notetype": "Basic"
    }
  ],
  "warnings": [
    "检测到 36 个媒体文件，EasyEnglish 暂不支持媒体，已保留占位文本。"
  ]
}
```

#### `POST /api/import/commit`

`application/json`：

```json
{
  "importId": "5b0c...",
  "options": {
    "mapping": {
      "text": 0,
      "meaning": 1,
      "explanation": null,
      "examples": [],
      "notes": [],
      "type": "auto"
    },
    "useAnkiTags": true,
    "addDeckTag": true,
    "duplicateMode": "skip",
    "scheduling": "reset",
    "media": "placeholder"
  }
}
```

响应：

```json
{
  "imported": 1180,
  "updated": 0,
  "skipped": 20,
  "failed": 0,
  "warnings": ["有 3 条内容超过字段长度限制，已截断。"],
  "errors": []
}
```

校验：

- `importId` 必须匹配 `^[a-zA-Z0-9-]+$`
- 临时目录必须存在，否则 404「导入会话已过期，请重新选择文件」
- `options` 用 zod 校验；`duplicateMode`、`scheduling`、`media` 用 enum
- `mapping.text` 必须是非负整数，且在字段范围内；否则 400

#### `DELETE /api/import/:importId`

删除临时目录，返回 `{ ok: true }`。幂等。

### 7.10 错误处理

统一使用 `{ error: string, details?: unknown }`。不要落到 Hono 的 500 默认分支。

需要明确处理的错误：

| 场景 | 状态码 | 文案 |
|---|---|---|
| 没有文件 | 400 | 请选择要导入的文件 |
| 不是 ZIP | 400 | 不是有效的 Anki 词库文件 |
| ZIP 里没有集合 | 400 | 包内没有找到 Anki 数据库 |
| SQLite 格式错误 | 400 | 包内数据库损坏或格式不受支持 |
| schema > 18 | 400 | 暂不支持该 Anki 数据库版本 |
| 导入会话不存在 | 404 | 导入会话已过期，请重新选择文件 |
| 文件过大 | 413 | 文件过大，最大支持 200MB |
| 字段映射非法 | 400 | 字段映射不合法 |
| 写入失败 | 500 | 导入失败，请重试 |

`server/index.ts` 的 `app.onError` 继续负责 ZodError；导入路由内部尽量捕获并返回具体错误。

---

## 8. 前端实现

### 8.1 `src/lib/api.ts`

现有 `request()` 无条件设置 `Content-Type: application/json`，**不能**用于 FormData。新增：

```ts
async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(body?.error ?? `请求失败（${response.status}）`, response.status, body?.details)
  }
  return response.json() as Promise<T>
}
```

新增 API：

```ts
export const api = {
  // ...现有
  import: {
    preview(file: File, formatHint?: ImportFormat) {
      const form = new FormData()
      form.append('file', file)
      if (formatHint) form.append('formatHint', formatHint)
      return upload<ImportPreview>('/import/preview', form)
    },
    commit(importId: string, options: ImportOptions) {
      return request<ImportResult>('/import/commit', {
        method: 'POST',
        body: JSON.stringify({ importId, options }),
      })
    },
    cancel(importId: string) {
      return request<void>(`/import/${encodeURIComponent(importId)}`, { method: 'DELETE' })
    },
  },
}
```

注意：`request()` 会自动加 `/api` 前缀并设置 JSON 头；`upload()` 不要设置任何 `Content-Type`，让浏览器自己生成 multipart boundary。

### 8.2 `src/components/ImportModal.vue`

基于 `BaseModal.vue`，宽度 `720px`。Props/emits：

```ts
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; imported: [] }>()
```

状态：

```ts
type Step = 'select' | 'preview' | 'importing' | 'done'
const step = ref<Step>('select')
const file = ref<File | null>(null)
const preview = ref<ImportPreview | null>(null)
const result = ref<ImportResult | null>(null)
const error = ref('')
const busy = ref(false)
const options = ref<ImportOptions>({ ...默认值 })
```

流程：

1. **select**
   - 拖拽区 + `<input type="file" accept=".apkg,.colpkg,.txt,.csv,.tsv">`
   - 文案：「选择 Anki 词库文件」「支持 .apkg 牌组包和 .colpkg 集合包」
   - 选中后立即调用 `api.import.preview(file)`，进入 preview
   - 失败显示 `.banner.banner-error`

2. **preview**
   - 顶部信息：格式（牌组包/集合包）、note 数、card 数、媒体数
   - 牌组 chips（`.tag`）
   - note type 信息：名称、字段列表、是否 cloze
   - 字段映射：为 `text` / `meaning` / `explanation` / `examples` / `notes` 提供 `<select class="select">`，选项来自 `preview.notetypes[0].fields`
   - 选项：
     - `使用 Anki 标签`（checkbox，默认 true）
     - `把牌组名加入标签`（checkbox，默认 true）
     - `重复词条`：`跳过已有词条`（默认）/ `更新已有词条` / `仍然作为新词导入`
     - `学习进度`：`全部作为新词（推荐）`（默认）/ `近似保留 Anki 进度`
     - `媒体文件`：`保留占位文本`（默认）/ `直接移除`
   - 示例表格：显示前 5 行，列名用字段名
   - `.colpkg` 警告：`这是 Anki 集合包。AnkiDroid 导入时会替换全部内容；EasyEnglish 将改为合并导入，不会删除现有词条。`
   - 底部按钮：`取消` / `开始导入`

3. **importing**
   - 进度条（复用 `.progress-track` / `.progress-fill`）或不确定进度 spinner
   - 文案：`正在导入…`
   - 禁用关闭/取消（或允许取消，调用 DELETE）

4. **done**
   - 结果统计：新增 / 更新 / 跳过 / 失败
   - warnings 列表
   - errors 前 10 条，其余折叠
   - 按钮：`完成`
   - emit `imported`

关闭行为：

- 如果已 preview 但未 commit，关闭时 best-effort 调用 `api.import.cancel(importId)`
- commit 成功后临时目录已被服务端删除，不再调用

### 8.3 `src/pages/LibraryPage.vue`

在页头「添加词条」旁加：

```vue
<button class="btn" @click="importOpen = true">
  <Icon name="upload" :size="16" />
  导入词库
</button>
```

并挂载：

```vue
<ImportModal v-model:open="importOpen" @imported="onImported" />
```

```ts
async function onImported() {
  await load()
  await store.refreshStats()
}
```

### 8.4 `src/components/Icon.vue`

在 `icons` 注册表增加 `upload`。可用简单的上传箭头 SVG：

```ts
upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />',
```

保持现有 `Icon` 的 stroke 风格。

### 8.5 样式

- 只用 tokens 和全局类：`.btn`、`.btn-primary`、`.btn-ghost`、`.card`、`.field`、`.input`、`.select`、`.tag`、`.banner`、`.banner-error`、`.banner-ok`、`.progress-track`、`.progress-fill`
- 不硬编码颜色；同时兼容 Neumorphism 和 Swiss 主题
- 示例表格放在 `overflow-x: auto` 容器里，避免移动端撑破页面
- 映射行用 `display:grid`，窄屏改单列
- 移动端 400px 宽度仍可用

### 8.6 中文文案约定

- 按钮：`选择文件`、`开始导入`、`导入中…`、`完成`
- 成功：`已导入 1180 条，更新 0 条，跳过 20 条。`
- 失败：`导入失败：不是有效的 Anki 词库文件。`
- 警告：`检测到 36 个媒体文件，EasyEnglish 暂不支持媒体，已保留占位文本。`
- 使用全角标点 `，。：；` 和中文引号 `“”`

---

## 9. 安全与限制

| 风险 | 措施 |
|---|---|
| 超大上传 | `bodyLimit` 200MB；集合解压后 100MB；note 数 100,000 |
| ZIP bomb | 只解压集合成员；检查解压后大小；不解压媒体 |
| 路径穿越 | 不使用 ZIP 内文件名写盘；临时目录用 UUID；校验 `importId` |
| 恶意 SQLite | `readonly: true`；不执行 `ATTACH`；不加载扩展；只查已知表 |
| XSS | 不把 Anki HTML 直接写入前端渲染；清洗成纯文本；Vue 插值默认转义 |
| 临时文件泄漏 | 提交/取消删除；启动和预览时清理 1 小时前目录 |
| 资源耗尽 | 限制 note 数、媒体不解压、字段截断、错误列表截断到 100 条 |
| 文件名欺骗 | 用 ZIP 魔数和成员名判断，不信任扩展名和原文件名 |

---

## 10. 测试与验收

### 10.1 手工测试夹具

至少准备以下 `.apkg`：

1. **legacy1**：ZIP 内只有 `collection.anki2`（schema 11）
2. **legacy2 纯 SQLite**：ZIP 内 `collection.anki21`（schema 11）
3. **legacy2 zstd**：`collection.anki21` 的 zstd 压缩版本
4. **latest**：`collection.anki21b`（zstd，schema 18 表）
5. **colpkg**：文件名 `collection.colpkg`，内容同 latest
6. **坏文件**：普通 ZIP、空 ZIP、损坏 SQLite、schema 99

可以用 Python 3 生成 schema 11 夹具：

```python
import json, sqlite3, zipfile, tempfile, os

SCHEMA = """
CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER,
  ver INTEGER, dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT,
  decks TEXT, dconf TEXT, tags TEXT);
CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER,
  usn INTEGER, tags TEXT, flds TEXT, sfld INTEGER, csum INTEGER, flags INTEGER, data TEXT);
CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER,
  mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER,
  factor INTEGER, reps INTEGER, lapses INTEGER, left INTEGER, odue INTEGER,
  odid INTEGER, flags INTEGER, data TEXT);
CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, usn INTEGER, ease INTEGER,
  ivl INTEGER, lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER);
CREATE TABLE graves (usn INTEGER, oid INTEGER, type INTEGER);
"""

db_path = tempfile.mktemp(suffix='.anki2')
con = sqlite3.connect(db_path)
con.executescript(SCHEMA)
models = {'100': {'id': 100, 'name': 'Basic', 'type': 0,
  'flds': [{'name': 'Front', 'ord': 0}, {'name': 'Back', 'ord': 1}], 'tmpls': []}}
decks = {'1': {'id': 1, 'name': 'Fixture Deck'}}
con.execute(
  'INSERT INTO col VALUES (1,0,0,0,11,0,0,0,?,?,?,?,?)',
  ('{}', json.dumps(models), json.dumps(decks), '{}', '{}'),
)
flds = '\x1f'.join(['apple', '苹果'])
con.execute(
  "INSERT INTO notes VALUES (1,'guid-apple',100,0,0,' fruit ',?,0,0,0,'')",
  (flds,),
)
con.execute(
  "INSERT INTO cards VALUES (1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,'')",
)
con.commit()
con.close()

with zipfile.ZipFile('fixture.apkg', 'w') as z:
    z.write(db_path, 'collection.anki2')
    z.writestr('media', '{}')

os.remove(db_path)
```

注意：`\x1f` 是真实的 Unit Separator，不要写成字面量反斜杠 + `x1f`。

modern 夹具可以用 Node：

```js
import { zstdCompressSync } from 'node:zlib'
// 生成 schema 18 的 SQLite 后：
// zstdCompressSync(sqliteBuffer) 写入 collection.anki21b
```

### 10.2 手工 API 冒烟

```bash
pnpm dev:server

# 预览
curl -sS -F "file=@fixture.apkg" http://localhost:3001/api/import/preview | jq

# 提交（把 importId 换成预览返回的值）
curl -sS -X POST http://localhost:3001/api/import/commit \
  -H 'Content-Type: application/json' \
  -d '{"importId":"<uuid>","options":{"mapping":{"text":0,"meaning":1,"type":"auto"},"useAnkiTags":true,"addDeckTag":true,"duplicateMode":"skip","scheduling":"reset","media":"placeholder"}}' | jq

# 验证词条
curl -sS 'http://localhost:3001/api/entries?q=apple' | jq

# 验证复习队列与统计
curl -sS http://localhost:3001/api/review/queue | jq
curl -sS http://localhost:3001/api/review/stats | jq
```

### 10.3 验收清单

- [ ] AnkiDroid 2.25.x 导出的 `.apkg` 能预览出牌组、note type、字段、note 数
- [ ] `collection.anki2`（schema 11）能导入
- [ ] `collection.anki21`（纯 SQLite 和 zstd 两种）能导入
- [ ] `collection.anki21b`（zstd，schema 18）能导入
- [ ] `.colpkg` 能导入，只合并不删除，并显示警告
- [ ] `notes.flds` 按 `\x1f` 正确拆分
- [ ] tags 正确拆分，`::` 层级标签保留
- [ ] HTML 标签、`<br>`、`<img>`、`[sound:]` 清洗正确
- [ ] cloze `{{c1::answer::hint}}` 清洗为 `answer`
- [ ] 一个 note 多张 card 只生成一条词条
- [ ] 筛选牌组使用 `odid` 的牌组名
- [ ] 字段映射可在预览页调整
- [ ] 默认跳过重复；更新模式保留复习状态；新词模式可重复导入
- [ ] 超长字段截断并告警；空 text 跳过并记录
- [ ] 媒体不落盘，给出数量和占位文本
- [ ] 非法 ZIP / 非 Anki ZIP / schema 99 返回友好 400
- [ ] 200MB 以上文件返回 413
- [ ] 导入后 `store.refreshStats()` 生效，侧边栏数字更新
- [ ] FTS 搜索能搜到导入的词条
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build` 通过
- [ ] Neumorphism 和 Swiss 两套主题下 UI 正常
- [ ] 400px 宽度下映射表格可横向滚动，页面不横向溢出

---

## 11. 实施顺序

1. `pnpm add fflate`；追加 `shared/types.ts`
2. 更新 `server/schema.sql` + `server/db.ts` 迁移；`mapEntry` 加 `externalId`
3. 抽 `server/lib/entry-store.ts`，改造 `server/routes/entries.ts`
4. 实现 `server/lib/import/anki-package.ts`：
   - ZIP 读取
   - legacy1 `collection.anki2`
   - zstd 魔数检测
   - schema 11 读取
5. 实现 `server/lib/import/mapper.ts`：HTML/cloze 清洗、类型判断、字段映射
6. 实现 `server/routes/import.ts` 的 preview / commit / cancel
7. 补 schema 18 读取（`collection.anki21b`）
8. 前端 `ImportModal.vue` + Library 按钮 + `api.ts`
9. 补测试夹具和手工冒烟
10. 更新 `docs/ARCHITECTURE.md`
11. 第二阶段：文本/CSV 导入、近似复习进度

---

## 12. 默认决策

实现时采用以下默认值，除非产品另行确认：

| 项 | 默认值 |
|---|---|
| 重复词条 | `skip` |
| 学习进度 | `reset`（全部作为新词） |
| 媒体 | `placeholder`（保留占位文本） |
| `.colpkg` | 合并导入，不删除 |
| `source` | `'anki'` |
| 去重 | GUID 优先，规范化 text 兜底 |
| 媒体落盘 | 不做 |
| `revlog` | 不导入 |
| 文本/CSV | 第二阶段 |
| 上传上限 | 200MB |
| note 数上限 | 100,000 |

---

## 13. 参考资料

- AnkiDroid Manual（Import/Export）：https://docs.ankidroid.org/manual.html
- Anki Manual — Text Files：https://docs.ankiweb.net/manual/importing/text-files.md
- Anki Manual — Packaged Decks：https://docs.ankiweb.net/manual/importing/packaged-decks.md
- Anki Manual — Exporting：https://docs.ankiweb.net/manual/exporting.md
- Anki 源码 — `package/meta.rs`：https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/meta.rs
- Anki 源码 — `package/media.rs`：https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/media.rs
- Anki 源码 — `schema11.sql`：https://github.com/ankitects/anki/blob/main/rslib/src/storage/schema11.sql
- Anki 源码 — schema 14/15/18 升级 SQL：https://github.com/ankitects/anki/tree/main/rslib/src/storage/upgrades
- fflate：https://github.com/101arrowz/fflate
