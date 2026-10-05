import type { EntryRow } from './types'

/**
 * 流域总览的唯一口径层：台账、流域视图、首页概览都从这里派生数字与状态，
 * 任何页面都不允许再各自算一遍，避免出现两个总数。
 */

// 运行状态：台账行 status 字段是唯一真源。这里只是集中登记，供三处共用。
export const STATION_STATUSES = ['在建', '试运行', '正常运行', '停机检修', '停运'] as const
export type StationStatus = (typeof STATION_STATUSES)[number]

// 停运（含停机检修）以外的状态都算“在运”，台账改了状态，在运数随之变。
export const ACTIVE_STATUSES: StationStatus[] = ['试运行', '正常运行', '停机检修']

/**
 * 曾用流域名 -> 现行流域名。
 * 早期归属登记用过“雅砻江干流”“大渡河干流”等旧名，历史数据回填与迁移时
 * 一律按现行名归一；映射表之外的名称保持原样。
 */
export const BASIN_ALIASES: Record<string, string> = {
  雅砻江干流: '雅砻江流域',
  大渡河干流: '大渡河流域',
  澜沧江中游: '澜沧江流域',
  南盘江: '红水河流域',
  金沙江中段: '金沙江流域',
}

export function canonBasin(raw: unknown): string {
  const name = String(raw ?? '').trim()
  if (!name) {
    return '未划分流域'
  }
  return BASIN_ALIASES[name] ?? name
}

