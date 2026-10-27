<template>
  <ArtDialog ref="dialogRef" size="lg">
    <CashVoucherOcrPanel
      v-if="dialog.mode === 'create'"
      ref="ocrPanelRef"
      v-model="form.voucherUrls"
      direction="payment"
      :resource-tenant-id="tenantScopeStore.effectiveTenantId || ''"
      @apply="handleApplyOcrResult"
    />
    <ArtDescriptions
      v-if="dialog.mode === 'allocate' && dialog.transaction"
      class="mb-5"
      :data="dialog.transaction"
      :items="allocationSourceItems"
      :columns="2"
      label-width="100px"
    />
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      :model-value="form"
      @update:model-value="replaceReactiveModel(form, $event)"
      :items="formItems"
      :rules="formRules"
      :span="12"
      :gutter="20"
      label-width="100px"
      :show-reset="false"
      :show-submit="false"
    >
      <template #carrierId>
        <ArtTableSingleSelect
          v-model="form.carrierId"
          v-model:selected-data="selection.carriers"
          :api-fn="fetchCarrierSelectorData"
          :columns="carrierColumns"
          title="选择付款承运商"
          subtitle="付款和应付对账单必须属于同一承运商"
          row-key="id"
          label-key="companyName"
          description-key="carrierCode"
          placeholder="请选择承运商"
          search-placeholder="承运商名称、编码或联系人"
          empty-text="暂无可选承运商"
          empty-description="当前租户没有匹配的启用承运商，请先维护承运商主数据。"
          dialog-width="lg"
          :disabled="dialog.mode === 'allocate'"
          @change="handleCarrierChange"
        >
          <template #empty><FinanceDataSourceEmptyActions source="carrier" /></template>
        </ArtTableSingleSelect>
      </template>
      <template #statementIds>
        <ArtTableMultipleSelect
          ref="statementSelectRef"
          v-model="form.statementIds"
          v-model:selected-data="selection.statements"
          :api-fn="fetchStatementSelectorData"
          :columns="statementSelectorColumns"
          title="选择待核销承运商对账单"
          subtitle="仅显示该承运商已确认、且仍有未付金额的对账单"
          row-key="id"
          label-key="statementNo"
          description-key="periodLabel"
          placeholder="可选择一份或多份对账单"
          search-placeholder="对账单号或承运商名称"
          dialog-width="xl"
          show-pagination
          show-selected-panel
          :page-size="10"
          :disabled="!form.carrierId"
          @change="handleStatementChange"
          empty-text="暂无待核销承运商对账单"
          empty-description="请先生成并确认承运商对账单；已付清或无未付金额的对账单不会显示。"
        >
          <template #empty><FinanceDataSourceEmptyActions source="carrier-statement" /></template>
        </ArtTableMultipleSelect>
      </template>
    </ArtForm>
    <div v-if="allocationRows.length" class="payment-allocation">
      <div class="payment-allocation__header"
        ><span>核销明细</span
        ><ElButton plain type="primary" @click="autoAllocate">按未付金额自动分配</ElButton></div
      >
      <ArtTable
        :data="allocationRows"
        :border="false"
        :columns="allocationColumns"
        :pagination="false"
        height="auto"
        :show-table-header="false"
        max-height="300px"
      />
    </div>
    <ElAlert
      v-if="dialog.mode === 'allocate'"
      class="mt-4"
      type="info"
      :closable="false"
      show-icon
      title="核销仅使用实付本金余额，手续费不参与应付核销；账面流水金额保持不变。"
    />
    <ElAlert
      class="mt-4"
      :type="allocationSummary.allocated > allocationSummary.limit ? 'error' : 'info'"
      :closable="false"
      show-icon
      :title="summaryText"
    />
  </ArtDialog>
</template>

