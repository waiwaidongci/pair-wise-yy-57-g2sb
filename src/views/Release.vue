<script setup lang="ts">
import { computed } from 'vue'
import { useTestStore } from '../store'

const store = useTestStore()
const ready = computed(() => store.activeCases.every((item) => item.status === '通过'))
const report = computed(() => store.reconcileReport)
function exportPackage() {
  const rec = store.reconcileReport
  const pkg = {
    station:'海州站 CS',
    version: store.isCandidate ? store.candidateVersion : 'v26.10',
    locked:store.baselineLocked,
    candidate: store.isCandidate,
    reconcile: rec ? { valid:rec.validCount, invalid:rec.invalidCount, generatedAt:rec.generatedAt } : null,
    cases:store.activeCases.map((item)=>({id:item.id,name:item.name,status:item.status,steps:item.steps.length,failureReason:item.failureReason})),
    executions:store.activeExecutions,
    generatedAt:new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(pkg,null,2)],{type:'application/json'})
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download=`联锁测试报告-${pkg.version}.json`; link.click(); URL.revokeObjectURL(link.href)
}
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">发布门禁与历史基线</p><h1>基线锁定与测试报告</h1><p>全部未通过、阻塞和证据缺失项闭环后，才能锁定版本并导出可追溯测试报告。</p></div><n-space><n-button @click="exportPackage">导出测试报告</n-button><n-button type="primary" :disabled="!ready || store.baselineLocked" @click="store.lockBaseline">锁定发布基线</n-button></n-space></section>
  <n-alert :type="ready ? 'success' : 'error'" :title="ready ? '全部用例已通过，可锁定' : '发布门禁未通过'" :description="ready ? '设备快照、执行证据和失败闭环均完整。' : '存在失败、阻塞或未执行步骤，任何人员不得无痕跳过。'" style="margin-bottom:16px" />
  <div v-if="store.isCandidate" class="candidate-banner"><span>候选版本</span><div><b>{{store.candidateVersion}}</b> · 基线已锁定，本次改动仅进入候选版本，不影响已发布基线。</div><n-button size="small" type="primary" @click="store.publishCandidate">发布为新基线</n-button><n-button size="small" @click="store.discardCandidate">丢弃</n-button></div>
  <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>发布门禁清单</h2><p>自动判断，不允许人工绕过</p></div><n-tag :type="ready?'success':'error'">{{ready?'可发布':'阻断'}}</n-tag></div><div v-for="item in store.activeCases" :key="item.id" class="gate"><div><b>{{item.id}} · {{item.name}}</b><small>{{item.failureReason || '执行记录完整'}}</small></div><n-tag :type="item.status==='通过'?'success':item.status==='失败'?'error':item.status==='阻塞'?'warning':'info'">{{item.status}}</n-tag></div></article>
    <article class="card"><div class="panel-head"><div><h2>对账与失效重算</h2><p>按生效时段核对设备变更与进路关系</p></div><n-space><n-button size="small" @click="store.runReconcile">重新对账</n-button><n-button size="small" type="warning" :disabled="!report || report.invalidCount===0" @click="store.applyRecalc">失效重算{{report && report.invalidCount ? ` ${report.invalidCount}` : ''}}</n-button><n-button size="small" @click="store.dedupeExecutions">重复请求去重</n-button></n-space></div>
      <div v-if="report && report.invalidated.length" class="recalc-list"><div v-for="r in report.invalidated" :key="`${r.caseId}:${r.stepId}`" class="recalc-item"><div><b>{{r.caseId}} · {{r.stepId}}</b><small>{{r.reason}} · 生效时间 {{r.effectiveTime}}</small></div><n-tag type="warning">失效</n-tag></div></div>
      <n-empty v-else description="对账未发现失效结果" size="small" />
      <div v-if="store.batchStatus==='rolled-back'" class="batch-status rolled-back">批次写入失败，已按完整批次恢复：{{store.lastBatchError}}</div>
      <div v-else-if="store.batchStatus==='committed'" class="batch-status">批次写入已提交</div>
      <n-divider />
      <h3>基线状态</h3><n-result :status="store.baselineLocked ? 'success' : 'info'" :title="store.baselineLocked ? (store.isCandidate ? '候选版本待发布' : 'v26.10 已锁定') : '等待全部用例通过'" :description="store.baselineLocked ? '报告与证据哈希已签章；改动仅生成候选版本。' : '锁定后生成只读版本快照。'" /></article></div>
</template>
