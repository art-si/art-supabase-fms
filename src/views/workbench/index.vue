<template>
  <ArtPageShell :error="loadError" class="finance-workbench" @retry="loadWorkbench">
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="FINANCE OPERATIONS"
      title="财务工作台"
      description="集中查看应收、应付、开票、回款与费用审核进度"
      icon="ri:money-cny-box-line"
      :tags="workspaceTags"
      :metrics="overview.loading && !overview.metrics.length ? loadingMetrics : overview.metrics"
      class="finance-workbench__header"
      @metric-click="handleMetricClick"
    >
      <template #actions>
        <ElButton type="primary" @click="openCollectionAdvisor">
          <ArtSvgIcon icon="ri:sparkling-2-line" />AI 回款风险研判
        </ElButton>
      </template>
    </BusinessWorkspaceHeader>

    <div class="finance-workbench__main">
      <ArtSectionCard
        title="财务待办"
        subtitle="先处理会阻断结算、付款和记账的事项"
        class="finance-workbench__panel"
        :show-scrollbar="false"
        :loading="overview.loading"
        :skeleton-rows="4"
        :empty="!overview.loading && overview.tasks.length === 0"
        empty-title="当前没有待办事项"
        empty-description="所有需处理事项已完成；可继续查看下方经营与流程进度。"
      >
        <template #loading>
          <ElSkeleton animated aria-hidden="true" class="finance-workbench__task-skeleton">
            <template #template>
              <div class="finance-workbench__task-skeleton-heading">
                <span>待办事项</span><span>数量</span><span>涉及金额</span><span>优先级</span
                ><span>操作</span>
              </div>
              <div v-for="index in 5" :key="index" class="finance-workbench__task-skeleton-row">
                <ElSkeletonItem variant="text" />
                <ElSkeletonItem variant="text" />
                <ElSkeletonItem variant="text" />
                <ElSkeletonItem variant="text" />
                <ElSkeletonItem variant="rect" />
              </div>
            </template>
          </ElSkeleton>
        </template>
        <ArtTable
          :border="false"
          :data="overview.tasks"
          :columns="taskColumns"
          :pagination="false"
          table-layout="fixed"
          empty-text="当前没有待办事项"
          empty-description="财务任务产生后会在此显示。"
        >
          <template #urgency="{ row }">
            <ElTag :type="urgencyType(row.urgency)">{{ row.urgency }}</ElTag>
          </template>
          <template #operation="{ row }">
            <ArtButtonTable
              type="view"
              icon="ri:arrow-right-up-line"
              label="去处理"
              permission=""
              @click="handleTask(row)"
            />
          </template>
        </ArtTable>
      </ArtSectionCard>

      <AccountingReadinessPanel compact />
    </div>

    <ArtSectionCard
      v-if="overview.loading || overview.progressItems.length"
      title="业务完成率"
      subtitle="本月关键流程的完成情况"
      class="finance-workbench__panel"
      :loading="overview.loading"
      :skeleton-rows="2"
    >
      <template #loading>
        <ElSkeleton animated aria-hidden="true">
          <template #template>
            <div class="finance-workbench__progress-list">
              <div v-for="index in 4" :key="index" class="finance-workbench__progress-skeleton">
                <ElSkeletonItem variant="circle" />
                <span>
                  <ElSkeletonItem variant="text" />
                  <ElSkeletonItem variant="text" />
                </span>
              </div>
            </div>
          </template>
        </ElSkeleton>
      </template>
      <div class="finance-workbench__progress-list">
        <div
          v-for="item in overview.progressItems"
          :key="item.label"
          class="finance-workbench__progress-item"
          :style="{ '--progress-color': item.color }"
        >
          <ElProgress
            type="circle"
            :percentage="item.percent"
            :width="88"
            :stroke-width="8"
            :color="item.color"
            :format="() => item.value"
            :aria-label="`${item.label} ${item.value}`"
          />
          <div class="finance-workbench__progress-copy">
            <strong>{{ item.label }}</strong>
            <small>本月完成</small>
          </div>
        </div>
      </div>
    </ArtSectionCard>

    <ArtSectionCard
      v-if="statsDescriptionItems.length"
      title="本月经营概览"
      subtitle="本月运输收入、成本、毛利及资金核销概况"
      class="finance-workbench__panel"
    >
      <ArtDescriptions
        :data="statsDescriptionData"
        :items="statsDescriptionItems"
        :columns="4"
        label-width="104px"
      />
    </ArtSectionCard>

    <ArtSectionCard
      v-if="overview.reminders.length"
      title="结算提醒"
      class="finance-workbench__panel"
    >
      <ElAlert
        v-for="item in overview.reminders"
        :key="item.title"
        :title="item.title"
        :type="item.type"
        show-icon
        :closable="false"
      />
    </ArtSectionCard>

    <ReceivablesCollectionAdvisorDrawer ref="collectionAdvisorRef" />
  </ArtPageShell>
