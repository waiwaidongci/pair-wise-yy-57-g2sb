import type { DeviceChange, RouteInfo, RouteRevision, StepRecord, WorkWindow } from './types'

// 发布对账时间点：2026-10-03（第三次施工前）
export const NOW = '2026-10-03T12:00:00'

export const windows: WorkWindow[] = [
  { id: 'W-0925', name: '第一次施工天窗 · P-02 转辙机更换', startAt: '2026-09-25T22:00:00', endAt: '2026-09-26T04:00:00' },
  { id: 'W-1002', name: '第二次施工天窗 · 轨道区段作业', startAt: '2026-10-02T22:00:00', endAt: '2026-10-03T04:00:00' },
]

export const routes: RouteInfo[] = [
  { id: 'R-01', name: 'X → 1G → S 正线接车', color: '#2563eb', devices: ['X-01', 'P-01', 'P-02', 'T-01', 'T-02', 'S-01'] },
  { id: 'R-02', name: 'X → 2G → S2 侧线接车', color: '#059669', devices: ['X-01', 'P-01', 'P-02', 'P-03', 'T-01', 'T-03', 'S-02'] },
  { id: 'R-03', name: 'X → 2G → S 接车', color: '#d97706', devices: ['X-01', 'P-01', 'P-02', 'T-02', 'S-01'] },
  { id: 'R-04', name: '2G → 3G → S2 调车', color: '#7c3aed', devices: ['P-03', 'T-02', 'T-03', 'S-02'] },
  { id: 'R-05', name: 'X → 4G 预留侧线（变更单登记、现场撤销）', color: '#dc2626', devices: ['X-01', 'P-02', 'T-04', 'S-03'] },
]

// CHG-03 现场撤销：最终设备表里仍留痕，但没有关系修订，不算生效变更
export const changes: DeviceChange[] = [
  { id: 'CHG-01', name: 'P-02 转辙机更换', deviceId: 'P-02', deviceName: '2# 道岔', kind: '道岔', windowId: 'W-0925', status: 'applied', effectiveAt: '2026-09-26T01:00:00', routeIds: ['R-01', 'R-02', 'R-03'], note: '新转辙机动作时序与锁闭反馈变更' },
  { id: 'CHG-02', name: 'T-03 绝缘节调整', deviceId: 'T-03', deviceName: '3G 轨道区段', kind: '轨道区段', windowId: 'W-1002', status: 'applied', effectiveAt: '2026-10-03T00:30:00', routeIds: ['R-02', 'R-04'], note: '占用边界变化，S2 信号关闭时机重测' },
  {
    id: 'CHG-03',
    name: 'T-04 轨道区段改造（预留侧线）',
    deviceId: 'T-04',
    deviceName: '4G 轨道区段',
    kind: '轨道区段',
    windowId: 'W-1002',
    status: 'revoked',
    revokedAt: '2026-10-02T23:40:00',
    routeIds: ['R-05'],
    note: '天窗内现场撤销，材料未到位；最终设备表仍按计划单登记 R-05',
  },
]

