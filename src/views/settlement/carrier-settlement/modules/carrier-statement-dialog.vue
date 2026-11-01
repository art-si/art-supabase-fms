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
      <template #carrierId>
        <ArtTableSingleSelect
          v-model="form.carrierId"
          v-model:selected-data="selectedCarriers"
          :api-fn="fetchCarrierSelectorData"
          :columns="carrierColumns"
          title="选择对账承运商"
          subtitle="应付对账单按承运商归集已审核费用"
          row-key="id"
          label-key="companyName"
          description-key="carrierCode"
          placeholder="请选择承运商"
          search-placeholder="承运商名称、编码或联系人"
          empty-text="暂无可选承运商"
          empty-description="当前租户没有匹配的启用承运商，请先维护承运商主数据。"
          dialog-width="lg"
          @change="handleCriteriaChange"
        >
          <template #empty><FinanceDataSourceEmptyActions source="carrier" /></template>
        </ArtTableSingleSelect>
      </template>
      <template #costIds>
        <ArtTableMultipleSelect
          ref="costSelectRef"
          v-model="form.costIds"
          v-model:selected-data="selectedCosts"
          :api-fn="fetchCostSelectorData"
          :columns="costColumns"
          title="选择待对账费用"
          subtitle="应付以已审核费用为准；执行运费分摊仅作金额对照，同一运单的多笔费用会重复显示该参考值"
          row-key="id"
          label-key="waybillNo"
          description-key="routeLabel"
          placeholder="请选择待对账费用"
          search-placeholder="运单号、收款方或运输线路"
          dialog-width="xl"
          show-pagination
          show-selected-panel
          :page-size="10"
          :disabled="!canSelectCost"
          empty-text="暂无待对账费用"
          empty-description="请先在运单成本中完成费用录入和审核；已进入有效对账单的费用不会重复显示。"
        >
          <template #empty><FinanceDataSourceEmptyActions source="waybill-cost" /></template>
        </ArtTableMultipleSelect>
      </template>
    </ArtForm>
    <ElAlert
      class="mt-4"
      :type="selectedCosts.length ? 'success' : 'info'"
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
    createCarrierStatement,
    fetchCarrierOptions,
    fetchCarrierStatementEligibleCosts
  } from '@fms/api'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'
  import {
    isReadableFieldAccess,
    getFieldAccess,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'FinanceCarrierStatementDialog' })
  type EligibleCost = Api.Fms.CarrierStatementEligibleCost
  interface StatementForm {
    statementNo: string
    carrierId: string
    periodRange: string[]
    costIds: string[]
    remark: string
  }
  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<FormExpose>()
  const costSelectRef = ref<ArtDataSelectExpose>()
  const selectedCarriers = ref<DataSelectRecord[]>([])
  const selectedCosts = ref<DataSelectRecord[]>([])
  const fieldAccess = ref<Api.Fms.CarrierStatementFieldAccessMap>({})
  const statementNumber = useDocumentNumberRule('tms.carrier_statement')
  const userStore = useUserStore()
  const createInitialForm = (): StatementForm => ({
    statementNo: '',
    carrierId: '',
    periodRange: [dayjs().startOf('month').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')],
    costIds: [],
    remark: ''
  })
  const form = ref<StatementForm>(createInitialForm())
  const canSelectCost = computed(() =>
    Boolean(form.value.carrierId && form.value.periodRange[0] && form.value.periodRange[1])
  )
  const amountAccess = computed(() => getFieldAccess(fieldAccess.value, 'statementAmounts'))
  const allocatedFreightAccess = computed(() =>
    getFieldAccess(fieldAccess.value, 'allocatedFreight')
  )
  const selectedAmount = computed(() => {
    if (!isReadableFieldAccess(amountAccess.value)) return null
    return selectedCosts.value.reduce(
      (sum, row) => sum + Number((row as EligibleCost).costAmount ?? 0),
      0
    )
  })

  const selectedAmountSummary = computed(() => {
    if (amountAccess.value === 'hidden') return ''
    if (amountAccess.value === 'masked') return '，应付金额 ***'
    return `，应付金额 ${formatSensitiveNumberWithAffix(selectedAmount.value, { prefix: '¥' })}`
  })
  const selectionSummary = computed(() =>
    selectedCosts.value.length
      ? `已选择 ${selectedCosts.value.length} 笔费用${selectedAmountSummary.value}`
      : canSelectCost.value
        ? '请选择本次需要纳入对账的费用'
        : '请先选择承运商和账期，再选择待对账费用'
  )

  const carrierColumns: DataSelectColumn[] = [
    { prop: 'carrierCode', label: '承运商编码', width: 150 },
    { prop: 'companyName', label: '承运商名称', minWidth: 240 },
    { prop: 'contactName', label: '联系人', width: 120 },
    { prop: 'contactPhone', label: '联系电话', width: 150 }
  ]
  const costColumns = computed<DataSelectColumn[]>(() => [
    { prop: 'waybillNo', label: '运单号', width: 175 },
    {
      prop: 'costType',
      label: '费用类型',
      width: 130,
      dict: { code: 'tmsWaybillCostType', display: 'text' }
    },
    { prop: 'routeLabel', label: '运输线路', minWidth: 210 },
    { prop: 'occurredOn', label: '发生日期', width: 115 },
    { prop: 'payeeName', label: '收款方', width: 160 },
    ...(amountAccess.value !== 'hidden'
      ? [
          {
            prop: 'costAmount',
            label: '费用金额',
            width: 130,
            align: 'right' as const,
            formatter: (row: DataSelectRecord) =>
              formatSensitiveNumberWithAffix((row as EligibleCost).costAmount, { prefix: '¥' })
          }
        ]
      : []),
    ...(allocatedFreightAccess.value !== 'hidden'
      ? [
          {
            prop: 'allocatedFreightAmount',
            label: '执行运费分摊（参考）',
            width: 175,
            align: 'right' as const,
            formatter: (row: DataSelectRecord) =>
              formatSensitiveNumberWithAffix((row as EligibleCost).allocatedFreightAmount, {
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
            ? callback(new Error('请输入承运商对账单号'))
            : callback(),
        trigger: 'blur'
      }
    ],
    carrierId: [{ required: true, message: '请选择对账承运商', trigger: 'change' }],
    periodRange: [{ required: true, message: '请选择对账账期', trigger: 'change' }],
    costIds: [
      {
        validator: (_r, v, cb) =>
          Array.isArray(v) && v.length ? cb() : cb(new Error('请至少选择一条待对账费用')),
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
      props: { maxlength: 50, ...statementNumber.inputProps(false, '请输入承运商对账单号') },
      description: statementNumber.description.value
    },
    { label: '对账承运商', key: 'carrierId', type: 'input', span: 12 },
    {
      label: '对账账期',
      key: 'periodRange',
      type: 'date',
      span: 24,
      props: {
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
        rangeSeparator: '至',
        startPlaceholder: '开始日期',
        endPlaceholder: '结束日期',
        class: '!w-full',
        onChange: handleCriteriaChange
      }
    },
    { label: '待对账费用', key: 'costIds', type: 'input', span: 24 },
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
        placeholder: '可填写账期说明、承运商约定或内部备注'
      }
    }
  ])

  async function fetchCarrierSelectorData(params: DataSelectFetchParams) {
    const { data } = await fetchCarrierOptions({ companyName: params.keyword })
    return { data: data ?? [], total: data?.length ?? 0 }
  }
  async function fetchCostSelectorData(params: DataSelectFetchParams) {
    if (!canSelectCost.value) return { data: [], total: 0 }
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    const {
      data,
      fieldAccess: access,
      total
    } = await fetchCarrierStatementEligibleCosts({
      carrierId: form.value.carrierId,
      periodStart: form.value.periodRange[0],
      periodEnd: form.value.periodRange[1],
      keyword: params.keyword,
      from,
      to
    })
    fieldAccess.value = access
    return {
      data: (data ?? []).map((item) => ({
        ...item,
        routeLabel: [item.originCity, item.destinationCity].filter(Boolean).join(' → ')
      })),
      total: total ?? 0
    }
  }
  function handleCriteriaChange() {
    form.value.costIds = []
    selectedCosts.value = []
    fieldAccess.value = {}
    void costSelectRef.value?.reload()
  }
  async function resetForm() {
    Object.assign(form.value, createInitialForm())
    selectedCarriers.value = []
    selectedCosts.value = []
    fieldAccess.value = {}
    await nextTick()
    formRef.value?.clearValidate()
  }
  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '承运商对账单校验失败，请重试')
      return false
    }
    try {
      await createCarrierStatement({
        statementNo: normalizeNullableText(form.value.statementNo),
        carrierId: form.value.carrierId,
        periodStart: form.value.periodRange[0],
        periodEnd: form.value.periodRange[1],
        costIds: [...form.value.costIds],
        remark: normalizeNullableText(form.value.remark)
      })
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '承运商对账单保存失败，请检查内容后重试')
      return false
    }
  }
  async function handleOpen() {
    await resetForm()
    await dialogRef.value?.handleOpen(undefined, {
      title: '生成承运商对账单',
      subtitle: '按承运商和账期归集已审核费用，生成后可提交财务审核',
      confirmText: '生成对账单',
      contentMaxHeight: '72vh',
      loading: true,
      loadingText: '正在加载编号规则…',
      onOpen: async (_openData, api) => {
        try {
          await Promise.all([
            statementNumber.loadRule(),
            userStore.ensureDictLoaded('tmsWaybillCostType')
          ])
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
