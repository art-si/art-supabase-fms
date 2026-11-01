<template>
  <ArtDialog ref="dialogRef" size="lg">
    <ArtForm
      ref="formRef"
      v-model="model"
      :items="items"
      :rules="rules"
      :span="12"
      :gutter="20"
      label-position="top"
    >
      <template #reimburseeEmployeeId>
        <ArtEmployeeSelect
          :model-value="model.reimburseeEmployeeId || undefined"
          :tenant-id="tenantId"
          :api-fn="fetchReimbursementApplicantSelector"
          placeholder="选择报销人"
          @update:model-value="model.reimburseeEmployeeId = $event || null"
        />
      </template>
    </ArtForm>
    <p class="px-4 text-sm text-[var(--art-gray-700)]">
      不含税金额：<strong class="tabular-nums text-[var(--art-gray-900)]">{{
        formatCurrencyValue(netAmount)
      }}</strong>
    </p>
  </ArtDialog>
</template>

<script setup lang="ts">
  import dayjs from 'dayjs'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import { formatCurrencyValue } from '@/utils/ui'
  import {
    fetchExpenseItemTree,
    fetchExpenseProjectOptions,
    fetchReimbursementApplicantSelector,
    type TravelReimbursementLineInput
  } from '@fms/api'

  interface OpenData {
    line?: TravelReimbursementLineInput
    tenantId: string
    applicantEmployeeId: string
    multipleReimbursees: boolean
    copy?: boolean
  }

  const emit = defineEmits<{ save: [line: TravelReimbursementLineInput] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const tenantId = ref('')
  const applicantEmployeeId = ref('')
  const multipleReimbursees = ref(false)
  const initial = (): TravelReimbursementLineInput => ({
    expenseItemId: '',
    projectId: null,
    occurredOn: dayjs().format('YYYY-MM-DD'),
    grossAmount: 0,
    taxRate: 0,
    taxAmount: 0,
    invoiceNo: null,
    reimburseeEmployeeId: null,
    remark: null
  })
  const model = ref<TravelReimbursementLineInput>(initial())
  const netAmount = computed(() => Math.max(model.value.grossAmount - model.value.taxAmount, 0))

  function recalculateTax(): void {
    const gross = Number(model.value.grossAmount) || 0
    const rate = Number(model.value.taxRate) || 0
    model.value.taxAmount = Math.round((gross * rate * 100) / (100 + rate)) / 100
  }

  const items = computed<FormItem[]>(() => [
    {
      key: 'expenseItemId',
      label: '费用项目',
      type: 'treeSelect',
      api: () =>
        fetchExpenseItemTree({ tenantId: tenantId.value, isEnabled: true, disableGroups: true }),
      resultField: 'data',
      labelField: 'itemName',
      valueField: 'id',
      childrenField: 'children',
      props: { checkStrictly: true, placeholder: '选择可报销费用项目' }
    },
    {
      key: 'projectId',
      label: '项目',
      type: 'select',
      api: () => fetchExpenseProjectOptions(tenantId.value),
      resultField: 'data',
      labelField: 'projectName',
      valueField: 'id',
      props: { clearable: true, filterable: true, placeholder: '选填关联项目' }
    },
    {
      key: 'occurredOn',
      label: '费用发生日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD' }
    },
    {
      key: 'grossAmount',
      label: '报销金额（元）',
      type: 'number',
      props: { min: 0.01, precision: 2, class: 'w-full', onChange: recalculateTax }
    },
    {
      key: 'taxRate',
      label: '税率（%）',
      type: 'number',
      props: { min: 0, max: 100, precision: 2, class: 'w-full', onChange: recalculateTax }
    },
    {
      key: 'taxAmount',
      label: '税额（元）',
      type: 'number',
      props: { min: 0, precision: 2, class: 'w-full' }
    },
    {
      key: 'invoiceNo',
      label: '发票号码',
      type: 'input',
      props: { maxlength: 100, clearable: true }
    },
    ...(multipleReimbursees.value
      ? [{ key: 'reimburseeEmployeeId', label: '报销人', type: 'input' as const }]
      : []),
    {
      key: 'remark',
      label: '备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500, showWordLimit: true }
    }
  ])
  const rules = computed(() => ({
    expenseItemId: [{ required: true, message: '请选择费用项目', trigger: 'change' }],
    occurredOn: [{ required: true, message: '请选择费用发生日期', trigger: 'change' }],
    grossAmount: [
      {
        required: true,
        type: 'number' as const,
        min: 0.01,
        message: '报销金额须大于零',
        trigger: 'change'
      }
    ],
    taxAmount: [
      {
        required: true,
        type: 'number' as const,
        min: 0,
        max: model.value.grossAmount,
        message: '税额须在零至报销金额之间',
        trigger: 'change'
      }
    ],
    reimburseeEmployeeId: multipleReimbursees.value
      ? [{ required: true, message: '请选择报销人', trigger: 'change' }]
      : []
  }))

  async function handleOpen(data: OpenData): Promise<void> {
    tenantId.value = data.tenantId
    applicantEmployeeId.value = data.applicantEmployeeId
    multipleReimbursees.value = data.multipleReimbursees
    model.value = {
      ...initial(),
      ...data.line,
      id: data.copy ? undefined : data.line?.id,
      reimburseeEmployeeId: data.line?.reimburseeEmployeeId || data.applicantEmployeeId
    }
    await dialogRef.value?.handleOpen(data, {
      title: data.copy ? '复制费用明细' : data.line ? '编辑费用明细' : '新增费用明细',
      subtitle: '填写费用发生日期、金额与发票信息；税额可按发票调整。',
      confirmText: data.line && !data.copy ? '保存费用明细' : '添加费用明细',
      onOpen: () => formRef.value?.clearValidate(),
      onConfirm: async () => {
        if (!(await validateArtFormForSubmit(formRef.value))) return false
        if (model.value.grossAmount <= 0 || model.value.taxAmount > model.value.grossAmount)
          return false
        emit('save', {
          ...model.value,
          reimburseeEmployeeId: multipleReimbursees.value
            ? model.value.reimburseeEmployeeId
            : applicantEmployeeId.value,
          invoiceNo: normalizeNullableText(model.value.invoiceNo),
          remark: normalizeNullableText(model.value.remark)
        })
        return true
      }
    })
  }

  defineExpose({ handleOpen })
</script>
