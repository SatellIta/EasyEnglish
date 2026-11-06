import type {
  AiPersonaSettings,
  Persona,
  PersonaInput,
} from '../../shared/types'
import { db } from '../db'
import { deleteSetting, getSetting, setSetting } from './settings'
import { nowIso } from './time'

const SELECTED_KEY = 'ai.personaId'

export interface DefaultPersonaSeed {
  key: string
  name: string
  description: string
  prompt: string
  sortOrder: number
}

/** 与 005_personas.sql 的种子保持一致；恢复默认时使用。 */
export const DEFAULT_PERSONAS: DefaultPersonaSeed[] = [
  {
    key: 'serious',
    name: '严肃老师',
    description: '严谨、直接，重视准确和纠错。',
    prompt:
      '你是一位严谨、直接的英语老师。语气克制，先给准确结论，再给必要细节。学习者出现错误时明确指出并解释原因；鼓励主动回忆和精确表达；不闲聊，不使用网络流行语，不为了讨好而夸赞。',
    sortOrder: 1,
  },
  {
    key: 'homie',
    name: '嘻哈好哥们（老外）',
    description: '母语者朋友风格，口语化、轻松、带一点俚语。',
    prompt:
      '你是一位以英语为母语、语气像嘻哈好哥们的朋友。用自然、口语化的英文互动，可以适当使用常见俚语和轻松调侃。先肯定对方再指出问题；解释要简短、接地气；不要为了耍酷而牺牲准确性，也不要使用让人难以理解的生僻俚语。',
    sortOrder: 2,
  },
  {
    key: 'catgirl',
    name: '猫娘女仆',
    description: '可爱、温柔、有耐心，偶尔使用语气词。',
    prompt:
      '你是一位猫娘女仆风格的英语学习伙伴。语气可爱、温柔、有耐心，可以偶尔使用「喵」等语气词，但不要影响信息密度。先鼓励再纠正；讲解仍然准确、清楚；不要用卖萌代替知识。',
    sortOrder: 3,
  },
]

export function mapPersona(row: any): Persona {
  return {
    id: row.id,
    key: row.key ?? null,
    name: row.name,
    description: row.description ?? null,
    prompt: row.prompt,
    isDefault: row.is_default === 1,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listPersonas(): Persona[] {
  const rows = db
    .prepare(
      `SELECT * FROM personas
       ORDER BY is_default DESC, sort_order ASC, id ASC`,
    )
    .all()
  return rows.map(mapPersona)
}

export function getPersona(id: number): Persona | null {
  const row = db.prepare('SELECT * FROM personas WHERE id = ?').get(id)
  return row ? mapPersona(row) : null
}

/** 当前选中人格；设置失效时回退到第一个人格。 */
export function getSelectedPersona(): Persona | null {
  const raw = Number(getSetting(SELECTED_KEY))
  if (Number.isInteger(raw) && raw > 0) {
    const selected = getPersona(raw)
    if (selected) return selected
  }
  const row = db
    .prepare(
      `SELECT * FROM personas
       ORDER BY is_default DESC, sort_order ASC, id ASC
       LIMIT 1`,
    )
    .get()
  return row ? mapPersona(row) : null
}

export function getAiPersonaSettings(): AiPersonaSettings {
  return { personaId: getSelectedPersona()?.id ?? null }
}

export function saveAiPersonaSettings(input: AiPersonaSettings): AiPersonaSettings {
  if (input.personaId === null) {
    deleteSetting(SELECTED_KEY)
    return getAiPersonaSettings()
  }

  const persona = getPersona(input.personaId)
  if (!persona) throw new Error('人格不存在')
  setSetting(SELECTED_KEY, String(persona.id))
  return { personaId: persona.id }
}

export function createPersona(input: PersonaInput): Persona {
  const name = input.name.trim()
  const prompt = input.prompt.trim()
  if (!name) throw new Error('人格名称不能为空')
  if (!prompt) throw new Error('人格提示词不能为空')

  const now = nowIso()
  const nextOrder = Number(
    (
      db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM personas').get() as {
        next: number
      }
    ).next,
  )
  const info = db
    .prepare(
      `INSERT INTO personas (key, name, description, prompt, is_default, sort_order, created_at, updated_at)
       VALUES (NULL, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(name, input.description?.trim() || null, prompt, nextOrder, now, now)

  return getPersona(Number(info.lastInsertRowid)) as Persona
}

export function updatePersona(
  id: number,
  input: Partial<PersonaInput>,
): Persona | null {
  const persona = getPersona(id)
  if (!persona) return null

  const fields: string[] = []
  const params: unknown[] = []
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`)
    params.push(value)
  }

  // 默认人格只允许改提示词，名称/描述由界面按 key 本地化。
  if (!persona.isDefault) {
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) throw new Error('人格名称不能为空')
      set('name', name)
    }
    if (input.description !== undefined) {
      set('description', input.description?.trim() || null)
    }
  }

  if (input.prompt !== undefined) {
    const prompt = input.prompt.trim()
    if (!prompt) throw new Error('人格提示词不能为空')
    set('prompt', prompt)
  }

  if (!fields.length) return persona
  set('updated_at', nowIso())
  db.prepare(`UPDATE personas SET ${fields.join(', ')} WHERE id = ?`).run(
    ...params,
    id,
  )
  return getPersona(id)
}

/** 恢复默认人格的名称、描述和提示词。 */
export function resetPersona(id: number): Persona | null {
  const persona = getPersona(id)
  if (!persona || !persona.isDefault || !persona.key) return null

  const seed = DEFAULT_PERSONAS.find((item) => item.key === persona.key)
  if (!seed) return null

  db.prepare(
    `UPDATE personas
     SET name = ?, description = ?, prompt = ?, updated_at = ?
     WHERE id = ?`,
  ).run(seed.name, seed.description, seed.prompt, nowIso(), id)
  return getPersona(id)
}

export function deletePersona(id: number): boolean {
  const persona = getPersona(id)
  if (!persona || persona.isDefault) return false

  const info = db.prepare('DELETE FROM personas WHERE id = ?').run(id)
  if (info.changes && Number(getSetting(SELECTED_KEY)) === id) {
    deleteSetting(SELECTED_KEY)
  }
  return info.changes > 0
}
