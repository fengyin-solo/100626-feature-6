import { getMeta, listRows, saveRows, setMeta } from '@/data/local-store'
import { canWrite, PermissionDeniedError, useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

// 越权拒绝类型与 local-service 共用 session 模块的同一份定义。
export { PermissionDeniedError }

// 归属之外的岗位越权改动直接拒绝（与 local-service 同一条防线）。
function requireWatershedWrite(): void {
  const store = useSessionStore()
  if (!canWrite(store.role, 'watershed')) {
    throw new PermissionDeniedError('当前岗位只有查看权限：流域分布的另存与结论写回仅限调度员')
  }
}

/**
 * 流域总览领域服务。
 *
 * 唯一数据源：电站台账（local-store 的 station 表）。首页概览、电站台账、本视图、
 * 另存快照与检修待办结论全部从这里取数，台账一改，各处统计同一次读取即一起变。
 *
 * 两个已定口径（页面里也会展示，勿改回按名称排序）：
 * 1) 排布：以流域分组为骨架、装机容量为唯一排序量。流域组按「在运总装机」降序；
 *    组内电站按装机容量降序，容量相同按台账 id（即存量发生顺序）兜底；
 *    任何层级都不按名称排序——名称是可改的展示标签，按它排会随改名抖动。
 * 2) 运行状态：以台账工作流 status 为唯一权威值，「运行状态」列只是镜像，
 *    迁移时按 status 回填；自由文本列不参与任何统计。
 */

const STATION_KEY = 'station'
const SNAPSHOT_KEY = 'watershed:snapshot'

export const STATION_STATUS = ['在建', '试运行', '正常运行', '停机检修', '停运'] as const
export type StationStatus = (typeof STATION_STATUS)[number]

// 装机容量单位统一为 MW（兆瓦），与台账「装机容量」列同一口径。
export type CapacityTier = { key: string; label: string; min: number; max: number }
export const CAPACITY_TIERS: CapacityTier[] = [
  { key: 'large', label: '大型（≥300MW）', min: 300, max: Number.POSITIVE_INFINITY },
  { key: 'medium', label: '中型（50–300MW，含50）', min: 50, max: 300 },
  { key: 'small', label: '小型（<50MW）', min: 0, max: 50 },
  { key: 'unknown', label: '容量未登记', min: Number.NaN, max: Number.NaN },
]

export function parseCapacity(row: EntryRow): number | null {
  const raw = Number(row['装机容量'])
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

export function parseUnits(row: EntryRow): number {
  const raw = Number(row['机组台数'])
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0
}

export function tierOf(capacity: number | null): CapacityTier {
  if (capacity === null) {
    return CAPACITY_TIERS[3]
  }
  return CAPACITY_TIERS.find((tier) => Number.isFinite(tier.min) && capacity >= tier.min && capacity < tier.max)!
}

// 权威运行状态：只认工作流 status；出现词表外的脏值时归到「在建」前的未知，不编造状态。
export function stationStatus(row: EntryRow): StationStatus | null {
  const value = String(row.status)
  return (STATION_STATUS as readonly string[]).includes(value) ? (value as StationStatus) : null
}

export const IN_SERVICE_STATUSES: StationStatus[] = ['试运行', '正常运行', '停机检修']
export const STOPPED_STATUS: StationStatus = '停运'
export const BUILDING_STATUS: StationStatus = '在建'

export function isInService(row: EntryRow): boolean {
  const status = stationStatus(row)
  return status !== null && IN_SERVICE_STATUSES.includes(status)
}
export function isStopped(row: EntryRow): boolean {
  return stationStatus(row) === STOPPED_STATUS
}
export function isBuildingWithoutDate(row: EntryRow): boolean {
  return stationStatus(row) === BUILDING_STATUS && String(row['投运日期'] ?? '').trim() === ''
}

export function stationBasin(row: EntryRow): string {
  const value = String(row['所属流域'] ?? '').trim()
  return value === '' ? '未划分流域' : value
}

export function commissionDate(row: EntryRow): string {
  return String(row['投运日期'] ?? '').trim()
}

export function stopReason(row: EntryRow): string {
  return String(row['停运原因'] ?? '').trim()
}

// —— 排序（唯一口径，导出/另存/页面共用，杜绝「两套排布打架」）——

function compareStations(a: EntryRow, b: EntryRow): number {
  const ca = parseCapacity(a)
  const cb = parseCapacity(b)
  // 无投运日期的在建电站一律沉底（先于容量比较）。
  const pendingA = isBuildingWithoutDate(a)
  const pendingB = isBuildingWithoutDate(b)
  if (pendingA !== pendingB) {
    return pendingA ? 1 : -1
  }
  if (ca === null && cb !== null) return 1
  if (ca !== null && cb === null) return -1
  if (ca !== null && cb !== null && ca !== cb) return cb - ca // 容量降序
  // 容量相同（含都未知）→ 台账 id 升序，即存量发生顺序，稳定且与名称无关。
  return Number(a.id) - Number(b.id)
}

export type BasinGroup = {
  basin: string
  stations: EntryRow[]
  totalCapacity: number | null // 全组台账装机合计
  inServiceCapacity: number
  inServiceUnits: number
  totalUnits: number
  inServiceCount: number
  stoppedCount: number
  buildingCount: number
  firstDate: string | null // 组内最早投运日期（组间并列时的稳定兜底）
}

function summarizeGroup(basin: string, rows: EntryRow[]): BasinGroup {
  let totalCapacity: number | null = 0
  let inServiceCapacity = 0
  let inServiceUnits = 0
  let totalUnits = 0
  let inServiceCount = 0
  let stoppedCount = 0
  let buildingCount = 0
  let firstDate: string | null = null
  for (const row of rows) {
    const capacity = parseCapacity(row)
    if (capacity !== null) totalCapacity! += capacity
    else totalCapacity = null
    totalUnits += parseUnits(row)
    if (isInService(row)) {
      inServiceCount += 1
      if (capacity !== null) inServiceCapacity += capacity
      inServiceUnits += parseUnits(row)
    }
    if (isStopped(row)) stoppedCount += 1
    if (stationStatus(row) === BUILDING_STATUS) buildingCount += 1
    const date = commissionDate(row)
    if (date && (firstDate === null || date < firstDate)) firstDate = date
  }
  return {
    basin,
    stations: rows,
    totalCapacity,
    inServiceCapacity,
    inServiceUnits,
    totalUnits,
    inServiceCount,
    stoppedCount,
    buildingCount,
    firstDate,
  }
}

function compareGroups(a: BasinGroup, b: BasinGroup): number {
  // 组间按在运总装机降序（在运口径排除停运与在建，避免「纸面装机」挤上来）。
  if (a.inServiceCapacity !== b.inServiceCapacity) return b.inServiceCapacity - a.inServiceCapacity
  // 并列 → 最早投运日期早的在前；仍并列 → 名称仅作最后确定性兜底（不构成业务排序）。
  if (a.firstDate !== b.firstDate) {
    if (a.firstDate === null) return 1
    if (b.firstDate === null) return -1
    return a.firstDate < b.firstDate ? -1 : 1
  }
  return a.basin.localeCompare(b.basin, 'zh-Hans-CN')
}

export type WatershedFilters = {
  basin: string // '' 表示全部
  tier: string // '' 表示全部
}

export function allStations(): EntryRow[] {
  return listRows(STATION_KEY)
}

export function basinOptions(): string[] {
  return [...new Set(allStations().map(stationBasin))]
}

export function applyFilters(rows: EntryRow[], filters: WatershedFilters): EntryRow[] {
  return rows.filter((row) => {
    if (filters.basin !== '' && stationBasin(row) !== filters.basin) return false
    if (filters.tier !== '' && tierOf(parseCapacity(row)).key !== filters.tier) return false
    return true
  })
}

// 对照视图主函数：先分组（组内按统一口径排序），再按统一口径给组排序。
export function buildBasinGroups(filters: WatershedFilters = { basin: '', tier: '' }): BasinGroup[] {
  const rows = applyFilters(allStations(), filters)
  const map = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const basin = stationBasin(row)
    const list = map.get(basin)
    if (list) list.push(row)
    else map.set(basin, [row])
  }
  const groups = [...map.entries()].map(([basin, list]) =>
    summarizeGroup(basin, [...list].sort(compareStations)),
  )
  return groups.sort(compareGroups)
}

export type WatershedSummary = {
  stationCount: number
  inServiceCount: number
  stoppedCount: number
  buildingCount: number
  totalUnits: number
  inServiceUnits: number
  inServiceCapacity: number
  groups: BasinGroup[]
}

// 汇总条与各页卡片都调它：一处计算，多处展示，台账改了重算即同步。
export function buildWatershedSummary(
  filters: WatershedFilters = { basin: '', tier: '' },
): WatershedSummary {
  const groups = buildBasinGroups(filters)
  const summary: WatershedSummary = {
    stationCount: 0,
    inServiceCount: 0,
    stoppedCount: 0,
    buildingCount: 0,
    totalUnits: 0,
    inServiceUnits: 0,
    inServiceCapacity: 0,
    groups,
  }
  for (const group of groups) {
    summary.stationCount += group.stations.length
    summary.inServiceCount += group.inServiceCount
    summary.stoppedCount += group.stoppedCount
    summary.buildingCount += group.buildingCount
    summary.totalUnits += group.totalUnits
    summary.inServiceUnits += group.inServiceUnits
    summary.inServiceCapacity += group.inServiceCapacity
  }
  return summary
}

// —— 检修待办结论：固定工作票号 + upsert，同一件事反复触发只记一次 ——

export const CONCLUSION_TICKET_NO = 'OH-WATERSHED-CONCLUSION'

// 结论内容由全量统计现算：台账状态变了，重新触发时更新同一条，不新增记录。
export function buildConclusionText(): string {
  const summary = buildWatershedSummary()
  const stopped = allStations().filter(isStopped)
  const building = allStations().filter(isBuildingWithoutDate)
  const lines = [
    `【流域总览结论】全流域在运水电站 ${summary.inServiceCount} 座，在运装机 ${summary.inServiceCapacity.toLocaleString()}MW，在运机组 ${summary.inServiceUnits} 台；停运 ${summary.stoppedCount} 座，在建（无投运日期）${building.length} 座。`,
  ]
  if (stopped.length > 0) {
    lines.push(
      `停运电站：${stopped
        .map((row) => `${row['电站名称']}（${stationBasin(row)}，${stopReason(row) || '原因待补录'}）`)
        .join('；')}。`,
    )
  }
  if (building.length > 0) {
    lines.push(
      `在建电站 ${building.length} 座尚无投运日期，按排布规则沉底展示：${building
        .map((row) => String(row['电站名称']))
        .join('、')}。`,
    )
  }
  return lines.join('')
}

export type ConclusionTodo = {
  ticketNo: string
  status: string
  note: string
  updatedAt: string
  exists: boolean
}

export function readConclusionTodo(): ConclusionTodo | null {
  const row = listRows('overhaul').find((item) => String(item['工作票号']) === CONCLUSION_TICKET_NO)
  if (!row) return null
  return {
    ticketNo: CONCLUSION_TICKET_NO,
    status: String(row.status),
    note: String(row['待办说明'] ?? ''),
    updatedAt: String(row['更新时间'] ?? ''),
    exists: true,
  }
}

// upsert：有则更新说明与时间、无则追加，永远只有票号相同的一条。
export function upsertConclusionTodo(note: string, operator: string): EntryRow {
  requireWatershedWrite()
  const rows = [...listRows('overhaul')]
  const index = rows.findIndex((item) => String(item['工作票号']) === CONCLUSION_TICKET_NO)
  const stamp = new Date().toISOString()
  if (index >= 0) {
    rows[index] = {
      ...rows[index],
      status: '待审批',
      pending: true,
      abnormal: false,
      待办说明: note,
      更新时间: stamp,
      更新人: operator,
    }
    saveRows('overhaul', rows)
    return rows[index]
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const created: EntryRow = {
    id,
    status: '待审批',
    pending: true,
    abnormal: false,
    工作票号: CONCLUSION_TICKET_NO,
    检修机组: '全流域水电站',
    检修级别: '流域总览核查',
    计划工期: '—',
    实际工期: '—',
    工作负责人: operator,
    验收人员: '—',
    检修状态: '待审批',
    待办说明: note,
    更新时间: stamp,
    更新人: operator,
  }
  rows.push(created)
  saveRows('overhaul', rows)
  return created
}

// —— 另存流域分布：冻结快照，两个入口拿到的是同一份 ——

export type WatershedSnapshot = {
  savedAt: string
  savedBy: string
  filters: WatershedFilters
  rowCount: number
  rows: EntryRow[]
  groups: BasinGroup[]
}

export function readSnapshot(): WatershedSnapshot | null {
  return getMeta<WatershedSnapshot | null>(SNAPSHOT_KEY, null)
}

// 另存时把「当前筛选后页面里的座数」整行冻结下来；另一个入口（首页概览）只读这一份。
export function saveSnapshot(
  filters: WatershedFilters,
  operator: string,
): WatershedSnapshot {
  requireWatershedWrite()
  const groups = buildBasinGroups(filters)
  const rows = groups.flatMap((group) => group.stations)
  const snapshot: WatershedSnapshot = {
    savedAt: new Date().toISOString(),
    savedBy: operator,
    filters: { ...filters },
    rowCount: rows.length,
    rows: JSON.parse(JSON.stringify(rows)) as EntryRow[],
    groups: JSON.parse(JSON.stringify(groups)) as BasinGroup[],
  }
  setMeta(SNAPSHOT_KEY, snapshot)
  return snapshot
}

// CSV 行序与页面座数完全一致：直接按分组顺序展开，不另起排序。
const EXPORT_FIELDS = [
  '电站编号', '电站名称', '所属流域', '装机容量', '机组台数', '投运日期', '运行状态', '停运原因',
]

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function snapshotToCsv(snapshot: WatershedSnapshot): { filename: string; content: string } {
  const lines: string[] = [['序号', ...EXPORT_FIELDS].join(',')]
  let index = 1
  for (const group of snapshot.groups) {
    for (const row of group.stations) {
      lines.push(
        [
          index++,
          ...EXPORT_FIELDS.map((field) =>
            csvCell(field === '所属流域' ? group.basin : row[field]),
          ),
        ].join(','),
      )
    }
  }
  const stamp = snapshot.savedAt.slice(0, 10)
  return { filename: `流域分布-${stamp}.csv`, content: `﻿${lines.join('\n')}` }
}

// 直接导出当前页面（不经过快照）时，复用同一分组/排序口径，保证另存与当场导出行数一致。
export function exportCurrentView(filters: WatershedFilters): { filename: string; content: string } {
  const groups = buildBasinGroups(filters)
  const rows = groups.flatMap((group) => group.stations)
  const snapshot: WatershedSnapshot = {
    savedAt: new Date().toISOString(),
    savedBy: '',
    filters: { ...filters },
    rowCount: rows.length,
    rows,
    groups,
  }
  return snapshotToCsv(snapshot)
}
