# Markdown 导入格式

## 1. 普通分类

使用四个一级标题：

```md
# words
# collocations
# sentences
# Scenery
```

- `# words`：每一行一个单词，类型固定为「单词」
- `# collocations`：每一行一个短语，类型固定为「短语」
- `# sentences`：每一行一个句子，类型固定为「句子」
- `# Scenery`：场景，规则见下一节

一行一个词条。明确是单词的目录（`# words` 或场景 `### 单词`）可以用 ` / ` 分隔多个单词；短语、句子目录不要用 `/` 拆分。

### 可选释义

普通行可以使用 `=` 或 ` — ` 补充含义/解释：

```md
crack a joke = informal expression meaning tell a joke
If only ... — 要是...就好了
```

- 右侧含中文 → 写入「含义」
- 右侧不含中文 → 写入「解释」

## 2. Scenery 场景

```md
# Scenery

## Bank

### 单词

Deposit money
ATM vestibule
- I'd like to deposit $500 into my savings account.

### 短语

make a deposit
withdraw cash

### 句子

Can I deposit cash at this ATM?
- What's the daily withdrawal limit?
```

规则：

- `##` = 场景名称
- `###` = 分类，支持：
  - 单词：`单词` / `words` / `word` / `词汇` / `vocabulary`
  - 短语：`短语` / `phrases` / `phrase` / `搭配` / `collocations`
  - 句子：`句子` / `sentences` / `sentence`
- 普通行按所在 H3 的分类处理
- 在 `### 单词` 下，普通行可以用 ` / ` 分隔多个单词
- 场景中 `-` / `*` / `1.` 开头的列表行，一律按句子处理，即使写在 `### 单词` 下，也不会按 `/` 拆分
- 场景词条默认不进入每日复习

## 3. 表格

表格可用于任何分类：

```md
| English | 含义 | 补充 |
| --- | --- | --- |
| Deposit money | 存钱 | 办理存款 |
| Bank account | 银行账户 | 可搭配 savings / checking |
```

规则：

- 第一列：英文内容
- 第二列：含义
- 第三列：补充解释
- 第四列及以后直接忽略
- 单元格里如果要写竖线，用 `\|` 转义
- 表格行的类型跟随所在分类：
  - `# words` / `### 单词` → 单词
  - `# collocations` / `### 短语` → 短语
  - `# sentences` / `### 句子` → 句子
- 第一列为空的表格行会被丢弃

## 4. 其他规则

- 表格以外的每个非空行就是一条候选词条，不会把多行合并成一条
- `H4` 及更深的标题会被忽略，内容仍按当前 H2/H3 处理
- 加粗、斜体、反引号、Markdown 链接会去掉格式，只保留文字
- 场景 H3 如果不是可识别的分类，会按内容自动判断，并在预览中提示
- 导入前会按主要英文内容查重：
  - 忽略大小写、首尾空格、首尾引号和结尾标点
  - 类型、含义、解释、例句、标签不参与判重
  - 已存在的英文内容不会重复导入；场景中的重复内容也不会重复写入

## 5. 导出

导出的 Markdown 使用同样的结构：

- 常规词条：`# words` / `# collocations` / `# sentences`
- 场景：`# Scenery` → `## 场景名` → `### 单词/短语/句子`
- 导出使用三列表格：`English | 含义 | 补充`
- 「补充」列会合并解释、例句、笔记和标签
- 导出不包含复习进度
