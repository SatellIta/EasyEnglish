# Markdown import format

## 1. Four H1 headings

```md
# words
# collocations
# sentences
# Scenery
```

- `# words`: one word per line
- `# collocations`: phrases and collocations
- `# sentences`: full sentences
- `# Scenery`: scenes, see section 3

Put one entry per line. Word groups (`# words` or scene `#### Words`) may split multiple words with ` / `; phrase and sentence groups never split on `/`.

## 2. Plain lines and continuations

### Inline meaning

Regular lines may use `=` or ` — ` to add a meaning or explanation:

```md
crack a joke = informal expression meaning tell a joke
If only ... — I wish that were true
```

- Right side contains Chinese → stored as Meaning
- Right side has no Chinese → stored as Explanation

### Adding fields to an entry

An indented line (2 spaces or a tab) directly below an entry adds more fields. This is the simplest way to give a word a one-sentence English definition:

```md
deposit = 存款
  英英释义：To put money into a bank account.
  例句：I'd like to deposit $500.
  例句：She deposited the check.
  补充：也可以作名词，表示「存款」。
  音标：/dɪˈpɒzɪt/
  标签：finance, bank
```

Supported continuation labels:

| Field | Labels |
| --- | --- |
| Meaning | `含义` / `中文` / `meaning` |
| English definition | `英英释义` / `英文释义` / `英文解释` / `definition` |
| Examples | `例句` / `例子` / `example` |
| Explanation | `补充` / `解释` / `说明` / `explanation` |
| Notes | `笔记` / `备注` / `notes` |
| Phonetic | `音标` / `发音` / `phonetic` |
| Tags | `标签` / `tags` |

A continuation must directly follow its entry. Blank lines in between are allowed, but another entry is not.

A `>` quote line adds an example sentence to the previous entry:

```md
deposit = 存款
> I'd like to deposit $500.
> She deposited the check.
```

Each `>` line becomes a separate example. In `A = B`, `B` is always the explanation: Chinese goes to Meaning, non-Chinese goes to Explanation.

Separate multiple examples with ` / `, `；` or `<br>`; separate tags with commas, semicolons or slashes.

### Headings as groups and tags

Under `# words`, `# collocations` and `# sentences`, every `##` and `###` heading is used both as a preview group and as a **tag**:

```md
# sentences
## Expression
If only I had known.
```

The entry above gets the tag `Expression`. This works in all three regular categories. Inside `# Scenery`, headings describe the scene structure and never become tags.

## 3. Scenery scenes

The recommended structure is scene → segment → type:

```md
# Scenery

## At the bank

### Opening an account
#### Words
deposit
withdraw

#### Phrases
open an account
make a deposit

#### Sentences
- I'd like to open a savings account, please.

### At the counter
#### Words
withdraw cash
```

Rules:

- `##` = scene name
- `###` = a free-form segment or sub-section inside the scene (for example `Opening an account`)
- `####` = entry type:
  - Words: `单词` / `words` / `word` / `词汇` / `vocabulary`
  - Phrases: `短语` / `phrases` / `phrase` / `搭配` / `collocations`
  - Sentences: `句子` / `sentences` / `sentence`
- The old format still works: write `### 单词` / `### 短语` / `### 句子` directly under `## scene` and skip the segment level
- Plain lines under a type heading use that type; without a type heading the type is detected from the content
- Under a word heading, regular lines may split multiple words with ` / `
- List lines starting with `-`, `*` or `1.` are always treated as sentences, even under `#### Words`, and are never split on `/`
- Scene entries join daily review by default; uncheck “Add scene entries to daily review too” in the preview to exclude them
- If the English text already exists, no new entry is created; the existing entry is linked to the current scene and its review setting is preserved

After import, `###` segments become the first grouping level in the scene view, and `####` types become the second.

## 4. Tables

### Named columns (recommended)

With named columns, the column order can be changed freely and unneeded columns can be omitted:

```md
| English | 含义 | 英英释义 | 例句 | 音标 | 标签 |
| --- | --- | --- | --- | --- | --- |
| deposit | 存款；存入 | To put money into a bank account. | I'd like to deposit $500. / She deposited the check. | /dɪˈpɒzɪt/ | finance, bank |
| withdraw | 取款 | To take money out of an account. |  |  | finance |
```

Supported column names (Chinese or English):

| Field | Column names |
| --- | --- |
| English content | `English` / `英文` / `单词` / `短语` / `句子` / `词条` / `内容` |
| Meaning | `含义` / `中文` / `释义` / `意思` / `Meaning` |
| English definition | `英英释义` / `英文释义` / `英文解释` / `Definition` |
| Examples | `例句` / `例子` / `Example` |
| Explanation | `补充` / `解释` / `说明` / `Explanation` |
| Notes | `笔记` / `备注` / `Notes` |
| Phonetic | `音标` / `发音` / `Phonetic` |
| Tags | `标签` / `Tags` |

- The English column does not have to be first; any recognized header works
- If no English column is recognized, the first column is used as the English content
- Separate multiple examples with `<br>`, ` / ` or `；`; separate tags with commas, semicolons or slashes
- A row's type follows its `#` / `####` group
- Rows with an empty English cell are dropped

### Legacy three columns

The old `| English | Meaning | Supplement |` table still works. If no header can be recognized at all, the parser falls back to "first column English, second column meaning, third column explanation" and shows a preview warning.

## 5. Ignoring content

Wrap notes, drafts or temporary remarks in HTML comments and the parser will skip them entirely:

```md
<!-- A note to myself; do not import -->
deposit = 存款

<!--
A multi-line comment
is not turned into entries
-->
```

Inline comments work too: `deposit <!-- source: podcast --> = 存款`. Only the `<!--` and `-->` pair matters; it does not have to be on its own line. An unclosed comment produces a warning and everything after it is ignored.

## 6. Other rules

- Every non-empty line outside a table is one candidate entry; lines are never merged (indented continuations excepted)
- H5 and deeper headings are ignored; H4 does not affect grouping outside scenes
- Bold, italics, backticks and Markdown links are stripped to plain text
- Scenes without a type heading fall back to automatic type detection
- Import dedupes by the main English text:
  - Case, surrounding whitespace, surrounding quotes and trailing punctuation are ignored
  - Type, meaning, explanation, examples and tags are not part of the key
  - Existing English text is not created again; inside a scene, the existing entry is linked to that scene and keeps its review setting
  - With “Update existing entries”, only fields actually present in the Markdown are changed; missing examples, phonetics or notes are preserved
  - To sync a Markdown file, set its path in Settings and sync from the Review page

## 7. Export

Exported Markdown uses the same structure and can be imported again:

- Regular entries: `# words` / `# collocations` / `# sentences`
- Scenes: `# Scenery` → `## scene name` → `### segment` → `#### Word/Phrase/Sentence`
- Tables use named columns: `English | 含义 | 英英释义 | 例句 | 补充 | 笔记 | 音标 | 标签`
- Only columns that actually contain data in the group are written
- Review progress and images are not exported