<script setup lang="tsx">
  import { replaceReactiveModel } from '@/utils/form/model'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableNumber, normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import { round } from 'lodash-es'
  import { ElInputNumber, ElMessage, type FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTableMultipleSelect from '@/components/core/forms/art-data-select/table-multiple.vue'
  import ArtTableSingleSelect from '@/components/core/forms/art-data-select/table-single.vue'
  import FinanceDataSourceEmptyActions from '../../../components/finance-data-source-empty-actions.vue'
  import type {
    ArtDataSelectExpose,
    DataSelectColumn,
    DataSelectFetchParams,
    DataSelectRecord
  } from '@/components/core/forms/art-data-select/types'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import type { ColumnOption } from '@/types'
  import {
    allocateCarrierPayment,
    createCarrierPayment,
    fetchCarrierOptions,
    fetchCarrierStatementAllocatableList,
    fetchFundAccountOptions,
    reviewCashVoucherOcrArtifact
  } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import CashVoucherOcrPanel from './cash-voucher-ocr-panel.vue'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'
  import { canEditField, formatSensitiveNumberWithAffix } from '@/utils/field-permission'

  defineOptions({ name: 'FinanceCarrierPaymentDialog' })
  type CashTransaction = Api.Fms.CashTransactionRecord
  type Statement = Api.Fms.CarrierStatementAllocatable
  interface PaymentForm {
    transactionNo: string
    carrierId: string
    fundAccountId: string
    transactionDate: string
    amount: number
    paymentMethod: Api.Fms.CashPaymentMethod
    bankReference: string
    remark: string
    statementIds: string[]
    voucherUrls: string[]
  }
  interface AllocationRow extends Statement {
    allocationAmount: number
  }
  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }
  interface OcrPanelExpose {
    reset: () => void
  }

  const emit = defineEmits<{ success: [] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const tenantScopeStore = useTenantScopeStore()
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<FormExpose>()
  const statementSelectRef = ref<ArtDataSelectExpose>()
  const ocrPanelRef = ref<OcrPanelExpose>()
  const ocrResult = ref<Api.Fms.CashVoucherOcrAnalyzeResponse>()
  const transactionNumber = useDocumentNumberRule('tms.cash_transaction')
  const fundAccountOptions = ref<Api.Fms.FundAccountOption[]>([])
  const dialog = reactive<{ mode: 'create' | 'allocate'; transaction?: CashTransaction }>({
    mode: 'create'
  })
  const selection = reactive<{
    carriers: DataSelectRecord[]
    statements: DataSelectRecord[]
    amounts: Record<string, number>
  }>({ carriers: [], statements: [], amounts: {} })
  const initialForm = (): PaymentForm => ({
    transactionNo: '',
    carrierId: '',
    fundAccountId: '',
    transactionDate: dayjs().format('YYYY-MM-DD'),
    amount: 0,
    paymentMethod: 'bank_transfer',
    bankReference: '',
    remark: '',
    statementIds: [],
    voucherUrls: []
  })
  const form = reactive<PaymentForm>(initialForm())
  const allocationSourceItems: ArtDescriptionItem<CashTransaction>[] = [
    { key: 'transactionNo', label: '付款流水号', field: 'transactionNo', copyable: true },
    { key: 'transactionDate', label: '付款日期', field: 'transactionDate', format: 'date' },
    { key: 'counterpartyName', label: '付款承运商', field: 'counterpartyName' },
    {
      key: 'paymentMethod',
      label: '付款方式',
      field: 'paymentMethod',
      dictCode: 'tmsCashPaymentMethod',
      dictDisplay: 'text'
    },
    ...(
      [
        ['amount', '实付总额'],
        ['feeAmount', '手续费（不核销）'],
        ['allocatedAmount', '已核销本金'],
        ['allocatableAmount', '可核销本金']
      ] as const
    ).map(([field, label]) => ({
      key: field,
      label,
      field,
      formatter: (value: unknown) =>
        formatSensitiveNumberWithAffix(value as Api.Fms.SensitiveNumber, { prefix: '¥' })
    }))
  ]

  const limit = computed(() =>
    round(
      dialog.mode === 'allocate'
        ? (normalizeNullableNumber(dialog.transaction?.allocatableAmount) ?? 0)
        : Number(form.amount || 0),
      2
    )
  )
  const selectedStatements = computed(() => selection.statements as Statement[])
  const allocationRows = computed<AllocationRow[]>(() =>
    selectedStatements.value.map((item) => ({
      ...item,
      allocationAmount: Number(selection.amounts[item.id] ?? 0)
    }))
  )
  const allocationSummary = computed(() => {
    const allocated = round(
      allocationRows.value.reduce((sum, row) => sum + Number(row.allocationAmount || 0), 0),
      2
    )
    return { allocated, limit: limit.value, remaining: round(limit.value - allocated, 2) }
  })
  const summaryText = computed(
    () =>
      `可核销 ${formatSensitiveNumberWithAffix(allocationSummary.value.limit, { prefix: '¥' })}，本次核销 ${formatSensitiveNumberWithAffix(allocationSummary.value.allocated, { prefix: '¥' })}，剩余 ${formatSensitiveNumberWithAffix(allocationSummary.value.remaining, { prefix: '¥' })}`
  )

  const carrierColumns: DataSelectColumn[] = [
    { prop: 'carrierCode', label: '承运商编码', width: 150 },
    { prop: 'companyName', label: '承运商名称', minWidth: 240 },
    { prop: 'contactName', label: '联系人', width: 120 },
    { prop: 'contactPhone', label: '联系电话', width: 150 }
  ]
  const statementSelectorColumns: DataSelectColumn[] = [
    { prop: 'statementNo', label: '对账单号', width: 190 },
    { prop: 'periodLabel', label: '对账账期', width: 205 },
    { prop: 'costCount', label: '费用数', width: 90 },
    {
      prop: 'statementAmount',
      label: '应付金额',
      width: 130,
      align: 'right',
      formatter: (r) =>
        formatSensitiveNumberWithAffix(Number((r as Statement).statementAmount) || 0, {
          prefix: '¥'
        })
    },
    {
      prop: 'settledAmount',
      label: '已付金额',
      width: 130,
      align: 'right',
      formatter: (r) =>
        formatSensitiveNumberWithAffix(Number((r as Statement).settledAmount) || 0, { prefix: '¥' })
    },
    {
      prop: 'outstandingAmount',
      label: '未付金额',
      width: 130,
      align: 'right',
      formatter: (r) =>
        formatSensitiveNumberWithAffix(Number((r as Statement).outstandingAmount) || 0, {
          prefix: '¥'
        })
    }
  ]
  const allocationColumns: ColumnOption<AllocationRow>[] = [
    { prop: 'statementNo', label: '对账单号', width: 190 },
    {
      prop: 'period',
      label: '账期',
      minWidth: 190,
      formatter: (r) => `${r.periodStart} 至 ${r.periodEnd}`
    },
    {
      prop: 'outstandingAmount',
      label: '未付金额',
      width: 130,
      align: 'right',
      formatter: (r) => formatSensitiveNumberWithAffix(r.outstandingAmount || 0, { prefix: '¥' })
    },
    {
      prop: 'allocationAmount',
      label: '本次核销',
      width: 180,
      formatter: (r) => (
        <ElInputNumber
          v-model={selection.amounts[r.id]}
          min={0}
          max={Math.min(Number(r.outstandingAmount), limit.value)}
          precision={2}
          controlsPosition="right"
          class="w-full!"
          onChange={() => {
            selection.amounts[r.id] = round(Number(selection.amounts[r.id] ?? 0), 2)
          }}
        />
      )
    }
  ]

  const formRules: FormRules<PaymentForm> = {
    transactionNo: [
      {
        validator: (_rule, value, callback) =>
          transactionNumber.manualRequired(dialog.mode === 'allocate') &&
          !String(value || '').trim()
            ? callback(new Error('请输入付款流水号'))
            : callback(),
        trigger: 'blur'
      }
    ],
    carrierId: [{ required: true, message: '请选择付款承运商', trigger: 'change' }],
    fundAccountId: [
      {
        validator: (_rule, value, callback) =>
          dialog.mode === 'allocate' || String(value || '').trim()
            ? callback()
            : callback(new Error('请选择付款资金账户')),
        trigger: 'change'
      }
    ],
    transactionDate: [{ required: true, message: '请选择付款日期', trigger: 'change' }],
    amount: [
      {
        validator: (_r, v, cb) => (Number(v) > 0 ? cb() : cb(new Error('付款金额必须大于 0'))),
        trigger: 'change'
      }
    ],
    paymentMethod: [{ required: true, message: '请选择付款方式', trigger: 'change' }]
  }
  const formItems = computed<FormItem[]>(() =>
    dialog.mode === 'allocate'
      ? [{ label: '承运商对账单', key: 'statementIds', type: 'input', span: 24 }]
      : [
          { label: '付款信息', key: 'base', type: 'divider', span: 24 },
          {
            label: '付款流水号',
            key: 'transactionNo',
            type: 'input',
            span: 12,
            props: {
              maxlength: 50,
              ...transactionNumber.inputProps(false, '请输入付款流水号', true)
            },
            description: transactionNumber.description.value
          },
          { label: '付款承运商', key: 'carrierId', type: 'input', span: 12 },
          {
            label: '付款日期',
            key: 'transactionDate',
            type: 'date',
            span: 12,
            props: {
              valueFormat: 'YYYY-MM-DD',
              class: '!w-full'
            }
          },
          {
            label: '付款金额',
            key: 'amount',
            type: 'number',
            span: 12,
            props: {
              min: 0.01,
              precision: 2,
              controlsPosition: 'right',
              class: '!w-full',
              onChange: autoAllocate
            }
          },
          {
            label: '付款方式',
            key: 'paymentMethod',
            type: 'select',
            span: 12,
            props: {
              options: getDictMap.value.tmsCashPaymentMethod ?? []
            }
          },
          {
            label: '付款账户',
            key: 'fundAccountId',
            type: 'select',
            span: 12,
            props: {
              options: fundAccountOptions.value,
              filterable: true,
              placeholder: '选择实际扣款资金账户'
            },
            description: '付款成功后自动登记资金流出日记账'
          },
          {
            label: '银行流水号',
            key: 'bankReference',
            type: 'input',
            span: 12,
            props: { placeholder: '选填' }
          },
          {
            label: '付款备注',
            key: 'remark',
            type: 'textarea',
            span: 24,
            props: { maxlength: 500, placeholder: '选填' }
          },
          { label: '核销信息', key: 'allocation', type: 'divider', span: 24 },
          { label: '承运商对账单', key: 'statementIds', type: 'input', span: 24 }
        ]
  )

  async function fetchCarrierSelectorData(params: DataSelectFetchParams) {
    const { data } = await fetchCarrierOptions({ companyName: params.keyword })
    return { data: data ?? [], total: data?.length ?? 0 }
  }
  async function fetchStatementSelectorData(params: DataSelectFetchParams) {
    if (!form.carrierId) return { data: [], total: 0 }
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    const { data, total } = await fetchCarrierStatementAllocatableList({
      carrierId: form.carrierId,
      keyword: params.keyword,
      from,
      to
    })
    return {
      data: (data ?? []).map((item) => ({
        ...item,
        periodLabel: `${item.periodStart} 至 ${item.periodEnd}`
      })),
      total: total ?? 0
    }
  }
  function clearStatements() {
    form.statementIds = []
    selection.statements = []
    selection.amounts = {}
  }
  function handleApplyOcrResult(result: Api.Fms.CashVoucherOcrAnalyzeResponse) {
    ocrResult.value = result
    const voucher = result.voucher
    Object.assign(form, {
      transactionDate: voucher.transactionDate || form.transactionDate,
      amount: voucher.amount ?? form.amount,
      paymentMethod: voucher.paymentMethod,
      bankReference: voucher.bankReference || form.bankReference
    })
    const topMatch = result.matches[0]
    if (topMatch) {
      form.carrierId = topMatch.counterpartyId
      selection.carriers = [
        {
          id: topMatch.counterpartyId,
          companyName: topMatch.counterpartyName,
          carrierCode: 'AI 推荐'
        }
      ]
      applyRecommendedStatements(result.matches, topMatch.counterpartyId)
    }
    void nextTick(() => formRef.value?.clearValidate())
    ElMessage.success(
      topMatch ? '识别结果和推荐对账单已填入，请确认核销金额' : '识别结果已填入，请手工选择对账单'
    )
  }
  function applyRecommendedStatements(
    matches: Api.Fms.CashVoucherStatementMatch[],
    carrierId: string
  ) {
    clearStatements()
    let remaining = Number(form.amount || 0)
    const selected: DataSelectRecord[] = []
    for (const match of matches) {
      if (remaining <= 0 || match.counterpartyId !== carrierId || match.score < 60) continue
      const allocation = round(Math.min(remaining, Number(match.outstandingAmount || 0)), 2)
      if (allocation <= 0) continue
      remaining = round(remaining - allocation, 2)
      selection.amounts[match.statementId] = allocation
      selected.push({
        id: match.statementId,
        statementNo: match.statementNo,
        carrierId: match.counterpartyId,
        carrierName: match.counterpartyName,
        periodStart: match.periodStart,
        periodEnd: match.periodEnd,
        statementAmount: match.statementAmount,
        settledAmount: match.settledAmount,
        outstandingAmount: match.outstandingAmount,
        periodLabel: `${match.periodStart} 至 ${match.periodEnd}`
      })
    }
    selection.statements = selected
    form.statementIds = selected.map((item) => String(item.id))
  }
  function handleCarrierChange() {
    if (dialog.mode === 'allocate') return
    clearStatements()
    void statementSelectRef.value?.reload()
  }
  function handleStatementChange() {
    const ids = new Set(selection.statements.map((x) => String(x.id)))
    Object.keys(selection.amounts).forEach((id) => {
      if (!ids.has(id)) delete selection.amounts[id]
    })
    autoAllocate()
  }
  function autoAllocate() {
    let remaining = limit.value
    selectedStatements.value.forEach((s) => {
      const amount = round(Math.min(remaining, Number(s.outstandingAmount)), 2)
      selection.amounts[s.id] = Math.max(amount, 0)
      remaining = round(remaining - amount, 2)
    })
  }
  function allocations() {
    return allocationRows.value
      .map((r) => ({ statementId: r.id, amount: round(Number(selection.amounts[r.id] ?? 0), 2) }))
      .filter((x) => x.amount > 0)
  }
  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '承运商付款校验失败，请重试')
      return false
    }
    if (allocationSummary.value.allocated > limit.value) {
      ElMessage.warning('核销合计不能超过可核销金额')
      return false
    }
    if (dialog.mode === 'allocate' && !allocations().length) {
      ElMessage.warning('请至少填写一条核销金额')
      return false
    }
    try {
      if (dialog.mode === 'allocate' && dialog.transaction)
        await allocateCarrierPayment({
          transactionId: dialog.transaction.id,
          allocations: allocations()
        })
      else {
        const { data: transactionId } = await createCarrierPayment({
          transactionNo: normalizeNullableText(form.transactionNo),
          carrierId: form.carrierId,
          fundAccountId: form.fundAccountId,
          transactionDate: form.transactionDate,
          amount: Number(form.amount),
          paymentMethod: form.paymentMethod,
          bankReference: normalizeNullableText(form.bankReference),
          voucherUrls: [...form.voucherUrls],
          remark: normalizeNullableText(form.remark),
          allocations: allocations()
        })
        await recordOcrReview(transactionId)
      }
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '承运商付款保存失败，请检查内容后重试')
      return false
    }
  }
  async function resetForm() {
    Object.assign(form, initialForm())
    dialog.transaction = undefined
    selection.carriers = []
    clearStatements()
    ocrResult.value = undefined
    ocrPanelRef.value?.reset()
    await nextTick()
    formRef.value?.clearValidate()
  }
  async function handleOpen(transaction?: CashTransaction) {
    await userStore.ensureDictLoaded('tmsCashPaymentMethod')
    if (transaction && !canEditField(transaction.fieldAccess, 'transactionAmounts')) {
      ElMessage.warning('当前字段权限不允许继续核销该付款')
      return
    }
    await resetForm()
    fundAccountOptions.value = []
    dialog.mode = transaction ? 'allocate' : 'create'
    dialog.transaction = transaction
    if (transaction) {
      Object.assign(form, {
        transactionNo: transaction.transactionNo,
        carrierId: transaction.carrierId ?? '',
        transactionDate: transaction.transactionDate,
        amount: normalizeNullableNumber(transaction.amount) ?? 0,
        paymentMethod: transaction.paymentMethod,
        bankReference: transaction.bankReference ?? '',
        voucherUrls: [...(transaction.voucherUrls ?? [])]
      })
      selection.carriers = [
        {
          id: transaction.carrierId,
          companyName: transaction.counterpartyName,
          carrierCode: transaction.transactionNo
        }
      ]
    }
    await dialogRef.value?.handleOpen(undefined, {
      title: transaction ? `继续核销 · ${transaction.transactionNo}` : '登记承运商付款',
      subtitle: transaction
        ? `本笔付款可核销本金 ${formatSensitiveNumberWithAffix(transaction.allocatableAmount, { prefix: '¥' })}，不含手续费`
        : '登记实际付款流水，可同时核销一份或多份已确认承运商对账单',
      confirmText: transaction ? '确认核销' : '登记付款',
      contentMaxHeight: '76vh',
      loading: true,
      loadingText: transaction ? '正在准备核销明细…' : '正在加载编号规则与资金账户…',
      onOpen: async (_openData, api) => {
        try {
          if (dialog.mode === 'create') {
            const [, fundAccounts] = await Promise.all([
              transactionNumber.loadRule(),
              fetchFundAccountOptions({ status: 'active', baseCurrencyOnly: true })
            ])
            fundAccountOptions.value = fundAccounts.data ?? []
          }
        } finally {
          api.setLoading(false)
        }
      },
      onConfirm: handleSubmit,
      onReset: () => void resetForm(),
      dialogProps: { appendToBody: true, closeOnClickModal: false }
    })
  }
  defineExpose({ handleOpen })

  async function recordOcrReview(transactionId?: string | null): Promise<void> {
    if (!ocrResult.value || !transactionId) return
    try {
      const { error } = await reviewCashVoucherOcrArtifact({
        action: 'review',
        artifactId: ocrResult.value.artifactId,
        entityId: transactionId,
        outcome: 'applied',
        finalPayload: {
          payerName: ocrResult.value.voucher.payerName,
          payeeName: selection.carriers[0]?.companyName ?? null,
          transactionDate: form.transactionDate,
          amount: Number(form.amount),
          bankReference: normalizeNullableText(form.bankReference),
          paymentMethod: form.paymentMethod,
          statementIds: [...form.statementIds]
        }
      })
      if (error) ElMessage.warning('付款已登记，但 AI 质量记录失败；不影响正式业务数据')
    } catch {
      ElMessage.warning('付款已登记，但 AI 质量记录失败；不影响正式业务数据')
    }
  }
</script>

<style scoped lang="scss">
  .payment-allocation {
    margin-top: 16px;

    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      font-weight: 600;
    }
  }
</style>
