<template>
  <ArtDrawer
    ref="drawerRef"
    header-icon="ri:line-chart-line"
    :loading="state.loading"
    :show-footer="false"
  >
    <div class="profit-analyst">
      <template v-if="state.data">
        <ArtSectionCard
          :class="['profit-analyst__hero', `is-${assessment.riskLevel}`]"
          :show-scrollbar="false"
        >
          <template #header>
            <header class="profit-analyst__hero-header">
              <div class="profit-analyst__hero-main">
                <span class="profit-analyst__hero-icon">
                  <ArtSvgIcon icon="ri:funds-box-line" />
                </span>
                <div>
                  <span class="profit-analyst__eyebrow"><i />AI PROFIT HEALTH CHECK</span>
                  <div class="profit-analyst__title-row">
                    <strong>运单利润经营体检</strong>
                    <ElTag :type="riskTagType" effect="dark" round>{{ riskLabel }}</ElTag>
                    <ElTag type="info" effect="plain" round>{{ recommendationLabel }}</ElTag>
                  </div>
                  <p>分析当前租户最近 {{ assessment.metrics.totalWaybills }} 票非作废运单</p>
                </div>
              </div>
              <ElButton type="primary" plain :loading="state.loading" @click="loadAssessment">
                <ArtSvgIcon icon="ri:refresh-line" />重新诊断
              </ElButton>
            </header>
          </template>

          <div class="profit-analyst__scores">
            <article>
              <header
                ><span>经营风险</span><strong>{{ assessment.riskScore }}</strong></header
              >
              <ElProgress
                :percentage="assessment.riskScore"
                :show-text="false"
                :stroke-width="6"
                :color="riskProgressColor"
              />
              <small>综合亏损、成本覆盖与承运应付</small>
            </article>
            <article>
              <header
                ><span>诊断置信度</span><strong>{{ confidencePercent }}%</strong></header
              >
              <ElProgress :percentage="confidencePercent" :show-text="false" :stroke-width="6" />
              <small>基于当前系统业务数据</small>
            </article>
            <article>
              <header
                ><span>成本覆盖率</span
                ><strong>{{ formatPercent(assessment.metrics.costCoverage) }}</strong></header
              >
              <ElProgress
                :percentage="assessment.metrics.costCoverage"
                :show-text="false"
                :stroke-width="6"
                :color="coverageProgressColor"
              />
              <small>{{ assessment.metrics.missingCostCount }} 票尚未形成成本</small>
            </article>
          </div>

          <div class="profit-analyst__conclusion">
            <span><ArtSvgIcon :icon="conclusionIcon" /></span>
            <div>
              <small>AI 经营结论</small>
              <p>{{ assessment.summary }}</p>
            </div>
          </div>
        </ArtSectionCard>

        <ArtSectionCard
          class="profit-analyst__section"
          title="利润健康指标"
          :show-scrollbar="false"
        >
          <div class="profit-analyst__metrics">
            <article class="art-card-xs">
              <span class="profit-analyst__metric-icon is-receivable">
                <ArtSvgIcon icon="ri:wallet-3-line" />
              </span>
              <div
                ><span>账面应收</span
                ><strong>{{ formatMoney(assessment.metrics.receivableAmount) }}</strong
                ><small>当前分析范围</small></div
              >
            </article>
            <article class="art-card-xs">
              <span class="profit-analyst__metric-icon is-cost">
                <ArtSvgIcon icon="ri:funds-line" />
              </span>
              <div
                ><span>已形成成本</span
                ><strong>{{ formatMoney(assessment.metrics.totalCostAmount) }}</strong
                ><small>审核成本与承运应付</small></div
              >
            </article>
            <article :class="['art-card-xs', profitTone]">
              <span class="profit-analyst__metric-icon is-profit">
                <ArtSvgIcon icon="ri:line-chart-line" />
              </span>
              <div
                ><span>账面毛利</span
                ><strong>{{ formatMoney(assessment.metrics.bookGrossProfit) }}</strong
                ><small>受成本覆盖率影响</small></div
              >
            </article>
            <article class="art-card-xs">
              <span class="profit-analyst__metric-icon is-coverage">
                <ArtSvgIcon icon="ri:pie-chart-2-line" />
              </span>
              <div
                ><span>完成单成本覆盖</span
                ><strong>{{ formatPercent(assessment.metrics.finalizedCostCoverage) }}</strong
                ><small>{{ assessment.metrics.finalizedWaybills }} 票完成/签收</small></div
              >
            </article>
            <article class="art-card-xs is-danger">
              <span class="profit-analyst__metric-icon is-loss">
                <ArtSvgIcon icon="ri:arrow-down-circle-line" />
              </span>
              <div
                ><span>亏损运单</span
                ><strong>{{ assessment.metrics.negativeMarginCount }} 票</strong
                ><small>毛利额或毛利率为负</small></div
              >
            </article>
            <article class="art-card-xs">
              <span class="profit-analyst__metric-icon is-carrier">
                <ArtSvgIcon icon="ri:truck-line" />
              </span>
              <div
                ><span>承运应付缺失</span
                ><strong>{{ assessment.metrics.carrierPayableMissingCount }} 票</strong
                ><small>已关联承运商但应付为零</small></div
              >
            </article>
          </div>
        </ArtSectionCard>

        <ArtSectionCard
          class="profit-analyst__section"
          title="经营风险信号"
          :show-scrollbar="false"
          :empty="!assessment.signals.length"
          empty-title="当前未识别到明确经营风险"
          empty-description="仍可按下方建议顺序复核运单利润。"
        >
          <div v-if="assessment.signals.length" class="profit-analyst__signals">
            <article
              v-for="signal in assessment.signals"
              :key="signal.type"
              :class="['profit-analyst__signal art-card-xs', `is-${signal.severity}`]"
            >
              <header>
                <div>
                  <span><ArtSvgIcon :icon="signalIcon(signal.severity)" /></span>
                  <strong>{{ signal.title }}</strong>
                </div>
                <ElTag :type="severityTagType(signal.severity)" effect="light" round>
                  {{ severityLabel(signal.severity) }}
                </ElTag>
              </header>
              <p>{{ signal.detail }}</p>
              <div class="profit-analyst__evidence">
                <span v-for="item in signal.evidence" :key="item"><i />{{ item }}</span>
              </div>
            </article>
          </div>
        </ArtSectionCard>

        <ArtSectionCard
          class="profit-analyst__section"
          title="优先核对运单"
          :show-scrollbar="false"
          :empty="!assessment.riskWaybills.length"
          empty-title="暂无需要优先核对的运单"
          empty-description="后续出现高风险运单时会在此列出。"
        >
          <div v-if="assessment.riskWaybills.length" class="profit-analyst__waybills">
            <article
              v-for="waybill in assessment.riskWaybills"
              :key="waybill.id || waybill.waybillId"
              class="profit-analyst__waybill art-card-xs"
            >
              <header>
                <div>
                  <span class="profit-analyst__risk-score">{{ waybill.riskScore }}</span>
                  <div>
                    <strong>{{ waybill.waybillNo }}</strong>
                    <p><ArtSvgIcon icon="ri:route-line" />{{ waybill.route }}</p>
                  </div>
                </div>
                <ElTag :type="getWaybillStatusPresentation(waybill.waybillStatus).type">
                  {{ getWaybillStatusPresentation(waybill.waybillStatus).label }}
                </ElTag>
              </header>
              <div class="profit-analyst__waybill-party">
                <span class="art-icon-label"
                  ><ArtSvgIcon icon="ri:building-2-line" />{{ waybill.customerName }}</span
                >
                <span class="art-icon-label"
                  ><ArtSvgIcon icon="ri:truck-line" />{{ waybill.carrierName }}</span
                >
              </div>
              <div class="profit-analyst__waybill-metrics">
                <span
                  >应收<strong>{{ formatMoney(waybill.receivableAmount) }}</strong></span
                >
                <span
                  >成本<strong>{{ formatMoney(waybill.totalCostAmount) }}</strong></span
                >
                <span
                  >毛利<strong :class="{ 'is-negative': waybill.grossProfit < 0 }">{{
                    formatMoney(waybill.grossProfit)
                  }}</strong></span
                >
              </div>
              <div class="profit-analyst__reasons">
                <span v-for="reason in waybill.reasons" :key="reason">{{ reason }}</span>
              </div>
            </article>
          </div>
        </ArtSectionCard>

        <ArtSectionCard
          class="profit-analyst__section"
          title="建议处理顺序"
          :show-scrollbar="false"
          :empty="!assessment.recommendedActions.length"
          empty-title="暂无处理建议"
          empty-description="可结合利润指标和风险信号进行人工复核。"
        >
          <ol class="profit-analyst__actions">
            <li v-for="(action, index) in assessment.recommendedActions" :key="action">
              <span>{{ index + 1 }}</span>
              <div
                ><small>经营核对步骤 {{ index + 1 }}</small
                ><p>{{ action }}</p></div
              >
            </li>
          </ol>
        </ArtSectionCard>

        <ArtSectionCard
          class="profit-analyst__section"
          title="数据边界"
          :show-scrollbar="false"
          :empty="!assessment.limitations.length"
          empty-title="暂无补充说明"
          empty-description="请结合当前分析范围复核诊断结果。"
        >
          <div class="profit-analyst__limitations">
            <p v-for="item in assessment.limitations" :key="item">
              <ArtSvgIcon icon="ri:checkbox-circle-line" /><span>{{ item }}</span>
            </p>
          </div>
        </ArtSectionCard>

        <ArtAiFeedback :run-id="state.data.runId" context-label="AI 运单利润诊断" />

        <footer
          class="mt-5 flex flex-wrap items-center gap-3.5 border-t border-dashed border-(--el-border-color-lighter) px-0.5 pt-3.5 pb-0.5 text-xs text-g-700 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.25"
        >
          <span class="art-icon-label"
            ><ArtSvgIcon icon="ri:git-commit-line" />{{ state.data.ruleVersion }}</span
          >
          <span class="art-icon-label"
            ><ArtSvgIcon icon="ri:time-line" />{{
              formatDateTimeValue(state.data.generatedAt)
            }}</span
          >
          <span class="art-icon-label"
            ><ArtSvgIcon icon="ri:shield-check-line" />只读诊断，不会自动修改财务数据</span
          >
        </footer>
      </template>

      <ArtAsyncState
        v-else-if="state.error"
        :error="state.error"
        error-title="利润诊断失败"
        @retry="loadAssessment"
      />
    </div>
  </ArtDrawer>
