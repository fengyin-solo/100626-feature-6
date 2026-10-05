<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水电站机组运行检修管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向电站台账、机组运行、调速励磁、主变与闸门、大坝渗流位移监测、机组检修与发电计划的一体化水电站运行检修管理平台。</span>
        <span class="head-user">
          当前值班：{{ store.operator }} · {{ store.shiftLabel }}
          <label class="role-switch">
            岗位
            <select :value="store.role" @change="changeRole">
              <option v-for="role in roles" :key="role.key" :value="role.key">
                {{ role.label }}（{{ role.scope }}）
              </option>
            </select>
          </label>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { watchEffect } from 'vue'

import { ROLES, useSessionStore } from '@/stores/session'
import { setCurrentRole } from '@/api/local-service'

const store = useSessionStore()
const roles = ROLES

// 岗位切换后立即同步到服务层，越权写操作在服务层直接拒绝。
watchEffect(() => setCurrentRole(store.roleLabel))

function changeRole(event: Event) {
  store.setRole((event.target as HTMLSelectElement).value as typeof store.role)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "流域分布总览", path: "/basin" }, { label: "电站台账", path: "/station" }, { label: "机组运行", path: "/unit" }, { label: "调速器", path: "/governor" }, { label: "励磁系统", path: "/excitation" }, { label: "主变压器", path: "/transformer" }, { label: "闸门启闭", path: "/gate" }, { label: "渗流监测", path: "/seepage" }, { label: "位移监测", path: "/displacement" }, { label: "拦污栅", path: "/trashrack" }, { label: "机组检修", path: "/overhaul" }, { label: "导轴承", path: "/bearing" }, { label: "技术供水", path: "/cooling" }, { label: "水情调度", path: "/hydrology" }, { label: "泄洪操作", path: "/flood" }, { label: "发电计划", path: "/generation" }, { label: "继电保护", path: "/protection" }, { label: "缺陷处置", path: "/defect" }, { label: "检修人员", path: "/crew" }, { label: "备品备件", path: "/spare" }]
</script>
