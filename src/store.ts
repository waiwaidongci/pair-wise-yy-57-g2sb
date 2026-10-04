import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { ExecutionRecord, TestCase, TestStep } from './types'
import { seedCases, seedExecutions, equipmentChanges as seedEquipmentChanges, routeSnapshots as seedRouteSnapshots } from './mock'
import { reconcile, dedupeRequests, latestSnapshot, type EquipmentChange, type ReconcileReport, type RouteSnapshot } from './reconcile'

const STORAGE_KEY = 'yy57-interlocking-draft-v1'

function currentTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false })
}

export const useTestStore = defineStore('interlocking', () => {
  // 基线数据（锁定后只读）
  const cases = ref<TestCase[]>(structuredClone(seedCases))
  const executions = ref<ExecutionRecord[]>(structuredClone(seedExecutions))
  // 设备变更与进路关系（按生效时段）
  const equipmentChanges = ref<EquipmentChange[]>(structuredClone(seedEquipmentChanges))
  const routeSnapshots = ref<RouteSnapshot[]>(structuredClone(seedRouteSnapshots))
  // 候选版本：基线锁定后的改动只进入候选，不触碰基线
  const candidateCases = ref<TestCase[] | null>(null)
  const candidateExecutions = ref<ExecutionRecord[] | null>(null)
  const candidateVersion = ref<string | null>(null)
  // 对账与批次状态
  const reconcileReport = ref<ReconcileReport | null>(null)
  const batchStatus = ref<'idle' | 'committed' | 'rolled-back'>('idle')
  const lastBatchError = ref<string | null>(null)

  const selectedCaseId = ref('TC-102')
  const selectedRouteIds = ref<string[]>(['R-02'])
  const baselineLocked = ref(false)
  const connection = ref<'在线' | '重连中'>('在线')
  const pendingRetry = ref(0)
  const liveMessage = ref('执行进度已同步')

  /** 活动分支：锁定后有候选则用候选，否则用基线 */
  const activeCases = computed(() => candidateCases.value ?? cases.value)
  const activeExecutions = computed(() => candidateExecutions.value ?? executions.value)
  const isCandidate = computed(() => candidateCases.value !== null)

  const selectedCase = computed(() => activeCases.value.find((item) => item.id === selectedCaseId.value))
  const progress = computed(() => {
    const steps = activeCases.value.flatMap((item) => item.steps)
    return Math.round(steps.filter((step) => step.result !== '未执行').length / steps.length * 100)
  })

  /** 受影响用例：关联当前进路关系中含变更设备的进路 */
  const affectedCases = computed(() => {
    const changedDeviceIds = new Set(equipmentChanges.value.filter((c) => !c.revoked).map((c) => c.deviceId))
    return activeCases.value.filter((item) =>
      item.routeIds.some((routeId) => latestSnapshot(routeSnapshots.value, routeId).devices.some((d) => changedDeviceIds.has(d))),
    )
  })

  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify({ cases: cases.value, executions: executions.value })) }
  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const draft = JSON.parse(raw)
      cases.value = draft.cases
      executions.value = draft.executions
    }
  }
  function selectCase(id: string) {
    selectedCaseId.value = id
    selectedRouteIds.value = activeCases.value.find((item) => item.id === id)?.routeIds ?? []
  }

  /** 锁定基线后，首次改动时克隆出候选版本 */
  function ensureCandidate() {
    if (!baselineLocked.value || isCandidate.value) return
    candidateCases.value = structuredClone(cases.value)
    candidateExecutions.value = structuredClone(executions.value)
    candidateVersion.value = 'v26.10-cand.1'
  }

  /**
   * 批次写入：先在 draft 上执行全部写入，成功才提交；任一失败按完整批次恢复。
   * 锁定基线后写入只进入候选版本。
   */
  function commitBatch(writes: Array<(draft: { cases: TestCase[]; executions: ExecutionRecord[] }) => void>): boolean {
    ensureCandidate()
    const draft = { cases: structuredClone(activeCases.value), executions: structuredClone(activeExecutions.value) }
    const snapCases = structuredClone(draft.cases)
    const snapExecs = structuredClone(draft.executions)
    try {
      for (const w of writes) w(draft)
      if (isCandidate.value) { candidateCases.value = draft.cases; candidateExecutions.value = draft.executions }
      else { cases.value = draft.cases; executions.value = draft.executions }
      batchStatus.value = 'committed'
      lastBatchError.value = null
      persist()
      return true
    } catch (e) {
      // 完整批次恢复：丢弃 draft，回到批次前快照
      if (isCandidate.value) { candidateCases.value = snapCases; candidateExecutions.value = snapExecs }
      else { cases.value = snapCases; executions.value = snapExecs }
      batchStatus.value = 'rolled-back'
      lastBatchError.value = e instanceof Error ? e.message : String(e)
      liveMessage.value = lastBatchError.value || '批次写入失败，已按完整批次恢复'
      return false
    }
  }

  function setStepResult(caseId: string, stepId: string, result: TestStep['result'], actual?: string) {
    const ok = commitBatch([
      (draft) => {
        const item = draft.cases.find((entry) => entry.id === caseId)
        const step = item?.steps.find((entry) => entry.id === stepId)
        if (!item || !step) throw new Error('用例或步骤不存在')
        if (step.dependency && item.steps.find((entry) => entry.id === step.dependency)?.result !== '通过') {
          throw new Error(`前置步骤 ${step.dependency} 未通过，禁止跳过`)
        }
        step.result = result
        step.actual = actual ?? step.actual
        item.status = item.steps.some((entry) => entry.result === '失败') ? '失败' : item.steps.every((entry) => entry.result === '通过') ? '通过' : '执行中'
      },
    ])
    if (ok) liveMessage.value = `步骤 ${stepId} 结果已记录${isCandidate.value ? '（候选版本）' : ''}`
  }

  function startExecution() {
    const item = selectedCase.value
    if (!item) return
    const t = currentTime()
    const ok = commitBatch([
      (draft) => {
        const target = draft.cases.find((entry) => entry.id === item.id)
        if (!target) throw new Error('用例不存在')
        target.status = '执行中'
        draft.executions.unshift({
          id: `EX-${Date.now().toString().slice(-6)}`,
          caseId: target.id,
          operator: '当前用户',
          startedAt: t,
          snapshot: 'v26.10 / CS-LEU-09',
          result: '执行中',
          evidence: [],
          requestKey: `req-${target.id}-${t}`,
        })
      },
    ])
    if (ok) liveMessage.value = `已开始执行 ${item.id}${isCandidate.value ? '（候选版本）' : ''}`
  }

  function updateLiveProgress(value: number) {
    liveMessage.value = value >= 100 ? '全部用例执行完成，等待审核锁定' : `实时同步：已完成 ${value}%`
    if (value >= 100) {
      const active = activeExecutions.value.find((item) => item.result === '执行中')
      if (active) {
        active.result = '失败'
        active.finishedAt = currentTime()
      }
    }
  }
  function simulateDisconnect() { connection.value = '重连中'; pendingRetry.value += 1 }
  function retry() { connection.value = '在线'; pendingRetry.value = 0; liveMessage.value = '断线期间执行记录已补传' }

  /** 对账：按生效时段核对设备变更、进路关系与执行记录 */
  function runReconcile() {
    const report = reconcile(activeCases.value, activeExecutions.value, equipmentChanges.value, routeSnapshots.value, currentTime())
    reconcileReport.value = report
    liveMessage.value = `对账完成：${report.validCount} 项有效，${report.invalidCount} 项失效待重算`
  }

  /** 失效重算：把对账判定失效的步骤结果重置为未执行（在活动分支上） */
  function applyRecalc() {
    const report = reconcileReport.value
    if (!report || report.invalidated.length === 0) return
    const invalidStepIds = new Set(report.invalidated.map((r) => `${r.caseId}:${r.stepId}`))
    const ok = commitBatch([
      (draft) => {
        for (const tc of draft.cases) {
          for (const step of tc.steps) {
            if (invalidStepIds.has(`${tc.id}:${step.id}`)) {
              step.result = '未执行'
              step.actual = undefined
            }
          }
          tc.status = tc.steps.some((s) => s.result === '失败') ? '失败'
            : tc.steps.every((s) => s.result === '通过') ? '通过'
            : tc.steps.some((s) => s.result !== '未执行') ? '执行中'
            : '未执行'
        }
      },
    ])
    if (ok) {
      reconcileReport.value = null
      liveMessage.value = `已失效重算 ${invalidStepIds.size} 项步骤结果${isCandidate.value ? '（候选版本）' : ''}`
    }
  }

  /** 重复请求取首次：按幂等键去重执行记录 */
  function dedupeExecutions() {
    const before = activeExecutions.value.length
    const deduped = dedupeRequests(activeExecutions.value)
    if (deduped.length === before) {
      liveMessage.value = '无重复执行请求'
      return
    }
    const ok = commitBatch([(draft) => { draft.executions = dedupeRequests(draft.executions) }])
    if (ok) liveMessage.value = `重复请求已去重：${before} → ${activeExecutions.value.length} 条（取首次）`
  }

  /** 撤销变更：标记撤销并写入撤销时间 */
  function revokeChange(id: string) {
    const change = equipmentChanges.value.find((c) => c.id === id)
    if (!change || change.revoked) return
    change.revoked = true
    change.effectiveTo = currentTime()
    liveMessage.value = `已撤销变更：${change.description}`
  }

  function lockBaseline() {
    baselineLocked.value = true
    candidateCases.value = null
    candidateExecutions.value = null
    candidateVersion.value = null
  }
  function publishCandidate() {
    if (!candidateCases.value) return
    cases.value = candidateCases.value
    executions.value = candidateExecutions.value!
    candidateCases.value = null
    candidateExecutions.value = null
    candidateVersion.value = null
    baselineLocked.value = true
    liveMessage.value = '候选版本已发布为新基线'
  }
  function discardCandidate() {
    candidateCases.value = null
    candidateExecutions.value = null
    candidateVersion.value = null
    liveMessage.value = '候选版本已丢弃'
  }

  watch(cases, persist, { deep: true })
  restore()
  runReconcile()

  return {
    cases, executions, equipmentChanges, routeSnapshots,
    candidateCases, candidateExecutions, candidateVersion,
    reconcileReport, batchStatus, lastBatchError,
    selectedCaseId, selectedRouteIds, selectedCase, progress,
    baselineLocked, connection, pendingRetry, liveMessage,
    activeCases, activeExecutions, isCandidate, affectedCases,
    selectCase, setStepResult, startExecution, updateLiveProgress,
    simulateDisconnect, retry, lockBaseline,
    runReconcile, applyRecalc, dedupeExecutions, revokeChange,
    publishCandidate, discardCandidate, commitBatch,
  }
})
