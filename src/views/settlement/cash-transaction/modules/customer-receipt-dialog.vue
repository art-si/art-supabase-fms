<template>
  <ArtDialog
    ref="dialogRef"
    @open="
      () => {
        activeTab = ''
      }
    "
    size="lg"
  >
    <ArtDescriptions
      v-if="dialog.mode === 'allocate' && dialog.transaction"
      class="mb-4"
      :data="dialog.transaction"
      :columns="2"
      :border="true"
      label-width="104px"
      :items="[
        { key: 'transactionNo', field: 'transactionNo', label: '收款单号', copyable: true },
        { key: 'counterpartyName', field: 'counterpartyName', label: '收款客户' },
        { key: 'transactionDate', field: 'transactionDate', label: '收款日期', format: 'date' },
        {
          key: 'paymentMethod',
          field: 'paymentMethod',
          label: '收款方式',
          dictCode: 'tmsCashPaymentMethod'
        },
        { key: 'amount', field: 'amount', label: '收款金额', format: 'money' },
        {
          key: 'unallocatedAmount',
          field: 'unallocatedAmount',
          label: '可核销金额',
          format: 'money'
        }
      ]"
    />

    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model:active-tab="activeTab"
      v-model="form.data"
      :items="workspaceItems"
      :rules="form.rules"
      :span="12"
      :gutter="20"
      label-width="104px"
    >
      <template #statementIds>
        <div class="receipt-allocation">
          <ArtTableMultipleSelect
            ref="statementSelectRef"
            v-model="form.data.statementIds"
            v-model:selected-data="selection.statements"
            :api-fn="fetchStatementSelectorData"
            :columns="statementSelectorColumns"
            title="选择待核销客户对账单"
            subtitle="仅显示该客户已确认且仍有未结金额的对账单"
            row-key="id"
            label-key="statementNo"
            description-key="periodLabel"
            :placeholder="
              dialog.mode === 'allocate' ? '请选择需要核销的对账单' : '可暂不核销，后续再分配收款'
            "
            search-placeholder="对账单号或客户名称"
            dialog-width="xl"
            show-pagination
            show-selected-panel
            :page-size="10"
            :disabled="!form.data.customerId"
            @change="handleStatementChange"
            empty-text="暂无待核销客户对账单"
            empty-description="请先生成并确认客户对账单；已结清或无未结金额的对账单不会显示。"
          >
            <template #empty
              ><FinanceDataSourceEmptyActions source="customer-statement"
            /></template>
          </ArtTableMultipleSelect>

          <div v-if="allocationRows.length" class="receipt-allocation__selected">
            <div class="receipt-allocation__header">
              <ArtSectionTitle :show-line="false">本次核销分配</ArtSectionTitle>
              <ElButton type="primary" plain @click="autoAllocate">
                <template #icon><ArtSvgIcon icon="ri:magic-line" /></template>
                自动分配
              </ElButton>
            </div>
            <ArtTable
              ref="allocationTableRef"
              :data="allocationRows"
              :border="false"
              :columns="allocationColumns"
              :pagination="false"
              height="auto"
              max-height="260px"
            />
          </div>

          <ElAlert
            class="receipt-allocation__summary"
            :type="allocationSummary.remaining >= 0 ? 'info' : 'error'"
            :closable="false"
            show-icon
            :title="allocationSummaryText"
          />
        </div>
      </template>
      <template #cashEvidence
        ><CashVoucherOcrPanel
          v-if="dialog.mode === 'create'"
          ref="ocrPanelRef"
          v-model="form.data.voucherUrls"
          direction="receipt"
          :resource-tenant-id="tenantScopeStore.effectiveTenantId || ''"
          @apply="handleApplyOcrResult" /></template
    ></ArtForm>
  </ArtDialog>
</template>