</template>

<script setup lang="ts">
  import { clamp } from 'lodash-es'
  import { formatSensitiveNumberWithAffix, isMaskedValue } from '@/utils/field-permission'
  import { normalizeNullableNumber } from '@/utils/form/normalize'
  import type { AlertProps, TagProps } from 'element-plus'
  import type { ColumnOption } from '@/types'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric,
    type BusinessWorkspaceTag
  } from '@/components/business/business-workspace-header/index.vue'
  import { fetchAccountingWorkloadSummary, fetchFinanceWorkbench } from '@fms/api'
  import { financeRouteNames } from '@/router/business-paths'
  import AccountingReadinessPanel from './modules/accounting-readiness-panel.vue'
  import ReceivablesCollectionAdvisorDrawer from './modules/receivables-collection-advisor-drawer.vue'

  defineOptions({ name: 'FinanceWorkbench' })

  type Stats = Api.Fms.FinanceWorkbenchStats
  type SensitiveNumber = Api.Fms.SensitiveNumber
  type WorkbenchFieldKey = Api.Fms.FinanceWorkbenchFieldKey
  type FieldAccessLevel = Api.Common.FieldAccessLevel
  type Urgency = '普通' | '关注' | '紧急'

  interface WorkbenchTask {
    id: string
    title: string
    count: number
    amount?: SensitiveNumber
    urgency: Urgency
    routeName: string
    query?: Record<string, string>
  }

  interface ProgressItem {
    label: string
    value: string
    percent: number
    color: string
  }

  interface ReminderItem {
    title: string
    type: AlertProps['type']
  }

  interface OverviewGroup {
    loading: boolean
    stats: Stats
    metrics: BusinessWorkspaceMetric[]
    tasks: WorkbenchTask[]
    progressItems: ProgressItem[]
    reminders: ReminderItem[]
    workload: Api.Fms.AccountingWorkloadSummary
  }

  interface CollectionAdvisorExpose {
    handleOpen: () => Promise<void>
  }

  const rateDisplayOptions = {
    suffix: '%',
    emptyText: '—',
    numberFormat: { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }
  }

  const router = useRouter()
  const metricRouteNames: Record<string, string> = {
    'customer-receivable': financeRouteNames.customerSettlement,
    'carrier-payable': financeRouteNames.carrierSettlement,
    'month-receipt': financeRouteNames.cashTransaction,
    'month-gross-profit': financeRouteNames.waybillProfit
  }
  const loadError = ref<Error | null>(null)
  const collectionAdvisorRef = ref<CollectionAdvisorExpose>()
  const loadingMetrics: BusinessWorkspaceMetric[] = [
    {
      key: 'customer-receivable',
      label: '客户应收余额',
      value: '—',
      description: '正在汇总',
      icon: 'ri:funds-line',
      loading: true
    },
    {
      key: 'carrier-payable',
      label: '承运商应付余额',
      value: '—',
      description: '正在汇总',
      icon: 'ri:bank-card-line',
      loading: true
    },
    {
      key: 'month-receipt',
      label: '本月回款',
      value: '—',
      description: '正在汇总',
      icon: 'ri:money-cny-circle-line',
      loading: true
    },
    {
      key: 'month-gross-profit',
      label: '本月运输毛利',
      value: '—',
      description: '正在汇总',
      icon: 'ri:line-chart-line',
      loading: true
    }
  ]

  const createEmptyStats = (): Stats => ({
    customerReceivableBalance: undefined,
    carrierPayableBalance: undefined,
    monthReceiptAmount: undefined,
    monthPaymentAmount: undefined,
    monthRevenueAmount: undefined,
    monthCostAmount: undefined,
    monthGrossProfit: undefined,
    receiptCompletionRate: undefined,
    paymentCompletionRate: undefined,
    invoiceMatchRate: undefined,
    costApprovalRate: undefined,
    pendingCustomerStatementCount: 0,
    pendingCustomerStatementAmount: undefined,
    pendingCarrierStatementCount: 0,
    pendingCarrierStatementAmount: undefined,
    pendingCostCount: 0,
    pendingCostAmount: undefined,
    unallocatedReceiptCount: 0,
    unallocatedReceiptAmount: undefined,
    unallocatedPaymentCount: 0,
    unallocatedPaymentAmount: undefined,
    draftInvoiceCount: 0,
    draftInvoiceAmount: undefined,
    pendingInvoiceCount: 0,
    pendingInvoiceAmount: undefined,
    pendingPaymentApplicationCount: 0,
    pendingPaymentApplicationAmount: undefined,
    approvedUnpaidPaymentCount: 0,
    approvedUnpaidPaymentAmount: undefined,
    unapprovedPaymentCount: 0,
    unapprovedPaymentAmount: undefined,
    overdueReceivableCount: 0,
    overdueReceivableAmount: undefined,
    uninvoicedReceivableCount: 0,
    uninvoicedReceivableAmount: undefined,
    fieldAccess: {}
  })

  const createEmptyWorkload = (): Api.Fms.AccountingWorkloadSummary => ({
    failedPostingEventCount: 0,
    pendingConfigurationEventCount: 0,
    pendingPostingEventCount: 0,
    pendingVoucherReviewCount: 0,
    approvedVoucherCount: 0,
    closingPeriodCount: 0
  })

  const overview = reactive<OverviewGroup>({
    loading: true,
    stats: createEmptyStats(),
    metrics: [],
    tasks: [],
    progressItems: [],
    reminders: [],
    workload: createEmptyWorkload()
  })
  const workspaceTags: BusinessWorkspaceTag[] = [
    { label: '经营数据实时汇总', type: 'success', effect: 'plain' },
    { label: '支持 AI 回款风险研判', type: 'info', effect: 'plain' }
  ]

  const taskColumns = computed<ColumnOption<WorkbenchTask>[]>(() => {
    const columns: ColumnOption<WorkbenchTask>[] = [
      { prop: 'title', label: '待办事项', minWidth: 175, showOverflowTooltip: true },
      {
        prop: 'count',
        label: '数量',
        width: 90,
        align: 'center',
        formatter: (row) => `${row.count} 项`
      }
    ]
    if (overview.tasks.some((item) => item.amount !== undefined && item.amount !== null)) {
      columns.push({
        prop: 'amount',
        label: '涉及金额',
        minWidth: 135,
        align: 'right',
        formatter: (row) =>
          formatSensitiveNumberWithAffix(row.amount, { prefix: '¥', emptyText: '—' })
      })
    }
    columns.push(
      { prop: 'urgency', label: '优先级', width: 90, useSlot: true },
      { prop: 'operation', label: '操作', width: 90, fixed: 'right', useSlot: true }
    )
    return columns
  })

  const statsDescriptionData = computed<Record<string, unknown>>(() => ({ ...overview.stats }))
  const statsDescriptionItems = computed<ArtDescriptionItem[]>(() => {
    const items: Array<{ access: WorkbenchFieldKey; item: ArtDescriptionItem }> = [
      {
        access: 'operatingAmounts',
        item: {
          key: 'revenue',
          label: '运输收入',
          value: () =>
            formatSensitiveNumberWithAffix(overview.stats.monthRevenueAmount, {
              prefix: '¥',
              emptyText: '—'
            })
        }
      },
      {
        access: 'operatingAmounts',
        item: {
          key: 'cost',
          label: '运输成本',
          value: () =>
            formatSensitiveNumberWithAffix(overview.stats.monthCostAmount, {
              prefix: '¥',
              emptyText: '—'
            })
        }
      },
      {
        access: 'operatingAmounts',
        item: {
          key: 'profit',
          label: '运输毛利',
          value: () =>
            formatSensitiveNumberWithAffix(overview.stats.monthGrossProfit, {
              prefix: '¥',
              emptyText: '—'
            })
        }
      },
      {
        access: 'operatingAmounts',
        item: {
          key: 'margin',
          label: '综合毛利率',
          value: () => formatSensitiveNumberWithAffix(grossMargin.value, rateDisplayOptions)
        }
      },
      {
        access: 'cashFlowAmounts',
        item: {
          key: 'receipt',
          label: '客户回款',
          value: () =>
            formatSensitiveNumberWithAffix(overview.stats.monthReceiptAmount, {
              prefix: '¥',
              emptyText: '—'
            })
        }
      },
      {
        access: 'cashFlowAmounts',
        item: {
          key: 'payment',
          label: '承运商付款',
          value: () =>
            formatSensitiveNumberWithAffix(overview.stats.monthPaymentAmount, {
              prefix: '¥',
              emptyText: '—'
            })
        }
      },
      {
        access: 'cashFlowAmounts',
        item: {
          key: 'unallocatedReceipt',
          label: '未核销收款',
          value: () =>
            formatSensitiveNumberWithAffix(overview.stats.unallocatedReceiptAmount, {
              prefix: '¥',
              emptyText: '—'
            })
        }
      },
      {
        access: 'cashFlowAmounts',
        item: {
          key: 'unallocatedPayment',
          label: '未核销付款',
          value: () =>
            formatSensitiveNumberWithAffix(overview.stats.unallocatedPaymentAmount, {
              prefix: '¥',
              emptyText: '—'
            })
        }
      }
    ]
    return items
      .filter(({ access }) => fieldAccessLevel(access) !== 'hidden')
      .map(({ item }) => item)
  })

  const grossMargin = computed(() => {
    const revenue = normalizeNullableNumber(overview.stats.monthRevenueAmount) ?? undefined
    const profit = normalizeNullableNumber(overview.stats.monthGrossProfit) ?? undefined
    if (revenue === undefined || profit === undefined) {
      return isMaskedValue(overview.stats.monthRevenueAmount) ||
        isMaskedValue(overview.stats.monthGrossProfit)
        ? '***'
        : undefined
    }
    return revenue > 0 ? Number(((profit / revenue) * 100).toFixed(2)) : 0
  })

  function fieldAccessLevel(field: WorkbenchFieldKey): FieldAccessLevel {
    return overview.stats.fieldAccess?.[field] ?? 'hidden'
  }

  function withOptionalAmount(label: string, value?: SensitiveNumber): string {
    return value === undefined || value === null
      ? label
      : `${label}，金额 ${formatSensitiveNumberWithAffix(value, { prefix: '¥', emptyText: '—' })}`
  }

  function buildMetrics(stats: Stats): BusinessWorkspaceMetric[] {
    const profit = normalizeNullableNumber(stats.monthGrossProfit) ?? undefined
    const candidates: Array<{ access: WorkbenchFieldKey; metric: BusinessWorkspaceMetric }> = [
      {
        access: 'customerSettlementAmounts',
        metric: {
          key: 'customer-receivable',
          label: '客户应收余额',
          value: formatSensitiveNumberWithAffix(stats.customerReceivableBalance, {
            prefix: '¥',
            emptyText: '—'
          }),
          description:
            fieldAccessLevel('cashFlowAmounts') === 'hidden'
              ? '本月回款金额受限'
              : `本月已回款 ${formatSensitiveNumberWithAffix(stats.monthReceiptAmount, { prefix: '¥', emptyText: '—' })}`,
          icon: 'ri:funds-line',
          tone: 'primary',
          interactive: true
        }
      },
      {
        access: 'carrierSettlementAmounts',
        metric: {
          key: 'carrier-payable',
          label: '承运商应付余额',
          value: formatSensitiveNumberWithAffix(stats.carrierPayableBalance, {
            prefix: '¥',
            emptyText: '—'
          }),
          description:
            fieldAccessLevel('cashFlowAmounts') === 'hidden'
              ? '本月付款金额受限'
              : `本月已付款 ${formatSensitiveNumberWithAffix(stats.monthPaymentAmount, { prefix: '¥', emptyText: '—' })}`,
          icon: 'ri:bank-card-line',
          tone: 'warning',
          interactive: true
        }
      },
      {
        access: 'cashFlowAmounts',
        metric: {
          key: 'month-receipt',
          label: '本月回款',
          value: formatSensitiveNumberWithAffix(stats.monthReceiptAmount, {
            prefix: '¥',
            emptyText: '—'
          }),
          description:
            fieldAccessLevel('customerSettlementAmounts') === 'hidden'
              ? '回款完成率受限'
              : `回款完成率 ${formatSensitiveNumberWithAffix(stats.receiptCompletionRate, rateDisplayOptions)}`,
          icon: 'ri:money-cny-circle-line',
          tone: 'success',
          interactive: true
        }
      },
      {
        access: 'operatingAmounts',
        metric: {
          key: 'month-gross-profit',
          label: '本月运输毛利',
          value: formatSensitiveNumberWithAffix(stats.monthGrossProfit, {
            prefix: '¥',
            emptyText: '—'
          }),
          description: `综合毛利率 ${formatSensitiveNumberWithAffix(grossMargin.value, rateDisplayOptions)}`,
          icon: 'ri:line-chart-line',
          tone: profit === undefined || profit >= 0 ? 'primary' : 'danger',
          interactive: true
        }
      }
    ]
    return candidates
      .filter(({ access }) => fieldAccessLevel(access) !== 'hidden')
      .map(({ metric }) => metric)
  }

  function buildTasks(stats: Stats, workload: Api.Fms.AccountingWorkloadSummary): WorkbenchTask[] {
    const tasks: WorkbenchTask[] = [
      {
        id: 'posting-event-failed',
        title: '自动入账失败事件',
        count: workload.failedPostingEventCount,
        amount: null,
        urgency: '紧急',
        routeName: financeRouteNames.autoPosting,
        query: { tab: 'events', status: 'failed' }
      },
      {
        id: 'posting-event-configuration',
        title: '自动入账待配置事件',
        count: workload.pendingConfigurationEventCount,
        amount: null,
        urgency: '紧急',
        routeName: financeRouteNames.autoPosting,
        query: { tab: 'events', status: 'pending_configuration' }
      },
      {
        id: 'posting-event-pending',
        title: '自动入账待处理事件',
        count: workload.pendingPostingEventCount,
        amount: null,
        urgency: '关注',
        routeName: financeRouteNames.autoPosting,
        query: { tab: 'events', status: 'pending' }
      },
      {
        id: 'voucher-review',
        title: '待审核会计凭证',
        count: workload.pendingVoucherReviewCount,
        amount: null,
        urgency: '紧急',
        routeName: financeRouteNames.voucherCenter,
        query: { status: 'pending_review' }
      },
      {
        id: 'voucher-posting',
        title: '已审核待过账凭证',
        count: workload.approvedVoucherCount,
        amount: null,
        urgency: '关注',
        routeName: financeRouteNames.voucherCenter,
        query: { status: 'approved' }
      },
      {
        id: 'period-closing',
        title: '关账中会计期间',
        count: workload.closingPeriodCount,
        amount: null,
        urgency: '关注',
        routeName: financeRouteNames.periodClose
      },
      {
        id: 'payment-application-review',
        title: '待审批承运商付款申请',
        count: stats.pendingPaymentApplicationCount,
        amount: stats.pendingPaymentApplicationAmount,
        urgency: '紧急',
        routeName: financeRouteNames.paymentApplication,
        query: { status: 'pending_review' }
      },
      {
        id: 'approved-payment-execution',
        title: '已批准待执行付款',
        count: stats.approvedUnpaidPaymentCount,
        amount: stats.approvedUnpaidPaymentAmount,
        urgency: '紧急',
        routeName: financeRouteNames.paymentApplication,
        query: { status: 'approved' }
      },
      {
        id: 'unapproved-payment-review',
        title: '未关联审批付款待复核',
        count: stats.unapprovedPaymentCount,
        amount: stats.unapprovedPaymentAmount,
        urgency: '紧急',
        routeName: financeRouteNames.cashTransaction,
        query: { direction: 'payment' }
      },
      {
        id: 'overdue-receivable',
        title: '账期结束超 30 天未回款',
        count: stats.overdueReceivableCount,
        amount: stats.overdueReceivableAmount,
        urgency: '关注',
        routeName: financeRouteNames.customerSettlement,
        query: { status: 'confirmed' }
      },
      {
        id: 'uninvoiced-receivable',
        title: '已确认对账未完成开票',
        count: stats.uninvoicedReceivableCount,
        amount: stats.uninvoicedReceivableAmount,
        urgency: '关注',
        routeName: financeRouteNames.invoiceManagement,
        query: { direction: 'output' }
      },
      {
        id: 'customer-statement-review',
        title: '待审核客户对账单',
        count: stats.pendingCustomerStatementCount,
        amount: stats.pendingCustomerStatementAmount,
        urgency: '紧急',
        routeName: financeRouteNames.customerSettlement,
        query: { status: 'pending_review' }
      },
      {
        id: 'carrier-statement-review',
        title: '待审核承运商对账单',
        count: stats.pendingCarrierStatementCount,
        amount: stats.pendingCarrierStatementAmount,
        urgency: '紧急',
        routeName: financeRouteNames.carrierSettlement,
        query: { status: 'pending_review' }
      },
      {
        id: 'receipt-allocation',
        title: '待核销客户收款',
        count: stats.unallocatedReceiptCount,
        amount: stats.unallocatedReceiptAmount,
        urgency: '关注',
        routeName: financeRouteNames.cashTransaction,
        query: { direction: 'receipt', status: 'pending_allocation' }
      },
      {
        id: 'payment-allocation',
        title: '待核销承运商付款',
        count: stats.unallocatedPaymentCount,
        amount: stats.unallocatedPaymentAmount,
        urgency: '关注',
        routeName: financeRouteNames.cashTransaction,
        query: { direction: 'payment', status: 'pending_allocation' }
      },
      {
        id: 'invoice-review',
        title: '待复核发票',
        count: stats.pendingInvoiceCount,
        amount: stats.pendingInvoiceAmount,
        urgency: '关注',
        routeName: financeRouteNames.invoiceManagement,
        query: { status: 'pending_review' }
      },
      {
        id: 'invoice-match',
        title: '待匹配草稿发票',
        count: stats.draftInvoiceCount,
        amount: stats.draftInvoiceAmount,
        urgency: '普通',
        routeName: financeRouteNames.invoiceManagement,
        query: { status: 'draft' }
      },
      {
        id: 'cost-review',
        title: '待审核运单费用',
        count: stats.pendingCostCount,
        amount: stats.pendingCostAmount,
        urgency: '关注',
        routeName: financeRouteNames.waybillCost,
        query: { auditStatus: 'pending_review' }
      }
    ]
    return tasks.filter((item) => item.count > 0)
  }

  function buildProgressItems(stats: Stats): ProgressItem[] {
    const candidates: Array<{ access: WorkbenchFieldKey; item: ProgressItem }> = [
      {
        access: 'customerSettlementAmounts',
        item: {
          label: '客户回款完成率',
          value: formatSensitiveNumberWithAffix(stats.receiptCompletionRate, rateDisplayOptions),
          percent: clamp(normalizeNullableNumber(stats.receiptCompletionRate) ?? 0, 0, 100),
          color:
            (normalizeNullableNumber(stats.receiptCompletionRate) ?? undefined) !== undefined
              ? 'var(--el-color-success)'
              : 'var(--el-color-info)'
        }
      },
      {
        access: 'carrierSettlementAmounts',
        item: {
          label: '承运商付款完成率',
          value: formatSensitiveNumberWithAffix(stats.paymentCompletionRate, rateDisplayOptions),
          percent: clamp(normalizeNullableNumber(stats.paymentCompletionRate) ?? 0, 0, 100),
          color:
            (normalizeNullableNumber(stats.paymentCompletionRate) ?? undefined) !== undefined
              ? 'var(--el-color-warning)'
              : 'var(--el-color-info)'
        }
      },
      {
        access: 'invoiceAmounts',
        item: {
          label: '发票匹配完成率',
          value: formatSensitiveNumberWithAffix(stats.invoiceMatchRate, rateDisplayOptions),
          percent: clamp(normalizeNullableNumber(stats.invoiceMatchRate) ?? 0, 0, 100),
          color:
            (normalizeNullableNumber(stats.invoiceMatchRate) ?? undefined) !== undefined
              ? 'var(--el-color-primary)'
              : 'var(--el-color-info)'
        }
      },
      {
        access: 'operatingAmounts',
        item: {
          label: '费用审核完成率',
          value: formatSensitiveNumberWithAffix(stats.costApprovalRate, rateDisplayOptions),
          percent: clamp(normalizeNullableNumber(stats.costApprovalRate) ?? 0, 0, 100),
          color:
            (normalizeNullableNumber(stats.costApprovalRate) ?? undefined) !== undefined
              ? 'var(--el-color-success)'
              : 'var(--el-color-info)'
        }
      }
    ]
    return candidates
      .filter(({ access }) => fieldAccessLevel(access) !== 'hidden')
      .map(({ item }) => item)
  }

  function buildReminders(stats: Stats): ReminderItem[] {
    const reminders: ReminderItem[] = []
    if (stats.approvedUnpaidPaymentCount > 0) {
      reminders.push({
        title: withOptionalAmount(
          `有 ${stats.approvedUnpaidPaymentCount} 笔付款申请已审批但尚未付款`,
          stats.approvedUnpaidPaymentAmount
        ),
        type: 'warning'
      })
    }
    if (stats.unapprovedPaymentCount > 0) {
      reminders.push({
        title: `${withOptionalAmount(
          `发现 ${stats.unapprovedPaymentCount} 笔未关联付款审批的实际付款`,
          stats.unapprovedPaymentAmount
        )}；请复核存量或平台批量入账记录`,
        type: 'error'
      })
    }
    if (stats.unallocatedReceiptCount > 0) {
      reminders.push({
        title: withOptionalAmount(
          `有 ${stats.unallocatedReceiptCount} 笔客户收款尚未完全核销`,
          stats.unallocatedReceiptAmount
        ),
        type: 'warning'
      })
    }
    if (stats.unallocatedPaymentCount > 0) {
      reminders.push({
        title: withOptionalAmount(
          `有 ${stats.unallocatedPaymentCount} 笔承运商付款尚未完全核销`,
          stats.unallocatedPaymentAmount
        ),
        type: 'info'
      })
    }
    if (stats.draftInvoiceCount > 0 || stats.pendingInvoiceCount > 0) {
      const invoiceRate = normalizeNullableNumber(stats.invoiceMatchRate) ?? undefined
      const invoiceRateLabel =
        fieldAccessLevel('invoiceAmounts') === 'hidden'
          ? ''
          : `当前发票匹配完成率 ${formatSensitiveNumberWithAffix(stats.invoiceMatchRate, rateDisplayOptions)}，`
      if (invoiceRate !== undefined && invoiceRate >= 100) return reminders
      reminders.push({
        title: `${invoiceRateLabel}请及时关联对账单并完成复核`,
        type: 'info'
      })
    }
    return reminders
  }

  function applyStats(stats: Stats, workload = overview.workload): void {
    const normalizedStats: Stats = {
      ...createEmptyStats(),
      ...stats,
      fieldAccess: stats.fieldAccess ?? {}
    }
    Object.assign(overview.stats, normalizedStats)
    Object.assign(overview.workload, workload)
    overview.metrics = buildMetrics(normalizedStats)
    overview.tasks = buildTasks(normalizedStats, workload)
    overview.progressItems = buildProgressItems(normalizedStats)
    overview.reminders = buildReminders(normalizedStats)
  }

  function urgencyType(value: string): TagProps['type'] {
    if (value === '紧急') return 'danger'
    if (value === '关注') return 'warning'
    return 'info'
  }

  function handleTask(task: WorkbenchTask): void {
    const routeName = task.routeName
    if (!routeName) return
    void router.push({ name: routeName, query: task.query })
  }

  function handleMetricClick(metric: BusinessWorkspaceMetric): void {
    const routeName = metricRouteNames[metric.key ?? '']
    if (routeName) void router.push({ name: routeName })
  }

  function openCollectionAdvisor(): void {
    void collectionAdvisorRef.value?.handleOpen()
  }

  async function loadWorkbench(): Promise<void> {
    overview.loading = true
    loadError.value = null
    try {
      const [workbenchResult, workloadResult] = await Promise.all([
        fetchFinanceWorkbench(),
        fetchAccountingWorkloadSummary()
      ])
      applyStats(
        workbenchResult.data ?? createEmptyStats(),
        workloadResult.data ?? createEmptyWorkload()
      )
    } catch (error) {
      loadError.value = error instanceof Error ? error : new Error('财务工作台加载失败')
    } finally {
      overview.loading = false
    }
  }

  onMounted(() => void loadWorkbench())
