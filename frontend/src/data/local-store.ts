import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'
// 与业务表并列的「元信息」命名空间：迁移版本、另存快照、去重标记等，不跟业务记录混在一张表。
const META_KEY = 'hydropower-plant-om:meta'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

// 迁移用：一次性整体落盘，避免 v1→v2→v3 每步都重写整个 localStorage。
export function saveAllRows(next: Record<string, EntryRow[]>): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

type MetaValue = string | number | boolean | null | MetaValue[] | { [key: string]: MetaValue }

function readMeta(): Record<string, MetaValue> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(META_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, MetaValue>
  } catch {
    return {}
  }
}

export function getMeta<T extends MetaValue>(key: string, fallback: T): T {
  const value = readMeta()[key]
  return value === undefined ? fallback : (value as T)
}

export function setMeta(key: string, value: MetaValue): void {
  const next = { ...readMeta(), [key]: value }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(META_KEY, JSON.stringify(next))
  }
}
