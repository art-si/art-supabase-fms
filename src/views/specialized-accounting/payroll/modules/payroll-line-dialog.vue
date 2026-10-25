<template>
  <ArtDialog ref="dialogRef" size="md"
    ><template #subtitle>金额构成按员工快照保存，不依赖后续人事档案变更。</template
    ><ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      :model-value="form"
      @update:model-value="replaceReactiveModel(form, $event)"
      :items="items"
      :rules="rules"
      :span="12"
      :gutter="18"
      label-width="100px"
      :show-reset="false"
      :show-submit="false"
    >
      <template #employeeId>
        <span
          v-if="currentLine"
          :title="employeeSnapshotLabel"
          class="break-words text-sm leading-6"
          >{{ employeeSnapshotLabel }}</span
        >
        <ArtEmployeeSelect
          v-else
          v-model="form.employeeId"
          :tenant-id="runTenantId"
          :api-fn="fetchEmployees"
          :display-fields="[]"
          subtitle="选择本薪资批次所属租户的员工"
          search-placeholder="搜索姓名或工号"
        />
      </template>
      <template #earningItems><PayrollItemsEditor v-model="earningRows" /></template>
      <template #deductionItems><PayrollItemsEditor v-model="deductionRows" /></template>
      <template #employerCostItems><PayrollItemsEditor v-model="employerRows" /></template>
    </ArtForm>
  </ArtDialog>
