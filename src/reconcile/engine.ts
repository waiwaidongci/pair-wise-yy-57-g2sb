import type {
  DeviceChange,
  RecordVerdict,
  ReconcileResult,
  RecomputeTask,
  RouteInfo,
  RouteRevision,
  RouteScope,
  StepRecord,
  VerdictCode,
  WorkWindow,
} from './types'

export interface ReconcileInput {
  now: string
  windows: WorkWindow[]
  changes: DeviceChange[]
  routes: RouteInfo[]
  revisions: RouteRevision[]
  records: StepRecord[]
}

export const REASON_LABEL: Record<VerdictCode, string> = {
  valid: '有效：落在生效时段且关联当前进路',
  'duplicate-request': '重复请求，已取首次执行',
  'change-revoked': '关联设备变更已被现场撤销',
  'step-outside-window': '步骤起算时间早于设备关系实际生效点',
  'relation-superseded': '携带旧进路关系，进路关系已变更，结果失效重算',
}

export function within(value: string, start: string, end: string) {
  return value >= start && value <= end
}

/** 某条进路在指定时刻生效的关系修订（取 effectiveFrom 最晚且不晚于该时刻的一条） */
export function revisionAt(revisions: RouteRevision[], routeId: string, at: string): RouteRevision | undefined {
  return revisions
    .filter((item) => item.routeId === routeId && item.effectiveFrom <= at)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]
}

/** 当前进路关系指纹 */
export function currentSignature(revisions: RouteRevision[], routeId: string, now: string) {
  return revisionAt(revisions, routeId, now)?.signature
}

/** 对账起算时间：旧记录以首次执行时间起算 */
export function basisAtOf(record: StepRecord): string {
  return record.firstExecutionAt ?? record.executedAt
}

function changesById(changes: DeviceChange[]) {
  return new Map(changes.map((item) => [item.id, item]))
}

function primaryOf(reasons: VerdictCode[]): VerdictCode {
  const order: VerdictCode[] = ['valid', 'duplicate-request', 'change-revoked', 'step-outside-window', 'relation-superseded']
  for (const code of order) if (reasons.includes(code)) return code
  return reasons[0] ?? 'valid'
}

/**
 * 设备关系一变，只有落在该时段且关联当前进路的步骤有效，其余结果失效重算。
 * 返回逐条执行记录的对账结论（重复请求在 evaluateAll 中判定）。
 */
export function evaluateRecord(
  record: StepRecord,
  ctx: ReconcileInput,
  isFirstByRequest: boolean,
): { verdict: Omit<RecordVerdict, 'supersededBy'> } {
  const basisAt = basisAtOf(record)
  const reasons: VerdictCode[] = []
  const changeMap = changesById(ctx.changes)

  if (!isFirstByRequest) reasons.push('duplicate-request')

  const route = ctx.routes.find((item) => item.id === record.routeId)
  if (!route) {
    reasons.push('relation-superseded')
    return { verdict: { recordId: record.id, valid: false, primary: primaryOf(reasons), reasons, basisAt } }
  }

  const change = record.changeId ? changeMap.get(record.changeId) : undefined
  if (record.changeId && !change) reasons.push('relation-superseded')
  if (change?.status === 'revoked') reasons.push('change-revoked')

  // 围绕某条变更执行的步骤：起算时间不得早于关系实际生效点。
  // 生效点之前（含换设备前、撤点后补录）属于旧时段；生效之后允许跨天窗回归重算。
  if (change && change.status === 'applied') {
    const effectiveAt = change.effectiveAt
    if (!effectiveAt || basisAt < effectiveAt) reasons.push('step-outside-window')
  }

  // 关联当前进路：执行时锁定的关系指纹必须等于对账时刻的当前关系
  const current = currentSignature(ctx.revisions, record.routeId, ctx.now)
  if (!current || record.relationSigAtExec !== current) reasons.push('relation-superseded')

  const valid = reasons.length === 0
  if (valid) reasons.push('valid')
  return { verdict: { recordId: record.id, valid, primary: primaryOf(reasons), reasons: valid ? ['valid'] : reasons, basisAt, currentSignature: current } }
}

