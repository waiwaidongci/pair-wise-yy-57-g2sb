import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { reconcile, gateReady, REASON_LABEL } from './engine'
import { commitBatch, lockBaseline, proposeCandidate } from './baseline'
import type {
  BaselineSnapshot,
  CandidateVersion,
  DeviceChange,
  RouteRevision,
  StepRecord,
} from './types'
import { changes as seedChanges, NOW, revisions as seedRevisions, routes, seedRecords, windows } from './scenario'

const STORAGE_KEY = 'yy57-reconcile-v1'

interface PersistShape {
  records: StepRecord[]
  changes: DeviceChange[]
  revisions: RouteRevision[]
  baseline?: BaselineSnapshot
  candidates: CandidateVersion[]
  log: string[]
}

export const useReconcileStore = defineStore('reconcile', () => {
  const records = ref<StepRecord[]>(structuredClone(seedRecords))
  const changes = ref<DeviceChange[]>(structuredClone(seedChanges))
  const revisions = ref<RouteRevision[]>(structuredClone(seedRevisions))
  const baseline = ref<BaselineSnapshot | undefined>()
  const candidates = ref<CandidateVersion[]>([])
  const log = ref<string[]>(['场景载入：两次施工天窗、CHG-03 现场撤销、跨天窗旧结果与重复请求各 1 条'])
  const batchMessage = ref('批次通道空闲')
  const batchError = ref(false)
  const failNextAt = ref<number | undefined>()
  const failMessage = ref('模拟联锁服务器写入中断')

  function ctx(now = NOW) {
    return { now, windows, changes: changes.value, routes, revisions: revisions.value, records: records.value }
  }
  const result = computed(() => reconcile(ctx()))
  const gate = computed(() => gateReady(result.value))
  const verdictMap = computed(() => new Map(result.value.verdicts.map((item) => [item.recordId, item])))

  function persist() {
    const payload: PersistShape = {
      records: records.value,
      changes: changes.value,
      revisions: revisions.value,
      baseline: baseline.value,
      candidates: candidates.value,
      log: log.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }
  function restore() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const draft = JSON.parse(raw) as PersistShape
    records.value = draft.records
    changes.value = draft.changes
    revisions.value = draft.revisions
    baseline.value = draft.baseline
    candidates.value = draft.candidates ?? []
    log.value = draft.log ?? []
  }

  /**
   * 整批写入：写入失败按完整批次恢复；重复请求取首次。
   * 基线锁定后不再写入正式结果，只生成候选版本。
   */
  function commitIncoming(incoming: StepRecord[]): { committed: boolean } {
    if (baseline.value) {
      const candidate = proposeCandidate(
        baseline.value,
        '锁定后重算请求，仅生成候选版本',
        { changes: changes.value, records: incoming, revisions: revisions.value },
        NOW,
      )
      candidates.value.unshift(candidate)
      batchMessage.value = `基线 ${baseline.value.version} 已锁定，改动已转为候选版本 ${candidate.id}`
      batchError.value = false
      log.value.unshift(`${NOW} 锁定后改动 → 候选版本 ${candidate.id}（不触碰基线）`)
      persist()
      return { committed: false }
    }

    const outcome = commitBatch({
      records: records.value,
      incoming,
      now: NOW,
      windows,
      changes: changes.value,
      routes,
      revisions: revisions.value,
      failAtIndex: failNextAt.value,
      failure: failNextAt.value === undefined ? undefined : { atIndex: failNextAt.value, message: failMessage.value },
    })
    records.value = outcome.records
    if (outcome.rolledBack) {
      batchError.value = true
      batchMessage.value = `第 ${failNextAt.value! + 1} 步写入失败：${outcome.failureMessage}；已按完整批次恢复，未写入任何记录`
      log.value.unshift(`${NOW} 批次写入失败，整批回滚（${incoming.length} 条全部恢复）`)
    } else {
      batchError.value = false
      const skipped = outcome.skippedDuplicates.length
      batchMessage.value = `批次提交成功：写入 ${outcome.accepted.length} 条${skipped ? `，重复请求跳过 ${skipped} 条（取首次）` : ''}`
      log.value.unshift(`${NOW} 批次提交：接受 ${outcome.accepted.length} 条，重复跳过 ${skipped} 条`)
    }
    failNextAt.value = undefined
    persist()
    return { committed: !outcome.rolledBack }
  }

  /** 提交一条对指定重算任务的重测记录（整批写入） */
  function submitRecompute(taskKey: string, result2: StepRecord['result']) {
    const task = result.value.tasks.find((item) => item.key === taskKey)
    if (!task) return
    const stamp = NOW.replace('12:00:00', `12:${String(records.value.length + 40).slice(-2)}:00`)
    const current = result.value.routes.find((item) => item.routeId === task.routeId)?.currentSignature ?? ''
    const relatedChange = [...changes.value]
      .reverse()
      .find((item) => item.status === 'applied' && item.routeIds.includes(task.routeId))
    const incoming: StepRecord = {
      id: `EX-R${records.value.length + 1}`,
      requestId: `REQ-R${Date.now().toString().slice(-6)}`,
      caseId: task.caseId,
      caseName: task.caseName,
      routeId: task.routeId,
      action: task.action,
      result: result2,
      executedAt: stamp,
      relationSigAtExec: current,
      changeId: relatedChange?.id,
      operator: '当前用户',
      snapshot: 'v26.10 / CS-LEU-09（重算）',
      evidence: result2 === '通过' ? ['RC-重算通过'] : ['RC-重测失败待处理'],
    }
    commitIncoming([incoming])
  }

  /** 重放一批重复请求（演示取首次） */
  function replayDuplicates() {
    const dupes = result.value.verdicts.filter((item) => item.reasons.includes('duplicate-request'))
    const incoming: StepRecord[] = dupes.map((item) => {
      const origin = records.value.find((record) => record.id === item.recordId)!
      return { ...origin, id: `${origin.id}-REPLAY-${Date.now().toString().slice(-4)}`, executedAt: NOW, evidence: [...origin.evidence, '重放'] }
    })
    if (incoming.length) commitIncoming(incoming)
  }

  function doLock() {
    if (!gate.value.ready || baseline.value) return
    const { snapshot } = lockBaseline('v26.10', NOW, { windows, changes: changes.value, routes, revisions: revisions.value, records: records.value })
    baseline.value = snapshot
    batchMessage.value = `发布基线 ${snapshot.version} 已锁定：${snapshot.records.length} 条有效步骤固化，此后改动只生成候选版本`
    log.value.unshift(`${NOW} 基线锁定 ${snapshot.version}，影响进路 ${snapshot.impactRouteIds.join('、')}`)
    persist()
  }

  /** 锁定后再登记一条新设备变更（只进候选） */
  function registerPostLockChange() {
    if (!baseline.value) return
    const patchChange: DeviceChange = {
      id: `CHG-P${candidates.value.length + 1}`,
      name: 'P-01 尖轨检修（锁后追加）',
      deviceId: 'P-01',
      deviceName: '1# 道岔',
      kind: '道岔',
      windowId: 'W-1002',
      status: 'applied',
      effectiveAt: NOW,
      routeIds: ['R-01', 'R-02', 'R-03'],
      note: '基线锁定后追加，等待候选评审',
    }
    const candidate = proposeCandidate(
      baseline.value,
      '锁后追加设备变更 P-01 尖轨检修',
      { changes: [patchChange], records: [], revisions: [] },
      NOW,
    )
    candidates.value.unshift(candidate)
    log.value.unshift(`${NOW} 锁后变更 ${patchChange.id} → 候选版本 ${candidate.id}`)
    persist()
  }

  function armFailure(atIndex: number) {
    failNextAt.value = atIndex
    batchError.value = false
    batchMessage.value = `已布置：下一批第 ${atIndex + 1} 步写入将失败`
  }

  function resetAll() {
    localStorage.removeItem(STORAGE_KEY)
    records.value = structuredClone(seedRecords)
    changes.value = structuredClone(seedChanges)
    revisions.value = structuredClone(seedRevisions)
    baseline.value = undefined
    candidates.value = []
    log.value = ['场景已重置']
    batchError.value = false
    failNextAt.value = undefined
    batchMessage.value = '批次通道空闲'
  }

  restore()

  return {
    NOW,
    windows,
    routes,
    changes,
    revisions,
    records,
    result,
    gate,
    verdictMap,
    baseline,
    candidates,
    log,
    batchMessage,
    batchError,
    REASON_LABEL,
    commitIncoming,
    submitRecompute,
    replayDuplicates,
    doLock,
    registerPostLockChange,
    armFailure,
    resetAll,
  }
})
