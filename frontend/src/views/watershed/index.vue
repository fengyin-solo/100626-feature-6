<template>
  <section class="page" data-module="watershed">
    <header class="page-head">
      <div>
        <h2>电站流域总览</h2>
        <p class="page-desc">
          全流域水电站按所属流域铺开。排布口径：以流域分组为骨架、装机容量为唯一排序量（组按在运总装机降序，站按装机降序，同容按台账编号兜底；不按名称排序）。
          运行状态只取台账工作流状态，与电站台账、首页概览同源同数。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!canWrite" @click="saveCurrentSnapshot">
          另存流域分布
        </button>
        <button class="btn" type="button" @click="exportCurrent">导出当前分布</button>
        <button class="btn" type="button" :disabled="!canWrite" @click="writeConclusion">
          结论写回检修待办
        </button>
      </div>
    </header>

    <p v-if="!canWrite" class="perm-note">
      当前岗位「{{ roleText }}」只有查看权限，另存与结论写回已禁用；越权改动会被拒绝。
    </p>

    <div class="stat-row">
      <article v-for="item in cards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所属流域</span>
        <select v-model="filters.basin">
          <option value="">全部流域</option>
          <option v-for="basin in basinList" :key="basin" :value="basin">{{ basin }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>装机容量档位</span>
        <select v-model="filters.tier">
          <option value="">全部档位</option>
          <option v-for="tier in tiers" :key="tier.key" :value="tier.key">{{ tier.label }}</option>
        </select>
      </label>
      <button class="btn" type="submit">收窄</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 停运电站单独标出，原因直接来自台账「停运原因」列 -->
    <section v-if="stoppedRows.length" class="stopped-block">
      <h3>停运电站（{{ stoppedRows.length }} 座）</h3>
      <ul class="stopped-list">
        <li v-for="row in stoppedRows" :key="String(row.id)">
          <span class="badge badge-stopped">停运</span>
          <strong>{{ row['电站名称'] }}</strong>
          <span class="muted">{{ stationBasin(row) }} · {{ capacityText(row) }}MW · {{ row['机组台数'] }}台 · 投运 {{ dateText(row) }}</span>
          <em class="stop-reason">停运原因：{{ stopReason(row) || '原因待补录' }}</em>
        </li>
      </ul>
    </section>

    <!-- 对照视图：与首页概览同一个组件、同一个数据源 -->
    <WatershedCompare :show-title="true" ref="compareRef" />

    <section v-for="group in groups" :key="group.basin" class="basin-group">
      <header class="group-head">
        <h3>{{ group.basin }} <span class="muted">（{{ group.stations.length }} 座）</span></h3>
        <span class="muted">
          在运装机 {{ formatCapacity(group.inServiceCapacity) }}MW ·
          机组 {{ group.totalUnits }} 台（在运 {{ group.inServiceUnits }}）·
          停运 {{ group.stoppedCount }} · 在建 {{ group.buildingCount }}
        </span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>电站编号</th>
            <th>电站名称</th>
            <th>装机容量(MW)</th>
            <th>机组台数</th>
            <th>投运日期</th>
            <th>运行状态</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in group.stations" :key="String(row.id)" :class="rowClass(row)">
            <td>{{ row['电站编号'] }}</td>
            <td>{{ row['电站名称'] }}</td>
            <td>{{ capacityText(row) }}</td>
            <td>{{ row['机组台数'] ?? '—' }}</td>
            <td>{{ dateText(row) }}</td>
            <td><span :class="['badge', badgeClass(row)]">{{ statusText(row) }}</span></td>
            <td>
              <span v-if="isStopped(row)" class="stop-reason">{{ stopReason(row) || '停运原因待补录' }}</span>
              <span v-else-if="isBuildingWithoutDate(row)" class="building-note">在建电站，尚未登记投运日期，按规则排到组内最后</span>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-if="buildingNoDate.length" class="building-foot">
      另有 {{ buildingNoDate.length }} 座在建电站尚无投运日期，已统一排到各组最后：
      {{ buildingNoDate.map((row) => String(row['电站名称'])).join('、') }}
    </p>

    <section v-if="todo" class="todo-block">
      <h3>检修待办中的流域结论 <span class="badge badge-todo">{{ todo.status }}</span></h3>
      <p class="todo-note">{{ todo.note }}</p>
      <p class="muted">工作票号 {{ todo.ticketNo }} · 最近更新 {{ formatTime(todo.updatedAt) }}</p>
    </section>

    <footer class="page-foot">
      <span>当前筛选共 {{ groups.reduce((sum, group) => sum + group.stations.length, 0) }} 座；另存/导出的行数与此一致</span>
      <span v-if="snapshot" class="muted">
        已另存 {{ snapshot.rowCount }} 座（{{ formatTime(snapshot.savedAt) }}，{{ snapshot.savedBy }}），首页概览取同一份
      </span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  PermissionDeniedError,
  buildConclusionText,
  buildWatershedSummary,
  basinOptions,
  CAPACITY_TIERS,
  commissionDate,
  exportCurrentView,
  isBuildingWithoutDate,
  isStopped,
  parseCapacity,
  readConclusionTodo,
  readSnapshot,
  saveSnapshot,
  stationBasin,
  stationStatus,
  stopReason,
  upsertConclusionTodo,
  type BasinGroup,
  type WatershedFilters,
  type WatershedSnapshot,
  type ConclusionTodo,
} from '@/api/station-overview'
import { allStations } from '@/api/station-overview'
import { downloadText } from '@/api/local-service'
import { roleLabel, useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import WatershedCompare from '@/components/WatershedCompare.vue'

const session = useSessionStore()
const canWrite = computed(() => session.canEditWatershed)
const roleText = computed(() => roleLabel(session.role))

const filters = ref<WatershedFilters>({ basin: '', tier: '' })
const basinList = ref<string[]>([])
const tiers = CAPACITY_TIERS
const groups = ref<BasinGroup[]>([])
const snapshot = ref<WatershedSnapshot | null>(null)
const todo = ref<ConclusionTodo | null>(null)
const message = ref('')
const messageOk = ref(false)
const compareRef = ref<InstanceType<typeof WatershedCompare> | null>(null)

const cards = ref<{ label: string; value: string | number }[]>([])

// 停运/在建标注基于全量台账，不受筛选影响：收窄时也不能把停运电站藏没。
const stoppedRows = ref<EntryRow[]>([])
const buildingNoDate = ref<EntryRow[]>([])

function formatCapacity(value: number): string {
  return value.toLocaleString('zh-CN')
}
function formatTime(value: string): string {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}
function capacityText(row: EntryRow): string {
  const capacity = parseCapacity(row)
  return capacity === null ? '未登记' : formatCapacity(capacity)
}
function dateText(row: EntryRow): string {
  return commissionDate(row) || '—'
}
function statusText(row: EntryRow): string {
  return stationStatus(row) ?? '状态异常'
}
function rowClass(row: EntryRow): Record<string, boolean> {
  return {
    'row-stopped': isStopped(row),
    'row-building': isBuildingWithoutDate(row),
  }
}
function badgeClass(row: EntryRow): string {
  const status = stationStatus(row)
  if (status === '停运') return 'badge-stopped'
  if (status === '在建') return 'badge-building'
  if (status === '停机检修') return 'badge-overhaul'
  if (status === '试运行') return 'badge-trial'
  return 'badge-running'
}

function resetFilters() {
  filters.value = { basin: '', tier: '' }
  reload()
}

function reload() {
  message.value = ''
  basinList.value = basinOptions()
  groups.value = buildWatershedSummary(filters.value).groups
  // 数据在 localStorage，不是 Vue 响应式：每次进入/操作后显式重算，确保汇总与台账同步。
  const summary = buildWatershedSummary()
  cards.value = [
    { label: '水电站总数', value: summary.stationCount },
    { label: '在运电站', value: summary.inServiceCount },
    { label: '在运总装机(MW)', value: formatCapacity(summary.inServiceCapacity) },
    { label: '在运机组(台)', value: summary.inServiceUnits },
    { label: '停运电站', value: summary.stoppedCount },
  ]
  stoppedRows.value = allStations().filter(isStopped)
  buildingNoDate.value = allStations().filter(isBuildingWithoutDate)
  snapshot.value = readSnapshot()
  todo.value = readConclusionTodo()
  compareRef.value?.refresh()
}

function handleError(error: unknown): void {
  messageOk.value = false
  message.value = error instanceof PermissionDeniedError
    ? error.message
    : error instanceof Error
      ? error.message
      : '操作失败'
}

function saveCurrentSnapshot() {
  try {
    snapshot.value = saveSnapshot(filters.value, session.operator)
    messageOk.value = true
    message.value = `已另存 ${snapshot.value.rowCount} 座，与当前页面座数一致；首页概览入口取这一份`
  } catch (error) {
    handleError(error)
  }
}

function exportCurrent() {
  const file = exportCurrentView(filters.value)
  downloadText(file.filename, file.content)
  const count = groups.value.reduce((sum, group) => sum + group.stations.length, 0)
  messageOk.value = true
  message.value = `导出 ${count} 座，行序与页面排布一致`
}

function writeConclusion() {
  try {
    upsertConclusionTodo(buildConclusionText(), session.operator)
    todo.value = readConclusionTodo()
    messageOk.value = true
    message.value = '结论已写回机组检修待办（同一票号，反复触发也只保留一条并更新时间）'
  } catch (error) {
    handleError(error)
  }
}

onMounted(reload)
</script>
