# Markdown import format

## 1. Regular groups

Use four H1 headings:

```md
# words
# collocations
# sentences
# Scenery
```

- `# words`: one word per line, type fixed to Word
- `# collocations`: one phrase per line, type fixed to Phrase
- `# sentences`: one sentence per line, type fixed to Sentence
- `# Scenery`: scenes, see the next section

Put one entry per line. Word directories (`# words` or scene `### Words`) may split multiple words with ` / `; phrase and sentence groups never split on `/`.

### Optional meaning

Regular lines may use `=` or ` — ` to add a meaning/explanation:

```md
crack a joke = informal expression meaning tell a joke
If only ... — I wish that were true
```

- Right side contains Chinese → stored as Meaning
- Right side has no Chinese → stored as Explanation

## 2. Scenery scenes

```md
# Scenery

## Bank

### Words

Deposit money
ATM vestibule
- I'd like to deposit $500 into my savings account.

### Phrases

make a deposit
withdraw cash

### Sentences

Can I deposit cash at this ATM?
- What's the daily withdrawal limit?
```

Rules:

- `##` = scene name
- `###` = group. Supported aliases:
  - Words: `单词` / `words` / `word` / `词汇` / `vocabulary`
  - Phrases: `短语` / `phrases` / `phrase` / `搭配` / `collocations`
  - Sentences: `句子` / `sentences` / `sentence`
- Regular lines use the type of their current H3
- Under `### Words`, regular lines may split multiple words with ` / `
- List lines starting with `-`, `*` or `1.` are always treated as sentences, even under `### Words`, and are never split on `/`
- Scene entries do not enter daily review by default

## 3. Tables

Tables work in any group:

```md
| English | Meaning | Supplement |
| --- | --- | --- |
| Deposit money | save money | make a deposit |
| Bank account | bank account | collocates with savings / checking |
```

Rules:

- First column: English content
- Second column: meaning
- Third column: supplement
- Fourth and later columns are ignored
- Escape a literal pipe as `\|`
- The row type follows its group:
  - `# words` / `### Words` → Word
  - `# collocations` / `### Phrases` → Phrase
  - `# sentences` / `### Sentences` → Sentence
- Rows with an empty first column are dropped

## 4. Other rules

- Every non-empty line outside a table is one candidate entry; lines are never merged
- H4 and deeper headings are ignored; content stays in the current H2/H3
- Bold, italics, backticks and Markdown links are stripped to plain text
- Unrecognized scene H3 headings fall back to type detection and show a preview warning
- Import dedupes by the main English text:
  - Case, surrounding whitespace, surrounding quotes and trailing punctuation are ignored
  - Type, meaning, explanation, examples and tags are not part of the key
  - Existing English text is never imported twice, including inside scenes

## 5. Export

Exported Markdown uses the same structure:

- Regular entries: `# words` / `# collocations` / `# sentences`
- Scenes: `# Scenery` → `## scene name` → `### Word/Phrase/Sentence`
- Tables have three columns: `English | Meaning | Supplement`
- The Supplement column merges explanation, examples, notes and tags
- Review progress is not exported
