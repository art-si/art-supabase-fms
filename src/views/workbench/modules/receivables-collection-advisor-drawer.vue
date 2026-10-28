<template>
  <ArtDrawer
    ref="drawerRef"
    header-icon="ri:hand-coin-line"
    :loading="state.loading"
    :show-footer="false"
  >
    <div class="collection-advisor">
      <template v-if="state.data">
        <ArtSectionCard
          :class="['collection-advisor__hero', `is-${assessment.riskLevel}`]"
          :show-scrollbar="false"
        >
          <template #header>
            <header class="collection-advisor__hero-header">
              <div class="collection-advisor__hero-main">
                <span class="collection-advisor__hero-icon">
                  <ArtSvgIcon icon="ri:funds-line" />
                </span>
                <div>
                  <span class="collection-advisor__eyebrow"><i />AI RECEIVABLES CONTROL</span>
                  <div class="collection-advisor__title-row">
                    <strong>应收回款风险研判</strong>
                    <ElTag :type="riskTagType" effect="dark" round>{{ riskLabel }}</ElTag>
                    <ElTag type="info" effect="plain" round>{{ recommendationLabel }}</ElTag>
                  </div>
                  <p>分析当前租户 {{ assessment.metrics.openStatementCount }} 笔未关闭客户对账单</p>
                </div>
              </div>
              <ElButton type="primary" plain :loading="state.loading" @click="loadAssessment">
                <ArtSvgIcon icon="ri:refresh-line" />重新研判
              </ElButton>
            </header>
          </template>
          <div class="collection-advisor__scores">
            <article>
              <header
                ><span>回款风险</span><strong>{{ assessment.riskScore }}</strong></header
              >
              <ElProgress
                :percentage="assessment.riskScore"
                :show-text="false"
                :stroke-width="6"
                :color="riskProgressColor"
              />
              <small>综合账龄、对账、开票与金额集中度</small>
            </article>
            <article>
              <header
                ><span>研判置信度</span><strong>{{ confidencePercent }}%</strong></header
              >
              <ElProgress :percentage="confidencePercent" :show-text="false" :stroke-width="6" />
              <small>基于系统内当前财务链路数据</small>
            </article>
            <article>
              <header
                ><span>账面回款率</span
                ><strong>{{ formatPercent(assessment.metrics.collectionRate) }}</strong></header
              >
              <ElProgress
                :percentage="assessment.metrics.collectionRate"
                :show-text="false"
                :stroke-width="6"
                :color="collectionProgressColor"
              />
              <small>已结金额占未关闭对账金额</small>
            </article>
          </div>

          <div class="collection-advisor__conclusion">
            <span><ArtSvgIcon :icon="conclusionIcon" /></span>
            <div>
              <small>AI 财务结论</small>
              <p>{{ assessment.summary }}</p>
            </div>
          </div>
        </ArtSectionCard>

        <ArtSectionCard title="应收健康指标" class="mt-5.5" :show-scrollbar="false">
          <div class="collection-advisor__metrics">
            <article class="art-card-xs">
              <span class="collection-advisor__metric-icon is-outstanding">
                <ArtSvgIcon icon="ri:wallet-3-line" />
              </span>
              <div
                ><span>当前未结应收</span
                ><strong>{{ formatMoney(assessment.metrics.outstandingAmount) }}</strong
                ><small>{{ assessment.metrics.openStatementCount }} 笔未关闭对账单</small></div
              >
            </article>
            <article class="art-card-xs is-danger">
              <span class="collection-advisor__metric-icon is-risk">
                <ArtSvgIcon icon="ri:alarm-warning-line" />
              </span>
              <div
                ><span>高关注金额</span
                ><strong>{{ formatMoney(assessment.metrics.atRiskAmount) }}</strong
                ><small>风险分数 60 分及以上</small></div
              >
            </article>
            <article class="art-card-xs">
              <span class="collection-advisor__metric-icon is-aging">
                <ArtSvgIcon icon="ri:time-line" />
              </span>
              <div
                ><span>60 天以上账龄</span
                ><strong>{{ formatMoney(assessment.metrics.aging60Amount) }}</strong
                ><small>按账期结束日计算</small></div
              >
            </article>
            <article class="art-card-xs">
              <span class="collection-advisor__metric-icon is-review">
                <ArtSvgIcon icon="ri:file-search-line" />
              </span>
              <div
                ><span>对账审核阻塞</span
                ><strong>{{ formatMoney(assessment.metrics.reviewBlockedAmount) }}</strong
                ><small>草稿与待审核对账单</small></div
              >
            </article>
            <article class="art-card-xs">
              <span class="collection-advisor__metric-icon is-invoice">
                <ArtSvgIcon icon="ri:bill-line" />
              </span>
              <div
                ><span>待完成开票</span
                ><strong>{{ formatMoney(assessment.metrics.uninvoicedAmount) }}</strong
                ><small>已确认应收的未开票金额</small></div
              >
            </article>
            <article class="art-card-xs">
              <span class="collection-advisor__metric-icon is-settled">
                <ArtSvgIcon icon="ri:checkbox-circle-line" />
              </span>
              <div
                ><span>已结金额</span
                ><strong>{{ formatMoney(assessment.metrics.settledAmount) }}</strong
                ><small>当前分析范围内已核销</small></div
              >
            </article>
          </div>
        </ArtSectionCard>

        <ArtSectionCard
          title="优先跟进对账单"
          class="mt-5.5"
          :show-scrollbar="false"
          :empty="!assessment.priorityStatements.length"
          empty-title="当前没有需要优先跟进的未结对账单"
          empty-description="后续出现高关注回款事项时会在此列出。"
          :empty-visual-size="72"
        >
          <div class="collection-advisor__statements">
            <article
              v-for="statement in assessment.priorityStatements"
              :key="statement.id"
              class="collection-advisor__statement art-card-xs"
            >
              <header>
                <div>
                  <span class="collection-advisor__risk-score">{{ statement.riskScore }}</span>
                  <div>
                    <strong>{{ statement.statementNo }}</strong>
                    <p><ArtSvgIcon icon="ri:building-line" />{{ statement.customerName }}</p>
                  </div>
                </div>
                <ElTag :type="getSettlementStatusPresentation(statement.status).type">
                  {{ getSettlementStatusPresentation(statement.status).label }}
                </ElTag>
              </header>
              <div class="collection-advisor__statement-metrics">
                <span
                  ><small>未结金额</small
                  ><strong>{{ formatMoney(statement.outstandingAmount) }}</strong></span
                >
                <span
                  ><small>账龄参考</small><strong>{{ statement.ageDays }} 天</strong></span
                >
                <span
                  ><small>未开票</small
                  ><strong>{{ formatMoney(statement.uninvoicedAmount) }}</strong></span
                >
              </div>
              <div class="collection-advisor__reasons">
                <span v-for="reason in statement.reasons" :key="reason">{{ reason }}</span>
              </div>
              <footer>
                <span
                  >{{ statement.periodStart || '--' }} 至 {{ statement.periodEnd || '--' }}</span
                >
                <ElButton link type="primary" @click="goToStatement(statement)">
                  查看对账单<ArtSvgIcon icon="ri:arrow-right-line" />
                </ElButton>
              </footer>
            </article>
          </div>
        </ArtSectionCard>

        <div class="collection-advisor__decision-grid">
          <ArtSectionCard
            title="风险信号"
            class="mt-5.5"
            :show-scrollbar="false"
            :empty="!assessment.signals.length"
            empty-title="当前未识别到明确的回款风险信号"
            empty-description="仍可按建议处理顺序定期核对未结应收。"
            :empty-visual-size="72"
          >
            <div class="collection-advisor__signals">
              <article
                v-for="signal in assessment.signals"
                :key="signal.type"
                :class="['collection-advisor__signal art-card-xs', `is-${signal.severity}`]"
              >
                <header>
                  <div
                    ><span><ArtSvgIcon :icon="signalIcon(signal.severity)" /></span
                    ><strong>{{ signal.title }}</strong></div
                  >
                  <ElTag :type="severityTagType(signal.severity)" effect="light" round>{{
                    severityLabel(signal.severity)
                  }}</ElTag>
                </header>
                <p>{{ signal.detail }}</p>
                <div class="collection-advisor__evidence">
                  <span v-for="item in signal.evidence" :key="item"><i />{{ item }}</span>
                </div>
              </article>
            </div>
          </ArtSectionCard>

          <ArtSectionCard
            title="高关注客户"
            class="mt-5.5"
            :show-scrollbar="false"
            :empty="!assessment.riskCustomers.length"
            empty-title="暂无高关注客户"
            empty-description="客户风险升高时会在此列出。"
            :empty-visual-size="72"
          >
            <div class="collection-advisor__customers">
              <article
                v-for="customer in assessment.riskCustomers"
                :key="customer.customerId || customer.customerName"
              >
                <span>{{ customer.riskScore }}</span>
                <div>
                  <header class="flex items-start justify-between gap-2"
                    ><strong class="min-w-0 wrap-anywhere text-g-900">{{
                      customer.customerName
                    }}</strong
                    ><small class="shrink-0 whitespace-nowrap"
                      >{{ customer.statementCount }} 笔</small
                    ></header
                  >
                  <p
                    >{{ formatMoney(customer.outstandingAmount) }} 未结 · 最长
                    {{ customer.maxAgeDays }} 天</p
                  >
                </div>
              </article>
            </div>
          </ArtSectionCard>
        </div>

        <ArtSectionCard
          title="建议处理顺序"
          class="mt-5.5"
          :show-scrollbar="false"
          :empty="!assessment.recommendedActions.length"
          empty-title="暂无处理建议"
          empty-description="可结合回款指标和风险信号进行人工复核。"
          :empty-visual-size="72"
        >
          <ol class="collection-advisor__actions">
            <li v-for="(action, index) in assessment.recommendedActions" :key="action">
              <span>{{ index + 1 }}</span>
              <div
                ><small>财务跟进步骤 {{ index + 1 }}</small
                ><p>{{ action }}</p></div
              >
            </li>
          </ol>
        </ArtSectionCard>

        <ArtSectionCard
          title="判断边界"
          class="mt-5.5"
          :show-scrollbar="false"
          :empty="!assessment.limitations.length"
          empty-title="暂无补充说明"
          empty-description="请结合当前分析范围复核研判结果。"
          :empty-visual-size="72"
        >
          <div class="collection-advisor__limitations">
            <p v-for="item in assessment.limitations" :key="item">
              <ArtSvgIcon icon="ri:checkbox-circle-line" /><span>{{ item }}</span>
            </p>
          </div>
        </ArtSectionCard>

        <ArtAiFeedback :run-id="state.data.runId" context-label="AI 回款风险助手" />

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
            ><ArtSvgIcon
              icon="ri:shield-check-line"
            />只读研判，不会自动改账、催收或修改业务状态</span
          >
        </footer>
      </template>

      <ArtAsyncState
        v-else-if="state.error"
        :error="state.error"
        error-title="回款风险分析失败"
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
  import type { UnwrapNestedRefs } from 'vue'
  import ArtAiFeedback from '@/components/core/base/art-ai-feedback/index.vue'
  import { getSettlementStatusPresentation } from '../../modules/settlement-status'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import { analyzeReceivablesCollectionByAi } from '@fms/api'
  import { financeRouteNames } from '@/router/business-paths'

  defineOptions({ name: 'FinanceReceivablesCollectionAdvisorDrawer' })

  type AnalysisResponse = Api.Fms.ReceivablesCollectionResponse
  type RiskLevel = Api.Fms.ReceivablesRiskLevel
  type Recommendation = Api.Fms.ReceivablesRecommendation
  type Severity = Api.Fms.ReceivablesSignalSeverity
  type PriorityStatement = Api.Fms.ReceivablesPriorityStatement

  interface AnalysisState {
    data: AnalysisResponse | null
    error: string
    loading: boolean
  }

  const router = useRouter()
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
    unblock_settlement: '先解除对账阻塞',
    complete_invoicing: '先完成开票',
    prioritize_collection: '优先催收长账龄',
    routine_monitoring: '常规回款跟进'
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
  const collectionProgressColor = computed(() => {
    const rate = assessment.value.metrics.collectionRate
    return rate < 30
      ? 'var(--el-color-danger)'
      : rate < 70
        ? 'var(--el-color-warning)'
        : 'var(--el-color-success)'
  })
  const conclusionIcon = computed(() =>
    assessment.value.riskLevel === 'critical' || assessment.value.riskLevel === 'high'
      ? 'ri:alarm-warning-line'
      : 'ri:checkbox-circle-line'
  )

  async function handleOpen(): Promise<void> {
    Object.assign(state, { data: null, error: '', loading: false })
    await drawerRef.value?.handleOpen(
      {},
      {
        title: 'AI 回款风险助手',
        subtitle: '从对账、开票到回款核销的只读风险研判',
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
      const { data, error } = await analyzeReceivablesCollectionByAi()
      if (error) throw error
      if (!data) throw new Error('回款风险分析服务未返回结果')
      state.data = data
    } catch (error) {
      state.data = null
      state.error = getFriendlySupabaseErrorMessage(error, '回款风险分析服务暂时不可用，请稍后重试')
    } finally {
      state.loading = false
    }
  }

  async function goToStatement(statement: PriorityStatement): Promise<void> {
    await drawerRef.value?.handleClose()
    await router.push({
      name: financeRouteNames.customerSettlement,
      query: { keyword: statement.statementNo }
    })
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

  .collection-advisor {
    min-width: 0;

    &__hero {
      position: relative;
      padding: 20px;
      overflow: hidden;
      background: var(--default-box-color);

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
    &__statement header,
    &__statement header > div,
    &__evidence,
    &__reasons {
      display: flex;
      align-items: center;
    }

    &__hero-header,
    &__signal header,
    &__statement header {
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
      flex: 0 0 40px;
      place-items: center;
      width: 40px;
      height: 40px;
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
      font-size: 12px;
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
          font-size: 12px;
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
          font-size: 12px;
          white-space: nowrap;
        }

        &.is-danger strong {
          color: var(--el-color-danger);
        }
      }
    }

    &__metric-icon {
      @include ai.metric-icon-badge;

      &.is-risk,
      &.is-aging {
        color: var(--el-color-danger) !important;
        background: var(--el-color-danger-light-9);
      }

      &.is-review,
      &.is-invoice {
        color: var(--el-color-warning) !important;
        background: var(--el-color-warning-light-9);
      }

      &.is-settled {
        color: var(--el-color-success) !important;
        background: var(--el-color-success-light-9);
      }
    }

    &__statements {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    &__statement {
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
          font-size: 12px;
          color: var(--el-text-color-secondary);
          white-space: nowrap;
        }
      }

      footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: 10px;
        margin-top: 10px;
        font-size: 12px;
        color: var(--el-text-color-secondary);
        border-top: 1px dashed var(--el-border-color-lighter);
      }
    }

    &__risk-score {
      @include ai.risk-score-badge;
    }

    &__statement-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      padding: 10px;
      margin: 12px 0 10px;
      background: var(--el-fill-color-lighter);
      border-radius: var(--el-border-radius-base);

      span,
      small,
      strong {
        display: block;
        min-width: 0;
      }

      small {
        color: var(--el-text-color-secondary);
      }

      strong {
        margin-top: 3px;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 12px;
        color: var(--el-text-color-primary);
        white-space: nowrap;
      }
    }

    &__reasons,
    &__evidence {
      flex-wrap: wrap;
      gap: 7px;

      span {
        display: inline-flex;
        gap: 5px;
        align-items: center;
        padding: 4px 8px;
        font-size: 12px;
        color: var(--el-text-color-secondary);
        background: var(--el-fill-color-lighter);
        border-radius: 999px;
      }
    }

    &__evidence i {
      width: 5px;
      height: 5px;
      background: var(--el-color-warning);
      border-radius: 50%;
    }

    &__decision-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.8fr);
      gap: 16px;
      min-width: 0;
    }

    &__signals {
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

    &__customers {
      article {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        padding: 12px 0;

        & + article {
          border-top: 1px dashed var(--el-border-color-lighter);
        }

        > span {
          display: grid;
          place-items: center;
          width: 32px;
          height: 32px;
          font-size: 12px;
          font-weight: 700;
          color: var(--el-color-danger);
          background: var(--el-color-danger-light-9);
          border-radius: 50%;
        }

        small,
        p {
          color: var(--art-gray-700);
        }

        p {
          margin: 4px 0 0;
          font-size: 12px;
        }
      }
    }

    &__actions {
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
      p {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin: 0;
        line-height: 1.6;
        color: var(--el-text-color-secondary);

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

    @media (width <= 760px) {
      &__scores,
      &__metrics,
      &__statements,
      &__decision-grid {
        grid-template-columns: 1fr;
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

      &__statement footer {
        gap: 8px;
        align-items: flex-start;
      }
    }
  }
</style>