<script setup lang="tsx">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableNumber, normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import { ElInputNumber, ElMessage, type FormRules } from 'element-plus'
  import { round } from 'lodash-es'
  import type { ComputedRef, UnwrapNestedRefs } from 'vue'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTableMultipleSelect from '@/components/core/forms/art-data-select/table-multiple.vue'
  import FinanceDataSourceEmptyActions from '../../../components/finance-data-source-empty-actions.vue'
  import type {
    ArtDataSelectExpose,
    DataSelectColumn,
    DataSelectFetchParams,
    DataSelectRecord
  } from '@/components/core/forms/art-data-select/types'
  import ArtSectionTitle from '@/components/core/surfaces/art-section-title/index.vue'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import type { ColumnOption } from '@/types'
  import {
    allocateCustomerReceipt,
    createCustomerReceipt,
    fetchFundAccountOptions,
    fetchCustomerSelectorList,
    fetchCustomerStatementAllocatableList,
    reviewCashVoucherOcrArtifact
  } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import CashVoucherOcrPanel from './cash-voucher-ocr-panel.vue'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'
  import { canEditField, formatSensitiveNumberWithAffix } from '@/utils/field-permission'

  defineOptions({ name: 'FinanceCustomerReceiptDialog' })

  type CashTransaction = Api.Fms.CashTransactionRecord
  type AllocatableStatement = Api.Fms.CustomerStatementAllocatable
  type AllocationRow = AllocatableStatement & { allocationAmount: number }
  type DialogMode = 'create' | 'allocate'

  interface ReceiptForm {
    transactionNo: string
    customerId: string
    fundAccountId: string
    transactionDate: string
    amount: number | undefined
    paymentMethod: Api.Fms.CashPaymentMethod
    bankReference: string
    voucherUrls: string[]
    statementIds: string[]
    remark: string
  }

  interface FormGroup {
    data: ReceiptForm
    items: ComputedRef<FormItem[]>
    rules: FormRules<ReceiptForm>
  }

  interface DialogGroup {
    mode: DialogMode
    transaction?: CashTransaction
  }

  interface SelectionGroup {
    customers: DataSelectRecord[]
    statements: DataSelectRecord[]
    allocationAmounts: Record<string, number>
  }

  interface OcrPanelExpose {
    reset: () => void
  }

  const emit = defineEmits<{ success: [] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const tenantScopeStore = useTenantScopeStore()
  const dialogRef = ref<ArtDialogExpose>()
  const activeTab = ref('')
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const statementSelectRef = ref<ArtDataSelectExpose>()
  const allocationTableRef = ref<ArtTableExpose<AllocationRow>>()
  const ocrPanelRef = ref<OcrPanelExpose>()
  const ocrResult = ref<Api.Fms.CashVoucherOcrAnalyzeResponse>()
  const transactionNumber = useDocumentNumberRule('tms.cash_transaction')
  const fundAccountOptions = ref<Api.Fms.FundAccountOption[]>([])

  const dialog = reactive<DialogGroup>({ mode: 'create', transaction: undefined })
  const selection = reactive<SelectionGroup>({
    customers: [],
    statements: [],
    allocationAmounts: {}
  })

  const createInitialForm = (): ReceiptForm => ({
    transactionNo: '',
    customerId: '',
    fundAccountId: '',
    transactionDate: dayjs().format('YYYY-MM-DD'),
    amount: undefined,
    paymentMethod: 'bank_transfer',
    bankReference: '',
    voucherUrls: [],
    statementIds: [],
    remark: ''
  })

  const moneyProps = {
    min: 0,
    precision: 2,
    controlsPosition: 'right' as const,
    class: 'w-full!'
  }

  const form: UnwrapNestedRefs<FormGroup> = reactive<FormGroup>({
    data: createInitialForm(),
    rules: {
      transactionNo: [
        {
          validator: (_rule, value, callback) =>
            transactionNumber.manualRequired(dialog.mode === 'allocate') &&
            !String(value || '').trim()
              ? callback(new Error('请输入收款流水号'))
              : callback(),
          trigger: 'blur'
        }
      ],
      customerId: [{ required: true, message: '请选择收款客户', trigger: 'change' }],
      fundAccountId: [
        {
          validator: (_rule, value, callback) =>
            dialog.mode === 'allocate' || String(value || '').trim()
              ? callback()
              : callback(new Error('请选择收款资金账户')),
          trigger: 'change'
        }
      ],
      transactionDate: [{ required: true, message: '请选择收款日期', trigger: 'change' }],
      amount: [
        { required: true, message: '请输入收款金额', trigger: 'blur' },
        {
          validator: (_rule, value, callback) =>
            (normalizeNullableNumber(value) ?? 0) > 0
              ? callback()
              : callback(new Error('收款金额必须大于 0')),
          trigger: 'blur'
        }
      ],
      paymentMethod: [{ required: true, message: '请选择收款方式', trigger: 'change' }],
      bankReference: [{ max: 120, message: '银行流水号不能超过 120 个字符', trigger: 'blur' }],
      remark: [{ max: 500, message: '备注不能超过 500 个字符', trigger: 'blur' }]
    },
    items: computed<FormItem[]>(() => {
      const baseItems: FormItem[] = [
        { label: '收款信息', key: 'baseSection', type: 'divider', span: 24 },
        {
          label: '收款流水号',
          key: 'transactionNo',
          type: 'input',
          span: 12,
          props: {
            maxlength: 50,
            ...transactionNumber.inputProps(dialog.mode === 'allocate', '请输入收款流水号', true)
          },
          description: dialog.mode === 'create' ? transactionNumber.description.value : undefined
        },
        {
          slots: { empty: () => h(FinanceDataSourceEmptyActions, { source: 'customer' }) },
          props: {
            mode: 'table',
            multiple: false,
            showSelectedPanel: false,

            selectedData: selection.customers,
            'onUpdate:selectedData': ($event: typeof selection.customers) => {
              selection.customers = $event
            },
            apiFn: fetchCustomerSelectorData,
            columns: customerColumns,
            title: '选择收款客户',
            subtitle: '收款客户必须与待核销客户对账单一致',
            rowKey: 'id',
            labelKey: 'customerName',
            descriptionKey: 'customerCode',
            placeholder: '请选择收款客户',
            searchPlaceholder: '客户名称、编码、联系人或电话',
            emptyText: '暂无可选客户',
            emptyDescription: '当前租户没有匹配的启用客户，请先维护客户主数据。',
            dialogWidth: 'lg',
            showPagination: true,
            pageSize: 10,
            disabled: dialog.mode === 'allocate',
            onChange: handleCustomerChange
          },
          label: '收款客户',
          key: 'customerId',
          type: 'dataSelect',
          span: 12
        },
        {
          label: '收款日期',
          key: 'transactionDate',
          type: 'date',
          span: 12,
          props: {
            valueFormat: 'YYYY-MM-DD',
            placeholder: '请选择收款日期',
            class: 'w-full!',
            disabled: dialog.mode === 'allocate'
          }
        },
        {
          label: dialog.mode === 'allocate' ? '收款总额' : '收款金额',
          key: 'amount',
          type: 'number',
          span: 12,
          props: { ...moneyProps, disabled: dialog.mode === 'allocate' }
        },
        {
          label: '收款方式',
          key: 'paymentMethod',
          type: 'select',
          span: 12,
          props: {
            options: getDictMap.value.tmsCashPaymentMethod ?? [],
            disabled: dialog.mode === 'allocate'
          }
        }
      ]

      if (dialog.mode === 'create') {
        baseItems.push(
          {
            label: '收款账户',
            key: 'fundAccountId',
            type: 'select',
            span: 12,
            props: {
              options: fundAccountOptions.value,
              filterable: true,
              placeholder: '选择实际入账资金账户'
            },
            description: '收款成功后自动登记资金流入日记账'
          },
          {
            label: '银行流水号',
            key: 'bankReference',
            type: 'input',
            span: 12,
            props: { placeholder: '选填，可用于检索和对账' }
          },
          {
            label: '收款备注',
            key: 'remark',
            type: 'input',
            span: 24,
            props: {
              type: 'textarea',
              rows: 2,
              maxlength: 500,
              showWordLimit: true,
              placeholder: '选填，可记录付款账户、业务说明等'
            }
          }
        )
      }

      if (dialog.mode === 'allocate') baseItems.length = 0

      baseItems.push(
        { label: '核销信息', key: 'allocationSection', type: 'divider', span: 24 },
        { label: '客户对账单', key: 'statementIds', type: 'input', span: 24 }
      )
      return baseItems
    })
  })

  const allocationLimit = computed(() =>
    round(
      dialog.mode === 'allocate'
        ? (normalizeNullableNumber(dialog.transaction?.unallocatedAmount) ?? 0)
        : (normalizeNullableNumber(form.data.amount) ?? 0),
      2
    )
  )

  const selectedStatements = computed<AllocatableStatement[]>(() =>
    selection.statements.map((item) => item as AllocatableStatement)
  )

  const allocationRows = computed<AllocationRow[]>(() =>
    selectedStatements.value.map((item) => ({
      ...item,
      allocationAmount: normalizeNullableNumber(selection.allocationAmounts[item.id]) ?? 0
    }))
  )

  const allocationSummary = computed(() => {
    const allocated = round(
      allocationRows.value.reduce(
        (total, row) => total + (normalizeNullableNumber(row.allocationAmount) ?? 0),
        0
      ),
      2
    )
    return {
      limit: allocationLimit.value,
      allocated,
      remaining: round(allocationLimit.value - allocated, 2)
    }
  })

  const allocationSummaryText = computed(() => {
    const { allocated, limit, remaining } = allocationSummary.value
    const prefix = allocationRows.value.length
      ? `已选 ${allocationRows.value.length} 份对账单`
      : dialog.mode === 'allocate'
        ? '请选择对账单并填写核销金额'
        : '本次可以暂不选择对账单'
    return `${prefix}，可核销 ${formatSensitiveNumberWithAffix(limit, { prefix: '¥' })}，本次核销 ${formatSensitiveNumberWithAffix(allocated, { prefix: '¥' })}，剩余 ${formatSensitiveNumberWithAffix(remaining, { prefix: '¥' })}`
  })

  const customerColumns: DataSelectColumn[] = [
    { prop: 'customerCode', label: '客户编码', width: 145 },
    { prop: 'customerName', label: '客户名称', minWidth: 210 },
    { prop: 'contactName', label: '联系人', width: 120 },
    { prop: 'contactPhone', label: '联系电话', width: 145 },
    { prop: 'region', label: '所在区域', minWidth: 150 }
  ]

  const statementSelectorColumns: DataSelectColumn[] = [
    {
      prop: 'statementNo',
      label: '对账单 / 账期',
      minWidth: 220,
      formatter: (row) => {
        const statement = row as AllocatableStatement
        return (
          <div class="min-w-0 py-1">
            <strong class="block truncate text-sm font-semibold">{statement.statementNo}</strong>
            <small class="block text-xs text-[var(--el-text-color-secondary)]">
              {statement.periodStart} 至 {statement.periodEnd}
            </small>
          </div>
        )
      }
    },
    { prop: 'waybillCount', label: '运单数', width: 80, align: 'center' },
    {
      prop: 'statementAmount',
      label: '对账金额',
      width: 125,
      align: 'right',
      formatter: (row) =>
        formatSensitiveNumberWithAffix(
          normalizeNullableNumber((row as AllocatableStatement).statementAmount) ?? 0,
          { prefix: '¥' }
        )
    },
    {
      prop: 'outstandingAmount',
      label: '结算余额',
      width: 150,
      align: 'right',
      formatter: (row) => {
        const statement = row as AllocatableStatement
        return (
          <div class="py-1">
            <small class="block text-xs text-[var(--el-text-color-secondary)]">
              已结{' '}
              {formatSensitiveNumberWithAffix(
                normalizeNullableNumber(statement.settledAmount) ?? 0,
                {
                  prefix: '¥'
                }
              )}
            </small>
            <strong class="block text-sm font-semibold">
              未结{' '}
              {formatSensitiveNumberWithAffix(
                normalizeNullableNumber(statement.outstandingAmount) ?? 0,
                {
                  prefix: '¥'
                }
              )}
            </strong>
          </div>
        )
      }
    }
  ]

  const allocationColumns: ColumnOption<AllocationRow>[] = [
    { prop: 'statementNo', label: '对账单号', width: 190 },
    {
      prop: 'period',
      label: '账期',
      minWidth: 190,
      formatter: (row) => `${row.periodStart} 至 ${row.periodEnd}`
    },
    {
      prop: 'outstandingAmount',
      label: '未结金额',
      width: 130,
      align: 'right',
      formatter: (row) =>
        formatSensitiveNumberWithAffix(normalizeNullableNumber(row.outstandingAmount) ?? 0, {
          prefix: '¥'
        })
    },
    {
      prop: 'allocationAmount',
      label: '本次核销',
      headerTooltip: '填0表示暂不核销；单份对账单核销不能超过未结余额。',
      rules: {
        validator: ({ value, row }) =>
          Number.isFinite(value) &&
          Number(value) >= 0 &&
          Number(value) <= Number(row.outstandingAmount ?? 0),
        message: ({ rowIndex }) => '第 ' + (rowIndex + 1) + ' 行核销金额不能超过未结余额'
      },
      width: 180,
      formatter: (row) => (
        <ElInputNumber
          v-model={selection.allocationAmounts[row.id]}
          min={0}
          max={Math.min(normalizeNullableNumber(row.outstandingAmount) ?? 0, allocationLimit.value)}
          precision={2}
          controlsPosition="right"
          class="w-full!"
        />
      )
    }
  ]

  async function fetchCustomerSelectorData(params: DataSelectFetchParams) {
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    const { data, total } = await fetchCustomerSelectorList({
      keyword: params.keyword,
      from,
      to
    })
    return { data: data ?? [], total: total ?? 0 }
  }

  async function fetchStatementSelectorData(params: DataSelectFetchParams) {
    if (!form.data.customerId) return { data: [], total: 0 }
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    const { data, total } = await fetchCustomerStatementAllocatableList({
      customerId: form.data.customerId,
      keyword: params.keyword,
      from,
      to
    })
    const records = (data ?? []).map((item) => ({
      ...item,
      periodLabel: `${item.periodStart} 至 ${item.periodEnd}`
    }))
    return { data: records, total: total ?? 0 }
  }

  function clearStatementSelection(): void {
    form.data.statementIds = []
    selection.statements = []
    selection.allocationAmounts = {}
  }

  function handleApplyOcrResult(result: Api.Fms.CashVoucherOcrAnalyzeResponse): void {
    ocrResult.value = result
    const voucher = result.voucher
    Object.assign(form.data, {
      transactionDate: voucher.transactionDate || form.data.transactionDate,
      amount: voucher.amount ?? form.data.amount,
      paymentMethod: voucher.paymentMethod,
      bankReference: voucher.bankReference || form.data.bankReference
    })

    const topMatch = result.matches[0]
    if (topMatch) {
      form.data.customerId = topMatch.counterpartyId
      selection.customers = [
        {
          id: topMatch.counterpartyId,
          customerName: topMatch.counterpartyName,
          customerCode: 'AI 推荐'
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
    customerId: string
  ): void {
    clearStatementSelection()
    let remaining = normalizeNullableNumber(form.data.amount) ?? 0
    const selected: DataSelectRecord[] = []
    for (const match of matches) {
      if (remaining <= 0 || match.counterpartyId !== customerId || match.score < 60) continue
      const allocation = round(
        Math.min(remaining, normalizeNullableNumber(match.outstandingAmount) ?? 0),
        2
      )
      if (allocation <= 0) continue
      remaining = round(remaining - allocation, 2)
      selection.allocationAmounts[match.statementId] = allocation
      selected.push({
        id: match.statementId,
        statementNo: match.statementNo,
        customerId: match.counterpartyId,
        customerName: match.counterpartyName,
        periodStart: match.periodStart,
        periodEnd: match.periodEnd,
        statementAmount: match.statementAmount,
        settledAmount: match.settledAmount,
        outstandingAmount: match.outstandingAmount,
        periodLabel: `${match.periodStart} 至 ${match.periodEnd}`
      })
    }
    selection.statements = selected
    form.data.statementIds = selected.map((item) => String(item.id))
  }

  function handleCustomerChange(): void {
    if (dialog.mode === 'allocate') return
    clearStatementSelection()
    void statementSelectRef.value?.reload()
  }

  function handleStatementChange(): void {
    const selectedIds = new Set(selection.statements.map((item) => String(item.id)))
    Object.keys(selection.allocationAmounts).forEach((id) => {
      if (!selectedIds.has(id)) delete selection.allocationAmounts[id]
    })
    autoAllocate()
  }

  function autoAllocate(): void {
    let remaining = allocationLimit.value
    selectedStatements.value.forEach((statement) => {
      const amount = round(
        Math.min(remaining, normalizeNullableNumber(statement.outstandingAmount) ?? 0),
        2
      )
      selection.allocationAmounts[statement.id] = Math.max(amount, 0)
      remaining = round(remaining - amount, 2)
    })
  }

  function buildAllocations(): Api.Fms.CashAllocationInput[] {
    return allocationRows.value
      .map((row) => ({
        statementId: row.id,
        amount: round(normalizeNullableNumber(selection.allocationAmounts[row.id]) ?? 0, 2)
      }))
      .filter((item) => item.amount > 0)
  }

  function validateAllocations(): boolean {
    if (allocationSummary.value.allocated > allocationLimit.value) {
      ElMessage.warning('核销合计不能超过本次可核销金额')
      return false
    }
    if (dialog.mode === 'allocate' && !buildAllocations().length) {
      ElMessage.warning('请至少填写一条核销金额')
      return false
    }
    return true
  }

  const workspaceItems = computed<FormItem[]>(() => {
    const raw = form.items
    const allocationSlots: FormItem[] = []
    if (dialog.mode === 'allocate') return [...raw, ...allocationSlots]
    const statement = raw.find((item) => item.key === 'statementIds')
    return [
      { key: 'cashIdentity', label: '收付款信息', type: 'tab' },
      ...raw.filter(
        (item) =>
          !['baseSection', 'allocationSection', 'base', 'allocation', 'statementIds'].includes(
            item.key
          )
      ),
      ...(statement
        ? [
            {
              key: 'cashAllocation',
              label: '核销分配',
              type: allocationRows.value.length ? ('tab' as const) : ('divider' as const)
            },
            statement,
            ...allocationSlots
          ]
        : []),
      { key: 'cashEvidenceSection', label: '凭证与识别', type: 'tab' },
      { key: 'cashEvidence', label: '', span: 24, labelWidth: 0 }
    ]
  })

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '客户收款校验失败，请重试')
      return false
    }
    const allocationValidation = await allocationTableRef.value?.validate({ focus: false })
    if (allocationValidation && !allocationValidation.valid) {
      await formRef.value?.focusField('statementIds')
      if (allocationValidation.firstError) {
        await allocationTableRef.value?.validateField(allocationValidation.firstError.prop)
        ElMessage.warning(allocationValidation.firstError.message)
      }
      return false
    }
    if (!validateAllocations()) return false

    try {
      if (dialog.mode === 'allocate' && dialog.transaction) {
        await allocateCustomerReceipt({
          transactionId: dialog.transaction.id,
          allocations: buildAllocations()
        })
      } else {
        const { data: transactionId } = await createCustomerReceipt({
          transactionNo: normalizeNullableText(form.data.transactionNo),
          customerId: form.data.customerId,
          fundAccountId: form.data.fundAccountId,
          transactionDate: form.data.transactionDate,
          amount: normalizeNullableNumber(form.data.amount) ?? 0,
          paymentMethod: form.data.paymentMethod,
          bankReference: normalizeNullableText(form.data.bankReference),
          voucherUrls: [...form.data.voucherUrls],
          remark: normalizeNullableText(form.data.remark),
          allocations: buildAllocations()
        })
        await recordOcrReview(transactionId)
      }
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '客户收款保存失败，请检查内容后重试')
      return false
    }
  }

  async function resetForm(): Promise<void> {
    Object.assign(form.data, createInitialForm())
    dialog.transaction = undefined
    selection.customers = []
    clearStatementSelection()
    ocrResult.value = undefined
    ocrPanelRef.value?.reset()
    await nextTick()
    formRef.value?.clearValidate()
  }

  async function handleOpen(transaction?: CashTransaction): Promise<void> {
    await userStore.ensureDictLoaded('tmsCashPaymentMethod')
    if (transaction && !canEditField(transaction.fieldAccess, 'transactionAmounts')) {
      ElMessage.warning('当前字段权限不允许继续核销该收款')
      return
    }
    await resetForm()
    fundAccountOptions.value = []
    dialog.mode = transaction ? 'allocate' : 'create'
    dialog.transaction = transaction

    if (transaction) {
      Object.assign(form.data, {
        transactionNo: transaction.transactionNo,
        customerId: transaction.customerId ?? '',
        transactionDate: transaction.transactionDate,
        amount: normalizeNullableNumber(transaction.amount) ?? 0,
        paymentMethod: transaction.paymentMethod,
        bankReference: transaction.bankReference ?? '',
        voucherUrls: [...(transaction.voucherUrls ?? [])]
      })
      selection.customers = [
        {
          id: transaction.customerId,
          customerName: transaction.counterpartyName,
          customerCode: transaction.transactionNo
        }
      ]
    }

    await dialogRef.value?.handleOpen(undefined, {
      size: 'lg',
      title: transaction ? `继续核销 · ${transaction.transactionNo}` : '登记客户收款',
      subtitle: transaction
        ? `本笔收款尚有 ${formatSensitiveNumberWithAffix(normalizeNullableNumber(transaction.unallocatedAmount) ?? 0, { prefix: '¥' })} 未核销`
        : '登记客户实际到账流水，可同时核销一份或多份已确认对账单',
      confirmText: transaction ? '确认核销' : '登记收款',
      contentMaxHeight: '76vh',
      loading: true,
      loadingText: '正在加载编号规则与资金账户…',
      onOpen: async (_openData, api) => {
        try {
          const [, fundAccounts] = await Promise.all([
            transactionNumber.loadRule(),
            fetchFundAccountOptions({ status: 'active', baseCurrencyOnly: true })
          ])
          fundAccountOptions.value = fundAccounts.data ?? []
        } finally {
          api.setLoading(false)
        }
      },
      onConfirm: handleSubmit,
      onReset: () => void resetForm(),
      dialogProps: { appendToBody: true, closeOnClickModal: false }
    })
  }

  async function handleOpenFromOcr(result: Api.Fms.CashVoucherOcrAnalyzeResponse): Promise<void> {
    await handleOpen()
    handleApplyOcrResult(result)
  }

  defineExpose({ handleOpen, handleOpenFromOcr })

  async function recordOcrReview(transactionId?: string | null): Promise<void> {
    if (!ocrResult.value || !transactionId) return
    try {
      const { error } = await reviewCashVoucherOcrArtifact({
        action: 'review',
        artifactId: ocrResult.value.artifactId,
        entityId: transactionId,
        outcome: 'applied',
        finalPayload: {
          payerName: selection.customers[0]?.customerName ?? null,
          payeeName: ocrResult.value.voucher.payeeName,
          transactionDate: form.data.transactionDate,
          amount: normalizeNullableNumber(form.data.amount) ?? 0,
          bankReference: normalizeNullableText(form.data.bankReference),
          paymentMethod: form.data.paymentMethod,
          statementIds: [...form.data.statementIds]
        }
      })
      if (error) ElMessage.warning('收款已登记，但 AI 质量记录失败；不影响正式业务数据')
    } catch {
      ElMessage.warning('收款已登记，但 AI 质量记录失败；不影响正式业务数据')
    }
  }
</script>

<style scoped lang="scss">
  .receipt-allocation {
    width: 100%;

    &__selected {
      margin-top: 16px;
    }

    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    &__summary {
      margin-top: 12px;
    }
  }
</style>
