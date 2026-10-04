<script setup lang="ts">
import { computed } from 'vue'
import { useReconcileStore } from '../reconcile/store'

const store = useReconcileStore()
const result = computed(() => store.result)

const routeMap = computed(() => new Map(store.routes.map((item) => [item.id, item])))
const changeMap = computed(() => new Map(store.changes.map((item) => [item.id, item])))
const windowMap = computed(() => new Map(store.windows.map((item) => [item.id, item])))

const tagType = (code: string) =>
  code === 'valid' ? 'success' : code === 'duplicate-request' ? 'default' : code === 'change-revoked' ? 'warning' : 'error'

function recordOf(id: string) {
  return store.records.find((item) => item.id === id)
}
function verdictOf(id: string) {
  return store.verdictMap.get(id)
}
function scopeOf(routeId: string) {
  return result.value.routes.find((item) => item.routeId === routeId)
}

const validCount = computed(() => result.value.verdicts.filter((item) => item.valid).length)
const invalidCount = computed(() => result.value.verdicts.length - validCount.value)
const duplicateCount = computed(() => result.value.verdicts.filter((item) => item.reasons.includes('duplicate-request')).length)
const staleCount = computed(() => result.value.routes.reduce((sum, item) => sum + item.staleCarried, 0))

const naiveSet = computed(() => new Set(result.value.naiveImpactRouteIds))
const reconciledSet = computed(() => new Set(result.value.reconciledImpactRouteIds))

function fmt(value?: string) {
  return value ? value.replace('T', ' ') : ''
}
function changeTag(change: { status: string; effectiveAt?: string; revokedAt?: string }) {
  return change.status === 'applied' ? `生效 ${fmt(change.effectiveAt)}` : `已撤销 ${fmt(change.revokedAt)}`
}

const timeline = computed(() =>
  store.revisions
    .filter((item) => item.changeId)
    .map((item) => ({ ...item, routeName: routeMap.value.get(item.routeId)?.name ?? item.routeId }))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)),
)</script>

