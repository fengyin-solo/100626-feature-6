<template>
  <section class="page" data-module="station">
    <header class="page-head">
      <div>
        <h2>电站台账管理</h2>
        <p class="page-desc">维护水电站，围绕电站编号、电站名称、装机容量、机组台数做登记、筛选与状态流转。台账状态是全平台唯一真源。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水电站</button>
        <button class="btn" type="button" @click="exportRows">导出电站台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.text ?? item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span v-if="!store.isLedger" class="legend-item warn">当前岗位「{{ store.roleLabel }}」仅可查看，状态流转归属台账管理员</span>
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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-halted': row.status === '停运' }">
          <td v-for="column in columns" :key="column">{{ formatCell(row, column) }}</td>
          <td>
            <span class="status-tag" :class="statusClass(String(row.status))">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!store.isLedger"
              :title="store.isLedger ? '' : '仅台账管理员可操作'"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
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
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  loadStationSummary,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { onStoreChange } from '@/data/local-store'
import { STATION_STATUSES } from '@/data/station-model'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('station')
const columns = ["电站编号", "电站名称", "装机容量", "机组台数", "设计水头", "投运日期", "所属流域", "停运原因"]
const actions = ["投入试运行", "确认投产", "申请停机", "办理停运"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["电站编号", "电站名称", "所属流域"]
const summary = ref(loadStationSummary())

// 汇总条直接取同源派生口径，台账状态一改，这里与首页、流域页同时变。
const stats = computed(() => [
  { label: '总装机容量(MW)', value: summary.value.capacityTotal, text: summary.value.capacityTotal.toLocaleString('zh-CN') },
  { label: '正常运行电站', value: summary.value.inService },
  { label: '停运电站', value: summary.value.halted },
])

const statusSummary = computed(() =>
  STATION_STATUSES.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function formatCell(row: EntryRow, column: string): string {
  if (column === '停运原因') {
    return String(row.status) === '停运' ? String(row[column] ?? '原因待补录') : '—'
  }
  if (column === '投运日期') {
    return String(row[column] ?? '') || '—'
  }
  return String(row[column] ?? '—')
}

function statusClass(status: string): string {
  if (status === '正常运行') return 'tag-ok'
  if (status === '试运行') return 'tag-trial'
  if (status === '停运') return 'tag-halt'
  if (status === '停机检修') return 'tag-overhaul'
  return 'tag-build'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  if (!store.isLedger) {
    errorMessage.value = '电站台账归属台账管理员，当前岗位仅可查看'
    return
  }
  errorMessage.value = '水电站登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    summary.value = loadStationSummary()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '电站台账列表读取失败'
  }
}

const unsubscribe = onStoreChange(reload)
onMounted(reload)
onUnmounted(unsubscribe)
</script>

<style scoped>
.status-tag { padding: 2px 10px; border-radius: 999px; font-size: 12px; }
.tag-ok { background: #dcfce7; color: #166534; }
.tag-trial { background: #fef9c3; color: #854d0e; }
.tag-halt { background: #fee2e2; color: #b42318; }
.tag-overhaul { background: #ffedd5; color: #9a3412; }
.tag-build { background: #e2e8f0; color: #475569; }
.row-halted { background: #fff5f5; }
.warn { background: #fee2e2 !important; color: #b42318; }
.link:disabled { color: #94a3b8; cursor: not-allowed; }
</style>
