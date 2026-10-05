<template>
  <div class="compare-wrap">
    <div v-if="showTitle" class="compare-head">
      <h3>电站流域对照</h3>
      <p class="page-desc">
        指标与电站台账、流域总览同一口径：在运=试运行/正常运行/停机检修；在运装机与机组仅统计在运电站。
      </p>
    </div>
    <table class="data-table compare-table">
      <thead>
        <tr>
          <th>所属流域</th>
          <th>电站座数</th>
          <th>在运座数</th>
          <th>在运装机(MW)</th>
          <th>机组台数(总/在运)</th>
          <th>停运</th>
          <th>在建</th>
          <th>最早投运</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="group in summary.groups" :key="group.basin">
          <td>{{ group.basin }}</td>
          <td>{{ group.stations.length }}</td>
          <td>{{ group.inServiceCount }}</td>
          <td>{{ formatCapacity(group.inServiceCapacity) }}</td>
          <td>{{ group.totalUnits }} / {{ group.inServiceUnits }}</td>
          <td>
            <span v-if="group.stoppedCount > 0" class="badge badge-stopped">{{ group.stoppedCount }}</span>
            <span v-else>0</span>
          </td>
          <td>{{ group.buildingCount }}</td>
          <td>{{ group.firstDate ?? '—' }}</td>
        </tr>
        <tr class="compare-total">
          <td>全流域合计</td>
          <td>{{ summary.stationCount }}</td>
          <td>{{ summary.inServiceCount }}</td>
          <td>{{ formatCapacity(summary.inServiceCapacity) }}</td>
          <td>{{ summary.totalUnits }} / {{ summary.inServiceUnits }}</td>
          <td>{{ summary.stoppedCount }}</td>
          <td>{{ summary.buildingCount }}</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { buildWatershedSummary, type WatershedSummary } from '@/api/station-overview'

const props = withDefaults(defineProps<{ showTitle?: boolean }>(), { showTitle: true })
void props

// 全局对照（不受流域页局部筛选影响）：每次进入/手动刷新都从台账重算，保证两处同一份。
const summary = ref<WatershedSummary>(buildWatershedSummary())

function formatCapacity(value: number): string {
  return value.toLocaleString('zh-CN')
}

defineExpose({
  refresh() {
    summary.value = buildWatershedSummary()
  },
})

onMounted(() => {
  summary.value = buildWatershedSummary()
})
</script>
