import { allRows, getMeta, saveAllRows, setMeta } from './local-store'
import type { EntryRow } from './types'

// 存量数据迁移：所有改动按版本号顺序发生，每个版本只执行一次；
// 早期条目除该版本明确要做的归一化外，其余字段与顺序保持原样。
const META_VERSION = 'station-migration:version'
const META_LOG = 'station-migration:log'
const CURRENT_VERSION = 3

export type MigrationLogEntry = {
  version: number
  at: string
  summary: string
}

// 流域曾用名 → 现行名：只改归属名，其他字段一律不碰。
const BASIN_ALIASES: Record<string, string> = {
  '澜沧江中下游': '澜沧江',
  '瀾滄江': '澜沧江',
  '金沙江下游': '金沙江',
}

const STATION_STATUSES = ['在建', '试运行', '正常运行', '停机检修', '停运']

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// v2 回填：历史投运电站按投运日期由早到晚的发生顺序迁移。
const HISTORICAL_STATIONS: Array<Record<string, string | number>> = [
  {
    电站名称: '葛洲坝水电站', 装机容量: 2715, 机组台数: 21,
    设计水头: '18.6m', 投运日期: '1981-07-30', 所属流域: '长江', 运行状态: '正常运行',
    备注: '历史投运数据按投运日期回填',
  },
  {
    电站名称: '隔河岩水电站', 装机容量: 1212, 机组台数: 4,
    设计水头: '103m', 投运日期: '1994-11-26', 所属流域: '清江', 运行状态: '正常运行',
    备注: '历史投运数据按投运日期回填',
  },
  {
    电站名称: '三峡水电站', 装机容量: 22500, 机组台数: 34,
    设计水头: '113m', 投运日期: '2012-07-04', 所属流域: '长江', 运行状态: '正常运行',
    备注: '历史投运数据按投运日期回填',
  },
]

function toStationRow(data: Record<string, string | number>, id: number): EntryRow {
  const date = String(data['投运日期'])
  return {
    id,
    status: String(data['运行状态']),
    pending: false,
    abnormal: false,
    电站编号: `STAT-${String(id).padStart(4, '0')}`,
    电站名称: data['电站名称'],
    装机容量: data['装机容量'],
    机组台数: data['机组台数'],
    设计水头: data['设计水头'],
    投运日期: date,
    所属流域: data['所属流域'],
    运行状态: data['运行状态'],
    停运原因: '',
    ...(data['备注'] ? { 备注: data['备注'] } : {}),
  }
}

export function runMigrations(): MigrationLogEntry[] {
  const version = getMeta<number>(META_VERSION, 0)
  const log = getMeta<MigrationLogEntry[]>(META_LOG, [])
  if (version >= CURRENT_VERSION) {
    return log
  }

  // 取当前全量（首次进入时含种子数据；老用户则是其 localStorage 里的存量），原地迁移后整体落盘。
  const tables = allRows()
  const stations: EntryRow[] = [...(tables['station'] ?? [])]
  const appended: string[] = []

  if (version < 1) {
    // v1：早期流域归属改过名的，统一成现行名称（只改「所属流域」一个字段）。
    for (const row of stations) {
      const legacy = String(row['所属流域'] ?? '')
      const current = BASIN_ALIASES[legacy]
      if (current) {
        row['所属流域'] = current
      }
    }
    log.push({ version: 1, at: new Date().toISOString(), summary: '流域曾用名按现行名称统一' })
  }

  if (version < 2) {
    // v2：历史投运数据按投运日期回填。回填条目本身已按投运日期由早到晚给出，
    // 即「按发生顺序迁移」；新 id 在存量最大 id 之后顺延，绝不重排早期条目。
    let id = nextId(stations)
    for (const data of HISTORICAL_STATIONS) {
      stations.push(toStationRow(data, id))
      appended.push(String(data['电站名称']))
      id += 1
    }
    log.push({
      version: 2,
      at: new Date().toISOString(),
      summary: `按投运日期回填历史电站 ${appended.join('、')}`,
    })
  }

  if (version < 3) {
    // v3：运行状态只认工作流 status。存量里「运行状态」列缺失/是自由文本的，按 status 回填一致；
    // 「停运原因」列缺失的补空串。装机容量/机组台数非数值的早期脏数据保持原样，由展示层归入「未知」档。
    for (const row of stations) {
      if (STATION_STATUSES.includes(String(row.status))) {
        row['运行状态'] = String(row.status)
      }
      if (row['停运原因'] === undefined) {
        row['停运原因'] = ''
      }
    }
    log.push({ version: 3, at: new Date().toISOString(), summary: '运行状态列按工作流状态回填一致' })
  }

  tables['station'] = stations
  saveAllRows(tables)
  setMeta(META_VERSION, CURRENT_VERSION)
  setMeta(META_LOG, log)
  return log
}

export function migrationLog(): MigrationLogEntry[] {
  return getMeta<MigrationLogEntry[]>(META_LOG, [])
}
