import { defineStore } from 'pinia'

// 岗位口径：流域归属/投运状态/调度结论的写操作归属「调度员」（数据归属岗位）；
// 其余岗位（检修、安全监测、值班）只能查看，越权改动在服务层直接拒绝。
export type RoleKey = 'dispatcher' | 'crew' | 'monitor' | 'duty'

const ROLE_LABELS: Record<RoleKey, string> = {
  dispatcher: '调度员',
  crew: '检修人员',
  monitor: '安全监测',
  duty: '值班员',
}

export const ROLE_OPTIONS: { value: RoleKey; label: string }[] = [
  { value: 'dispatcher', label: ROLE_LABELS.dispatcher },
  { value: 'crew', label: ROLE_LABELS.crew },
  { value: 'monitor', label: ROLE_LABELS.monitor },
  { value: 'duty', label: ROLE_LABELS.duty },
]

export function roleLabel(role: RoleKey): string {
  return ROLE_LABELS[role]
}

// 哪些资源允许改：只列出「归属岗位」拥有写权限的资源；未列出即全员只读。
const WRITABLE_RESOURCES: Record<string, RoleKey[]> = {
  // 电站台账的投运/停运流转、停运原因登记，属于调度运行范畴。
  station: ['dispatcher'],
  // 流域总览的另存、结论写回，是调度中心的动作。
  watershed: ['dispatcher'],
}

export function canWrite(role: RoleKey, resource: string): boolean {
  return WRITABLE_RESOURCES[resource]?.includes(role) ?? false
}

// 越权拒绝单独成类：服务层抛出，页面据此提示「只有查看权限」，与业务校验失败区分开。
// 统一放在这里，避免各模块各定义一份导致 instanceof 对不上。
export class PermissionDeniedError extends Error {}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: 'dispatcher' as RoleKey,
    shiftLabel: '白班 08:00-20:00',
    scope: '水电站机组运行检修管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    canEditStation: (state) => canWrite(state.role, 'station'),
    canEditWatershed: (state) => canWrite(state.role, 'watershed'),
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