</script>

<style scoped lang="scss">
  .finance-workbench {
    min-width: 0;

    :deep(> .art-async-state) {
      display: grid;
      gap: 20px;
      min-width: 0;
    }

    &__main {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(340px, 1fr);
      gap: 16px;
      align-items: start;
      min-width: 0;

      :deep(.art-table),
      :deep(.art-table > .el-table) {
        height: auto;
      }
    }

    &__panel {
      padding: var(--art-section-padding);
    }

    &__task-skeleton {
      display: grid;
      grid-template-rows: 42px repeat(5, minmax(48px, 1fr));
      min-height: 326px;
      padding: 0 var(--art-section-padding) var(--art-section-padding);
    }

    &__task-skeleton-heading,
    &__task-skeleton-row {
      display: grid;
      grid-template-columns:
        minmax(0, 2fr) minmax(42px, 0.55fr) minmax(64px, 0.9fr) minmax(52px, 0.65fr)
        44px;
      gap: 12px;
      align-items: center;
      min-width: 0;
      padding: 0 12px;
    }

    &__task-skeleton-heading {
      font-size: 12px;
      font-weight: 600;
      color: var(--art-gray-700);
      background: var(--art-gray-100);
    }

    &__task-skeleton-row {
      border-bottom: 1px solid var(--el-border-color-lighter);

      :deep(.el-skeleton__item) {
        height: 14px;
      }

      :deep(.el-skeleton__rect) {
        width: 32px;
        height: 32px;
        border-radius: var(--el-border-radius-base);
      }
    }

    &__progress-list {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    &__progress-skeleton {
      display: flex;
      gap: 14px;
      align-items: center;
      min-width: 0;
      min-height: 116px;
      padding: 14px;
      background: var(--art-gray-100);
      border-radius: var(--art-surface-radius);

      :deep(.el-skeleton__circle) {
        flex: 0 0 auto;
        width: 88px;
        height: 88px;
      }

      > span {
        display: grid;
        flex: 1 1 auto;
        gap: 12px;
        min-width: 0;
      }
    }

    &__progress-item {
      display: flex;
      gap: 14px;
      align-items: center;
      min-width: 0;
      min-height: 116px;
      padding: 14px;
      background: color-mix(in srgb, var(--progress-color) 5%, var(--default-box-color));
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--art-surface-radius);

      :deep(.el-progress) {
        flex: 0 0 auto;
      }

      :deep(.el-progress__text) {
        font-size: 13px !important;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
      }
    }

    &__progress-copy {
      display: grid;
      gap: 5px;
      min-width: 0;

      strong {
        font-size: 13px;
        line-height: 20px;
        color: var(--el-text-color-primary);
      }

      small {
        font-size: 12px;
        color: var(--el-text-color-secondary);
      }
    }

    .el-alert + .el-alert {
      margin-top: 10px;
    }
  }

  @media (width <= 1360px) {
    .finance-workbench__progress-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .finance-workbench__main {
      grid-template-columns: 1fr;
    }
  }

  @media (width <= 640px) {
    .finance-workbench__progress-list {
      grid-template-columns: 1fr;
    }
  }
</style>
