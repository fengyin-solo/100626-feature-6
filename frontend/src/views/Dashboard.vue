<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；下方电站流域对照与电站台账、流域总览同源同数。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <RouterLink class="btn" to="/watershed">进入流域总览</RouterLink>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="snapshot-panel">
      <header class="snapshot-head">
        <h3>另存的流域分布</h3>
        <button v-if="snapshot" class="btn" type="button" @click="downloadSnapshot">下载这份分布</button>
      </header>
      <p v-if="!snapshot" class="muted">
        还没有另存记录。请到「电站流域总览」按流域/装机档位收窄后另存；另存后此处与该入口取同一份，行数即当时页面座数。
      </p>
      <table v-else class="data-table">
        <tbody>
          <tr><th>另存时间</th><td>{{ formatTime(snapshot.savedAt) }}</td><th>另存人</th><td>{{ snapshot.savedBy }}</td></tr>
          <tr>
            <th>另存条件</th>
            <td colspan="3">流域：{{ snapshot.filters.basin || '全部' }} ｜ 装机档位：{{ tierLabel(snapshot.filters.tier) }}</td>
          </tr>
          <tr><th>电站座数（行数）</th><td>{{ snapshot.rowCount }}</td><th>流域数</th><td>{{ snapshot.groups.length }}</td></tr>
        </tbody>
      </table>
    </section>

    <WatershedCompare ref="compareRef" />

    <table class="data-table module-table">
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
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview, downloadText } from '@/api/local-service'
import {
  CAPACITY_TIERS,
  readSnapshot,
  snapshotToCsv,
  type WatershedSnapshot,
} from '@/api/station-overview'
import type { OverviewResult } from '@/data/types'
import WatershedCompare from '@/components/WatershedCompare.vue'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const snapshot = ref<WatershedSnapshot | null>(null)
const compareRef = ref<InstanceType<typeof WatershedCompare> | null>(null)

function formatTime(value: string): string {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}

function tierLabel(key: string): string {
  if (!key) return '全部'
  return CAPACITY_TIERS.find((tier) => tier.key === key)?.label ?? key
}

function downloadSnapshot() {
  if (!snapshot.value) return
  const file = snapshotToCsv(snapshot.value)
  downloadText(file.filename, file.content)
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  snapshot.value = readSnapshot()
  compareRef.value?.refresh()
}

onMounted(refresh)
</script>
