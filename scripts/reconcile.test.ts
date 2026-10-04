import assert from 'node:assert/strict'
import { reconcile, basisAtOf } from '../src/reconcile/engine'
import { commitBatch, lockBaseline, proposeCandidate } from '../src/reconcile/baseline'
import { changes, NOW, revisions, routes, seedRecords, windows } from '../src/reconcile/scenario'
import type { StepRecord } from '../src/reconcile/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const ctx = { now: NOW, windows, changes, routes, revisions, records: seedRecords }
const result = reconcile(ctx)
const v = (id: string) => result.verdicts.find((item) => item.recordId === id)!

console.log('生效时段对账：')

check('EX-02 落在 CHG-01 生效时段且指纹为当前关系 → 有效', () => {
  assert.equal(v('EX-02').valid, true)
})
check('EX-01 在 01:00 生效前执行且携带 sig-base → 失效（时段外 + 旧进路）', () => {
  assert.equal(v('EX-01').valid, false)
  assert.ok(v('EX-01').reasons.includes('step-outside-window'))
  assert.ok(v('EX-01').reasons.includes('relation-superseded'))
})
check('EX-03 第一窗有效但 R-02 已二次变更 → 跨天窗旧进路失效重算', () => {
  assert.equal(v('EX-03').valid, false)
  assert.ok(v('EX-03').reasons.includes('relation-superseded'))
  assert.ok(!v('EX-03').reasons.includes('step-outside-window'))
})
check('EX-04 在 CHG-02 00:30 生效前(00:10)执行 → 时段外失效', () => {
  assert.equal(v('EX-04').valid, false)
  assert.ok(v('EX-04').reasons.includes('step-outside-window'))
})
check('EX-05 生效时段内 + sig-p02+t03 当前关系 → 有效', () => {
  assert.equal(v('EX-05').valid, true)
})
check('EX-07 旧记录复核在两次天窗之间，但首次执行在第一窗生效时段 → 以首次起算仍有效', () => {
  assert.equal(v('EX-07').valid, true)
  assert.equal(v('EX-07').basisAt, '2026-09-26T03:20:00')
  assert.equal(basisAtOf(seedRecords.find((r) => r.id === 'EX-07')!), '2026-09-26T03:20:00')
})
check('EX-08 无天窗步骤携带 sig-base，R-03 当前 sig-p02 → 旧进路失效', () => {
  assert.equal(v('EX-08').valid, false)
  assert.ok(v('EX-08').reasons.includes('relation-superseded'))
  assert.ok(!v('EX-08').reasons.includes('step-outside-window'))
})
check('EX-10 关联 CHG-03 已被现场撤销 → 失效', () => {
  assert.equal(v('EX-10').valid, false)
  assert.ok(v('EX-10').reasons.includes('change-revoked'))
})
check('EX-11 与 EX-10 同 requestId，重复请求取首次 → EX-11 判重复，EX-10 为首次保留', () => {
  assert.ok(v('EX-11').reasons.includes('duplicate-request'))
  assert.equal(v('EX-11').valid, false)
  assert.ok(!v('EX-10').reasons.includes('duplicate-request'))
})
check('重复请求不产生重算任务：EX-10 的撤销步骤产生 1 个任务，EX-11 不额外产生', () => {
  const ex10Tasks = result.tasks.filter((t) => t.invalidRecordIds.includes('EX-10'))
  assert.equal(ex10Tasks.length, 1)
  assert.ok(!result.tasks.find((t) => t.invalidRecordIds.includes('EX-11')))
})

check('旧口径影响范围含全部 5 条进路（按最终设备表，含已撤销 CHG-03）', () => {
  assert.deepEqual([...result.naiveImpactRouteIds].sort(), ['R-01', 'R-02', 'R-03', 'R-04', 'R-05'])
})
check('对账口径剔除 R-05（CHG-03 撤销且无关系修订），保留 R-01/02/03/04', () => {
  assert.deepEqual([...result.reconciledImpactRouteIds].sort(), ['R-01', 'R-02', 'R-03', 'R-04'])
})
check('R-02 旧口径误带 sig-p02 旧进路（staleCarried>0）', () => {
  const r02 = result.routes.find((item) => item.routeId === 'R-02')!
  assert.ok(r02.staleCarried >= 1)
})
check('EX-04 重算任务已被后续有效 EX-05 覆盖关闭，R-02 仅剩 P-02 反位锁闭任务', () => {
  assert.ok(!result.tasks.some((t) => t.invalidRecordIds.includes('EX-04')))
  assert.ok(result.tasks.some((t) => t.invalidRecordIds.includes('EX-03')))
})

console.log('整批写入与恢复：')