export const revisions: RouteRevision[] = [
  // 既有基线
  { id: 'REV-B01', routeId: 'R-01', signature: 'sig-base', summary: 'v26.09 既有进路关系', effectiveFrom: '2026-01-01T00:00:00' },
  { id: 'REV-B02', routeId: 'R-02', signature: 'sig-base', summary: 'v26.09 既有进路关系', effectiveFrom: '2026-01-01T00:00:00' },
  { id: 'REV-B03', routeId: 'R-03', signature: 'sig-base', summary: 'v26.09 既有进路关系', effectiveFrom: '2026-01-01T00:00:00' },
  { id: 'REV-B04', routeId: 'R-04', signature: 'sig-base', summary: 'v26.09 既有进路关系', effectiveFrom: '2026-01-01T00:00:00' },
  { id: 'REV-B05', routeId: 'R-05', signature: 'sig-base', summary: 'v26.09 既有进路关系', effectiveFrom: '2026-01-01T00:00:00' },
  // 第一次天窗：P-02 转辙机更换，01:00 生效
  { id: 'REV-01', routeId: 'R-01', changeId: 'CHG-01', signature: 'sig-p02', summary: 'P-02 更换后锁闭反馈与表示回路', effectiveFrom: '2026-09-26T01:00:00' },
  { id: 'REV-02', routeId: 'R-02', changeId: 'CHG-01', signature: 'sig-p02', summary: 'P-02 更换后锁闭反馈与表示回路', effectiveFrom: '2026-09-26T01:00:00' },
  { id: 'REV-03', routeId: 'R-03', changeId: 'CHG-01', signature: 'sig-p02', summary: 'P-02 更换后锁闭反馈与表示回路', effectiveFrom: '2026-09-26T01:00:00' },
  // 第二次天窗：T-03 绝缘节调整，00:30 生效（R-02 二次变更）
  { id: 'REV-04', routeId: 'R-02', changeId: 'CHG-02', signature: 'sig-p02+t03', summary: 'T-03 绝缘节调整后占用边界', effectiveFrom: '2026-10-03T00:30:00' },
  { id: 'REV-05', routeId: 'R-04', changeId: 'CHG-02', signature: 'sig-t03', summary: 'T-03 绝缘节调整后占用边界', effectiveFrom: '2026-10-03T00:30:00' },
]