/** 装机容量统一按兆瓦（MW）解析；解析不出按 0 处理，保证排序与合计不炸。 */
export function capacityMw(row: EntryRow): number {
  const raw = row['装机容量']
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  const matched = String(raw ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return matched ? Number(matched[0]) : 0
}

export function unitCount(row: EntryRow): number {
  const raw = row['机组台数']
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  const matched = String(raw ?? '').match(/\d+/)
  return matched ? Number(matched[0]) : 0
}

export function stationName(row: EntryRow): string {
  return String(row['电站名称'] ?? `水电站#${row.id}`)
}

/** 投运日期，空串/占位符视为未投运（在建）。 */
export function commissionDate(row: EntryRow): string {
  const value = String(row['投运日期'] ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

export function isInService(row: EntryRow): boolean {
  return ACTIVE_STATUSES.includes(String(row.status) as StationStatus)
}

/** 停机检修与停运都要单独标出；停运还要写清停运原因。 */
export function isHalted(row: EntryRow): boolean {
  return String(row.status) === '停运'
}

export function isOverhaul(row: EntryRow): boolean {
  return String(row.status) === '停机检修'
}

export function haltReason(row: EntryRow): string {
  return String(row['停运原因'] ?? '').trim()
}

export type CapacityTier = {
  key: string
  label: string
  match: (mw: number) => boolean
}

// 按水电行业常用口径划档：大型 ≥300MW，中型 50–300MW（不含 300），小型 <50MW。
export const CAPACITY_TIERS: CapacityTier[] = [
  { key: 'large', label: '大型（≥300MW）', match: (mw) => mw >= 300 },
  { key: 'medium', label: '中型（50–300MW）', match: (mw) => mw >= 50 && mw < 300 },
  { key: 'small', label: '小型（<50MW）', match: (mw) => mw < 50 },
]

export function tierOf(mw: number): CapacityTier {
  return CAPACITY_TIERS.find((tier) => tier.match(mw)) ?? CAPACITY_TIERS[CAPACITY_TIERS.length - 1]
}

/**
 * 统一排序口径：以装机容量为准（降序），绝不按名称排。
 * 容量相同用投运日期升序、电站编号升序兜底，只做唯一化，不改变“容量优先”。
 * 未投运（无投运日期，即在建）一律排到最后。
 */
export function compareByCapacityThenDate(a: EntryRow, b: EntryRow): number {
  const dateA = commissionDate(a)
  const dateB = commissionDate(b)
  if (!dateA && !dateB) {
    return compareCapacity(a, b)
  }
  if (!dateA) {
    return 1
  }
  if (!dateB) {
    return -1
  }
  return compareCapacity(a, b)
}

function compareCapacity(a: EntryRow, b: EntryRow): number {
  const diff = capacityMw(b) - capacityMw(a)
  if (diff !== 0) {
    return diff
  }
  const dateDiff = commissionDate(a).localeCompare(commissionDate(b))
  if (dateDiff !== 0) {
    return dateDiff
  }
  return Number(a.id) - Number(b.id)
}

export type StationGroup = {
  basin: string
  rows: EntryRow[]
  capacityTotal: number
  unitsTotal: number
}

/**
 * 按流域铺开：先按现行流域名归一过滤，再用统一容量口径排序。
 * 流域组之间按组内在运+停运电站的装机合计降序（合计相同按现行名升序兜底）。
 */
export function groupByBasin(
  rows: EntryRow[],
  options: { basins?: string[]; tiers?: string[] } = {},
): StationGroup[] {
  const allowedTiers = options.tiers?.length ? new Set(options.tiers) : null
  const selected = rows.filter((row) => {
    const basin = canonBasin(row['所属流域'])
    if (options.basins?.length && !options.basins.includes(basin)) {
      return false
    }
    if (allowedTiers && !allowedTiers.has(tierOf(capacityMw(row)).key)) {
      return false
    }
    return true
  })

  const map = new Map<string, EntryRow[]>()
  for (const row of selected) {
    const basin = canonBasin(row['所属流域'])
    const list = map.get(basin) ?? []
    list.push(row)
    map.set(basin, list)
  }

  const groups: StationGroup[] = [...map.entries()].map(([basin, list]) => {
    const sorted = [...list].sort(compareByCapacityThenDate)
    return {
      basin,
      rows: sorted,
      capacityTotal: sorted.reduce((sum, row) => sum + capacityMw(row), 0),
      unitsTotal: sorted.reduce((sum, row) => sum + unitCount(row), 0),
    }
  })

  groups.sort((a, b) => b.capacityTotal - a.capacityTotal || a.basin.localeCompare(b.basin, 'zh-Hans-CN'))
  return groups
}

export type BasinComparisonRow = {
  basin: string
  stationCount: number
  capacityTotal: number
  unitsTotal: number
  inService: number
  trial: number
  halted: number
  building: number
}

/** 对照视图指标：每座流域一行，两处（概览页/流域页）取这同一份。 */
export function basinComparison(rows: EntryRow[]): BasinComparisonRow[] {
  return groupByBasin(rows).map((group) => {
    const summary: BasinComparisonRow = {
      basin: group.basin,
      stationCount: group.rows.length,
      capacityTotal: group.capacityTotal,
      unitsTotal: group.unitsTotal,
      inService: 0,
      trial: 0,
      halted: 0,
      building: 0,
    }
    for (const row of group.rows) {
      const status = String(row.status)
      if (status === '正常运行') {
        summary.inService += 1
      } else if (status === '试运行') {
        summary.trial += 1
      } else if (status === '停运' || status === '停机检修') {
        summary.halted += 1
      } else {
        summary.building += 1
      }
    }
    return summary
  })
}

export type StationOverview = {
  total: number
  inService: number
  trial: number
  halted: number
  building: number
  capacityTotal: number
  unitsTotal: number
  activeCapacity: number
}

/** 汇总条/首页概览的电站口径，台账状态一改，这里跟着变，且只有这一处算法。 */
export function stationOverview(rows: EntryRow[]): StationOverview {
  const overview: StationOverview = {
    total: rows.length,
    inService: 0,
    trial: 0,
    halted: 0,
    building: 0,
    capacityTotal: 0,
    unitsTotal: 0,
    activeCapacity: 0,
  }
  for (const row of rows) {
    const mw = capacityMw(row)
    overview.capacityTotal += mw
    overview.unitsTotal += unitCount(row)
    const status = String(row.status)
    if (status === '正常运行') {
      overview.inService += 1
      overview.activeCapacity += mw
    } else if (status === '试运行') {
      overview.trial += 1
      overview.activeCapacity += mw
    } else if (status === '停机检修') {
      overview.halted += 1
      overview.activeCapacity += mw
    } else if (status === '停运') {
      overview.halted += 1
    } else {
      overview.building += 1
    }
  }
  return overview
}

export type CommissionBackfillRow = {
  year: string
  stations: number
  newCapacity: number
  newUnits: number
  cumulativeCapacity: number
}

/**
 * 历史投运回填：按投运日期把每年投运的电站、新增装机、新增机组逐年补齐，
 * 再给累计装机。无投运日期的在建电站不进入历史曲线。
 */
export function commissionBackfill(rows: EntryRow[]): CommissionBackfillRow[] {
  const byYear = new Map<string, { stations: number; capacity: number; units: number }>()
  for (const row of rows) {
    const date = commissionDate(row)
    if (!date) {
      continue
    }
    const year = date.slice(0, 4)
    const bucket = byYear.get(year) ?? { stations: 0, capacity: 0, units: 0 }
    bucket.stations += 1
    bucket.capacity += capacityMw(row)
    bucket.units += unitCount(row)
    byYear.set(year, bucket)
  }

  const result: CommissionBackfillRow[] = []
  let cumulative = 0
  for (const year of [...byYear.keys()].sort()) {
    const bucket = byYear.get(year)!
    cumulative += bucket.capacity
    result.push({
      year,
      stations: bucket.stations,
      newCapacity: bucket.capacity,
      newUnits: bucket.units,
      cumulativeCapacity: cumulative,
    })
  }
  return result
}

export function allBasinNames(rows: EntryRow[]): string[] {
  const names = new Set<string>()
  for (const row of rows) {
    names.add(canonBasin(row['所属流域']))
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}
