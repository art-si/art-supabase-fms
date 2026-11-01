<template>
  <ArtDialog ref="dialogRef" size="md">
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model="form"
      :items="formItems"
      :rules="formRules"
      :span="12"
      :gutter="20"
      label-width="104px"
    >
      <template #customerId>
        <ArtTableSingleSelect
          v-model="form.customerId"
          v-model:selected-data="selectedCustomers"
          :api-fn="fetchCustomerSelectorData"
          :columns="customerColumns"
          title="选择对账客户"
          subtitle="客户对账单按发货客户归集应收运费"
          row-key="id"
          label-key="customerName"
          description-key="customerCode"
          placeholder="请选择客户"
          search-placeholder="客户名称、编码、联系人或电话"
          empty-text="暂无可选客户"
          empty-description="当前租户没有匹配的启用客户，请先维护客户主数据。"
          dialog-width="lg"
          show-pagination
          :page-size="10"
          @change="handleCriteriaChange"
        >
          <template #empty><FinanceDataSourceEmptyActions source="customer" /></template>
        </ArtTableSingleSelect>
      </template>

      <template #orderIds>
        <ArtTableMultipleSelect
          ref="waybillSelectRef"
          v-model="form.orderIds"
          v-model:selected-data="selectedWaybills"
          :api-fn="fetchWaybillSelectorData"
          :columns="waybillColumns"
          title="选择待对账原始运输单"
          subtitle="每张原始单仅对账一次；拆单须全部签收，合单按客户原始单分别计费"
          row-key="orderId"
          label-key="orderNo"
          description-key="routeLabel"
          placeholder="请选择待对账原始单"
          search-placeholder="原始单号、执行运单号或运输线路"
          dialog-width="xl"
          show-pagination
          show-selected-panel
          :page-size="10"
          :disabled="!canSelectWaybill"
          empty-text="暂无待对账原始单"
          empty-description="原始单全部签收后才可对账；已进入有效对账单的原始单不会重复显示。"
        >
          <template #empty><FinanceDataSourceEmptyActions source="waybill" /></template>
        </ArtTableMultipleSelect>
      </template>
    </ArtForm>

    <ElAlert
      class="mt-4"
      :type="selectedWaybills.length ? 'success' : 'info'"
      :closable="false"
      show-icon
      :title="selectionSummary"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
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
  import {
    createCustomerStatement,
    fetchCustomerSelectorList,
    fetchCustomerStatementEligibleWaybills
  } from '@fms/api'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { formatWithDayjs } from '@/utils/time'
  import {
    isReadableFieldAccess,
    getFieldAccess,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'

  defineOptions({ name: 'FinanceCustomerStatementDialog' })

  type CreatePayload = Api.Fms.CreateCustomerStatementPayload
  type EligibleWaybill = Api.Fms.CustomerStatementEligibleWaybill

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }

  interface StatementForm {
    statementNo: string
    customerId: string
    periodRange: string[]
    orderIds: string[]
    remark: string
  }

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<FormExpose>()
  const waybillSelectRef = ref<ArtDataSelectExpose>()
  const selectedCustomers = ref<DataSelectRecord[]>([])
  const selectedWaybills = ref<DataSelectRecord[]>([])
  const fieldAccess = ref<Api.Fms.CustomerStatementFieldAccessMap>({})
  const statementNumber = useDocumentNumberRule('tms.customer_statement')

  const createInitialForm = (): StatementForm => ({
    statementNo: '',
    customerId: '',
    periodRange: [dayjs().startOf('month').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')],
    orderIds: [],
    remark: ''
  })

  const form = ref<StatementForm>(createInitialForm())

  const canSelectWaybill = computed(() =>
    Boolean(form.value.customerId && form.value.periodRange?.[0] && form.value.periodRange?.[1])
  )

  const amountAccess = computed(() => getFieldAccess(fieldAccess.value, 'statementAmounts'))

  const selectedAmount = computed(() => {
    if (!isReadableFieldAccess(amountAccess.value)) return null
    return selectedWaybills.value.reduce(
      (total, row) => total + Number((row as EligibleWaybill).receivableAmount ?? 0),
      0
    )
  })

  const selectedAmountSummary = computed(() => {
    if (amountAccess.value === 'hidden') return ''
    if (amountAccess.value === 'masked') return '，对账金额 ***'
    return `，对账金额 ${formatSensitiveNumberWithAffix(selectedAmount.value, { prefix: '¥' })}`
  })

  const selectionSummary = computed(() =>
    selectedWaybills.value.length
      ? `已选择 ${selectedWaybills.value.length} 张原始运输单${selectedAmountSummary.value}`
      : canSelectWaybill.value
        ? '请选择本次需要纳入对账的原始运输单'
        : '请先选择客户和账期，再选择待对账原始单'
  )

  const customerColumns: DataSelectColumn[] = [
    { prop: 'customerCode', label: '客户编码', width: 145 },
    { prop: 'customerName', label: '客户名称', minWidth: 210 },
    { prop: 'contactName', label: '联系人', width: 120 },
    { prop: 'contactPhone', label: '联系电话', width: 145 },
    { prop: 'region', label: '所在区域', minWidth: 150 }
  ]

  const waybillColumns = computed<DataSelectColumn[]>(() => [
    { prop: 'orderNo', label: '原始单号', width: 170 },
    { prop: 'waybillNo', label: '执行运单号', width: 170 },
    {
      prop: 'routeLabel',
      label: '运输线路',
      minWidth: 200,
      formatter: (row) =>
        [(row as EligibleWaybill).originStation, (row as EligibleWaybill).destinationStation]
          .filter(Boolean)
          .join(' → ') || '-'
    },
    {
      prop: 'completedAt',
      label: '完成时间',
      width: 170,
      formatter: (row) =>
        formatWithDayjs((row as EligibleWaybill).completedAt, 'YYYY-MM-DD HH:mm') ?? '-'
    },
    ...(amountAccess.value !== 'hidden'
      ? [
          {
            prop: 'receivableAmount',
            label: '应收金额',
            width: 130,
            align: 'right' as const,
            formatter: (row: DataSelectRecord) =>
              formatSensitiveNumberWithAffix((row as EligibleWaybill).receivableAmount, {
                prefix: '¥'
              })
          }
        ]
      : [])
  ])

  const formRules: FormRules<StatementForm> = {
    statementNo: [
      {
        validator: (_rule, value, callback) =>
          statementNumber.manualRequired(false) && !String(value || '').trim()
            ? callback(new Error('请输入客户对账单号'))
            : callback(),
        trigger: 'blur'
      }
    ],
    customerId: [{ required: true, message: '请选择对账客户', trigger: 'change' }],
    periodRange: [{ required: true, message: '请选择对账账期', trigger: 'change' }],
    orderIds: [
      {
        validator: (_rule, value, callback) =>
          Array.isArray(value) && value.length
            ? callback()
            : callback(new Error('请至少选择一张待对账原始单')),
        trigger: 'change'
      }
    ],
    remark: [{ max: 500, message: '备注不能超过 500 个字符', trigger: 'blur' }]
  }

  const formItems = computed<FormItem[]>(() => [
    { label: '对账范围', key: 'baseSection', type: 'divider', span: 24 },
    {
      label: '对账单号',
      key: 'statementNo',
      type: 'input',
      span: 12,
      props: { maxlength: 50, ...statementNumber.inputProps(false, '请输入客户对账单号') },
      description: statementNumber.description.value
    },
    { label: '对账客户', key: 'customerId', type: 'input', span: 12 },
    {
      label: '对账账期',
      key: 'periodRange',
      type: 'date',
      span: 24,
      props: {
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
        startPlaceholder: '开始日期',
        endPlaceholder: '结束日期',
        rangeSeparator: '至',
        class: '!w-full',
        onChange: handleCriteriaChange
      }
    },
    { label: '待对账原始单', key: 'orderIds', type: 'input', span: 24 },
    {
      label: '对账备注',
      key: 'remark',
      type: 'input',
      span: 24,
      props: {
        type: 'textarea',
        rows: 3,
        maxlength: 500,
        showWordLimit: true,
        placeholder: '可填写账期说明、客户约定或内部备注'
      }
    }
  ])

  async function fetchCustomerSelectorData(params: DataSelectFetchParams) {
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    const { data, total } = await fetchCustomerSelectorList({
      keyword: params.keyword,
      from,
      to
    })
    return { data: data ?? [], total: total ?? 0 }
  }

  async function fetchWaybillSelectorData(params: DataSelectFetchParams) {
    if (!canSelectWaybill.value) return { data: [], total: 0 }
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    const {
      data,
      fieldAccess: access,
      total
    } = await fetchCustomerStatementEligibleWaybills({
      customerId: form.value.customerId,
      periodStart: form.value.periodRange[0],
      periodEnd: form.value.periodRange[1],
      keyword: params.keyword,
      from,
      to
    })
    fieldAccess.value = access
    const records = (data ?? []).map((item) => ({
      ...item,
      routeLabel: [item.originStation, item.destinationStation].filter(Boolean).join(' → ')
    }))
    return { data: records, total: total ?? 0 }
  }

  function handleCriteriaChange(): void {
    form.value.orderIds = []
    selectedWaybills.value = []
    fieldAccess.value = {}
    void waybillSelectRef.value?.reload()
  }

  function replaceForm(nextForm: StatementForm): void {
    Object.keys(form.value).forEach((key) => delete form.value[key as keyof StatementForm])
    Object.assign(form.value, nextForm)
  }

  async function resetForm(): Promise<void> {
    replaceForm(createInitialForm())
    selectedCustomers.value = []
    selectedWaybills.value = []
    fieldAccess.value = {}
    await nextTick()
    formRef.value?.clearValidate()
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '客户对账单校验失败，请重试')
      return false
    }

    const payload: CreatePayload = {
      statementNo: normalizeNullableText(form.value.statementNo),
      customerId: form.value.customerId,
      periodStart: form.value.periodRange[0],
      periodEnd: form.value.periodRange[1],
      orderIds: [...form.value.orderIds],
      remark: normalizeNullableText(form.value.remark)
    }

    try {
      await createCustomerStatement(payload)
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '客户对账单保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(): Promise<void> {
    await resetForm()
    await dialogRef.value?.handleOpen(undefined, {
      title: '生成客户对账单',
      subtitle: '按客户和账期归集已完成运单，生成后可提交财务审核',
      confirmText: '生成对账单',
      contentMaxHeight: '72vh',
      loading: true,
      loadingText: '正在加载编号规则…',
      onOpen: async (_openData, api) => {
        try {
          await statementNumber.loadRule()
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
</script>