export const seedRecords: StepRecord[] = [
  // R-01 / CHG-01
  {
    id: 'EX-01', requestId: 'REQ-01', caseId: 'C-101', caseName: 'X 至 S 正线接车进路建立', routeId: 'R-01',
    action: '排列 X → S 接车进路，检查 P-02 锁闭表示', result: '通过',
    executedAt: '2026-09-26T00:20:00', relationSigAtExec: 'sig-base', changeId: 'CHG-01',
    operator: '陆晨', snapshot: 'v26.09 / CS-LEU-08', evidence: ['XS-101'],
  }, // 00:20 在 CHG-01 生效(01:00)之前 → 未落入生效时段；且携带旧关系
  {
    id: 'EX-02', requestId: 'REQ-02', caseId: 'C-101', caseName: 'X 至 S 正线接车进路建立', routeId: 'R-01',
    action: '排列 X → S 接车进路，检查 P-02 锁闭表示', result: '通过',
    executedAt: '2026-09-26T02:10:00', relationSigAtExec: 'sig-p02', changeId: 'CHG-01',
    operator: '陆晨', snapshot: 'v26.10 / CS-LEU-09', evidence: ['XS-102', 'LG-201'],
  }, // 生效时段内 + 当前关系 → 有效

  // R-02：跨天窗陷阱
  {
    id: 'EX-03', requestId: 'REQ-03', caseId: 'C-102', caseName: 'X 至 S2 侧线接车与 3G 占用', routeId: 'R-02',
    action: '排列 X → S2 侧线进路，验证 P-02 反位锁闭', result: '通过',
    executedAt: '2026-09-26T02:30:00', relationSigAtExec: 'sig-p02', changeId: 'CHG-01',
    operator: '方瑜', snapshot: 'v26.10 / CS-LEU-09', evidence: ['XS-103'],
  }, // 第一次天窗有效，但 R-02 当前关系是 sig-p02+t03 → 旧进路，失效重算
  {
    id: 'EX-04', requestId: 'REQ-04', caseId: 'C-102', caseName: 'X 至 S2 侧线接车与 3G 占用', routeId: 'R-02',
    action: '模拟 3G 占用，验证 S2 信号立即关闭', result: '失败',
    executedAt: '2026-10-03T00:10:00', relationSigAtExec: 'sig-p02', changeId: 'CHG-02',
    operator: '方瑜', snapshot: 'v26.10 / CS-LEU-09', evidence: ['VID-021'],
  }, // 00:10 在 CHG-02 生效(00:30)之前 + 旧关系
  {
    id: 'EX-05', requestId: 'REQ-05', caseId: 'C-102', caseName: 'X 至 S2 侧线接车与 3G 占用', routeId: 'R-02',
    action: '模拟 3G 占用，验证 S2 信号立即关闭', result: '通过',
    executedAt: '2026-10-03T01:40:00', relationSigAtExec: 'sig-p02+t03', changeId: 'CHG-02',
    operator: '方瑜', snapshot: 'v26.10 / CS-LEU-09', evidence: ['XS-105', 'LG-205'],
  }, // 生效时段内 + 当前关系 → 有效（同时关闭 EX-04 的重算任务）

  // R-03：旧记录以首次执行时间起算
  {
    id: 'EX-06', requestId: 'REQ-06', caseId: 'C-103', caseName: '敌对进路 R-01 / R-02 互锁', routeId: 'R-03',
    action: '排列 R-03 后验证敌对进路拒排', result: '通过',
    executedAt: '2026-09-26T03:00:00', relationSigAtExec: 'sig-p02', changeId: 'CHG-01',
    operator: '陆晨', snapshot: 'v26.10 / CS-LEU-09', evidence: ['XS-106'],
  }, // 有效
  {
    id: 'EX-07', requestId: 'REQ-07', caseId: 'C-103', caseName: '敌对进路 R-01 / R-02 互锁', routeId: 'R-03',
    action: '复核敌对进路锁闭时序', result: '通过',
    executedAt: '2026-10-02T20:00:00', firstExecutionAt: '2026-09-26T03:20:00',
    relationSigAtExec: 'sig-p02', changeId: 'CHG-01',
    operator: '方瑜', snapshot: 'v26.10 / CS-LEU-09', evidence: ['XS-107'],
  }, // 旧记录：复核在两次天窗之间，但首次执行落在第一窗生效时段 → 以首次起算，有效
  {
    id: 'EX-08', requestId: 'REQ-08', caseId: 'C-103', caseName: '敌对进路 R-01 / R-02 互锁', routeId: 'R-03',
    action: 'P-02 表示回路一致性核对', result: '通过',
    executedAt: '2026-10-02T20:30:00', relationSigAtExec: 'sig-base',
    operator: '方瑜', snapshot: 'v26.09 / CS-LEU-08', evidence: ['LG-208'],
  }, // 无天窗步骤，但携带 sig-base 旧关系，R-03 当前 sig-p02 → 失效重算

  // R-04 / CHG-02
  {
    id: 'EX-09', requestId: 'REQ-09', caseId: 'C-104', caseName: '2G 至 3G 调车进路与绝缘节', routeId: 'R-04',
    action: '排列 2G → 3G 调车进路，检查 T-03 占用边界', result: '通过',
    executedAt: '2026-10-03T02:00:00', relationSigAtExec: 'sig-t03', changeId: 'CHG-02',
    operator: '陆晨', snapshot: 'v26.10 / CS-LEU-09', evidence: ['XS-109'],
  }, // 有效

  // R-05 / CHG-03：现场撤销
  {
    id: 'EX-10', requestId: 'REQ-10', caseId: 'C-105', caseName: 'X → 4G 预留侧线排列', routeId: 'R-05',
    action: '按变更单试排 4G 侧线进路', result: '阻塞',
    executedAt: '2026-10-02T23:10:00', relationSigAtExec: 'sig-base', changeId: 'CHG-03',
    operator: '方瑜', snapshot: 'v26.10 / CS-LEU-09', evidence: ['MEMO-03'],
  }, // 关联变更已撤销 → 失效（旧口径按最终设备表仍把 R-05 算进影响范围）

  // 重复请求：同一请求重放，取首次
  {
    id: 'EX-11', requestId: 'REQ-10', caseId: 'C-105', caseName: 'X → 4G 预留侧线排列', routeId: 'R-05',
    action: '按变更单试排 4G 侧线进路（重放请求）', result: '通过',
    executedAt: '2026-10-03T09:00:00', relationSigAtExec: 'sig-base', changeId: 'CHG-03',
    operator: '系统补传', snapshot: 'v26.10 / CS-LEU-09', evidence: ['XS-111'],
  }, // REQ-10 的第二次提交 → 重复请求，取首次 EX-10；不产生额外重算任务
]
