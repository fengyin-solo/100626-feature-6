import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { canWrite, PermissionDeniedError, useSessionStore } from '@/stores/session'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 越权拒绝类型统一在 session 模块定义，这里转出给页面统一识别。
export { PermissionDeniedError }

function requireWrite(key: string): void {
  const store = useSessionStore()
  if (!canWrite(store.role, key)) {
    throw new PermissionDeniedError('当前岗位只有查看权限：归属岗位之外的改动已拒绝，请联系调度员处理')
  }
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

function terminalStatuses(meta: ModuleMeta): string[] {
  return meta.terminalStatuses ?? [meta.statuses[meta.statuses.length - 1]]
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  requireWrite(key)
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
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !terminalStatuses(meta).includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 电站台账：「运行状态」列永远镜像工作流状态，统计只认 status，不产生第二个数。
  if (key === 'station') {
    updated['运行状态'] = target
    // 非停运态不应挂着停运原因，恢复/转其他状态时清掉。
    if (target !== '停运') {
      updated['停运原因'] = ''
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 登记停运必须写明原因：走专用入口，原因落进台账「停运原因」列，流域总览据此单独标出。
export function registerStationStop(id: number, reason: string): ActionResult {
  const trimmed = reason.trim()
  if (trimmed === '') {
    return { ok: false, message: '停运电站必须写明停运原因' }
  }
  const meta = moduleMeta('station')
  requireWrite(meta.key)
  const rows = listRows(meta.key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的水电站` }
  }
  const next = [...rows]
  next[index] = {
    ...rows[index],
    status: '停运',
    pending: false,
    abnormal: false,
    运行状态: '停运',
    停运原因: trimmed,
  }
  saveRows(meta.key, next)
  return { ok: true, message: `水电站已登记停运并记录原因：${trimmed}` }
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

export function downloadText(filename: string, content: string): void {
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

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadText(filename, content)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    const terminals = terminalStatuses(meta)
    return {
      name: meta.name,
      created: entries.length,
      // 汇总条与台账保持同步：直接按当前台账状态 + 终态白名单重算，不缓存旧数。
      pending: entries.filter((row) => row.pending || !terminals.includes(String(row.status))).length,
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
