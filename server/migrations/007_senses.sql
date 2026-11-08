-- 一词多义：每个义项单独保存释义和例句，FTS 也索引 senses。
-- 列本身由 server/db.ts 在迁移时补充（全新数据库由 schema.sql 建好）。

DROP TRIGGER IF EXISTS entries_fts_ai;
DROP TRIGGER IF EXISTS entries_fts_ad;
DROP TRIGGER IF EXISTS entries_fts_au;
DROP TABLE IF EXISTS entries_fts;

CREATE VIRTUAL TABLE entries_fts USING fts5(
  text,
  meaning,
  explanation,
  notes,
  senses,
  content = 'entries',
  content_rowid = 'id',
  tokenize = 'trigram'
);

CREATE TRIGGER entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, text, meaning, explanation, notes, senses)
  VALUES (new.id, new.text, new.meaning, new.explanation, new.notes, new.senses);
END;

CREATE TRIGGER entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, text, meaning, explanation, notes, senses)
  VALUES ('delete', old.id, old.text, old.meaning, old.explanation, old.notes, old.senses);
END;

CREATE TRIGGER entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, text, meaning, explanation, notes, senses)
  VALUES ('delete', old.id, old.text, old.meaning, old.explanation, old.notes, old.senses);
  INSERT INTO entries_fts(rowid, text, meaning, explanation, notes, senses)
  VALUES (new.id, new.text, new.meaning, new.explanation, new.notes, new.senses);
END;

INSERT INTO entries_fts(entries_fts) VALUES ('rebuild');
