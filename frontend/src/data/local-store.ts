import { SEED_ROWS } from './seed'
import { BASIN_ALIASES } from './station-model'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'
const CURRENT_VERSION = 1

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type Persisted = {
  version: number
  entries: Record<string, EntryRow[]>
}

// 占位种子特征：仓库初始化时所有业务字段都填了“电站台账样例N”这类字符串，
// 存量数据迁移时识别到就说明用户从未真正登过电站，直接换成真实全域种子。
function isPlaceholderStation(rows: EntryRow[]): boolean {
  return rows.some((row) => String(row['电站名称'] ?? '').includes('电站台账样例'))
}

/**
 * 存量数据迁移：按条目原有顺序逐条处理，早期条目除流域名归一外保持原样，
 * 不新增不改写其余业务字段；只做最低限度的结构补齐。
 */
function migrateV0ToV1(raw: Record<string, EntryRow[]>): Persisted {
  const entries = clone(raw)

  if (Array.isArray(entries.station)) {
    if (isPlaceholderStation(entries.station)) {
      // 用户从未真正登过电站：换成真实全域种子，但种子里的历史条目仍保留曾用流域名，
      // 替换后同样走一遍归一，保证落库即为现行名。
      entries.station = clone(SEED_ROWS.station)
    }
    entries.station = entries.station.map((row) => {
      const next: EntryRow = { ...row }
      // 早期流域归属改过名的，按现行名称统一；映射表之外的名称原样保留。
      const basin = String(next['所属流域'] ?? '').trim()
      if (basin && BASIN_ALIASES[basin]) {
        next['所属流域'] = BASIN_ALIASES[basin]
      }
      if (!('停运原因' in next)) {
        next['停运原因'] = ''
      }
      // 文本镜像列与唯一真源 status 对齐，避免老数据两处取值不一致。
      next['运行状态'] = String(next.status ?? '')
      return next
    })
  }

  return { version: CURRENT_VERSION, entries }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback: Persisted = { version: CURRENT_VERSION, entries: clone(SEED_ROWS) }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback.entries
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback.entries
  }
  try {
    const parsed = JSON.parse(raw) as Persisted | Record<string, EntryRow[]>
    // 旧版本（裸 entries、无 version 字段）走迁移；带版本结构的直接接续。
    const persisted: Persisted =
      typeof (parsed as Persisted).version === 'number'
        ? (parsed as Persisted)
        : migrateV0ToV1(parsed as Record<string, EntryRow[]>)
    // 新种子里新增的模块/字段补进来，用户已有数据优先。
    const merged: Record<string, EntryRow[]> = { ...clone(SEED_ROWS), ...persisted.entries }
    const next: Persisted = { version: CURRENT_VERSION, entries: merged }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback.entries
  }
}

let cache: Record<string, EntryRow[]> | null = null

// 极简变更通知：任何写操作完成后广播，挂载着的台账/流域/概览页据此重算，
// 保证“台账改状态、流域视图与首页总数同时变”。
const listeners = new Set<() => void>()

export function onStoreChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitChange(): void {
  listeners.forEach((listener) => listener())
}

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
    const payload: Persisted = { version: CURRENT_VERSION, entries: next }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }
  emitChange()
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