</template>
<script setup lang="ts">
  import { normalizeNullableNumber } from '@/utils/form/normalize'
  import { round, sumBy } from 'lodash-es'
  import { replaceReactiveModel } from '@/utils/form/model'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import type {
    EmployeeIntegrationItem,
    EmployeeSelectorContractParams
  } from '@/api/integration/employees'
  import { fetchPayrollEmployeeOptions, savePayrollLine } from '@fms/api'
  import { canEditField } from '@/utils/field-permission'
  import { formatCurrencyValue } from '@/utils/ui'
  import PayrollItemsEditor from './payroll-items-editor.vue'
  import { buildPayrollItems, readPayrollItems, type PayrollItemRow } from './payroll-items'
  defineOptions({ name: 'FinancePayrollLineDialog' })
  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<{
    validate: () => Promise<boolean>
    clearValidate: (fields?: string | string[]) => void
  }>()
  const runId = ref('')
  const runTenantId = ref('')
  const earningRows = ref<PayrollItemRow[]>([])
  const deductionRows = ref<PayrollItemRow[]>([])
  const employerRows = ref<PayrollItemRow[]>([])
  const form = reactive({
    employeeId: '',
    grossAmount: 0,
    deductionAmount: 0,
    netAmount: 0,
    employerCostAmount: 0,
    remark: null as string | null
  })
  const rules: FormRules = {
    employeeId: [{ required: true, message: '请选择员工', trigger: 'change' }],
    grossAmount: [{ required: true, message: '请输入应发金额', trigger: 'change' }],
    deductionAmount: [
      {
        validator: (_rule, value, callback) => {
          if (Number(value) > form.grossAmount) {
            callback(new Error('扣款金额不能超过应发金额'))
          } else {
            callback()
          }
        },
        trigger: ['blur', 'change']
      }
    ]
  }
  watch(
    [earningRows, deductionRows, employerRows],
    () => {
      form.grossAmount = round(
        sumBy(earningRows.value, (row) => row.amount ?? 0),
        2
      )
      form.deductionAmount = round(
        sumBy(deductionRows.value, (row) => row.amount ?? 0),
        2
      )
      form.employerCostAmount = round(
        sumBy(employerRows.value, (row) => row.amount ?? 0),
        2
      )
    },
    { deep: true }
  )
  const items = computed<FormItem[]>(() => [
    { label: '员工快照', key: 'employeeSection', type: 'divider', span: 24 },
    {
      label: '员工',
      key: 'employeeId',
      type: 'input',
      span: 24
    },
    { label: '薪资构成', key: 'amountSection', type: 'divider', span: 24 },
    { label: '收入项目', key: 'earningItems', span: 24 },
    { label: '扣款项目', key: 'deductionItems', span: 24 },
    { label: '企业承担', key: 'employerCostItems', span: 24 },
    {
      label: '应发金额',
      key: 'grossAmount',
      type: 'text',
      props: { formatter: () => formatCurrencyValue(form.grossAmount) }
    },
    {
      label: '扣款金额',
      key: 'deductionAmount',
      type: 'text',
      props: { formatter: () => formatCurrencyValue(form.deductionAmount) }
    },
    {
      label: '企业成本',
      key: 'employerCostAmount',
      type: 'text',
      props: { formatter: () => formatCurrencyValue(form.employerCostAmount) }
    },
    {
      label: '实发金额',
      key: 'netAmount',
      type: 'text',
      props: {
        formatter: () => formatCurrencyValue(form.netAmount)
      },
      description: '按应发金额减去扣款金额自动计算。'
    },
    { label: '明细说明', key: 'remarkSection', type: 'divider', span: 24 },
    { label: '备注', key: 'remark', type: 'input', span: 24, props: { type: 'textarea', rows: 3 } }
  ])
  watch(
    () => form.employeeId,
    () => formRef.value?.clearValidate('employeeId')
  )
  watch(
    () => [form.grossAmount, form.deductionAmount] as const,
    ([grossAmount, deductionAmount]) => {
      form.netAmount = Math.max(grossAmount - deductionAmount, 0)
      if (deductionAmount <= grossAmount) formRef.value?.clearValidate('deductionAmount')
    },
    { immediate: true }
  )
  const currentLine = ref<Api.Fms.PayrollLineRecord>()
  const employeeSnapshotLabel = computed(() =>
    [currentLine.value?.employeeNameSnapshot, currentLine.value?.employeeNoSnapshot]
      .filter(Boolean)
      .join(' · ')
  )
  async function submit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      const earnings = buildPayrollItems(earningRows.value)
      const deductions = buildPayrollItems(deductionRows.value)
      const employer = buildPayrollItems(employerRows.value)
      if (deductions.total > earnings.total) throw new Error('扣款金额不能超过应发金额')
      const result = await savePayrollLine(runId.value, {
        employeeId: form.employeeId,
        earningItems: earnings.items,
        deductionItems: deductions.items,
        employerCostItems: employer.items,
        grossAmount: earnings.total,
        deductionAmount: deductions.total,
        employerCostAmount: employer.total,
        remark: form.remark
      })
      if (result.error) throw result.error
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '薪资明细保存失败，请检查内容后重试')
      return false
    }
  }
  async function handleOpen(
    run: Api.Fms.PayrollRunRecord,
    line?: Api.Fms.PayrollLineRecord
  ): Promise<void> {
    const access = line?.fieldAccess ?? run.fieldAccess
    if (!canEditField(access, 'employeeIdentity') || !canEditField(access, 'salaryAmounts')) {
      ElMessage.warning('你没有该薪资批次员工与金额字段的编辑权限')
      return
    }
    runId.value = run.id
    runTenantId.value = run.tenantId
    currentLine.value = line
    try {
      earningRows.value = readPayrollItems(
        line?.earningItems,
        normalizeNullableNumber(line?.grossAmount) ?? 0,
        '未分类收入'
      )
      deductionRows.value = readPayrollItems(
        line?.deductionItems,
        normalizeNullableNumber(line?.deductionAmount) ?? 0,
        '未分类扣款'
      )
      employerRows.value = readPayrollItems(
        line?.employerCostItems,
        normalizeNullableNumber(line?.employerCostAmount) ?? 0,
        '未分类企业成本'
      )
    } catch (error) {
      notifyFriendlyError(error, '薪酬项目加载失败，请刷新后重试')
      return
    }
    Object.assign(form, {
      employeeId: line?.employeeId || '',
      grossAmount: normalizeNullableNumber(line?.grossAmount) ?? 0,
      deductionAmount: normalizeNullableNumber(line?.deductionAmount) ?? 0,
      employerCostAmount: normalizeNullableNumber(line?.employerCostAmount) ?? 0,
      remark: line?.remark || null
    })
    await dialogRef.value?.handleOpen(undefined, {
      title: line ? `编辑薪资 · ${line.employeeNameSnapshot}` : '新增员工薪资',
      confirmText: '保存明细',
      onConfirm: submit,
      onOpen: () => {
        formRef.value?.clearValidate()
      },
      dialogProps: { closeOnClickModal: false }
    })
  }
  async function fetchEmployees(params: EmployeeSelectorContractParams = {}) {
    const result = await fetchPayrollEmployeeOptions(runId.value)
    const keyword = params.keyword?.trim().toLocaleLowerCase() || ''
    const records: EmployeeIntegrationItem[] = (result.data ?? [])
      .filter(
        (item) =>
          !keyword ||
          `${item.employeeName} ${item.employeeNo}`.toLocaleLowerCase().includes(keyword)
      )
      .map((item) => ({ ...item, tenantId: runTenantId.value, employmentStatus: '' }))
    const from = Math.max(params.from ?? 0, 0)
    return {
      data: records.slice(from, (params.to ?? from + 9) + 1),
      total: records.length,
      error: result.error,
      fieldAccess: {}
    }
  }
  defineExpose({ handleOpen })
</script>
