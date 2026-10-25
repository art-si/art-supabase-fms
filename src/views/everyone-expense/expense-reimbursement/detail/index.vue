<template>
  <ArtPageShell
    class="expense-reimbursement-detail"
    :loading="detail.loading"
    loading-mode="skeleton"
    :error="detail.error"
    :empty="detail.loaded && !detail.data"
    empty-text="未找到该费用报销单，或当前账号无权查看"
    empty-description="请返回报销单列表重新选择，或刷新后重试。"
    @retry="loadDetail"
  >
    <ArtPageHeader
      :title="detail.data?.reimbursementNo || '费用报销详情'"
      :subtitle="
        detail.data?.sourceType === 'travel'
          ? '差旅费用、收款与审批详情'
          : '费用申报、审批、付款与逐笔核销详情'
      "
      show-back
      @back="goBack"
    >
      <template #status>
        <ArtDictDisplay
          v-if="detail.data"
          dict-code="tmsReimbursementApprovalStatus"
          :value="detail.data.status"
          display="tag"
        />
        <ElTag v-if="detail.data?.isDemo" type="warning" size="small">演示</ElTag>
      </template>
      <template #meta>
        <div v-if="detail.data" class="expense-reimbursement-detail__header-meta">
          <span class="art-icon-label">
            <ArtSvgIcon icon="ri:user-3-line" aria-hidden="true" />
            {{ detail.data.applicantNameSnapshot || '申请人待补充' }}
          </span>
          <span class="art-icon-label">
            <ArtSvgIcon icon="ri:calendar-event-line" aria-hidden="true" />
            {{ detail.data.sourceType === 'travel' ? '报销日期' : '计划付款' }}
            {{
              formatDate(
                detail.data.sourceType === 'travel'
                  ? detail.data.reimbursementDate
                  : detail.data.plannedPaymentDate
              )
            }}
          </span>
          <span class="art-icon-label">
            <ArtSvgIcon icon="ri:time-line" aria-hidden="true" />
            更新于 {{ formatDateTime(detail.data.updateTime) }}
          </span>
        </div>
      </template>
      <ElButton v-if="primaryWaybillId && canViewWaybill" @click="openPrimaryWaybill">
        <ArtSvgIcon icon="ri:route-line" aria-hidden="true" />
        查看关联运单
      </ElButton>
    </ArtPageHeader>

    <ElAlert
      v-if="detail.data?.isDemo"
      type="warning"
      :closable="false"
      title="演示单据：付款仅用于流程验证，不涉及银行划转、真实资金流水或记账凭证。"
    />

    <section v-if="detail.data" class="expense-reimbursement-detail__overview art-card-xs">
      <article v-for="item in overviewItems" :key="item.label">
        <span :class="`is-${item.tone}`">
          <ArtSvgIcon :icon="item.icon" aria-hidden="true" />
        </span>
        <div>
          <small>{{ item.label }}</small>
          <strong :title="item.value">{{ item.value }}</strong>
          <p>{{ item.hint }}</p>
        </div>
      </article>
    </section>

    <div v-if="detail.data" class="expense-reimbursement-detail__content">
      <ArtSectionCard
        class="expense-reimbursement-detail__section"
        preserve-content-structure
        title="报销信息"
      >
        <ArtDescriptions
          :data="detail.data"
          :items="
            detail.data.sourceType === 'travel' ? travelReimbursementItems : reimbursementItems
          "
          :columns="descriptionColumns"
          label-width="128px"
        />
      </ArtSectionCard>

      <ArtSectionCard
        class="expense-reimbursement-detail__section"
        preserve-content-structure
        title="审批与付款"
      >
        <ArtDescriptions
          :data="detail.data"
          :items="approvalPaymentItems"
          :columns="descriptionColumns"
          label-width="128px"
        />
      </ArtSectionCard>

      <ArtSectionCard
        class="expense-reimbursement-detail__section"
        preserve-content-structure
        title="费用明细"
        :subtitle="
          detail.data.sourceType === 'travel'
            ? '逐笔记录费用、税额和报销人。'
            : '逐笔保留申请时的费用快照，审批通过并付清后自动核销。'
        "
        :empty="
          detail.data.sourceType === 'travel'
            ? !detail.data.travelLines?.length
            : !detail.data.items?.length
        "
        empty-title="当前报销单暂无费用明细"
        empty-description="登记费用明细后，可在此查看逐笔核销情况。"
      >
        <ArtTable
          v-if="detail.data.sourceType === 'travel' && !isMobile"
          :data="detail.data.travelLines ?? []"
          :columns="travelExpenseColumns"
          :border="false"
          :pagination="false"
          :show-table-header="false"
          table-layout="fixed"
        />
        <div v-else-if="detail.data.sourceType === 'travel'" class="grid gap-4">
          <article v-for="item in detail.data.travelLines ?? []" :key="item.id" class="min-w-0">
            <ArtDescriptions
              :data="item"
              :items="travelExpenseMobileItems"
              :columns="1"
              label-width="96px"
            />
          </article>
        </div>
        <ArtTable
          v-else-if="!isMobile"
          :data="detail.data.items ?? []"
          :columns="expenseColumns"
          :border="false"
          :pagination="false"
          :show-table-header="false"
          table-layout="fixed"
        />
        <div v-else class="grid gap-4">
          <article v-for="item in detail.data.items ?? []" :key="item.id" class="min-w-0">
            <RouterLink
              v-if="item.costId && canViewCosts"
              class="mb-3 inline-block break-all text-sm font-medium text-[var(--art-primary-text)]"
              :to="getWaybillCostDetailPath(item.costId)"
            >
              {{ item.costNoSnapshot || '查看费用详情' }}
            </RouterLink>
            <span v-else class="mb-3 inline-block break-all text-sm font-medium">
              {{ item.costNoSnapshot || '--' }}
            </span>
            <ArtDescriptions
              :data="item"
              :items="expenseMobileItems"
              :columns="1"
              label-width="96px"
            />
          </article>
        </div>
      </ArtSectionCard>

      <ArtSectionCard
        v-if="detail.data.sourceType === 'travel' && canViewPayees"
        class="expense-reimbursement-detail__section"
        preserve-content-structure
        title="收款信息"
        :empty="!detail.data.payees?.length"
        :empty-title="detail.data.cashPayableAmount === 0 ? '无需现金付款' : '暂无收款信息'"
        :empty-description="
          detail.data.cashPayableAmount === 0
            ? '本单报销金额已由借款抵扣，无需填写收款账户。'
            : '提交审批前需核对收款账户与收款金额。'
        "
      >
        <ArtTable
          v-if="!isMobile"
          :data="detail.data.payees ?? []"
          :columns="travelPayeeColumns"
          :border="false"
          :pagination="false"
          :show-table-header="false"
          table-layout="fixed"
        />
        <div v-else class="grid gap-4">
          <article v-for="payee in detail.data.payees ?? []" :key="payee.id" class="min-w-0">
            <ArtDescriptions
              :data="payee"
              :items="travelPayeeMobileItems"
              :columns="1"
              label-width="96px"
            />
          </article>
        </div>
      </ArtSectionCard>

      <ArtSectionCard
        v-if="canViewEvidence || canViewPaymentExecution"
        class="expense-reimbursement-detail__section"
        preserve-content-structure
        title="报销与付款凭证"
      >
        <div class="expense-reimbursement-detail__evidence-grid">
          <div v-if="canViewEvidence">
            <h3>报销依据</h3>
            <ArtUploadImage
              v-if="canReadEvidence && basisFiles.length"
              :model-value="detail.data.basisUrls ?? []"
              title="报销依据"
              :size="112"
              readonly
            />
            <ArtAsyncState
              v-else
              empty
              :empty-text="canReadEvidence ? '未上传报销依据' : '报销依据已按字段权限脱敏'"
              :empty-description="
                canReadEvidence ? '上传报销依据后可在此查看。' : '当前权限无法查看报销依据。'
              "
              size="compact"
              :empty-image-size="64"
            />
          </div>
          <div v-if="canViewPaymentExecution">
            <h3>付款凭证</h3>
            <ArtUploadImage
              v-if="canReadPaymentExecution && paymentFiles.length"
              :model-value="detail.data.paymentVoucherUrls ?? []"
              title="付款凭证"
              :size="112"
              readonly
            />
            <ArtAsyncState
              v-else
              empty
              :empty-text="
                canReadPaymentExecution
                  ? detail.data.isDemo
                    ? '演示付款不生成凭证'
                    : '尚未形成付款凭证'
                  : '付款凭证已按字段权限脱敏'
              "
              :empty-description="
                canReadPaymentExecution
                  ? detail.data.isDemo
                    ? '流程验收记录，不对应真实银行付款。'
                    : '付款完成并登记凭证后可在此查看。'
                  : '当前权限无法查看付款凭证。'
              "
              size="compact"
              :empty-image-size="64"
            />
          </div>
        </div>
      </ArtSectionCard>

      <ArtSectionCard
        v-if="detail.data.id"
        class="expense-reimbursement-detail__section"
        title="审批记录"
        preserve-content-structure
      >
        <WorkflowBusinessHistory
          business-type="tms_expense_reimbursement"
          :business-id="detail.data.id"
          :min-height="180"
        />
      </ArtSectionCard>
    </div>
  </ArtPageShell>
