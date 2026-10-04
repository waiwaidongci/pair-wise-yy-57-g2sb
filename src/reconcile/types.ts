// 生效时段对账领域模型
// 四类对象按时间轴对账：设备变更 / 进路关系版本 / 执行记录（步骤）/ 发布基线

export interface WorkWindow {
  id: string
  name: string
  startAt: string // ISO，施工天窗起
  endAt: string // ISO，施工天窗止
}

export type ChangeStatus = 'applied' | 'revoked'

export interface DeviceChange {
  id: string
  name: string
  deviceId: string
  deviceName: string
  kind: '道岔' | '信号机' | '轨道区段'
  windowId: string
  status: ChangeStatus
  effectiveAt?: string // 现场实际生效时间（关系变更落点）
  revokedAt?: string // 现场撤销时间
  /** 变更单上声明关联的进路（最终设备表口径，可能含事后撤销项） */
  routeIds: string[]
  note?: string
}

export interface RouteInfo {
  id: string
  name: string
  color: string
  devices: string[]
}

export interface RouteRevision {
  id: string
  routeId: string
  changeId?: string // 基线修订无关联变更
  signature: string // 进路关系指纹：设备集合 + 联锁关系版本
  summary: string
  effectiveFrom: string // 该关系版本生效起点
}

export type StepResult = '通过' | '失败' | '阻塞'

export interface StepRecord {
  id: string
  /** 上游请求幂等键：同一请求重复提交取首次 */
  requestId: string
  caseId: string
  caseName: string
  routeId: string
  action: string
  result: StepResult
  /** 本次执行时间 */
  executedAt: string
  /** 旧记录回填的首次执行时间；缺省取 executedAt */
  firstExecutionAt?: string
  /** 执行时锁定的进路关系指纹 */
  relationSigAtExec: string
  /** 步骤是否围绕某条设备变更展开（落在其天窗内执行） */
  changeId?: string
  operator: string
  snapshot: string
  evidence: string[]
}

export type VerdictCode =
  | 'valid'
  | 'duplicate-request' // 重复请求：非首次
  | 'change-revoked' // 关联变更已被现场撤销
  | 'step-outside-window' // 未落入变更天窗 / 生效时段
  | 'relation-superseded' // 携带旧进路关系，进路关系已变更

export interface RecordVerdict {
  recordId: string
  valid: boolean
  primary: VerdictCode
  reasons: VerdictCode[]
  basisAt: string // 对账起算时间（旧记录=首次执行时间）
  currentSignature?: string
  supersededBy?: string // 已被后续同步骤的有效结果取代
}

export interface RecomputeTask {
  key: string // caseId|routeId|action
  caseId: string
  caseName: string
  routeId: string
  action: string
  invalidRecordIds: string[]
  doneBy?: string // 重算后有效记录 id
}

export interface RouteScope {
  routeId: string
  routeName: string
  naiveAffected: boolean // 最终设备表一次算完的口径
  reconciledAffected: boolean // 生效时段对账口径
  currentSignature: string
  valid: number
  invalid: number
  duplicate: number
  staleCarried: number // 旧口径会带过天窗的失效步骤数
  carriedValid: number // 可直接进入发布的有效历史步骤数
}

export interface ReconcileResult {
  verdicts: RecordVerdict[]
  tasks: RecomputeTask[]
  routes: RouteScope[]
  naiveImpactRouteIds: string[]
  reconciledImpactRouteIds: string[]
  /** 对账时间点 */
  now: string
}

export interface BaselineSnapshot {
  version: string
  lockedAt: string
  records: StepRecord[]
  impactRouteIds: string[]
  validRecordIds: string[]
  signatureSummary: Record<string, string>
}

export interface CandidateVersion {
  id: string
  reason: string
  createdAt: string
  changes: DeviceChange[]
  records: StepRecord[]
  revisions: RouteRevision[]
}