</template>

<script setup lang="ts">
  import {
    formatDateTimeValue,
    formatCnyCurrencyValue as formatMoney,
    formatPercentValue as formatPercent
  } from '@/utils/ui/format'

  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import type { UnwrapNestedRefs } from 'vue'
  import ArtAiFeedback from '@/components/core/base/art-ai-feedback/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import { analyzeWaybillProfitByAi } from '@fms/api'
  import { getWaybillStatusPresentation } from '../../../modules/waybill-status'

  defineOptions({ name: 'FinanceWaybillProfitAnalysisDrawer' })

  type AnalysisResponse = Api.Fms.WaybillProfitAnalysisResponse
  type RiskLevel = Api.Fms.WaybillProfitAnalysisRiskLevel
  type Recommendation = Api.Fms.WaybillProfitAnalysisRecommendation
  type Severity = Api.Fms.WaybillProfitAnalysisSeverity

  interface AnalysisState {
    data: AnalysisResponse | null
    error: string
    loading: boolean
  }

  const drawerRef = ref<ArtDrawerExpose<Record<string, never>>>()
  const state: UnwrapNestedRefs<AnalysisState> = reactive<AnalysisState>({
    data: null,
    error: '',
    loading: false
  })

  const riskLabelMap: Record<RiskLevel, string> = {
    critical: '严重风险',
    high: '高风险',
    medium: '中风险',
    low: '健康'
  }
  const recommendationLabelMap: Record<Recommendation, string> = {
    repair_cost_baseline: '先补齐成本基线',
    manual_profit_review: '优先人工复核亏损',
    routine_monitoring: '进入常规经营监控'
  }
  const tagTypeMap = {
    critical: 'danger',
    high: 'danger',
    medium: 'warning',
    low: 'success'
  } as const
  const progressColorMap: Record<RiskLevel, string> = {
    critical: 'var(--el-color-danger)',
    high: 'var(--el-color-danger)',
    medium: 'var(--el-color-warning)',
    low: 'var(--el-color-success)'
  }

  const assessment = computed(() => state.data!.assessment)
  const riskLabel = computed(() => riskLabelMap[assessment.value.riskLevel])
  const riskTagType = computed(() => tagTypeMap[assessment.value.riskLevel])
  const recommendationLabel = computed(
    () => recommendationLabelMap[assessment.value.recommendation]
  )
  const confidencePercent = computed(() => Math.round(assessment.value.confidence * 100))
  const riskProgressColor = computed(() => progressColorMap[assessment.value.riskLevel])
  const coverageProgressColor = computed(() => {
    const coverage = assessment.value.metrics.costCoverage
    return coverage < 30
      ? 'var(--el-color-danger)'
      : coverage < 70
        ? 'var(--el-color-warning)'
        : 'var(--el-color-success)'
  })
  const conclusionIcon = computed(() =>
    assessment.value.riskLevel === 'critical' || assessment.value.riskLevel === 'high'
      ? 'ri:alarm-warning-line'
      : 'ri:checkbox-circle-line'
  )
  const profitTone = computed(() =>
    assessment.value.metrics.bookGrossProfit < 0 ? 'is-danger' : 'is-neutral'
  )

  async function handleOpen(): Promise<void> {
    Object.assign(state, { data: null, error: '', loading: false })
    await drawerRef.value?.handleOpen(
      {},
      {
        title: 'AI 运单利润诊断',
        subtitle: '跨运单成本完整性与经营风险分析',
        size: 'xl',
        showFooter: false,
        onOpen: loadAssessment,
        onReset: () => Object.assign(state, { data: null, error: '', loading: false }),
        drawerProps: {
          appendToBody: true,
          closeOnClickModal: true,
          resizable: true
        }
      }
    )
  }

  async function loadAssessment(): Promise<void> {
    if (state.loading) return
    state.loading = true
    state.error = ''
    try {
      const { data, error } = await analyzeWaybillProfitByAi()
      if (error) throw error
      if (!data) throw new Error('利润诊断服务未返回结果')
      state.data = data
    } catch (error) {
      state.data = null
      state.error = getFriendlySupabaseErrorMessage(error, '利润诊断服务暂时不可用，请稍后重试')
    } finally {
      state.loading = false
    }
  }

  function severityLabel(severity: Severity): string {
    return severity === 'critical' ? '严重' : severity === 'high' ? '高风险' : '中风险'
  }

  function severityTagType(severity: Severity): 'danger' | 'warning' {
    return severity === 'medium' ? 'warning' : 'danger'
  }

  function signalIcon(severity: Severity): string {
    return severity === 'critical'
      ? 'ri:alarm-warning-line'
      : severity === 'high'
        ? 'ri:error-warning-line'
        : 'ri:information-line'
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  @use '@/assets/styles/core/ai-surface-mixins' as ai;

  .profit-analyst {
    min-width: 0;

    &__hero {
      position: relative;
      overflow: hidden;
      background: var(--art-gray-100);

      &::before {
        position: absolute;
        top: 0;
        left: 0;
        width: 4px;
        height: 100%;
        content: '';
        background: var(--el-color-primary);
      }

      &.is-critical::before,
      &.is-high::before {
        background: var(--el-color-danger);
      }

      &.is-medium::before {
        background: var(--el-color-warning);
      }

      &.is-low::before {
        background: var(--el-color-success);
      }
    }

    &__hero-header,
    &__hero-main,
    &__title-row,
    &__signal header,
    &__signal header > div,
    &__waybill header,
    &__waybill header > div,
    &__waybill-party,
    &__evidence,
    &__reasons {
      display: flex;
      align-items: center;
    }

    &__hero-header,
    &__signal header,
    &__waybill header {
      justify-content: space-between;
    }

    &__hero-main {
      gap: 14px;
      min-width: 0;

      > div {
        min-width: 0;
      }

      p {
        margin: 6px 0 0;
        color: var(--el-text-color-secondary);
      }
    }

    &__hero-icon {
      display: grid;
      flex: 0 0 52px;
      place-items: center;
      width: 52px;
      height: 52px;
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
      border-radius: var(--custom-radius);

      :deep(svg) {
        width: 25px;
        height: 25px;
      }
    }

    &__eyebrow {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      font-size: 10px;
      font-weight: 700;
      color: var(--el-color-primary);
      letter-spacing: 0.13em;

      i {
        width: 6px;
        height: 6px;
        background: var(--el-color-success);
        border-radius: 50%;
      }
    }

    &__title-row {
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 4px;

      > strong {
        margin-right: 3px;
        font-size: 19px;
        color: var(--el-text-color-primary);
      }
    }

    &__scores {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;

      article {
        min-width: 0;
        padding: 13px 14px;
        background: color-mix(in srgb, var(--art-gray-100) 95%, var(--el-color-primary));
        border-radius: var(--el-border-radius-base);

        header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 9px;
        }

        span,
        small {
          color: var(--el-text-color-secondary);
        }

        strong {
          font-size: 20px;
          color: var(--el-text-color-primary);
        }

        small {
          display: block;
          margin-top: 7px;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 11px;
          white-space: nowrap;
        }
      }
    }

    &__conclusion {
      display: flex;
      gap: 12px;
      align-items: center;
      padding-top: 16px;
      margin-top: 16px;
      border-top: 1px dashed var(--el-border-color-lighter);

      > span {
        display: grid;
        flex: 0 0 34px;
        place-items: center;
        width: 34px;
        height: 34px;
        color: var(--el-color-danger);
        background: var(--el-color-danger-light-9);
        border-radius: var(--el-border-radius-base);
      }

      small {
        color: var(--el-text-color-secondary);
      }

      p {
        margin: 3px 0 0;
        line-height: 1.65;
        color: var(--el-text-color-primary);
      }
    }

    &__section {
      margin-top: 16px;
    }

    &__metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;

      article {
        display: flex;
        gap: 12px;
        align-items: center;
        min-width: 0;
        padding: 14px;

        > div {
          min-width: 0;
        }

        span,
        strong,
        small {
          display: block;
        }

        span,
        small {
          color: var(--el-text-color-secondary);
        }

        strong {
          margin: 3px 0;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 16px;
          color: var(--el-text-color-primary);
          white-space: nowrap;
        }

        small {
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 11px;
          white-space: nowrap;
        }

        &.is-danger strong {
          color: var(--el-color-danger);
        }
      }
    }

    &__metric-icon {
      @include ai.metric-icon-badge;

      &.is-cost,
      &.is-loss {
        color: var(--el-color-danger) !important;
        background: var(--el-color-danger-light-9);
      }

      &.is-profit,
      &.is-coverage {
        color: var(--el-color-success) !important;
        background: var(--el-color-success-light-9);
      }

      &.is-carrier {
        color: var(--el-color-warning) !important;
        background: var(--el-color-warning-light-9);
      }
    }

    &__signals,
    &__waybills {
      display: grid;
      gap: 10px;
    }

    &__signal {
      position: relative;
      padding: 15px 16px;
      overflow: hidden;

      &::before {
        position: absolute;
        top: 0;
        left: 0;
        width: 3px;
        height: 100%;
        content: '';
        background: var(--el-color-warning);
      }

      &.is-critical::before,
      &.is-high::before {
        background: var(--el-color-danger);
      }

      header > div {
        gap: 9px;

        > span {
          display: grid;
          place-items: center;
          width: 30px;
          height: 30px;
          color: var(--el-color-danger);
          background: var(--el-color-danger-light-9);
          border-radius: var(--el-border-radius-base);
        }
      }

      p {
        margin: 10px 0;
        line-height: 1.65;
        color: var(--el-text-color-secondary);
      }
    }

    &__evidence,
    &__reasons {
      flex-wrap: wrap;
      gap: 7px;

      span {
        display: inline-flex;
        gap: 5px;
        align-items: center;
        padding: 4px 8px;
        font-size: 11px;
        color: var(--el-text-color-secondary);
        background: var(--el-fill-color-lighter);
        border-radius: 999px;
      }

      i {
        width: 5px;
        height: 5px;
        background: var(--el-color-warning);
        border-radius: 50%;
      }
    }

    &__waybills {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    &__waybill {
      min-width: 0;
      padding: 15px;

      header > div {
        gap: 10px;
        min-width: 0;

        > div {
          min-width: 0;
        }

        strong {
          color: var(--el-text-color-primary);
        }

        p {
          display: flex;
          gap: 5px;
          align-items: center;
          margin: 4px 0 0;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 11px;
          color: var(--el-text-color-secondary);
          white-space: nowrap;
        }
      }
    }

    &__risk-score {
      @include ai.risk-score-badge;
    }

    &__waybill-party {
      gap: 12px;
      margin: 12px 0;

      span {
        display: flex;
        gap: 5px;
        align-items: center;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 11px;
        color: var(--el-text-color-secondary);
        white-space: nowrap;
      }
    }

    &__waybill-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      padding: 10px;
      margin-bottom: 10px;
      background: var(--el-fill-color-lighter);
      border-radius: var(--el-border-radius-base);

      span,
      strong {
        display: block;
      }

      span {
        font-size: 10px;
        color: var(--el-text-color-secondary);
      }

      strong {
        margin-top: 3px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 12px;
        color: var(--el-text-color-primary);
        white-space: nowrap;

        &.is-negative {
          color: var(--el-color-danger);
        }
      }
    }

    &__actions {
      padding: 0;
      margin: 0;
      list-style: none;

      li {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        padding: 13px 0;

        & + li {
          border-top: 1px dashed var(--el-border-color-lighter);
        }

        > span {
          @include ai.numbered-step-marker;
        }

        small {
          color: var(--el-color-primary);
        }

        p {
          margin: 3px 0 0;
          line-height: 1.55;
          color: var(--el-text-color-regular);
        }
      }
    }

    &__limitations {
      padding: 0;

      p {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin: 0;
        line-height: 1.6;
        color: var(--art-gray-700);

        & + p {
          margin-top: 8px;
        }

        :deep(svg) {
          flex: 0 0 auto;
          margin-top: 3px;
          color: var(--el-color-primary);
        }
      }
    }

    @media (width <= 720px) {
      &__hero-header {
        align-items: flex-start;
      }

      &__scores,
      &__metrics,
      &__waybills {
        grid-template-columns: 1fr;
      }

      &__waybill-metrics {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (width <= 480px) {
      &__hero-header,
      &__hero-main {
        flex-direction: column;
        align-items: flex-start;
      }

      &__hero-header :deep(.el-button) {
        width: 100%;
      }

      &__waybill-party {
        flex-direction: column;
        gap: 5px;
        align-items: flex-start;
      }
    }
  }
</style>
