<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { fetchStation } from '../api'
import { useTestStore } from '../store'
import { useExecutionSocket } from '../realtime'

const store = useTestStore()
const { data, isPending } = useQuery({ queryKey:['station'], queryFn:fetchStation })
useExecutionSocket((value) => store.updateLiveProgress(value), (state) => { store.connection = state })
const stats = computed(() => [
  { label:'测试用例', value:store.activeCases.length, note:'关联 4 条基本进路' },
  { label:'执行进度', value:`${store.progress}%`, note:'实时同步正常' },
  { label:'失败 / 阻塞', value:store.activeCases.filter((item)=>['失败','阻塞'].includes(item.status)).length, note:'发布前必须闭环' },
  { label:'受影响回归范围', value:store.affectedCases.length, note:'按生效时段对账推导' },
])
const report = computed(() => store.reconcileReport)
</script>

<template>
  <section class="page-head"><div><p class="eyebrow">版本升级与回归范围</p><h1>联锁测试回归总览</h1><p>按生效时段核对设备变更、进路关系与执行记录，失效结果重算后再进入发布。</p></div><n-space><n-button @click="store.runReconcile">重新对账</n-button><n-button type="primary" @click="$router.push('/station')">查看站场受影响区域</n-button></n-space></section>
  <n-spin :show="isPending">
    <div class="metrics"><article v-for="item in stats" :key="item.label" class="card metric"><span>{{item.label}}</span><strong>{{item.value}}</strong><small>{{item.note}}</small></article></div>
    <div class="grid-2"><article class="card"><div class="panel-head"><div><h2>本轮变更影响</h2><p>施工天窗分两次，带生效时段</p></div><n-tag type="warning">{{data?.version}}</n-tag></div><div v-for="change in store.equipmentChanges" :key="change.id" class="change"><n-tag :type="change.revoked ? 'default' : 'error'">{{change.revoked ? '已撤销' : `第${change.phase}阶段`}}</n-tag><div><b>{{change.description}}</b><small>{{change.effectiveFrom}} 起{{change.effectiveTo ? ` → ${change.effectiveTo} 撤销` : ' · 仍生效'}} · 影响 {{store.affectedCases.length}} 条用例</small></div></div><n-alert type="warning" title="跨天窗结果不得带着旧进路进入发布" description="只有落在变更生效时段且关联当前进路的步骤结果有效，其余失效重算；重复请求取首次。" /></article>
      <article class="card"><div class="panel-head"><div><h2>对账状态</h2><p>设备变更 · 进路关系 · 执行记录</p></div><n-tag :type="report ? (report.invalidCount ? 'warning' : 'success') : 'info'">{{report ? (report.invalidCount ? `${report.invalidCount} 项失效` : '全部有效') : '未对账'}}</n-tag></div><div v-if="report" class="reconcile-summary"><div class="rec-row"><span>有效结果</span><b class="ok">{{report.validCount}}</b></div><div class="rec-row"><span>失效待重算</span><b class="bad">{{report.invalidCount}}</b></div><div class="rec-row"><span>变更条目</span><b>{{report.scope.length}}</b></div><div class="rec-row"><span>进路版本</span><b>{{report.routeVersions.length}}</b></div></div><n-divider /><h3>执行状态</h3><n-progress type="line" :percentage="store.progress" :height="12" /><div v-for="item in store.activeCases" :key="item.id" class="case-row" @click="store.selectCase(item.id); $router.push('/execution')"><div><b>{{item.id}} · {{item.name}}</b><small>{{item.steps.filter((step)=>step.result!=='未执行').length}}/{{item.steps.length}} 步骤 · 关联 {{item.routeIds.join(' / ')}}</small></div><n-tag :type="item.status === '通过' ? 'success' : item.status === '失败' ? 'error' : item.status === '阻塞' ? 'warning' : 'info'">{{item.status}}</n-tag></div></article></div>
  </n-spin>
</template>
