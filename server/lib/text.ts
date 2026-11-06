/**
 * 词条去重用的归一化文本：大小写、全半角、空白和首尾标点都不参与比较。
 * 只做保守归一化，避免把 "a" 和 "the a" 这类不同内容误判为同一条。
 */
export function normalizeEntryText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s.,!?;:"'()\[\]{}…—–-]+/, '')
    .replace(/[\s.,!?;:"'()\[\]{}…—–-]+$/, '')
    .trim()
}

/** 判断两条词条是否在忽略大小写和首尾标点后相同。 */
export function isSameEntryText(a: string, b: string): boolean {
  const left = normalizeEntryText(a)
  return Boolean(left) && left === normalizeEntryText(b)
}
