import type { ExecutionRecord, TestCase } from './types'

/** 设备变更：带生效时段，可撤销 */
export interface EquipmentChange {
  id: string
  deviceId: string
  description: string
  /** 施工天窗批次：1 / 2 */
  phase: number
  /** 生效起 HH:mm */
  effectiveFrom: string
  /** 撤销时间；缺省表示仍生效 */
  effectiveTo?: string
  revoked: boolean
}

/** 进路关系快照：按生效时段版本化 */
export interface RouteSnapshot {
  routeId: string
  /** 生效起 HH:mm */
  validFrom: string
  /** 失效时间；缺省表示仍生效 */
  validTo?: string
  devices: string[]
}

export interface StepValidity {
  caseId: string
  stepId: string
  valid: boolean
  reason: string
  /** 该步骤结果的生效时间（取首次执行时间） */
  effectiveTime?: string
}

export interface ReconcileReport {
  generatedAt: string
  scope: Array<{ id: string; description: string; phase: number; effectiveFrom: string; effectiveTo?: string; revoked: boolean }>
  routeVersions: Array<{ routeId: string; period: string; devices: string[] }>
  results: StepValidity[]
  invalidated: StepValidity[]
  recalc: StepValidity[]
  validCount: number
  invalidCount: number
}

/** HH:mm 时间落在 [from, to) 区间内 */
export function timeInRange(t: string, from: string, to?: string): boolean {
  if (t < from) return false
  if (to !== undefined && t >= to) return false
  return true
}

/** 某时刻仍生效（未撤销且在时段内）的设备变更 */
export function changesAt(changes: EquipmentChange[], t: string): EquipmentChange[] {
  return changes.filter((c) => !c.revoked && timeInRange(t, c.effectiveFrom, c.effectiveTo))
}

/** 某时刻生效的进路关系快照 */
export function snapshotAt(snapshots: RouteSnapshot[], routeId: string, t: string): RouteSnapshot | undefined {
  return snapshots.find((s) => s.routeId === routeId && timeInRange(t, s.validFrom, s.validTo))
}

/** 当前（最新）进路关系快照 */
export function latestSnapshot(snapshots: RouteSnapshot[], routeId: string): RouteSnapshot {
  const list = snapshots.filter((s) => s.routeId === routeId)
  return [...list].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]!
}

/**
 * 对账：把设备变更、进路关系、执行记录按生效时段对账。
 * 规则：设备关系一变，只有落在该时段且关联当前进路的步骤有效，其余失效重算。
 * 旧记录以首次执行时间起算。
 */
export function reconcile(
  cases: TestCase[],
  executions: ExecutionRecord[],
  changes: EquipmentChange[],
  snapshots: RouteSnapshot[],
  now: string,
): ReconcileReport {
  // 旧记录以首次执行时间起算：用例步骤结果的生效时间 = 该用例首次执行记录的 startedAt
  const firstExec = new Map<string, string>()
  for (const rec of executions) {
    const prev = firstExec.get(rec.caseId)
    if (prev === undefined || rec.startedAt < prev) firstExec.set(rec.caseId, rec.startedAt)
  }

  const results: StepValidity[] = []
  for (const tc of cases) {
    const effectiveTime = firstExec.get(tc.id)
    for (const step of tc.steps) {
      if (step.result === '未执行') continue
      results.push(judgeStep(tc.id, step.id, tc.routeIds, effectiveTime, changes, snapshots))
    }
  }

  const invalidated = results.filter((r) => !r.valid)
  return {
    generatedAt: now,
    scope: changes.map((c) => ({ id: c.id, description: c.description, phase: c.phase, effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo, revoked: c.revoked })),
    routeVersions: snapshots.map((s) => ({ routeId: s.routeId, period: `${s.validFrom} → ${s.validTo ?? '仍生效'}`, devices: s.devices })),
    results,
    invalidated,
    recalc: invalidated,
    validCount: results.length - invalidated.length,
    invalidCount: invalidated.length,
  }
}

function judgeStep(
  caseId: string,
  stepId: string,
  routeIds: string[],
  effectiveTime: string | undefined,
  changes: EquipmentChange[],
  snapshots: RouteSnapshot[],
): StepValidity {
  const base = { caseId, stepId, effectiveTime }
  if (!effectiveTime) return { ...base, valid: false, reason: '无执行记录，生效时间缺失，需重算' }

  // 当前进路关系（最新快照）关联的设备变更
  const currentSnaps = routeIds.map((rid) => latestSnapshot(snapshots, rid))
  const related = changes.filter((c) => currentSnaps.some((s) => s.devices.includes(c.deviceId)))
  if (related.length === 0) return { ...base, valid: true, reason: '不在设备变更影响范围' }

  const active = related.filter((c) => !c.revoked)
  if (active.length === 0) return { ...base, valid: false, reason: '关联变更已撤销，结果需重算' }

  // 落在该时段？
  const inPeriod = active.some((c) => timeInRange(effectiveTime, c.effectiveFrom, c.effectiveTo))
  if (!inPeriod) return { ...base, valid: false, reason: `结果生效时间 ${effectiveTime} 不在变更生效时段内，需重算` }

  // 关联当前进路？执行时的进路关系与当前是否一致（跨天窗结果不得带着旧进路）
  const mismatch = routeIds.some((rid) => {
    const then = snapshotAt(snapshots, rid, effectiveTime)
    const nowSnap = latestSnapshot(snapshots, rid)
    return then !== undefined && then.devices.join('|') !== nowSnap.devices.join('|')
  })
  if (mismatch) return { ...base, valid: false, reason: '执行时进路关系与当前不一致（旧进路），需重算' }

  return { ...base, valid: true, reason: '落在变更生效时段且关联当前进路' }
}

/** 重复请求取首次：按幂等键去重，保留第一条 */
export function dedupeRequests<T extends { requestKey?: string; id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = item.requestKey ?? item.id
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
