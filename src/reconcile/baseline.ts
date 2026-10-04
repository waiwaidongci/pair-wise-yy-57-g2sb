import type { BaselineSnapshot, CandidateVersion, DeviceChange, ReconcileResult, RouteRevision, StepRecord } from './types'
import { reconcile, basisAtOf } from './engine'

export interface BatchFailure {
  atIndex: number
  message: string
}

export interface CommitInput {
  records: StepRecord[]
  incoming: StepRecord[]
  /** 模拟写入失败：在第 failAtIndex 步（0 起）抛出，整批回滚 */
  failAtIndex?: number
  failure?: BatchFailure
  now: string
  windows: import('./types').WorkWindow[]
  changes: DeviceChange[]
  routes: import('./types').RouteInfo[]
  revisions: RouteRevision[]
}

export interface CommitOutcome {
  records: StepRecord[]
  accepted: StepRecord[]
  skippedDuplicates: StepRecord[]
  rolledBack: boolean
  failureMessage?: string
}

/**
 * 写入失败按完整批次恢复：先快照整批，任何一步失败恢复到写入前状态；
 * 重复请求取首次：同 requestId 已存在（或批次内更早）的记录直接跳过，不写入。
 */
export function commitBatch(input: CommitInput): CommitOutcome {
  const snapshot: StepRecord[] = input.records.map((item) => ({ ...item, evidence: [...item.evidence] }))
  const working = snapshot.map((item) => ({ ...item, evidence: [...item.evidence] }))
  const accepted: StepRecord[] = []
  const skippedDuplicates: StepRecord[] = []

  try {
    input.incoming.forEach((incoming, index) => {
      if (input.failure && index === input.failure.atIndex) {
        throw new Error(input.failure.message)
      }
      const basis = basisAtOf(incoming)
      const existing = working.find((item) => item.requestId === incoming.requestId)
      const earlierInBatch = accepted.find((item) => item.requestId === incoming.requestId)
      const keepFirst =
        existing && basisAtOf(existing) <= basis
      if (keepFirst || earlierInBatch) {
        skippedDuplicates.push(incoming)
        return
      }
      if (existing) {
        // 新到记录起算更早（旧记录回填首次执行时间）：以首次为准替换
        const at = working.findIndex((item) => item.id === existing.id)
        working[at] = { ...incoming, evidence: [...incoming.evidence] }
      } else {
        working.push({ ...incoming, evidence: [...incoming.evidence] })
      }
      accepted.push(incoming)
    })
  } catch (error) {
    // 完整批次恢复：丢弃 working，回到写入前快照
    return {
      records: snapshot,
      accepted: [],
      skippedDuplicates: [],
      rolledBack: true,
      failureMessage: error instanceof Error ? error.message : '写入失败',
    }
  }

  return { records: working, accepted, skippedDuplicates, rolledBack: false }
}

/** 锁定发布基线：只固化对账有效的步骤与生效变更影响范围 */
export function lockBaseline(
  version: string,
  lockedAt: string,
  input: Omit<import('./engine').ReconcileInput, 'now'>,
): { snapshot: BaselineSnapshot; result: ReconcileResult } {
  const ctx = { ...input, now: lockedAt }
  const result = reconcile(ctx)
  const validIds = new Set(
    result.verdicts.filter((item) => item.valid && !item.supersededBy).map((item) => item.recordId),
  )
  const signatures: Record<string, string> = {}
  for (const scope of result.routes) signatures[scope.routeId] = scope.currentSignature
  return {
    snapshot: {
      version,
      lockedAt,
      records: input.records.filter((item) => validIds.has(item.id)),
      impactRouteIds: result.reconciledImpactRouteIds,
      validRecordIds: [...validIds],
      signatureSummary: signatures,
    },
    result,
  }
}

/**
 * 锁定基线后的改动只生成候选版本：不改写基线，不并入发布对账结果。
 */
export function proposeCandidate(
  baseline: BaselineSnapshot,
  reason: string,
  patch: { changes: DeviceChange[]; records: StepRecord[]; revisions: RouteRevision[] },
  now: string,
): CandidateVersion {
  return {
    id: `CAND-${now.replace(/[-:T.Z]/g, '').slice(0, 14)}`,
    reason,
    createdAt: now,
    changes: patch.changes.map((item) => ({ ...item })),
    records: patch.records.map((item) => ({ ...item })),
    revisions: patch.revisions.map((item) => ({ ...item })),
  }
}
