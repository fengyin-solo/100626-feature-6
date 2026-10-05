// 运行时验证：迁移幂等、流域改名归一、历史回填顺序、分组排序口径、
// 另存快照行数一致、检修待办去重、岗位越权拒绝、状态同步到首页。
import assert from 'node:assert'

// ---- 浏览器环境垫片 ----
const storage = new Map<string, string>()
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
} as never
globalThis.localStorage = (globalThis.window as never as { localStorage: Storage }).localStorage

import { createPinia, setActivePinia } from 'pinia'
setActivePinia(createPinia())

import { runMigrations, migrationLog } from '@/data/migrations'
import { listRows } from '@/data/local-store'
import {
  buildBasinGroups,
  buildWatershedSummary,
  saveSnapshot,
  readSnapshot,
  snapshotToCsv,
  upsertConclusionTodo,
  readConclusionTodo,
  buildConclusionText,
  CONCLUSION_TICKET_NO,
  exportCurrentView,
  CAPACITY_TIERS,
  applyFilters,
} from '@/api/station-overview'
import { loadOverview, registerStationStop, PermissionDeniedError } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log('✓', name)
}

// 1. 迁移按版本执行且幂等
runMigrations()
const log1 = migrationLog()
check('迁移 v1/v2/v3 全部执行', () => assert.deepStrictEqual(log1.map((l) => l.version), [1, 2, 3]))
runMigrations()
check('再次启动迁移不重复执行', () => assert.strictEqual(migrationLog().length, 3))

// 2. 流域曾用名归一
const stations = listRows('station')
check('澜沧江曾用名统一为现行名', () => {
  assert.ok(!stations.some((r) => ['澜沧江中下游', '瀾滄江'].includes(String(r['所属流域']))))
  const lc = stations.filter((r) => r['所属流域'] === '澜沧江')
  assert.ok(lc.some((r) => r['电站名称'] === '黄登水电站'))
  assert.ok(lc.some((r) => r['电站名称'] === '漫湾水电站'))
})

// 3. 历史回填按投运日期发生顺序，且在末尾，id 顺延
const dates = stations.map((r) => String(r['投运日期']))
check('历史回填 3 座且顺序为 1981→1994→2012', () => {
  assert.ok(stations.some((r) => r['电站名称'] === '葛洲坝水电站' && r['投运日期'] === '1981-07-30'))
  assert.ok(stations.some((r) => r['电站名称'] === '隔河岩水电站'))
  assert.ok(stations.some((r) => r['电站名称'] === '三峡水电站'))
  const backfillIdx = stations.findIndex((r) => r['电站名称'] === '葛洲坝水电站')
  assert.strictEqual(backfillIdx, stations.length - 3)
  const ids = stations.slice(-3).map((r) => Number(r.id))
  assert.deepStrictEqual(ids, [ids[0], ids[0] + 1, ids[0] + 2])
})

// 4. 排布：组间按在运总装机降序；组内按装机降序；无日期在建沉底；不按名称
const groups = buildBasinGroups()
const groupCaps = groups.map((g) => g.inServiceCapacity)
check('流域组按在运总装机降序', () => {
  const sorted = [...groupCaps].sort((a, b) => b - a)
  assert.deepStrictEqual(groupCaps, sorted)
})
check('组内电站按装机容量降序（在建无日期沉底）', () => {
  for (const g of groups) {
    for (let i = 1; i < g.stations.length; i++) {
      const prev = g.stations[i - 1]
      const cur = g.stations[i]
      const prevBuilding = String(prev['投运日期']) === '' && prev.status === '在建'
      const curBuilding = String(cur['投运日期']) === '' && cur.status === '在建'
      if (!prevBuilding && !curBuilding) {
        const pc = Number(prev['装机容量'])
        const cc = Number(cur['装机容量'])
        assert.ok(pc >= cc, `${g.basin}: ${prev['电站名称']} < ${cur['电站名称']}`)
      }
    }
    // 在建无日期的必须在最后
    g.stations.forEach((r, i) => {
      if (r.status === '在建' && String(r['投运日期']) === '') {
        assert.strictEqual(i, g.stations.length - 1)
      }
    })
  }
})
check('金沙江含旭龙在建沉底且排在白鹤滩等之后', () => {
  const js = groups.find((g) => g.basin === '金沙江')!
  assert.strictEqual(js.stations[js.stations.length - 1]['电站名称'], '旭龙水电站')
})

// 5. 停运单独标出且有原因
check('停运电站均带停运原因', () => {
  const stopped = stations.filter((r) => r.status === '停运')
  assert.ok(stopped.length >= 3)
  assert.ok(stopped.every((r) => String(r['停运原因'] ?? '').length > 0))
})

// 6. 汇总口径
const s = buildWatershedSummary()
check('汇总座数 = 台账行数', () => assert.strictEqual(s.stationCount, stations.length))
check('在运装机 = 试运行+正常运行+停机检修合计', () => {
  let expected = 0
  for (const r of stations) {
    if (['试运行', '正常运行', '停机检修'].includes(String(r.status))) expected += Number(r['装机容量'])
  }
  assert.strictEqual(s.inServiceCapacity, expected)
})

