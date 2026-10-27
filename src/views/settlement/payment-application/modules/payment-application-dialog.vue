<template>
  <ArtDialog ref="dialogRef" size="md">
    <ArtForm
      ref="formRef"
      v-model="form.data"
      :items="form.items"
      :rules="form.rules"
      :span="isCompact ? 24 : 12"
      :gutter="20"
      label-width="108px"
      :show-reset="false"
      :show-submit="false"
    >
      <template #carrierId>
        <ArtTableSingleSelect
          v-model="form.data.carrierId"
          v-model:selected-data="selection.carriers"
          :api-fn="fetchCarrierSelectorData"
          :columns="carrierColumns"
          title="选择付款承运商"
          subtitle="付款申请与应付对账单必须属于同一承运商"
          row-key="id"
          label-key="companyName"
          description-key="carrierCode"
          placeholder="请选择承运商"
          search-placeholder="承运商名称、编码或联系人"
          empty-text="暂无可选承运商"
          empty-description="当前租户没有匹配的启用承运商，请先维护承运商主数据。"
          dialog-width="lg"
          :disabled="!canEditApplicationField('applicationAmounts')"
          @change="handleCarrierChange"
        >
          <template #empty><FinanceDataSourceEmptyActions source="carrier" /></template>
        </ArtTableSingleSelect>
      </template>

      <template #statementIds>
        <ArtTableMultipleSelect
          ref="statementSelectRef"
          v-model="form.data.statementIds"
          v-model:selected-data="selection.statements"
          :api-fn="fetchStatementSelectorData"
          :columns="statementSelectorColumns"
          title="选择待付款承运商对账单"
          subtitle="可申请余额已扣除其他审批中和已批准待付款申请"
          row-key="id"
          label-key="statementNo"
          description-key="periodLabel"
          placeholder="请选择一份或多份对账单"
          search-placeholder="对账单号或承运商名称"
          dialog-width="xl"
          show-pagination
          show-selected-panel
          :page-size="10"
          :disabled="!form.data.carrierId || !canEditApplicationField('applicationAmounts')"
          @change="handleStatementChange"
          empty-text="暂无待付款对账单"
          empty-description="请先生成并确认承运商对账单；无可申请余额的对账单不会显示。"
        >
          <template #empty><FinanceDataSourceEmptyActions source="carrier-statement" /></template>
        </ArtTableMultipleSelect>
      </template>

      <template #basisUrls>
        <ArtUploadImage
          v-if="getFieldAccess(fieldAccess, 'basisEvidence') !== 'masked'"
          v-model="form.data.basisUrls"
          title="付款依据"
          :size="84"
          :limit="5"
          :readonly="!canEditApplicationField('basisEvidence')"
          multiple
        />
        <ElAlert v-else type="info" :closable="false" show-icon title="付款依据内容已脱敏" />
      </template>
    </ArtForm>

    <ArtSectionCard
      v-if="allocationRows.length && canViewApplicationField('applicationAmounts')"
      class="payment-application-dialog__allocation"
      title="付款分配"
      preserve-content-structure
    >
      <template #actions>
        <ElButton
          v-if="canEditApplicationField('applicationAmounts')"
          plain
          type="primary"
          @click="autoAllocate"
        >
          <template #icon><ArtSvgIcon icon="ri:magic-line" /></template>
          按可申请余额自动分配
        </ElButton>
      </template>
      <ArtTable
        :data="allocationRows"
        :border="false"
        :columns="allocationColumns"
        :pagination="false"
        height="auto"
        :show-table-header="false"
        table-layout="fixed"
        max-height="300px"
      />
    </ArtSectionCard>

    <ElAlert
      v-if="canViewApplicationField('applicationAmounts')"
      class="payment-application-dialog__summary"
      :type="
        allocationSummary.limit <= 0
          ? 'info'
          : allocationSummary.remaining === 0
            ? 'success'
            : 'warning'
      "
      :closable="false"
      show-icon
      :title="summaryText"
    />
  </ArtDialog>
</template>

