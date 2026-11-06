export function nowIso(): string {
  return new Date().toISOString()
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface DayRange {
  /** 本地当天 00:00 对应的 UTC ISO 时间 */
  start: string
  /** 本地次日 00:00 对应的 UTC ISO 时间 */
  end: string
  /** 本地日期 YYYY-MM-DD */
  date: string
}

export function dayRange(date = new Date()): DayRange {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    date: localDateKey(date),
  }
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000)
}
