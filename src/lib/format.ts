export function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const diff = date.getTime() - Date.now()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

  if (abs < 45_000) return '刚刚'
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day')
  return date.toLocaleDateString('zh-CN')
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDue(iso: string): string {
  if (new Date(iso).getTime() <= Date.now()) return '现在'
  return formatRelativeTime(iso)
}

export function todayLongLabel(date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
}

export function startOfTodayIso(date = new Date()): string {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString()
}

export function stageLabel(stage: number): string {
  if (stage <= 0) return '新词'
  return `第 ${stage} 阶段`
}

export function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