</template>

<script setup lang="tsx">
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import { RouterLink } from 'vue-router'
  import { useMediaQuery } from '@vueuse/core'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import type { FilePreviewTarget } from '@/hooks/core/useFilePreview'
  import type { ColumnOption } from '@/types'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import ArtPageHeader from '@/components/core/layouts/art-page-header/index.vue'
  import ArtPageShell from '@/components/core/layouts/art-page-shell/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import WorkflowBusinessHistory from '@/components/business/workflow-business-history/index.vue'
  import { fetchExpenseReimbursementDetail } from '@fms/api'
  import { getWaybillCostDetailPath } from '@/router/business-paths'
  import { createDateTimeFormatter } from '@/utils/ui/format'
  import { formatCurrencyValue } from '@/utils/ui'
  import { useDetailRecord } from '@/hooks/core/useDetailRecord'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import { useAuth } from '@/hooks/core/useAuth'
  import {
    isReadableFieldAccess,
    canViewField,
    getFieldAccess,
    isMaskedValue
  } from '@/utils/field-permission'

  defineOptions({ name: 'FinanceExpenseReimbursementDetail' })

  type Reimbursement = Api.Fms.ExpenseReimbursementRecord
  type ExpenseItem = Api.Fms.ExpenseReimbursementItem
  type TravelLine = Api.Fms.ExpenseReimbursementTravelLine
  type TravelPayee = Api.Fms.ExpenseReimbursementPayee

  interface OverviewItem {
    label: string
    value: string
    hint: string
    icon: string
    tone: 'primary' | 'success' | 'warning' | 'info'
  }

  const route = useRoute()
  const router = useRouter()
  const { hasAuth, hasAnyAuth } = useAuth()
  const canViewCosts = computed(() => hasAuth('FinanceWaybillCost:View'))
  const canViewWaybill = computed(() =>
    hasAnyAuth(['TmsPendingWaybillList:View', 'TmsLoadedWaybillList:View'])
  )
  const active = ref(true)
  const isMobile = useMediaQuery('(max-width: 640px)')
  const isNarrow = useMediaQuery('(max-width: 1440px)')
  const recordState = useDetailRecord<Reimbursement>(async (id) => {
    if (!id) throw new Error('缺少报销单标识')
    const assertScope = createTenantScopeReadGuard()
    const result = await fetchExpenseReimbursementDetail(id)
    assertScope()
    return result
  }, '报销详情加载失败，请稍后重试')
  const detail = reactive({
    data: recordState.detail,
    error: recordState.loadError,
    loaded: computed(() => Boolean(recordState.activeId.value) && !recordState.loading.value),
    loading: recordState.loading
  })

  const descriptionColumns = computed(() => (isMobile.value ? 1 : isNarrow.value ? 2 : 4))
  const primaryWaybillId = computed(
    () => detail.data?.items?.find((item) => item.waybillId)?.waybillId
  )
  const amountAccess = computed(() =>
    getFieldAccess(detail.data?.fieldAccess, 'reimbursementAmounts')
  )
  const payeeAccess = computed(() => getFieldAccess(detail.data?.fieldAccess, 'payeeDetails'))
  const canViewPayees = computed(() => payeeAccess.value !== 'hidden')
  const evidenceAccess = computed(() =>
    getFieldAccess(detail.data?.fieldAccess, 'reimbursementEvidence')
  )
  const paymentExecutionAccess = computed(() =>
    getFieldAccess(detail.data?.fieldAccess, 'paymentExecution')
  )
  const canViewEvidence = computed(() =>
    canViewField(detail.data?.fieldAccess, 'reimbursementEvidence')
  )
  const canReadEvidence = computed(() => isReadableFieldAccess(evidenceAccess.value))
  const canViewPaymentExecution = computed(() =>
    canViewField(detail.data?.fieldAccess, 'paymentExecution')
  )
  const canReadPaymentExecution = computed(() =>
    isReadableFieldAccess(paymentExecutionAccess.value)
  )
  const basisFiles = computed<FilePreviewTarget[]>(() =>
    canReadEvidence.value ? createFiles(detail.data?.basisUrls, '报销依据') : []
  )
  const paymentFiles = computed<FilePreviewTarget[]>(() =>
    canReadPaymentExecution.value ? createFiles(detail.data?.paymentVoucherUrls, '付款凭证') : []
  )
  const overviewItems = computed<OverviewItem[]>(() => {
    const items: OverviewItem[] = []
    if (amountAccess.value !== 'hidden') {
      items.push({
        label: '报销金额',
        value: money(detail.data?.totalAmount),
        hint: amountAccess.value === 'masked' ? '金额已按字段权限脱敏' : '本单申请报销总额',
        icon: 'ri:money-cny-circle-line',
        tone: 'primary'
      })
    }
    items.push({
      label: '费用笔数',
      value: `${detail.data?.itemCount ?? 0} 笔`,
      hint: detail.data?.sourceType === 'travel' ? '逐笔登记差旅费用' : '逐笔保留费用快照',
      icon: 'ri:file-list-3-line',
      tone: 'warning'
    })
    if (detail.data?.sourceType === 'travel') {
      if (amountAccess.value !== 'hidden') {
        items.push({
          label: '付现金额',
          value: money(detail.data.cashPayableAmount),
          hint: '扣除借款抵扣后的应付金额',
          icon: 'ri:wallet-3-line',
          tone: 'success'
        })
      }
    } else {
      items.push({
        label: '关联运单',
        value: detail.data?.waybillNos || `${detail.data?.waybillCount ?? 0} 单`,
        hint: '同一运单费用集中报销',
        icon: 'ri:truck-line',
        tone: 'success'
      })
    }
    if (paymentExecutionAccess.value !== 'hidden') {
      items.push({
        label: detail.data?.isDemo ? '模拟付款' : '付款进度',
        value:
          detail.data?.cashPayableAmount === 0
            ? '无需现金付款'
            : detail.data?.paymentNo || (detail.data?.status === 'paid' ? '已支付' : '待支付'),
        hint:
          paymentExecutionAccess.value === 'masked'
            ? '付款结果已按字段权限脱敏'
            : detail.data?.isDemo
              ? '仅记录演示付款，不产生真实资金流水'
              : detail.data?.paymentReference || '付款后自动逐笔核销',
        icon: 'ri:secure-payment-line',
        tone: 'info'
      })
    }
    return items
  })

  const reimbursementItems = computed<ArtDescriptionItem<Reimbursement>[]>(() => {
    const items: ArtDescriptionItem<Reimbursement>[] = [
      { key: 'reimbursementNo', label: '报销单号', field: 'reimbursementNo', copyable: true },
      { key: 'applicantName', label: '申请人', field: 'applicantNameSnapshot' }
    ]
    if (payeeAccess.value !== 'hidden') {
      items.push(
        { key: 'payeeName', label: '收款人', field: 'payeeName' },
        {
          key: 'paymentMethod',
          label: '付款方式',
          field: 'paymentMethod',
          dictCode: 'tmsCashPaymentMethod'
        },
        { key: 'payeeBank', label: '收款银行', field: 'payeeBank' },
        {
          key: 'payeeAccount',
          label: '收款账号',
          field: 'payeeAccount',
          copyable: isReadableFieldAccess(payeeAccess.value)
        }
      )
    }
    if (amountAccess.value !== 'hidden') {
      items.push({
        key: 'totalAmount',
        label: '报销金额',
        field: 'totalAmount',
        value: (data: Reimbursement) => money(data.totalAmount)
      })
    }
    items.push({
      key: 'plannedPaymentDate',
      label: '计划付款日',
      field: 'plannedPaymentDate',
      format: 'date'
    })
    if (evidenceAccess.value !== 'hidden') {
      items.push({ key: 'remark', label: '报销说明', field: 'remark', span: 4 })
    }
    return items
  })

  const travelReimbursementItems = computed<ArtDescriptionItem<Reimbursement>[]>(() => {
    const items: ArtDescriptionItem<Reimbursement>[] = [
      { key: 'reimbursementNo', label: '报销单号', field: 'reimbursementNo', copyable: true },
      { key: 'applicantNameSnapshot', label: '报销人', field: 'applicantNameSnapshot' },
      {
        key: 'applicantEmployeeNoSnapshot',
        label: '员工工号',
        field: 'applicantEmployeeNoSnapshot'
      },
      { key: 'reimbursementDate', label: '报销日期', field: 'reimbursementDate', format: 'date' },
      { key: 'positionNameSnapshot', label: '职位', field: 'positionNameSnapshot' },
      {
        key: 'applicantCompanyNameSnapshot',
        label: '申请人公司',
        field: 'applicantCompanyNameSnapshot'
      },
      {
        key: 'expenseDepartmentNameSnapshot',
        label: '费用承担部门',
        field: 'expenseDepartmentNameSnapshot'
      },
      {
        key: 'expenseCompanyNameSnapshot',
        label: '费用承担公司',
        field: 'expenseCompanyNameSnapshot'
      }
    ]
    if (evidenceAccess.value !== 'hidden') {
      items.push({ key: 'reason', label: '事由', field: 'reason', span: 4 })
    }
    if (amountAccess.value !== 'hidden') {
      items.push(
        {
          key: 'totalAmount',
          label: '报销金额',
          field: 'totalAmount',
          value: (row: Reimbursement) => money(row.totalAmount)
        },
        {
          key: 'approvedAmount',
          label: '核定金额',
          field: 'approvedAmount',
          value: (row: Reimbursement) => money(row.approvedAmount)
        },
        {
          key: 'loanOffsetAmount',
          label: '借款抵扣',
          field: 'loanOffsetAmount',
          value: (row: Reimbursement) => money(row.loanOffsetAmount)
        },
        {
          key: 'cashPayableAmount',
          label: '付现金额',
          field: 'cashPayableAmount',
          value: (row: Reimbursement) => money(row.cashPayableAmount)
        }
      )
    }
    items.push(
      { key: 'travelApplicationNo', label: '关联出差申请', field: 'travelApplicationNo' },
      { key: 'travelLoanNo', label: '关联借款单', field: 'travelLoanNo' },
      {
        key: 'plannedPaymentDate',
        label: '计划付款日',
        field: 'plannedPaymentDate',
        format: 'date'
      }
    )
    return items
  })

  const approvalPaymentItems = computed<ArtDescriptionItem<Reimbursement>[]>(() => {
    const items: ArtDescriptionItem<Reimbursement>[] = [
      {
        key: 'status',
        label: '审批/支付状态',
        field: 'status',
        dictCode: 'tmsReimbursementApprovalStatus'
      },
      { key: 'submittedAt', label: '提交时间', field: 'submittedAt', format: 'datetime' },
      { key: 'submittedBy', label: '提交人', field: 'submittedBy' },
      { key: 'reviewedAt', label: '审批完成时间', field: 'reviewedAt', format: 'datetime' },
      { key: 'reviewedBy', label: '审批结果登记人', field: 'reviewedBy' },
      { key: 'reviewRemark', label: '审批结果说明', field: 'reviewRemark', span: 2 }
    ]
    if (paymentExecutionAccess.value !== 'hidden') {
      const copyable = isReadableFieldAccess(paymentExecutionAccess.value)
      items.push(
        { key: 'paymentNo', label: '付款单号', field: 'paymentNo', copyable },
        {
          key: 'paymentReference',
          label: '银行流水号',
          field: 'paymentReference',
          copyable
        },
        { key: 'paidAt', label: '付款时间', field: 'paidAt', format: 'datetime' },
        { key: 'paidBy', label: '付款登记人', field: 'paidBy' }
      )
    }
    items.push(
      { key: 'createTime', label: '创建时间', field: 'createTime', format: 'datetime' },
      { key: 'updateTime', label: '最后更新', field: 'updateTime', format: 'datetime' }
    )
    return items
  })

  const expenseColumns = computed<ColumnOption<ExpenseItem>[]>(() => [
    {
      prop: 'costNoSnapshot',
      label: '费用单号',
      minWidth: 190,
      formatter: (row) =>
        row.costId && canViewCosts.value ? (
          <RouterLink
            class="expense-reimbursement-detail__document-link"
            to={getWaybillCostDetailPath(row.costId)}
          >
            {row.costNoSnapshot || '--'}
          </RouterLink>
        ) : (
          row.costNoSnapshot || '--'
        )
    },
    {
      prop: 'waybillNoSnapshot',
      label: '运单号',
      minWidth: 180,
      formatter: (row) =>
        row.waybillId && canViewWaybill.value ? (
          <RouterLink
            class="expense-reimbursement-detail__document-link"
            to={{ name: 'TmsWaybillDetail', params: { id: row.waybillId } }}
          >
            {row.waybillNoSnapshot || '--'}
          </RouterLink>
        ) : (
          row.waybillNoSnapshot || '--'
        )
    },
    {
      prop: 'expenseItemNameSnapshot',
      label: '费用项目',
      minWidth: 150,
      formatter: (row) => row.expenseItemNameSnapshot || '--'
    },
    {
      prop: 'occurredOnSnapshot',
      label: '发生日期',
      width: 125,
      formatter: (row) => formatDate(row.occurredOnSnapshot)
    },
    ...(amountAccess.value !== 'hidden'
      ? [
          {
            prop: 'amountSnapshot',
            label: '费用金额',
            width: 140,
            align: 'right' as const,
            formatter: (row: ExpenseItem) => money(row.amountSnapshot)
          }
        ]
      : [])
  ])

  const travelExpenseColumns = computed<ColumnOption<TravelLine>[]>(() => [
    { prop: 'expenseItemNameSnapshot', label: '费用项目', minWidth: 150 },
    { prop: 'projectNameSnapshot', label: '项目', minWidth: 140 },
    { prop: 'occurredOn', label: '费用发生日期', width: 130 },
    ...(amountAccess.value !== 'hidden'
      ? [
          {
            prop: 'grossAmount',
            label: '报销金额',
            width: 130,
            align: 'right' as const,
            formatter: (row: TravelLine) => money(row.grossAmount)
          },
          {
            prop: 'taxRate',
            label: '税率',
            width: 80,
            align: 'right' as const,
            formatter: (row: TravelLine) => `${row.taxRate}%`
          },
          {
            prop: 'taxAmount',
            label: '税额',
            width: 115,
            align: 'right' as const,
            formatter: (row: TravelLine) => money(row.taxAmount)
          },
          {
            prop: 'netAmount',
            label: '不含税金额',
            width: 130,
            align: 'right' as const,
            formatter: (row: TravelLine) => money(row.netAmount)
          },
          {
            prop: 'approvedAmount',
            label: '核定金额',
            width: 130,
            align: 'right' as const,
            formatter: (row: TravelLine) => money(row.approvedAmount)
          }
        ]
      : []),
    ...(evidenceAccess.value !== 'hidden'
      ? [{ prop: 'invoiceNo', label: '发票号码', minWidth: 140, showOverflowTooltip: true }]
      : []),
    { prop: 'reimburseeNameSnapshot', label: '报销人', minWidth: 120 },
    { prop: 'remark', label: '备注', minWidth: 150, showOverflowTooltip: true }
  ])

  const travelExpenseMobileItems = computed<ArtDescriptionItem<TravelLine>[]>(() => [
    { key: 'expenseItemNameSnapshot', label: '费用项目', field: 'expenseItemNameSnapshot' },
    { key: 'projectNameSnapshot', label: '项目', field: 'projectNameSnapshot' },
    { key: 'occurredOn', label: '发生日期', field: 'occurredOn', format: 'date' },
    ...(amountAccess.value !== 'hidden'
      ? [
          {
            key: 'grossAmount',
            label: '报销金额',
            field: 'grossAmount',
            value: (row: TravelLine) => money(row.grossAmount)
          },
          {
            key: 'taxAmount',
            label: '税额',
            field: 'taxAmount',
            value: (row: TravelLine) => money(row.taxAmount)
          },
          {
            key: 'netAmount',
            label: '不含税金额',
            field: 'netAmount',
            value: (row: TravelLine) => money(row.netAmount)
          }
        ]
      : []),
    { key: 'reimburseeNameSnapshot', label: '报销人', field: 'reimburseeNameSnapshot' }
  ])

  const travelPayeeColumns = computed<ColumnOption<TravelPayee>[]>(() => [
    {
      prop: 'settlementMethod',
      label: '支付方式',
      width: 140,
      formatter: (row) => (
        <ArtDictDisplay
          dictCode="fmsSettlementMethod"
          value={row.settlementMethod}
          display="text"
        />
      )
    },
    { prop: 'payeeNameSnapshot', label: '收款人', minWidth: 130 },
    { prop: 'accountNameSnapshot', label: '账户名称', minWidth: 150 },
    { prop: 'bankNameSnapshot', label: '开户银行', minWidth: 170 },
    { prop: 'bankAccountSnapshot', label: '银行账号', minWidth: 180 },
    ...(amountAccess.value !== 'hidden'
      ? [
          {
            prop: 'amount',
            label: '收款金额',
            width: 135,
            align: 'right' as const,
            formatter: (row: TravelPayee) => money(row.amount)
          }
        ]
      : []),
    { prop: 'remark', label: '备注', minWidth: 150, showOverflowTooltip: true }
  ])

  const travelPayeeMobileItems = computed<ArtDescriptionItem<TravelPayee>[]>(() => [
    { key: 'payeeNameSnapshot', label: '收款人', field: 'payeeNameSnapshot' },
    { key: 'bankNameSnapshot', label: '开户银行', field: 'bankNameSnapshot' },
    { key: 'bankAccountSnapshot', label: '银行账号', field: 'bankAccountSnapshot' },
    ...(amountAccess.value !== 'hidden'
      ? [
          {
            key: 'amount',
            label: '收款金额',
            field: 'amount',
            value: (row: TravelPayee) => money(row.amount)
          }
        ]
      : [])
  ])

  const expenseMobileItems = computed<ArtDescriptionItem<ExpenseItem>[]>(() => [
    {
      key: 'waybillNoSnapshot',
      label: '运单号',
      field: 'waybillNoSnapshot',
      render: (_value, row) =>
        row.waybillId && canViewWaybill.value ? (
          <RouterLink
            class="break-all text-[var(--art-primary-text)]"
            to={{ name: 'TmsWaybillDetail', params: { id: row.waybillId } }}
          >
            {row.waybillNoSnapshot || '--'}
          </RouterLink>
        ) : (
          row.waybillNoSnapshot || '--'
        )
    },
    { key: 'expenseItemNameSnapshot', label: '费用项目', field: 'expenseItemNameSnapshot' },
    { key: 'occurredOnSnapshot', label: '发生日期', field: 'occurredOnSnapshot', format: 'date' },
    ...(amountAccess.value !== 'hidden'
      ? [
          {
            key: 'amountSnapshot',
            label: '费用金额',
            field: 'amountSnapshot',
            value: (row: ExpenseItem) => money(row.amountSnapshot)
          }
        ]
      : [])
  ])

  watch(
    () => route.params.id,
    async () => {
      await nextTick()
      if (
        active.value &&
        (!recordState.activeId.value ||
          recordState.activeId.value !== String(route.params.id || ''))
      )
        void loadDetail()
    },
    { immediate: true, flush: 'post' }
  )
  onActivated(() => {
    active.value = true
    if (!recordState.activeId.value) void loadDetail()
  })
  onDeactivated(() => {
    active.value = false
    recordState.openDetail('')
  })
  onScopeDispose(() => {
    active.value = false
    recordState.openDetail('')
  })

  async function loadDetail(): Promise<void> {
    const reimbursementId = String(route.params.id || '')
    recordState.openDetail(reimbursementId)
    await recordState.loadDetail(reimbursementId)
  }

  function createFiles(urls: string[] | undefined, prefix: string): FilePreviewTarget[] {
    return (urls ?? []).map((url, index) => ({ url, name: `${prefix} ${index + 1}` }))
  }

  function openPrimaryWaybill(): void {
    if (!primaryWaybillId.value || !canViewWaybill.value) return
    void router.push({ name: 'TmsWaybillDetail', params: { id: primaryWaybillId.value } })
  }

  function goBack(): void {
    void router.back()
  }

  function money(value?: Api.Fms.SensitiveNumber): string {
    if (isMaskedValue(value)) return '***'
    if (value === null || value === undefined) return '--'
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? formatCurrencyValue(numericValue) : String(value)
  }

  const formatDate = createDateTimeFormatter({ format: 'YYYY-MM-DD' })
  const formatDateTime = createDateTimeFormatter({ format: 'YYYY-MM-DD HH:mm' })
