<template>
  <section class="page" data-module="basin">
    <header class="page-head">
      <div>
        <h2>全流域水电站分布总览</h2>
        <p class="page-desc">
          按所属流域铺开每座水电站，展示装机容量、机组台数、投运日期与运行状态；
          状态与电站台账、首页概览同源，台账改状态这里跟着变。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!canSave" @click="saveSnapshot">
          另存流域分布
        </button>
        <button class="btn" type="button" @click="downloadSnapshot">下载已另存版本</button>
        <button class="btn" type="button" :disabled="!canSave" @click="writeMemo">结论写回检修待办</button>
      </div>
    </header>

    <!-- 汇总条：数字全部由台账行派生，与台账记录保持同步 -->
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">水电站总数</span>
        <strong class="stat-value">{{ summary.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">总装机容量 (MW)</span>
        <strong class="stat-value">{{ formatNumber(summary.capacityTotal) }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">机组总台数</span>
        <strong class="stat-value">{{ summary.unitsTotal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">正常运行</span>
        <strong class="stat-value">{{ summary.inService }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">试运行</span>
        <strong class="stat-value">{{ summary.trial }}</strong>
      </article>
      <article class="stat-card highlight-warn">
        <span class="stat-label">停机检修/停运</span>
        <strong class="stat-value">{{ summary.halted }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">在建</span>
        <strong class="stat-value">{{ summary.building }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">口径：排布以装机容量为准（降序），名称不参与主排序；容量相同时按投运日期、编号兜底</span>
      <span v-if="!canSave" class="legend-item warn">当前岗位「{{ store.roleLabel }}」仅可查看，另存与结论回写归属调度中心</span>
    </p>

    <!-- 收窄条件：流域 + 装机容量档位 -->
    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所属流域</span>
        <select v-model="selectedBasins" multiple class="multi-select" size="3">
          <option v-for="name in basinNames" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
      <div class="filter-item">
        <span>装机容量档位</span>
        <label v-for="tier in tiers" :key="tier.key" class="check-item">
          <input type="checkbox" :value="tier.key" v-model="selectedTiers" />
          {{ tier.label }}
        </label>
      </div>
      <button class="btn" type="submit">收窄</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 按流域铺开 -->
    <div v-for="group in groups" :key="group.basin" class="basin-group">
      <h3 class="basin-title">
        {{ group.basin }}
        <span class="basin-sub">电站 {{ group.rows.length }} 座 · 装机 {{ formatNumber(group.capacityTotal) }} MW · 机组 {{ group.unitsTotal }} 台</span>
      </h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>电站编号</th>
            <th>电站名称</th>
            <th>装机容量(MW)</th>
            <th>装机档位</th>
            <th>机组台数</th>
            <th>投运日期</th>
            <th>运行状态</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="station in group.rows" :key="station.id" :class="{ 'row-halted': station.halted, 'row-building': !station.date }">
            <td>{{ station.code }}</td>
            <td>{{ station.name }}</td>
            <td>{{ station.capacity }}</td>
            <td>{{ station.tier }}</td>
            <td>{{ station.units }}</td>
            <td>{{ station.date || '—' }}</td>
            <td>
              <span class="status-tag" :class="statusClass(station.status)">{{ station.status }}</span>
            </td>
            <td class="note-cell">
              <span v-if="station.halted" class="halt-reason">停运原因：{{ station.reason || '原因待补录' }}</span>
              <span v-else-if="!station.date" class="building-note">在建电站，尚未确定投运日期，排在最后</span>
              <span v-else-if="station.status === '停机检修'" class="overhaul-note">停机检修中</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!groups.length" class="empty-state" style="padding:24px">当前条件下没有匹配的水电站</p>

    <!-- 对照视图：流域页与首页概览取同一份 -->
    <h3 class="section-title">流域指标对照</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>所属流域</th>
          <th>电站数</th>
          <th>装机合计(MW)</th>
          <th>机组合计(台)</th>
          <th>正常运行</th>
          <th>试运行</th>
          <th>停机/停运</th>
          <th>在建</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in comparison" :key="row.basin">
          <td>{{ row.basin }}</td>
          <td>{{ row.stationCount }}</td>
          <td>{{ formatNumber(row.capacityTotal) }}</td>
          <td>{{ row.unitsTotal }}</td>
          <td>{{ row.inService }}</td>
          <td>{{ row.trial }}</td>
          <td>{{ row.halted }}</td>
          <td>{{ row.building }}</td>
        </tr>
        <tr v-if="comparison.length" class="total-row">
          <td>全流域合计</td>
          <td>{{ comparisonTotal.stationCount }}</td>
          <td>{{ formatNumber(comparisonTotal.capacityTotal) }}</td>
          <td>{{ comparisonTotal.unitsTotal }}</td>
          <td>{{ comparisonTotal.inService }}</td>
          <td>{{ comparisonTotal.trial }}</td>
          <td>{{ comparisonTotal.halted }}</td>
          <td>{{ comparisonTotal.building }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 历史投运回填 -->
    <h3 class="section-title">历史投运回填（按投运日期）</h3>
    <table class="data-table">
      <thead>
        <tr><th>投运年份</th><th>当年投运(座)</th><th>新增装机(MW)</th><th>新增机组(台)</th><th>累计装机(MW)</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in backfill" :key="row.year">
          <td>{{ row.year }}</td>
          <td>{{ row.stations }}</td>
          <td>{{ formatNumber(row.newCapacity) }}</td>
          <td>{{ row.newUnits }}</td>
          <td>{{ formatNumber(row.cumulativeCapacity) }}</td>
        </tr>
        <tr v-if="!backfill.length"><td colspan="5" class="empty-state">暂无投运记录</td></tr>
      </tbody>
    </table>

    <!-- 另存状态 -->
    <section class="snapshot-box">
      <h3 class="section-title">已另存的流域分布（另一入口取同一份）</h3>
      <p v-if="!snapshot" class="page-desc">尚未另存。另存后这里显示的座数与文件行数对账一致才可下载。</p>
      <table v-else class="data-table">
        <tbody>
          <tr><td>另存时间</td><td>{{ formatTime(snapshot.savedAt) }}</td></tr>
          <tr><td>页面电站座数</td><td>{{ snapshot.stationCount }}</td></tr>
          <tr><td>文件数据行数</td><td>{{ snapshot.csvRowCount }}（{{ snapshot.stationCount === snapshot.csvRowCount ? '对账一致' : '不一致' }}）</td></tr>
          <tr>
            <td>另存时筛选</td>
            <td>
              流域：{{ snapshot.filter.basins.length ? snapshot.filter.basins.join('、') : '全部' }}；
              档位：{{ snapshot.filter.tiers.length ? snapshot.filter.tiers.join('、') : '全部' }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>当前页面共 {{ visibleCount }} 座水电站；另存行数始终等于当前筛选后的座数</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  basinOptions,
  capacityTierOptions,
  downloadLatestSnapshot,
  latestBasinSnapshot,
  loadBasinComparison,
  loadBasinGroups,
  loadCommissionBackfill,
  loadStationSummary,
  saveBasinSnapshot,
  writeConclusion,
} from '@/api/local-service'
import { onStoreChange } from '@/data/local-store'
import type { BasinSnapshot } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canSave = computed(() => store.isDispatch)

const groups = ref<ReturnType<typeof loadBasinGroups>>([])
const summary = ref(loadStationSummary())
const comparison = ref(loadBasinComparison())
const backfill = ref(loadCommissionBackfill())
const basinNames = ref<string[]>([])
const tiers = capacityTierOptions()
const selectedBasins = ref<string[]>([])
const selectedTiers = ref<string[]>([])
const message = ref('')
const messageOk = ref(false)
const snapshot = ref<BasinSnapshot | null>(null)

const visibleCount = computed(() => groups.value.reduce((sum, group) => sum + group.rows.length, 0))

const comparisonTotal = computed(() =>
  comparison.value.reduce(
    (acc, row) => ({
      ...acc,
      stationCount: acc.stationCount + row.stationCount,
      capacityTotal: acc.capacityTotal + row.capacityTotal,
      unitsTotal: acc.unitsTotal + row.unitsTotal,
      inService: acc.inService + row.inService,
      trial: acc.trial + row.trial,
      halted: acc.halted + row.halted,
      building: acc.building + row.building,
    }),
    { basin: '', stationCount: 0, capacityTotal: 0, unitsTotal: 0, inService: 0, trial: 0, halted: 0, building: 0 },
  ),
)

function reload() {
  basinNames.value = basinOptions()
  groups.value = loadBasinGroups({ basins: selectedBasins.value, tiers: selectedTiers.value })
  summary.value = loadStationSummary()
  comparison.value = loadBasinComparison()
  backfill.value = loadCommissionBackfill()
  snapshot.value = latestBasinSnapshot()
}

function resetFilters() {
  selectedBasins.value = []
  selectedTiers.value = []
  reload()
}

function notify(text: string, ok: boolean) {
  message.value = text
  messageOk.value = ok
}

function saveSnapshot() {
  const result = saveBasinSnapshot({ basins: selectedBasins.value, tiers: selectedTiers.value })
  notify(result.message, result.ok)
  if (result.ok) {
    snapshot.value = latestBasinSnapshot()
  }
}

function downloadSnapshot() {
  const result = downloadLatestSnapshot()
  notify(result.message, result.ok)
}

function writeMemo() {
  const result = writeConclusion()
  notify(result.message, result.ok)
}

function statusClass(status: string): string {
  if (status === '正常运行') return 'tag-ok'
  if (status === '试运行') return 'tag-trial'
  if (status === '停运') return 'tag-halt'
  if (status === '停机检修') return 'tag-overhaul'
  return 'tag-build'
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN')
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN')
}

const unsubscribe = onStoreChange(reload)
onMounted(reload)
onUnmounted(unsubscribe)
</script>

<style scoped>
.basin-group { margin-bottom: 18px; }
.basin-title { font-size: 15px; margin: 14px 0 6px; display: flex; align-items: baseline; gap: 10px; }
.basin-sub { font-size: 12px; color: var(--muted); font-weight: normal; }
.section-title { font-size: 15px; margin: 22px 0 8px; }
.multi-select { min-width: 180px; }
.check-item { display: block; font-size: 13px; margin: 2px 0; }
.status-tag { padding: 2px 10px; border-radius: 999px; font-size: 12px; }
.tag-ok { background: #dcfce7; color: #166534; }
.tag-trial { background: #fef9c3; color: #854d0e; }
.tag-halt { background: #fee2e2; color: #b42318; }
.tag-overhaul { background: #ffedd5; color: #9a3412; }
.tag-build { background: #e2e8f0; color: #475569; }
.row-halted { background: #fff5f5; }
.row-building { background: #fafafa; color: var(--muted); }
.halt-reason { color: #b42318; }
.building-note, .overhaul-note { color: var(--muted); font-size: 12px; }
.highlight-warn { border-color: #fecaca; }
.warn { background: #fee2e2 !important; color: #b42318; }
.total-row td { font-weight: 700; background: #f1f5f9; }
.snapshot-box { margin-top: 8px; }
.ok-text { color: #166534; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.note-cell { max-width: 320px; }
</style>
