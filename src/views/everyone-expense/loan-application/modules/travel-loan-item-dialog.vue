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
    </ArtForm>
  </ArtDialog>
</template>

<script setup lang="ts">
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import {
    fetchExpenseItemTree,
    fetchExpenseProjectOptions,
    fetchLoanApplicantSelector,
    type TravelLoanItemInput
  } from '@fms/api'

  interface OpenData {
    item?: TravelLoanItemInput
    tenantId: string
    applicantEmployeeId: string
    multipleTravelers: boolean
    copy?: boolean
  }
  const emit = defineEmits<{ save: [item: TravelLoanItemInput] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const tenantId = ref('')
  const multipleTravelers = ref(false)
  const model = ref<TravelLoanItemInput>({
    expenseItemId: '',
    projectId: null,
    borrowerEmployeeId: '',
    amount: 0,
    purpose: ''
  })
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
      props: { checkStrictly: true, placeholder: '选择末级费用项目' }
    },
    {
      key: 'projectId',
      label: '项目',
      type: 'select',
      api: () => fetchExpenseProjectOptions(tenantId.value),
      resultField: 'data',
      labelField: 'projectName',
      valueField: 'id',
      props: { filterable: true, clearable: true, placeholder: '选填关联项目' }
    },
    ...(multipleTravelers.value
      ? [
          {
            props: {
              modelValue: model.value.borrowerEmployeeId || undefined,
              tenantId: tenantId.value,
              apiFn: fetchLoanApplicantSelector,
              placeholder: '选择借款人',
              'onUpdate:modelValue': ($event: typeof model.value.borrowerEmployeeId) => {
                model.value.borrowerEmployeeId = $event || ''
              }
            },
            key: 'borrowerEmployeeId',
            label: '借款人',
            type: 'employeeSelect'
          }
        ]
      : []),
    {
      key: 'amount',
      label: '借款金额（元）',
      type: 'number',
      props: { min: 0.01, precision: 2, class: 'w-full' }
    },
    {
      key: 'purpose',
      label: '借款用途',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500, showWordLimit: true }
    }
  ])
  const rules = {
    expenseItemId: [{ required: true, message: '请选择费用项目', trigger: 'change' }],
    borrowerEmployeeId: [{ required: true, message: '请选择借款人', trigger: 'change' }],
    amount: [
      {
        required: true,
        type: 'number' as const,
        min: 0.01,
        message: '借款金额须大于零',
        trigger: 'change'
      }
    ],
    purpose: [{ required: true, message: '请填写借款用途', trigger: 'blur' }]
  }
  async function handleOpen(data: OpenData): Promise<void> {
    tenantId.value = data.tenantId
    multipleTravelers.value = data.multipleTravelers
    model.value = {
      expenseItemId: data.item?.expenseItemId ?? '',
      projectId: data.item?.projectId ?? null,
      borrowerEmployeeId: data.item?.borrowerEmployeeId || data.applicantEmployeeId,
      amount: data.item?.amount ?? 0,
      purpose: data.item?.purpose ?? '',
      id: data.copy ? undefined : data.item?.id
    }
    await dialogRef.value?.handleOpen(data, {
      title: data.copy ? '复制借款明细' : data.item ? '编辑借款明细' : '新增借款明细',
      subtitle: '选择费用项目与借款人，填写预计借款金额和用途。',
      confirmText: data.item && !data.copy ? '保存明细' : '添加明细',
      onOpen: () => formRef.value?.clearValidate(),
      onConfirm: async () => {
        if (!(await validateArtFormForSubmit(formRef.value))) return false
        if (model.value.amount <= 0) return false
        emit('save', {
          ...model.value,
          borrowerEmployeeId: multipleTravelers.value
            ? model.value.borrowerEmployeeId
            : data.applicantEmployeeId,
          purpose: model.value.purpose.trim()
        })
        return true
      }
    })
  }
  defineExpose({ handleOpen })
</script>
