import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  resetRows,
  saveRows,
  storageKey,
} from '@/data/local-store'
import {
  CAPACITY_TIERS,
  basinComparison,
  canonBasin,
  capacityMw,
  commissionBackfill,
  commissionDate,
  groupByBasin,
  haltReason,
  isHalted,
  stationOverview,
  tierOf,
  unitCount,
} from '@/data/station-model'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '停运']

// 写操作归属：只有对应归属岗位能改，归属之外的岗位越权一律拒绝，其余人只读。
const MODULE_OWNER: Record<string, string> = {
  station: '台账管理员',
  overhaul: '检修专责',
}

export type RoleInfo = { label: string }

let currentRoleLabel = '调度中心'

/** 会话切换岗位时同步给服务层，服务层据此做最终拦截（不只靠按钮置灰）。 */
export function setCurrentRole(roleLabel: string): void {
  currentRoleLabel = roleLabel
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)

  // 权限口径：归属之外的岗位越权改动直接拒绝，只读岗位任何流转都不受理。
  const owner = MODULE_OWNER[key]
  if (owner && currentRoleLabel !== owner) {
    return { ok: false, message: `${meta.name}归属${owner}，当前岗位「${currentRoleLabel}」无权改动，仅可查看` }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === 'station') {
    // status 是唯一真源，文本镜像列随真源回写，三处取值永远对得上。
    updated['运行状态'] = target
    if (target !== '停运') {
      updated['停运原因'] = ''
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadText(filename, content)
}

function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

/* ------------------------------------------------------------------ */
/* 流域分布：台账行是唯一数据源，以下派生结果在流域页、首页、另存间共用同一份 */
/* ------------------------------------------------------------------ */

export type BasinFilter = {
  basins: string[]
  tiers: string[]
}

export function stationRows(): EntryRow[] {
  return listRows('station')
}

export function basinOptions(): string[] {
  const names = new Set<string>()
  for (const row of stationRows()) {
    names.add(canonBasin(row['所属流域']))
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

export function capacityTierOptions() {
  return CAPACITY_TIERS.map((tier) => ({ key: tier.key, label: tier.label }))
}

/** 流域页主视图：按现行流域名分组 + 统一容量口径过滤排序。 */
export function loadBasinGroups(filter: BasinFilter = { basins: [], tiers: [] }) {
  const rows = stationRows()
  const groups = groupByBasin(rows, filter)
  return groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => ({
      id: row.id,
      code: String(row['电站编号'] ?? ''),
      name: String(row['电站名称'] ?? ''),
      basin: canonBasin(row['所属流域']),
      capacity: capacityMw(row),
      units: unitCount(row),
      date: commissionDate(row),
      status: String(row.status),
      tier: tierOf(capacityMw(row)).label,
      halted: isHalted(row),
      reason: haltReason(row),
    })),
  }))
}

/** 汇总条：与台账记录保持同步的唯一算法入口，概览卡与页面汇总都取它。 */
export function loadStationSummary() {
  return stationOverview(stationRows())
}

/** 对照视图：流域页与首页概览共用同一份指标矩阵。 */
export function loadBasinComparison() {
  return basinComparison(stationRows())
}

/** 历史投运回填：按投运日期逐年补齐累计装机，在建（无日期）不进入。 */
export function loadCommissionBackfill() {
  return commissionBackfill(stationRows())
}

/* ---------------- 另存：单一快照位，行数与页面座数对账 ---------------- */

const SNAPSHOT_KEY = 'hydropower-plant-om:basin-snapshot'

export type BasinSnapshot = {
  savedAt: string
  filter: BasinFilter
  stationCount: number
  csvRowCount: number
  filename: string
  content: string
}