<template>
  <section class="page-head">
    <div>
      <p class="eyebrow">设备变更 · 进路关系 · 执行记录 · 发布基线</p>
      <h1>生效时段对账</h1>
      <p>施工天窗分两次换道岔与轨道区段，现场还会撤销变更；对账只认「落在生效时段且关联当前进路」的步骤，跨天窗旧进路结果失效重算。</p>
    </div>
    <n-space>
      <n-button @click="store.resetAll()">重置场景</n-button>
      <n-button @click="store.replayDuplicates()">重放重复请求</n-button>
      <n-button type="primary" :disabled="store.gate.openTasks > 0 || !!store.baseline" @click="store.doLock">
        {{ store.baseline ? `基线已锁定 ${store.baseline.version}` : `锁定发布基线（待重算 ${store.gate.openTasks}）` }}
      </n-button>
    </n-space>
  </section>

  <n-alert
    :type="store.batchError ? 'error' : store.baseline ? 'success' : 'info'"
    :title="store.batchMessage"
    style="margin-bottom:16px"
  />

  <div class="metrics">
    <article class="card metric"><span>对账步骤</span><strong>{{store.records.length}}</strong><small>含重复请求 {{duplicateCount}} 条</small></article>
    <article class="card metric" style="border-left-color:#16a34a"><span>有效</span><strong>{{validCount}}</strong><small>落在生效时段 · 当前进路</small></article>
    <article class="card metric" style="border-left-color:#dc2626"><span>失效重算</span><strong>{{invalidCount}}</strong><small>其中跨天窗旧进路 {{staleCount}} 条</small></article>
    <article class="card metric" style="border-left-color:#d97706"><span>重算任务 / 基线</span><strong>{{store.gate.openTasks}}</strong><small>{{store.baseline ? `已锁定 ${store.baseline.version}` : '门禁未闭环，禁止发布'}}</small></article>
  </div>

  <div class="grid-2">
    <!-- 时间轴 -->
    <article class="card">
      <div class="panel-head">
        <div><h2>生效时段时间轴</h2><p>进路关系版本只在变更实际生效后切换</p></div>
        <n-tag type="info">2 次天窗</n-tag>
      </div>
      <n-timeline>
        <n-timeline-item v-for="window in store.windows" :key="window.id" type="info" :title="window.name">
          {{window.startAt.replace('T',' ')}} → {{window.endAt.replace('T',' ')}}
        </n-timeline-item>
      </n-timeline>
      <n-divider />
      <h3>设备变更与现场撤销</h3>
      <div v-for="change in store.changes" :key="change.id" class="change">
        <n-tag :type="change.status === 'applied' ? 'success' : 'warning'">
          {{changeTag(change)}}
        </n-tag>
        <div>
          <b>{{change.id}} · {{change.name}}</b>
          <small>{{change.kind}} {{change.deviceName}} · {{change.note}}</small>
        </div>
      </div>
      <n-divider />
      <h3>进路关系修订</h3>
      <div v-for="rev in timeline" :key="rev.id" class="rev-row">
        <n-tag size="small">{{rev.effectiveFrom.replace('T',' ')}}</n-tag>
        <div><b>{{rev.routeId}} · {{rev.routeName}}</b><small>{{rev.summary}} · 指纹 {{rev.signature}}</small></div>
      </div>
    </article>

    <!-- 影响范围对账 -->
    <article class="card">
      <div class="panel-head">
        <div><h2>影响范围：最终设备表 vs 生效时段对账</h2><p>旧口径一次算完会带旧进路、算进已撤销变更</p></div>
      </div>
      <table class="scope-table">
        <thead><tr><th>进路</th><th>最终设备表口径</th><th>时段对账口径</th><th>有效 / 失效</th><th>旧口径误带</th></tr></thead>
        <tbody>
          <tr v-for="scope in result.routes" :key="scope.routeId">
            <td><b>{{scope.routeId}}</b><small>{{scope.routeName}}</small></td>
            <td><n-tag :type="naiveSet.has(scope.routeId) ? 'warning' : 'default'">{{naiveSet.has(scope.routeId) ? '影响' : '—'}}</n-tag></td>
            <td><n-tag :type="reconciledSet.has(scope.routeId) ? 'error' : 'success'">{{reconciledSet.has(scope.routeId) ? '需重算' : '可沿用'}}</n-tag></td>
            <td>{{scope.valid}} / {{scope.invalid}}</td>
            <td>
              <span v-if="scope.staleCarried" class="stale-badge">{{scope.staleCarried}} 条旧进路</span>
              <span v-else-if="scope.carriedValid" class="carry-badge">{{scope.carriedValid}} 条有效沿用</span>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <n-alert
        type="error"
        title="R-05 只在最终设备表里：CHG-03 现场已撤销，对账口径剔除"
        style="margin-top:12px"
      />
      <n-alert
        type="warning"
        title="R-02 跨天窗陷阱：第一次天窗的 sig-p02 结果不能带入第二次天窗后的发布"
        style="margin-top:8px"
      />
    </article>
  </div>

  <!-- 逐条执行记录对账 -->
  <article class="card" style="margin-top:16px">
    <div class="panel-head">
      <div><h2>执行记录逐条对账</h2><p>旧记录以首次执行时间起算；重复请求只认首次提交</p></div>
      <n-space>
        <n-button size="small" @click="store.armFailure(1)">布置下一批写入失败（验整批恢复）</n-button>
      </n-space>
    </div>
    <table class="rec-table">
      <thead>
        <tr><th>记录</th><th>用例 / 进路 / 步骤</th><th>执行时间</th><th>对账起算</th><th>关系指纹</th><th>关联变更</th><th>结论</th></tr>
      </thead>
      <tbody>
        <tr v-for="record in store.records" :key="record.id" :class="{rowInvalid:!(verdictOf(record.id)?.valid)}">
          <td><b>{{record.id}}</b><small>{{record.requestId}}</small><small v-if="verdictOf(record.id)?.supersededBy">被 {{verdictOf(record.id)?.supersededBy}} 取代</small></td>
          <td><b>{{record.caseId}} · {{record.caseName}}</b><small>{{record.routeId}} · {{record.action}}</small><small>{{record.operator}} · {{record.snapshot}}</small></td>
          <td>{{record.executedAt.replace('T',' ')}}</td>
          <td>
            {{(verdictOf(record.id)?.basisAt ?? record.executedAt).replace('T',' ')}}
            <n-tag v-if="record.firstExecutionAt" size="small" type="info">旧记录取首次</n-tag>
          </td>
          <td>
            {{record.relationSigAtExec}}
            <n-tag v-if="verdictOf(record.id)?.currentSignature && verdictOf(record.id)?.currentSignature !== record.relationSigAtExec" size="small" type="error">
              当前 {{verdictOf(record.id)?.currentSignature}}
            </n-tag>
            <n-tag v-else size="small" type="success">当前一致</n-tag>
          </td>
          <td>
            <template v-if="record.changeId">
              <n-tag size="small" :type="changeMap.get(record.changeId)?.status === 'revoked' ? 'warning' : 'default'">
                {{record.changeId}} {{changeMap.get(record.changeId)?.status === 'revoked' ? '（撤销）' : ''}}
              </n-tag>
              <small>{{windowMap.get(changeMap.get(record.changeId)?.windowId ?? '')?.name}}</small>
            </template>
            <span v-else>无天窗（关系复核）</span>
          </td>
          <td>
            <n-tag :type="verdictOf(record.id)?.valid ? 'success' : tagType(verdictOf(record.id)?.primary ?? '')">
              {{verdictOf(record.id)?.valid ? '有效' : '失效重算'}}
            </n-tag>
            <small v-for="code in verdictOf(record.id)?.reasons.filter((item)=>item!=='valid')" :key="code" class="reason">
              · {{store.REASON_LABEL[code]}}
            </small>
          </td>
        </tr>
      </tbody>
    </table>
  </article>

  <!-- 重算任务 -->
  <article class="card" style="margin-top:16px">
    <div class="panel-head">
      <div><h2>失效结果重算任务</h2><p>同一步骤的多条失效记录合并为一个任务；重复请求不产生任务</p></div>
      <n-tag :type="result.tasks.length ? 'error' : 'success'">{{result.tasks.length}} 个待处理</n-tag>
    </div>
    <n-empty v-if="!result.tasks.length" description="无待重算任务，发布门禁已闭环" />
    <div v-for="task in result.tasks" :key="task.key" class="task-row">
      <div>
        <b>{{task.caseId}} · {{task.caseName}}</b>
        <small>{{task.routeId}} · {{task.action}}</small>
        <small>失效记录：{{task.invalidRecordIds.join('、')}}</small>
      </div>
      <n-space>
        <n-button size="small" type="error" @click="store.submitRecompute(task.key,'失败')">重测失败</n-button>
        <n-button size="small" type="success" @click="store.submitRecompute(task.key,'通过')">重测通过（整批写入）</n-button>
      </n-space>
    </div>
  </article>

  <!-- 锁定基线与候选版本 -->
  <div class="grid-2" style="margin-top:16px">
    <article class="card">
      <div class="panel-head"><div><h2>发布基线</h2><p>只固化有效步骤与生效变更影响范围</p></div>
        <n-tag :type="store.baseline ? 'success' : 'warning'">{{store.baseline ? '已锁定' : '未锁定'}}</n-tag>
      </div>
      <n-result v-if="store.baseline" status="success" :title="`${store.baseline.version} · ${store.baseline.lockedAt.replace('T',' ')}`"
        :description="`固化有效步骤 ${store.baseline.records.length} 条；影响进路 ${store.baseline.impactRouteIds.join('、')}`" />
      <n-alert v-else :type="store.gate.ready ? 'success' : 'warning'"
        :title="store.gate.ready ? '重算任务已清空，可以锁定基线' : `还有 ${store.gate.openTasks} 个重算任务，锁定按钮阻断`" />
      <n-button v-if="store.baseline" type="warning" style="margin-top:10px" @click="store.registerPostLockChange()">
        模拟锁后追加 P-01 变更（只生成候选）
      </n-button>
    </article>
    <article class="card">
      <div class="panel-head"><div><h2>候选版本</h2><p>锁定基线后任何改动只生成候选，不改写基线</p></div>
        <n-tag>{{store.candidates.length}}</n-tag></div>
      <n-empty v-if="!store.candidates.length" description="锁定基线后这里才会出现候选版本" />
      <div v-for="candidate in store.candidates" :key="candidate.id" class="candidate-row">
        <n-tag type="warning">{{candidate.id}}</n-tag>
        <div><b>{{candidate.reason}}</b><small>{{candidate.createdAt.replace('T',' ')}}</small></div>
      </div>
      <n-divider />
      <h3>操作审计</h3>
      <n-timeline>
        <n-timeline-item v-for="(line,index) in store.log" :key="index" :title="line" />
      </n-timeline>
    </article>
  </div>
</template>

<style scoped>
.scope-table,.rec-table{width:100%;border-collapse:collapse;font-size:13px}
.scope-table th,.scope-table td,.rec-table th,.rec-table td{text-align:left;padding:9px 8px;border-bottom:1px solid #edf0f5;vertical-align:top}
.scope-table th,.rec-table th{color:#7a8798;font-weight:600;background:#f8fafc}
.scope-table td small,.rec-table td small{display:block;color:#7a8798;margin-top:3px}
.rec-table tr.rowInvalid{background:#fff7f7}
.reason{display:block;margin-top:3px;color:#b42318}
.stale-badge{color:#b42318;font-weight:700}
.carry-badge{color:#15803d;font-weight:700}
.rev-row{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #edf0f5}
.rev-row small{display:block;color:#7a8798;margin-top:3px}
.task-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #edf0f5}
.task-row small{display:block;color:#7a8798;margin-top:4px}
.candidate-row{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #edf0f5}
.candidate-row small{display:block;color:#7a8798;margin-top:3px}
</style>