function scopeKeyOf(record: StepRecord) {
  return `${record.caseId}|${record.routeId}|${record.action}`
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  // 重复请求取首次：按 (requestId, 对账起算时间) 排序，最早出现的一条有效候选
  const firstRequest = new Map<string, StepRecord>()
  for (const record of input.records) {
    const held = firstRequest.get(record.requestId)
    if (!held || basisAtOf(record) < basisAtOf(held)) firstRequest.set(record.requestId, record)
  }

  const verdicts = input.records.map((record): RecordVerdict => {
    const first = firstRequest.get(record.requestId)
    const { verdict } = evaluateRecord(record, input, first?.id === record.id)
    return { ...verdict, supersededBy: undefined }
  })
  const verdictMap = new Map(verdicts.map((item) => [item.recordId, item]))

  // 后续同步骤的有效记录取代更早的有效结果（发布取最新有效），被取代者只保留审计意义
  const byScope = new Map<string, StepRecord[]>()
  for (const record of input.records) {
    if (!verdictMap.get(record.id)?.valid) continue
    const list = byScope.get(scopeKeyOf(record)) ?? []
    list.push(record)
    byScope.set(scopeKeyOf(record), list)
  }
  for (const list of byScope.values()) {
    list.sort((a, b) => (basisAtOf(a) < basisAtOf(b) ? -1 : 1))
    for (let i = 0; i < list.length - 1; i++) {
      const target = verdictMap.get(list[i]!.id)!
      target.supersededBy = list[list.length - 1]!.id
    }
  }

  // 失效结果重算任务（重复请求不产生任务，它的首次记录才是唯一有效来源）
  const taskMap = new Map<string, RecomputeTask>()
  input.records.forEach((record) => {
    const verdict = verdictMap.get(record.id)!
    if (verdict.valid || verdict.reasons.includes('duplicate-request')) return
    const key = scopeKeyOf(record)
    const task = taskMap.get(key) ?? {
      key,
      caseId: record.caseId,
      caseName: record.caseName,
      routeId: record.routeId,
      action: record.action,
      invalidRecordIds: [],
    }
    task.invalidRecordIds.push(record.id)
    taskMap.set(key, task)
  })

  // 已被后续有效步骤覆盖的重算任务关闭
  for (const list of byScope.values()) {
    const latest = list[list.length - 1]!
    const key = scopeKeyOf(latest)
    const task = taskMap.get(key)
    if (task) {
      task.doneBy = latest.id
      taskMap.delete(key)
    }
  }

  const verdictByRoute = new Map<string, { verdicts: RecordVerdict[]; records: StepRecord[] }>()
  input.records.forEach((record) => {
    const bucket = verdictByRoute.get(record.routeId) ?? { verdicts: [], records: [] }
    bucket.verdicts.push(verdictMap.get(record.id)!)
    bucket.records.push(record)
    verdictByRoute.set(record.routeId, bucket)
  })

  // 旧口径：按最终设备表一次算完（含已撤销变更，不看天窗与关系版本）
  const naiveImpact = new Set<string>()
  for (const change of input.changes) for (const routeId of change.routeIds) naiveImpact.add(routeId)

  // 对账口径：仅现场生效（未撤销）的变更，进路关系确实在该天窗变更
  const reconciledImpact = new Set<string>()
  for (const change of input.changes) {
    if (change.status !== 'applied' || !change.effectiveAt) continue
    const touched = input.revisions.some(
      (rev) => rev.changeId === change.id && rev.effectiveFrom >= (change.effectiveAt as string),
    )
    if (touched) for (const routeId of change.routeIds) reconciledImpact.add(routeId)
  }

  const routes: RouteScope[] = input.routes.map((route) => {
    const bucket = verdictByRoute.get(route.id)
    const list = bucket?.verdicts ?? []
    const validCount = list.filter((item) => item.valid).length
    const invalidCount = list.filter((item) => !item.valid).length
    const duplicateCount = list.filter((item) => item.reasons.includes('duplicate-request')).length
    // 跨天窗带着旧进路进入发布的步骤：旧口径算在影响范围/可复用里，但时段对账判定失效
    const stale = list.filter((item) => !item.valid && item.reasons.includes('relation-superseded')).length
    const carried = list.filter(
      (item) => item.valid && !item.supersededBy && !reconciledImpact.has(route.id),
    ).length
    return {
      routeId: route.id,
      routeName: route.name,
      naiveAffected: naiveImpact.has(route.id),
      reconciledAffected: reconciledImpact.has(route.id),
      currentSignature: currentSignature(input.revisions, route.id, input.now) ?? '',
      valid: validCount,
      invalid: invalidCount,
      duplicate: duplicateCount,
      staleCarried: stale,
      carriedValid: carried,
    }
  })

  return {
    verdicts,
    tasks: [...taskMap.values()],
    routes,
    naiveImpactRouteIds: input.routes.map((item) => item.id).filter((id) => naiveImpact.has(id)),
    reconciledImpactRouteIds: input.routes.map((item) => item.id).filter((id) => reconciledImpact.has(id)),
    now: input.now,
  }
}

/** 发布门禁：影响范围内不存在失效未重算步骤 */
export function gateReady(result: ReconcileResult): { ready: boolean; openTasks: number } {
  return { ready: result.tasks.length === 0, openTasks: result.tasks.length }
}