const SNAPSHOT_FIELDS = [
  '所属流域',
  '电站编号',
  '电站名称',
  '装机容量(MW)',
  '机组台数',
  '投运日期',
  '运行状态',
  '装机档位',
  '停运原因',
  '说明',
]

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildSnapshot(filter: BasinFilter): BasinSnapshot {
  const groups = loadBasinGroups(filter)
  const lines: string[] = [SNAPSHOT_FIELDS.map(csvCell).join(',')]
  let stationCount = 0

  for (const group of groups) {
    for (const station of group.rows) {
      stationCount += 1
      let note = ''
      if (station.halted) {
        note = station.reason ? `停运：${station.reason}` : '已停运，原因待补录'
      } else if (!station.date) {
        note = '在建电站，尚未确定投运日期'
      }
      lines.push(
        [
          group.basin,
          station.code,
          station.name,
          station.capacity,
          station.units,
          station.date || '未投运',
          station.status,
          station.tier,
          station.halted ? station.reason : '',
          note,
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }

  const content = `﻿${lines.join('\n')}`
  const csvRowCount = lines.length - 1 // 去掉表头：数据行数必须等于页面座数
  return {
    savedAt: new Date().toISOString(),
    filter,
    stationCount,
    csvRowCount,
    filename: '流域分布总览.csv',
    content,
  }
}

function readSnapshot(): BasinSnapshot | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(SNAPSHOT_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as BasinSnapshot
  } catch {
    return null
  }
}

/**
 * 另存流域分布：只有调度中心可执行。
 * 另存只保留一份（同一件事反复触发只记一次，覆盖更新，不多出记录），
 * 数据行数与页面当前筛选后的座数当场对账，对不上直接报错不写。
 */
export function saveBasinSnapshot(filter: BasinFilter): ActionResult & { snapshot?: BasinSnapshot } {
  if (currentRoleLabel !== '调度中心') {
    return { ok: false, message: `流域分布归属调度中心，当前岗位「${currentRoleLabel}」仅可查看，不能另存` }
  }
  const snapshot = buildSnapshot(filter)
  if (snapshot.csvRowCount !== snapshot.stationCount) {
    return { ok: false, message: `另存对账失败：页面 ${snapshot.stationCount} 座，文件 ${snapshot.csvRowCount} 行，未保存` }
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  }
  return { ok: true, message: `已另存 ${snapshot.stationCount} 座电站（文件 ${snapshot.csvRowCount} 行，对账一致）`, snapshot }
}

/** 另一个入口拿到的也是这一份：读的是同一个快照位。 */
export function latestBasinSnapshot(): BasinSnapshot | null {
  return readSnapshot()
}

export function downloadLatestSnapshot(): ActionResult {
  const snapshot = readSnapshot()
  if (!snapshot) {
    return { ok: false, message: '还没有另存过流域分布，请先在流域总览页另存' }
  }
  downloadText(snapshot.filename, snapshot.content)
  return { ok: true, message: `已下载另存的 ${snapshot.csvRowCount} 行流域分布` }
}

/* -------------- 检修待办结论：两处共用一条，重复触发只记一次 -------------- */

const CONCLUSION_KEY = 'hydropower-plant-om:overhaul-conclusion'

export type ConclusionMemo = {
  key: 'basin-distribution-conclusion'
  text: string
  updatedAt: string
  stationCount: number
  capacityTotal: number
}

export function loadConclusion(): ConclusionMemo | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(CONCLUSION_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as ConclusionMemo
  } catch {
    return null
  }
}

function buildConclusionText(): ConclusionMemo {
  const overview = loadStationSummary()
  const comparison = loadBasinComparison()
  const top = [...comparison].sort((a, b) => b.capacityTotal - a.capacityTotal)[0]
  const lines = [
    `全流域共 ${overview.total} 座水电站，总装机 ${overview.capacityTotal.toLocaleString()} MW、${overview.unitsTotal} 台机组；`,
    `其中正常运行 ${overview.inService} 座、试运行 ${overview.trial} 座、停机检修/停运 ${overview.halted} 座、在建 ${overview.building} 座；`,
    top ? `装机规模最大的为${top.basin}（${top.capacityTotal.toLocaleString()} MW）。` : '',
    '数据与电站台账同源，台账状态变更后本结论同步更新。',
  ]
  return {
    key: 'basin-distribution-conclusion',
    text: lines.filter(Boolean).join(''),
    updatedAt: new Date().toISOString(),
    stationCount: overview.total,
    capacityTotal: overview.capacityTotal,
  }
}

/**
 * 把结论写回机组检修待办：固定一条记录（key 恒定），反复触发只覆盖同一条，
 * 不会多出记录。只有调度中心可写。流域页与检修页看到的是同一份。
 */
export function writeConclusion(): ActionResult & { memo?: ConclusionMemo } {
  if (currentRoleLabel !== '调度中心') {
    return { ok: false, message: `检修待办结论归属调度中心，当前岗位「${currentRoleLabel}」仅可查看，不能回写` }
  }
  const memo = buildConclusionText()
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CONCLUSION_KEY, JSON.stringify(memo))
  }
  return { ok: true, message: '结论已写回机组检修待办（同一条记录，已刷新）', memo }
}

export { storageKey }