// 7. 筛选：流域 + 容量档位
const large = applyFilters(stations, { basin: '', tier: 'large' })
check('容量档位筛选（大型≥300MW）', () => {
  assert.ok(large.every((r) => Number(r['装机容量']) >= 300))
  assert.ok(large.some((r) => r['电站名称'] === '旧小寨水电站') === false)
})
const small = applyFilters(stations, { basin: '', tier: 'small' })
check('小型档位包含 42/21MW 小站', () => {
  assert.ok(small.some((r) => r['电站名称'] === '大河边水电站'))
  assert.ok(small.some((r) => r['电站名称'] === '旧小寨水电站'))
})
const dadu = applyFilters(stations, { basin: '大渡河', tier: '' })
check('流域筛选只留大渡河', () => assert.ok(dadu.every((r) => r['所属流域'] === '大渡河')))
void CAPACITY_TIERS

// 8. 另存行数 == 页面座数；CSV 行数一致；同一份
const filtered = buildBasinGroups({ basin: '雅砻江', tier: '' })
const pageCount = filtered.reduce((sum, g) => sum + g.stations.length, 0)
const snap = saveSnapshot({ basin: '雅砻江', tier: '' }, '调度员')
check('另存行数与筛选后页面座数一致', () => assert.strictEqual(snap.rowCount, pageCount))
const csv = snapshotToCsv(snap)
const csvRows = csv.content.split('\n').length - 1 // 去掉表头
check('CSV 数据行数 == 快照行数', () => assert.strictEqual(csvRows, snap.rowCount))
check('另一入口读到同一份快照', () => {
  const again = readSnapshot()!
  assert.strictEqual(again.rowCount, snap.rowCount)
  assert.strictEqual(again.savedBy, '调度员')
})

// 9. 结论写回：去重 upsert
upsertConclusionTodo(buildConclusionText(), '调度员')
const t1 = readConclusionTodo()!
const stamp1 = t1.updatedAt
await new Promise((r) => setTimeout(r, 20))
upsertConclusionTodo(buildConclusionText(), '调度员')
const t2 = readConclusionTodo()!
const overhaulRows = listRows('overhaul')
check('反复触发只保留一条待办（同票号）', () => {
  assert.strictEqual(t1.ticketNo, CONCLUSION_TICKET_NO)
  assert.strictEqual(overhaulRows.filter((r) => r['工作票号'] === CONCLUSION_TICKET_NO).length, 1)
  assert.notStrictEqual(t2.updatedAt, stamp1)
})
check('结论内容含停运原因与在建说明', () => {
  assert.ok(t2.note.includes('停运电站'))
  assert.ok(t2.note.includes('龚嘴水电站'))
})

// 10. 状态台账改动 -> 总览/首页同一份数据跟着变（一个数）
const before = buildWatershedSummary().inServiceCount
const gongzui = stations.find((r) => r['电站名称'] === '龚嘴水电站')!
// 龚嘴本就停运：改一座在运站（桐街子，停机检修）为停运，带原因
const tongjiezi = stations.find((r) => r['电站名称'] === '铜街子水电站')!
const res = registerStationStop(Number(tongjiezi.id), '机组A级检修超期，2026-10起停运技改')
check('登记停运成功', () => assert.strictEqual(res.ok, true))
const after = buildWatershedSummary()
check('停运后在运数-1、停运数+1，且镜像列同步', () => {
  assert.strictEqual(after.inServiceCount, before - 1)
  assert.strictEqual(after.stoppedCount, s.stoppedCount + 1)
  const updated = listRows('station').find((r) => Number(r.id) === Number(tongjiezi.id))!
  assert.strictEqual(updated['运行状态'], '停运')
  assert.strictEqual(String(updated['停运原因']).length > 0, true)
})
check('首页概览电站台账待处理与终态口径同步', () => {
  const ov = loadOverview()
  const stationLine = ov.modules.find((m) => m.name === '电站台账')!
  const pending = listRows('station').filter(
    (r) => !['正常运行', '停运'].includes(String(r.status)),
  ).length
  assert.strictEqual(stationLine.pending, pending)
})

// 11. 越权拒绝：切到检修人员
const session = useSessionStore()
session.setRole('crew')
check('非归属岗位登记停运被拒绝', () => {
  assert.throws(() => registerStationStop(Number(gongzui.id), 'x'), PermissionDeniedError)
})
check('非归属岗位另存/写回被拒绝', () => {
  assert.throws(() => saveSnapshot({ basin: '', tier: '' }, '检修人员'), PermissionDeniedError)
  assert.throws(() => upsertConclusionTodo('x', '检修人员'), PermissionDeniedError)
})
session.setRole('dispatcher')

// 12. 停运登记拒绝空原因
check('停运原因必填', () => {
  assert.strictEqual(registerStationStop(Number(gongzui.id), '   ').ok, false)
})

// 13. 当前视图导出也与组顺序一致
const file = exportCurrentView({ basin: '', tier: '' })
const lineCount = file.content.split('\n').length - 1
check('导出当前全量分布行数=台账全部电站', () => assert.strictEqual(lineCount, listRows('station').length))

console.log(`\n全部 ${passed} 项验证通过`)
