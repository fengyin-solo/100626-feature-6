import { defineStore } from 'pinia'

// 平台岗位：归属之外的岗位只能看不能改，写操作在服务层按岗位拒绝（见 local-service.ts）。
export const ROLES = [
  { key: 'dispatch', label: '调度中心', scope: '流域分布另存、结论待办回写' },
  { key: 'ledger', label: '台账管理员', scope: '电站台账登记与状态流转' },
  { key: 'maintenance', label: '检修专责', scope: '检修工作票流转' },
  { key: 'inspector', label: '巡检员', scope: '只读查看' },
  { key: 'guest', label: '访客', scope: '只读查看' },
] as const

export type RoleKey = (typeof ROLES)[number]['key']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '调度值班员',
    role: 'dispatch' as RoleKey,
    shiftLabel: '白班 08:00-20:00',
    scope: '水电站机组运行检修管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isDispatch: (state) => state.role === 'dispatch',
    isLedger: (state) => state.role === 'ledger',
    roleLabel(state): string {
      return ROLES.find((item) => item.key === state.role)?.label ?? state.role
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: RoleKey) {
      this.role = role
    },
  },
})