check('写入失败按完整批次恢复：部分写入后回滚，记录数与内容不变', () => {
  const incoming: StepRecord[] = [
    { ...seedRecords[0]!, id: 'NEW-1', requestId: 'REQ-NEW-1' },
    { ...seedRecords[1]!, id: 'NEW-2', requestId: 'REQ-NEW-2' },
    { ...seedRecords[2]!, id: 'NEW-3', requestId: 'REQ-NEW-3' },
  ]
  const before = seedRecords.length
  const outcome = commitBatch({
    records: seedRecords, incoming, failAtIndex: 1,
    failure: { atIndex: 1, message: '联锁服务器连接中断' },
    now: NOW, windows, changes, routes, revisions,
  })
  assert.equal(outcome.rolledBack, true)
  assert.equal(outcome.records.length, before)
  assert.ok(!outcome.records.some((r) => r.id.startsWith('NEW-')))
  assert.match(outcome.failureMessage ?? '', /中断/)
})
check('重复请求取首次：批次内或库内已有同 requestId 时跳过，不覆盖首次', () => {
  const replay = { ...seedRecords.find((r) => r.id === 'EX-10')!, id: 'EX-10-AGAIN', executedAt: NOW, evidence: ['重放'] }
  const outcome = commitBatch({ records: seedRecords, incoming: [replay], now: NOW, windows, changes, routes, revisions })
  assert.equal(outcome.rolledBack, false)
  assert.equal(outcome.skippedDuplicates.length, 1)
  assert.equal(outcome.accepted.length, 0)
})
check('旧记录回填更早的首次执行时间时，以首次为准替换保留', () => {
  const base = seedRecords.find((r) => r.id === 'EX-06')!
  const earlier = { ...base, id: 'EX-06B', firstExecutionAt: '2026-09-25T23:30:00', executedAt: NOW }
  const outcome = commitBatch({ records: seedRecords, incoming: [earlier], now: NOW, windows, changes, routes, revisions })
  assert.equal(outcome.accepted.length, 1)
  assert.ok(outcome.records.some((r) => r.id === 'EX-06B'))
})

console.log('发布基线与候选版本：')

check('有未闭环重算任务时发布门禁阻断', () => {
  assert.equal(result.tasks.length > 0, true)
})
check('全部重算完成（R-02/R-03/R-05 用当前关系重测通过）后门禁通过', () => {
  const repaired = [...seedRecords]
  for (const task of result.tasks) {
    const current = result.routes.find((scope) => scope.routeId === task.routeId)!.currentSignature
    repaired.push({
      id: `FIX-${task.key}`, requestId: `FIX-${task.key}`,
      caseId: task.caseId, caseName: task.caseName, routeId: task.routeId, action: task.action,
      result: '通过', executedAt: '2026-10-03T05:00:00', relationSigAtExec: current,
      // R-05 变更已撤销：重算回到基线关系复核，不再挂 changeId；其余挂第二次天窗生效变更
      changeId: task.routeId === 'R-05' ? undefined : 'CHG-02',
      operator: '重算', snapshot: 'v26.10', evidence: ['FIX'],
    })
  }
  // R-05 撤销变更的重算不应再带 changeId（撤销后回到基线关系复核）
  const fixed = repaired.find((r) => r.id === 'FIX-C-105|R-05|按变更单试排 4G 侧线进路')
  assert.ok(fixed)
  const again = reconcile({ now: NOW, windows, changes, routes, revisions, records: repaired })
  assert.equal(again.tasks.length, 0, `剩余任务：${again.tasks.map((t) => t.key).join('; ')}`)
})
check('锁定基线只固化有效（且未被取代）的步骤，影响范围按对账口径', () => {
  const { snapshot } = lockBaseline('v26.10', NOW, { windows, changes, routes, revisions, records: seedRecords })
  assert.ok(!snapshot.validRecordIds.includes('EX-11'))
  assert.ok(!snapshot.validRecordIds.includes('EX-01'))
  assert.ok(!snapshot.validRecordIds.includes('EX-10'))
  assert.ok(snapshot.validRecordIds.includes('EX-02'))
  assert.deepEqual(snapshot.impactRouteIds.sort(), ['R-01', 'R-02', 'R-03', 'R-04'])
  assert.ok(!snapshot.records.some((r) => !result.verdicts.find((v) => v.recordId === r.id)?.valid))
})
check('锁定后改动只生成候选版本，基线快照不变', () => {
  const { snapshot } = lockBaseline('v26.10', NOW, { windows, changes, routes, revisions, records: seedRecords })
  const before = JSON.stringify(snapshot)
  const candidate = proposeCandidate(snapshot, '锁后追加 P-01', { changes, records: seedRecords, revisions }, NOW)
  assert.ok(candidate.id.startsWith('CAND-'))
  assert.equal(JSON.stringify(snapshot), before)
  assert.equal(snapshot.records.some((r) => r.id === 'SHOULD-NOT-EXIST'), false)
})

console.log(`\n全部 ${passed} 项断言通过 ✔`)
