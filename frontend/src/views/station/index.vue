<template>
  <section class="page" data-module="station">
    <header class="page-head">
      <div>
        <h2>电站台账管理</h2>
        <p class="page-desc">维护水电站，围绕电站编号、电站名称、装机容量、机组台数做登记、筛选与状态流转。投运状态在此修改后，流域总览与首页概览的总数同步变化。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水电站</button>
        <button class="btn" type="button" @click="exportRows">导出电站台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="!canEdit" class="perm-note">当前岗位「{{ roleText }}」只有查看权限，状态流转与停运登记仅限调度员。</p>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-stopped': row.status === '停运' }">
          <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
          <td><span :class="['badge', badgeClass(String(row.status))]">{{ row.status }}</span></td>
          <td class="row-actions">
            <template v-for="action in actionList(row)" :key="action">
              <button
                v-if="action === '登记停运'"
                class="link"
                type="button"
                :disabled="!canEdit"
                @click="promptStop(row)"
              >
                {{ action }}
              </button>
              <button
                v-else
                class="link"
                type="button"
                :disabled="!canEdit"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无电站台账数据，可先登记水电站</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条电站台账记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  PermissionDeniedError,
  downloadEntries,
  listEntries,
  moduleMeta,
  registerStationStop,
  runAction as applyAction,
} from '@/api/local-service'
import { buildWatershedSummary } from '@/api/station-overview'
import { roleLabel, useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('station')
const columns = ["电站编号", "电站名称", "装机容量", "机组台数", "设计水头", "投运日期", "所属流域", "运行状态", "停运原因"]
const actions = ["投入试运行", "确认投产", "申请停机", "登记停运", "恢复运行"]
const statuses = ["在建", "试运行", "正常运行", "停机检修", "停运"]

const session = useSessionStore()
const canEdit = computed(() => session.canEditStation)
const roleText = computed(() => roleLabel(session.role))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 汇总卡片直接调领域服务：与流域总览、首页是同一个函数，台账改完 reload 即同步。
// 数据在 localStorage（非响应式），所以用 ref 并在 reload 中重算，不能用 computed 一次缓存。
const stats = ref<{ label: string; value: string | number }[]>([])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 已经是停运态的不再出现「登记停运」，避免同一件事反复触发；其余动作全部给调度员选择。
function actionList(row: EntryRow): string[] {
  return actions.filter((action) => !(action === '登记停运' && String(row.status) === '停运'))
}

function badgeClass(status: string): string {
  if (status === '停运') return 'badge-stopped'
  if (status === '在建') return 'badge-building'
  if (status === '停机检修') return 'badge-overhaul'
  if (status === '试运行') return 'badge-trial'
  return 'badge-running'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水电站登记入口尚未接入审批流'
}

function reportError(error: unknown): void {
  errorMessage.value = error instanceof PermissionDeniedError
    ? error.message
    : error instanceof Error
      ? error.message
      : '操作失败'
}

function promptStop(row: EntryRow) {
  const reason = window.prompt(`请填写「${row['电站名称']}」的停运原因（必填）：`)
  if (reason === null) return
  try {
    const result = registerStationStop(Number(row.id), reason)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    errorMessage.value = result.message
    reload()
  } catch (error) {
    reportError(error)
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  try {
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } catch (error) {
    reportError(error)
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const summary = buildWatershedSummary()
    stats.value = [
      { label: '在运总装机(MW)', value: summary.inServiceCapacity.toLocaleString('zh-CN') },
      { label: '在运电站', value: summary.inServiceCount },
      { label: '停运电站', value: summary.stoppedCount },
      { label: '在建电站', value: summary.buildingCount },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '电站台账列表读取失败'
  }
}

onMounted(reload)
</script>