<script setup lang="tsx">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableNumber, normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import { round } from 'lodash-es'
  import type { ComputedRef } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { ElInputNumber, ElMessage, type FormRules } from 'element-plus'
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
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import type { ColumnOption } from '@/types'
  import {
    fetchCarrierOptions,
    fetchCarrierPaymentApplicationDetail,
    fetchCarrierStatementAllocatableList,
    saveCarrierPaymentApplication
  } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'
  import {
    canEditField,
    canViewField,
    getFieldAccess,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'

  defineOptions({ name: 'FinancePaymentApplicationDialog' })

  type Application = Api.Fms.CarrierPaymentApplicationRecord
  type Statement = Api.Fms.CarrierStatementAllocatable

  interface PaymentApplicationForm {
    id?: string
    applicationNo: string
    carrierId: string
    plannedPaymentDate: string
    amount: Api.Fms.SensitiveNumber | undefined
    paymentMethod: Api.Fms.CashPaymentMethod
    basisUrls: string[]
    remark: string
    statementIds: string[]
  }

  interface AllocationRow extends Statement {
    allocationAmount: number
  }

  interface FormGroup {
    data: PaymentApplicationForm
    items: ComputedRef<FormItem[]>
    rules: FormRules<PaymentApplicationForm>
  }

  interface SelectionGroup {
    carriers: DataSelectRecord[]
    statements: DataSelectRecord[]
    amounts: Record<string, number>
  }

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }

  const emit = defineEmits<{ success: [] }>()
  const isCompact = useMediaQuery('(max-width: 767px)')
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose<Application>>()
  const formRef = ref<FormExpose>()
  const statementSelectRef = ref<ArtDataSelectExpose>()
  const applicationNumber = useDocumentNumberRule('tms.carrier_payment_application')
  const fieldAccess = ref<Api.Fms.CarrierPaymentApplicationFieldAccessMap>({
    applicationAmounts: 'edit',
    basisEvidence: 'edit'
  })

  function canViewApplicationField(field: Api.Fms.CarrierPaymentApplicationFieldKey): boolean {
    return canViewField(fieldAccess.value, field)
  }

  function canEditApplicationField(field: Api.Fms.CarrierPaymentApplicationFieldKey): boolean {
    return canEditField(fieldAccess.value, field)
  }

  const createInitialForm = (): PaymentApplicationForm => ({
    id: undefined,
    applicationNo: '',
    carrierId: '',
    plannedPaymentDate: dayjs().format('YYYY-MM-DD'),
    amount: undefined,
    paymentMethod: 'bank_transfer',
    basisUrls: [],
    remark: '',
    statementIds: []
  })

  const selection = reactive<SelectionGroup>({ carriers: [], statements: [], amounts: {} })
  const formData = reactive<PaymentApplicationForm>(createInitialForm())
  const form = reactive<FormGroup>({
    data: formData,
    rules: {
      applicationNo: [
        {
          validator: (_rule, value, callback) =>
            applicationNumber.manualRequired(Boolean(formData.id)) && !String(value || '').trim()
              ? callback(new Error('请输入付款申请号'))
              : callback(),
          trigger: 'blur'
        }
      ],
      carrierId: [{ required: true, message: '请选择付款承运商', trigger: 'change' }],
      plannedPaymentDate: [{ required: true, message: '请选择计划付款日期', trigger: 'change' }],
      amount: [
        {
          validator: (_rule, value, callback) => {
            if (formData.id && !canEditApplicationField('applicationAmounts')) {
              callback()
              return
            }
            if (Number(value) > 0) callback()
            else callback(new Error('申请付款金额必须大于 0'))
          },
          trigger: 'change'
        }
      ],
      paymentMethod: [{ required: true, message: '请选择付款方式', trigger: 'change' }]
    },
    items: computed<FormItem[]>(() => [
      { label: '申请信息', key: 'base', type: 'divider', span: 24 },
      {
        label: '申请单号',
        key: 'applicationNo',
        type: 'input',
        span: isCompact.value ? 24 : 12,
        props: {
          maxlength: 50,
          ...applicationNumber.inputProps(Boolean(formData.id), '请输入付款申请号', true)
        },
        description: formData.id ? undefined : applicationNumber.description.value
      },
      { label: '付款承运商', key: 'carrierId', type: 'input', span: isCompact.value ? 24 : 12 },
      {
        label: '计划付款日期',
        key: 'plannedPaymentDate',
        type: 'date',
        span: isCompact.value ? 24 : 12,
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      ...(canViewApplicationField('applicationAmounts')
        ? [
            {
              label: '申请付款金额',
              key: 'amount',
              type:
                getFieldAccess(fieldAccess.value, 'applicationAmounts') === 'masked'
                  ? ('input' as const)
                  : ('number' as const),
              span: isCompact.value ? 24 : 12,
              props: {
                min: 0.01,
                precision: 2,
                controlsPosition: 'right',
                class: '!w-full',
                disabled: !canEditApplicationField('applicationAmounts'),
                onChange: autoAllocate
              }
            }
          ]
        : []),
      {
        label: '计划付款方式',
        key: 'paymentMethod',
        type: 'select',
        span: 24,
        props: { options: getDictMap.value.tmsCashPaymentMethod ?? [] }
      },
      {
        label: '申请说明',
        key: 'remark',
        type: 'textarea',
        span: 24,
        props: {
          rows: 3,
          maxlength: 500,
          showWordLimit: true,
          placeholder: '说明付款用途、账期或其他审批要点'
        }
      },
      ...(canViewApplicationField('basisEvidence')
        ? [
            { label: '付款依据', key: 'evidence', type: 'divider' as const, span: 24 },
            { label: '依据附件', key: 'basisUrls', type: 'input' as const, span: 24 }
          ]
        : []),
      ...(canViewApplicationField('applicationAmounts')
        ? [
            { label: '应付核销', key: 'allocation', type: 'divider' as const, span: 24 },
            { label: '承运商对账单', key: 'statementIds', type: 'input' as const, span: 24 }
          ]
        : [])
    ])
  })

  const selectedStatements = computed(() => selection.statements as Statement[])
  const allocationRows = computed<AllocationRow[]>(() =>
    selectedStatements.value.map((item) => ({
      ...item,
      allocationAmount: Number(selection.amounts[item.id] ?? 0)
    }))
  )
  const allocationSummary = computed(() => {
    const allocatedAmount = allocationRows.value.reduce(
      (sum, row) => sum + Number(row.allocationAmount || 0),
      0
    )
    const allocated = round(Number(allocatedAmount || 0), 2)
    const remainingAmount = (normalizeNullableNumber(form.data.amount) ?? 0) - allocated
    return {
      allocated,
      limit: round(normalizeNullableNumber(form.data.amount) ?? 0, 2),
      remaining: round(Number(remainingAmount || 0), 2)
    }
  })
  const summaryText = computed(() => {
    if (getFieldAccess(fieldAccess.value, 'applicationAmounts') === 'masked') {
      return '申请金额与付款分配已脱敏'
    }
    if (allocationSummary.value.limit <= 0) return '填写申请金额并选择对账单后，核对付款分配合计。'
    return `申请金额 ${money(allocationSummary.value.limit)}，已分配 ${money(allocationSummary.value.allocated)}，待分配 ${money(allocationSummary.value.remaining)}`
  })

  const carrierColumns: DataSelectColumn[] = [
    { prop: 'carrierCode', label: '承运商编码', width: 150 },
    { prop: 'companyName', label: '承运商名称', minWidth: 240 },
    { prop: 'contactName', label: '联系人', width: 120 },
    { prop: 'contactPhone', label: '联系电话', width: 150 }
  ]
  const statementSelectorColumns: DataSelectColumn[] = [
    { prop: 'statementNo', label: '对账单号', minWidth: 170 },
    { prop: 'periodLabel', label: '对账账期', minWidth: 190 },
    {
      prop: 'statementOutstandingAmount',
      label: '账面未付',
      width: 110,
      align: 'right',
      formatter: (row) => money((row as Statement).statementOutstandingAmount)
    },
    {
      prop: 'reservedAmount',
      label: '审批占用',
      width: 110,
      align: 'right',
      formatter: (row) => money((row as Statement).reservedAmount)
    },
    {
      prop: 'outstandingAmount',
      label: '可申请余额',
      width: 120,
      align: 'right',
      formatter: (row) => money((row as Statement).outstandingAmount)
    }
  ]
  const allocationColumns: ColumnOption<AllocationRow>[] = [
    { prop: 'statementNo', label: '对账单号', width: 190 },
    {
      prop: 'period',
      label: '账期',
      minWidth: 190,
      formatter: (row) => (row.periodStart ? `${row.periodStart} 至 ${row.periodEnd}` : '--')
    },
    {
      prop: 'outstandingAmount',
      label: '可申请余额',
      width: 135,
      align: 'right',
      formatter: (row) => money(row.outstandingAmount)
    },
    {
      prop: 'allocationAmount',
      label: '本次申请',
      width: 180,
      formatter: (row) =>
        getFieldAccess(fieldAccess.value, 'applicationAmounts') === 'masked' ? (
          <span>***</span>
        ) : (
          <ElInputNumber
            v-model={selection.amounts[row.id]}
            min={0}
            max={Math.min(
              normalizeNullableNumber(row.outstandingAmount) ?? 0,
              normalizeNullableNumber(form.data.amount) ?? 0
            )}
            precision={2}
            controlsPosition="right"
            class="w-full!"
            disabled={!canEditApplicationField('applicationAmounts')}
            onChange={() => {
              selection.amounts[row.id] = round(Number(selection.amounts[row.id] || 0), 2)
            }}
          />
        )
    }
  ]

  const money = (value?: Api.Fms.SensitiveNumber): string => {
    return formatSensitiveNumberWithAffix(value, { prefix: '¥' })
  }

  async function fetchCarrierSelectorData(params: DataSelectFetchParams) {
    const { data, error } = await fetchCarrierOptions({ companyName: params.keyword })
    if (error) throw error
    return { data: data ?? [], total: data?.length ?? 0 }
  }

  async function fetchStatementSelectorData(params: DataSelectFetchParams) {
    if (!form.data.carrierId) return { data: [], total: 0 }
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    const { data, total, error } = await fetchCarrierStatementAllocatableList({
      carrierId: form.data.carrierId,
      keyword: params.keyword,
      from,
      to
    })
    if (error) throw error
    return {
      data: (data ?? []).map((item) => ({
        ...item,
        periodLabel: `${item.periodStart} 至 ${item.periodEnd}`
      })),
      total: total ?? 0
    }
  }

  function clearStatements(): void {
    form.data.statementIds = []
    selection.statements = []
    selection.amounts = {}
  }

  function handleCarrierChange(): void {
    clearStatements()
    void statementSelectRef.value?.reload()
  }

  function handleStatementChange(): void {
    const ids = new Set(selection.statements.map((item) => String(item.id)))
    Object.keys(selection.amounts).forEach((id) => {
      if (!ids.has(id)) delete selection.amounts[id]
    })
    autoAllocate()
  }

  function autoAllocate(): void {
    if (!canEditApplicationField('applicationAmounts')) return
    let remaining = round(normalizeNullableNumber(form.data.amount) ?? 0, 2)
    selectedStatements.value.forEach((statement) => {
      const amount = round(
        Math.min(remaining, normalizeNullableNumber(statement.outstandingAmount) ?? 0),
        2
      )
      selection.amounts[statement.id] = Math.max(amount, 0)
      remaining = round(remaining - amount, 2)
    })
  }

  function buildAllocations(): Api.Fms.CashAllocationInput[] {
    if (!canEditApplicationField('applicationAmounts')) return []
    return allocationRows.value
      .map((row) => ({
        statementId: row.id,
        amount: round(Number(selection.amounts[row.id] || 0), 2)
      }))
      .filter((item) => item.amount > 0)
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '付款申请校验失败，请重试')
      return false
    }
    if (canEditApplicationField('applicationAmounts') && !buildAllocations().length) {
      ElMessage.warning('请至少选择一份待付款对账单')
      return false
    }
    if (canEditApplicationField('applicationAmounts') && allocationSummary.value.remaining !== 0) {
      ElMessage.warning('申请付款金额必须与对账单分配合计一致')
      return false
    }
    try {
      await saveCarrierPaymentApplication({
        id: form.data.id,
        applicationNo: normalizeNullableText(form.data.applicationNo),
        carrierId: form.data.carrierId,
        plannedPaymentDate: form.data.plannedPaymentDate,
        amount: canEditApplicationField('applicationAmounts')
          ? (normalizeNullableNumber(form.data.amount) ?? 0)
          : null,
        paymentMethod: form.data.paymentMethod,
        basisUrls: [...form.data.basisUrls],
        remark: normalizeNullableText(form.data.remark),
        allocations: buildAllocations()
      })
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '付款申请保存失败，请检查内容后重试')
      return false
    }
  }

  async function resetForm(): Promise<void> {
    Object.assign(form.data, createInitialForm())
    selection.carriers = []
    clearStatements()
    fieldAccess.value = { applicationAmounts: 'edit', basisEvidence: 'edit' }
    await nextTick()
    formRef.value?.clearValidate()
  }

  async function loadApplication(id: string): Promise<void> {
    const { data, error } = await fetchCarrierPaymentApplicationDetail(id, {
      showErrorMessage: false
    })
    if (error) throw error
    if (!data) throw new Error('付款申请不存在')
    fieldAccess.value = data.fieldAccess ?? {}
    Object.assign(form.data, {
      id: data.id,
      applicationNo: data.applicationNo,
      carrierId: data.carrierId,
      plannedPaymentDate: data.plannedPaymentDate,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      basisUrls: [...(data.basisUrls ?? [])],
      remark: data.remark ?? '',
      statementIds: (data.items ?? []).map((item) => item.statementId)
    })
    selection.carriers = [
      { id: data.carrierId, companyName: data.carrierName, carrierCode: data.applicationNo }
    ]
    selection.statements = (data.items ?? []).map((item) => ({
      id: item.statementId,
      statementNo: item.statementNoSnapshot,
      carrierId: item.carrierId,
      carrierName: data.carrierName,
      periodStart: '',
      periodEnd: '',
      periodLabel: '申请明细',
      costCount: 0,
      waybillCount: 0,
      statementAmount: item.statementAmountSnapshot,
      settledAmount: round(
        (normalizeNullableNumber(item.statementAmountSnapshot) ?? 0) -
          (normalizeNullableNumber(item.outstandingAmountSnapshot) ?? 0),
        2
      ),
      outstandingAmount: item.outstandingAmountSnapshot,
      statementOutstandingAmount: item.outstandingAmountSnapshot,
      reservedAmount: 0,
      status: 'confirmed',
      createTime: item.createTime
    }))
    selection.amounts = Object.fromEntries(
      (data.items ?? []).map((item) => [
        item.statementId,
        normalizeNullableNumber(item.appliedAmount) ?? 0
      ])
    )
  }

  async function handleOpen(row?: Application): Promise<void> {
    await resetForm()
    if (row) fieldAccess.value = row.fieldAccess ?? {}
    await dialogRef.value?.handleOpen(row, {
      title: row ? '编辑付款申请' : '新建付款申请',
      subtitle: row
        ? `${row.applicationNo} · 审批通过后登记付款并自动核销`
        : '选择承运商与对账单，审批通过后登记付款并自动核销',
      confirmText: row ? '保存修改' : '保存草稿',
      contentMaxHeight: '78vh',
      loading: true,
      loadingText: '正在准备付款申请…',
      onOpen: async (_data, api) => {
        try {
          await userStore.ensureDictLoaded('tmsCashPaymentMethod')
          await applicationNumber.loadRule()
          if (row) await loadApplication(row.id)
        } catch (error) {
          notifyFriendlyError(error, '付款申请基础资料加载失败，请重新打开后重试')
          await api.handleClose()
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

<style scoped lang="scss">
  .payment-application-dialog {
    &__allocation {
      margin-top: var(--art-space-4);
    }

    &__summary {
      margin-top: var(--art-space-4);
    }
  }
</style>
