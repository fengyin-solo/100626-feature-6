<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标；流域电站指标与电站台账、流域总览同源，只有一份。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <button class="btn" type="button" @click="openSnapshot">下载另存的流域分布</button>
      </div>
    </header>

    <!-- 全流域电站汇总：与流域总览、台账同源 -->
    <h3 class="block-title">全流域电站汇总</h3>
    <div class="stat-row">
      <article v-for="card in stationCards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.text ?? card.value }}</strong>
      </article>
    </div>

    <!-- 流域指标对照：与流域总览页取同一份 -->
    <h3 class="block-title">流域指标对照</h3>
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
      </tbody>
    </table>

    <!-- 历史投运回填 -->
    <h3 class="block-title">历史投运回填</h3>
    <table class="data-table">
      <thead>
        <tr><th>投运年份</th><th>当年投运(座)</th><th>新增装机(MW)</th><th>累计装机(MW)</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in backfill" :key="row.year">
          <td>{{ row.year }}</td>
          <td>{{ row.stations }}</td>
          <td>{{ formatNumber(row.newCapacity) }}</td>
          <td>{{ formatNumber(row.cumulativeCapacity) }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="block-title">各业务模块</h3>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <section v-if="snapshot" class="snapshot-note">
      已另存流域分布：{{ formatTime(snapshot.savedAt) }} · 电站 {{ snapshot.stationCount }} 座 · 文件 {{ snapshot.csvRowCount }} 行
      （{{ snapshot.stationCount === snapshot.csvRowCount ? '对账一致' : '不一致' }}）
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadLatestSnapshot,
  latestBasinSnapshot,
  loadBasinComparison,
  loadCommissionBackfill,
  loadOverview,
  loadStationSummary,
} from '@/api/local-service'
import type { BasinSnapshot } from '@/api/local-service'
import { onStoreChange } from '@/data/local-store'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const summary = ref(loadStationSummary())
const comparison = ref(loadBasinComparison())
const backfill = ref(loadCommissionBackfill())
const snapshot = ref<BasinSnapshot | null>(null)
const message = ref('')
const messageOk = ref(false)

const stationCards = computed(() => [
  { label: '水电站总数', value: summary.value.total },
  { label: '总装机容量(MW)', value: summary.value.capacityTotal, text: summary.value.capacityTotal.toLocaleString('zh-CN') },
  { label: '机组总台数', value: summary.value.unitsTotal },
  { label: '正常运行', value: summary.value.inService },
  { label: '试运行', value: summary.value.trial },
  { label: '停机检修/停运', value: summary.value.halted },
  { label: '在建', value: summary.value.building },
])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  summary.value = loadStationSummary()
  comparison.value = loadBasinComparison()
  backfill.value = loadCommissionBackfill()
  snapshot.value = latestBasinSnapshot()
}

function openSnapshot() {
  const result = downloadLatestSnapshot()
  message.value = result.message
  messageOk.value = result.ok
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN')
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN')
}

const unsubscribe = onStoreChange(refresh)
onMounted(refresh)
onUnmounted(unsubscribe)
</script>

<style scoped>
.block-title { font-size: 15px; margin: 18px 0 8px; }
.snapshot-note { margin-top: 14px; font-size: 13px; color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 8px 12px; }
.ok-text { color: #166534; }
</style>