</script>

<style scoped lang="scss">
  .expense-reimbursement-detail {
    min-height: 100%;
    padding: 12px 16px 18px;
    background: var(--default-bg-color);

    &__header-meta {
      display: flex;
      align-items: center;
    }

    &__header-meta {
      flex-wrap: wrap;
      gap: var(--art-space-3);

      span {
        display: inline-flex;
        gap: 5px;
        align-items: center;
      }
    }

    &__overview {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      padding: 0;
      margin-top: var(--art-space-3);
      overflow: hidden;

      article {
        display: flex;
        gap: var(--art-space-3);
        min-width: 0;
        padding: var(--art-space-4);

        &:not(:last-child) {
          border-right: 1px solid var(--el-border-color-lighter);
        }

        > span {
          display: grid;
          flex: none;
          place-items: center;
          width: 42px;
          height: 42px;
          font-size: 20px;
          border-radius: var(--el-border-radius-base);

          &.is-primary {
            color: var(--el-color-primary);
            background: var(--el-color-primary-light-9);
          }

          &.is-success {
            color: var(--el-color-success);
            background: var(--el-color-success-light-9);
          }

          &.is-warning {
            color: var(--el-color-warning);
            background: var(--el-color-warning-light-9);
          }

          &.is-info {
            color: var(--el-color-info);
            background: var(--el-color-info-light-9);
          }
        }

        > div {
          display: grid;
          gap: 2px;
          min-width: 0;
        }

        small,
        p {
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--el-text-color-secondary);
          white-space: nowrap;
        }

        strong {
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 17px;
          font-variant-numeric: tabular-nums;
          color: var(--el-text-color-primary);
          white-space: nowrap;
        }

        p {
          margin: 0;
          font-size: 11px;
        }
      }
    }

    &__content {
      display: flex;
      flex-direction: column;
      gap: var(--art-space-3);
      margin-top: var(--art-space-3);
    }

    &__section {
      min-width: 0;
    }

    &__evidence-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--art-space-5);

      > div {
        min-width: 0;
      }

      h3 {
        margin: 0 0 var(--art-space-3);
        font-size: var(--art-font-size-body);
        color: var(--el-text-color-regular);
      }
    }

    :deep(.expense-reimbursement-detail__document-link) {
      display: inline-block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 600;
      color: var(--theme-color);
      white-space: nowrap;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      &:focus-visible {
        outline: 2px solid var(--theme-color);
        outline-offset: 2px;
        border-radius: var(--el-border-radius-small);
      }
    }

    @media (width <= 1100px) {
      &__overview {
        grid-template-columns: repeat(2, minmax(0, 1fr));

        article:nth-child(2) {
          border-right: 0;
        }

        article:nth-child(-n + 2) {
          border-bottom: 1px solid var(--el-border-color-lighter);
        }
      }
    }

    @media (width <= 767px) {
      &__evidence-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (width <= 640px) {
      padding-inline: 10px;

      &__overview {
        grid-template-columns: 1fr;

        article {
          border-right: 0 !important;

          &:not(:last-child) {
            border-bottom: 1px solid var(--el-border-color-lighter);
          }
        }
      }

      &__section {
        padding: var(--art-space-4);
      }
    }
  }
</style>
