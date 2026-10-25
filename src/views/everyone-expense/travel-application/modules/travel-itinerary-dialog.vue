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
      :show-reset="false"
      :show-submit="false"
    >
      <template #departureRegionPath>
        <ElCascader
          v-model="model.departureRegionPath"
          class="w-full"
          :options="regionOptions"
          :props="regionProps"
          filterable
          clearable
          placeholder="选择省 / 市 / 区"
          popper-class="travel-region-popper"
          aria-label="出发地"
        />
      </template>
      <template #destinationRegionPath>
        <ElCascader
          v-model="model.destinationRegionPath"
          class="w-full"
          :options="regionOptions"
          :props="regionProps"
          filterable
          clearable
          placeholder="选择省 / 市 / 区"
          popper-class="travel-region-popper"
          aria-label="目的地"
        />
      </template>
      <template #travelerEmployeeIds>
        <ArtEmployeeSelect
          v-model:model-values="model.travelerEmployeeIds"
          :tenant-id="tenantId"
          multiple
          placeholder="选择出差人"
        />
      </template>
    </ArtForm>
  </ArtDialog>
</template>

<script setup lang="ts">
  import dayjs from 'dayjs'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import TreeUtils from '@/utils/tree'
  import { fetchRegionOptions, type RegionOption } from '@/api/region-options'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import {
    fetchExpenseItemTree,
    fetchExpenseProjectOptions,
    type TravelItineraryInput
  } from '@fms/api'

  interface OpenData {
    line?: TravelItineraryInput
    tenantId: string
    applicantEmployeeId: string
    multipleTravelers: boolean
  }
  interface FormModel {
    departureRegionPath: string[]
    destinationRegionPath: string[]
    travelDates: [string, string] | []
    transportModes: string[]
    travelerEmployeeIds: string[]
    expenseItemId: string
    projectId: string | null
    requestedAmount: number | null
    remark: string
  }
  const emit = defineEmits<{ save: [line: TravelItineraryInput] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const transportOptions = useDictionaryOptions('fmsTravelTransportMode')
  const regionOptions = ref<RegionOption[]>([])
  const regionTree = new TreeUtils({ idKey: 'code', childrenKey: 'children' })
  const regionProps = { label: 'name', value: 'code', children: 'children' }
  const tenantId = ref('')
  const applicantEmployeeId = ref('')
  const multipleTravelers = ref(false)
  const initial = (): FormModel => ({
    departureRegionPath: [],
    destinationRegionPath: [],
    travelDates: [dayjs().format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')],
    transportModes: ['high_speed_rail'],
    travelerEmployeeIds: [],
    expenseItemId: '',
    projectId: null,
    requestedAmount: null,
    remark: ''
  })
  const model = ref<FormModel>(initial())
  const items = computed<FormItem[]>(() => [
    { key: 'departureRegionPath', label: '出发地', type: 'input' },
    { key: 'destinationRegionPath', label: '目的地', type: 'input' },
    {
      key: 'travelDates',
      label: '行程期间',
      type: 'date',
      props: {
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
        startPlaceholder: '开始日期',
        endPlaceholder: '结束日期'
      }
    },
    {
      key: 'transportModes',
      label: '交通工具',
      type: 'select',
      props: { multiple: true, collapseTags: true, options: transportOptions }
    },
    ...(multipleTravelers.value
      ? [{ key: 'travelerEmployeeIds', label: '出差人', type: 'input' as const }]
      : []),
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
      props: { filterable: true, clearable: true }
    },
    {
      key: 'requestedAmount',
      label: '申请金额（元）',
      type: 'number',
      props: { min: 0.01, precision: 2, class: 'w-full' }
    },
    {
      key: 'remark',
      label: '备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500, showWordLimit: true }
    }
  ])
  const rules = computed(() => ({
    departureRegionPath: [{ required: true, message: '请选择出发地', trigger: 'change' }],
    destinationRegionPath: [{ required: true, message: '请选择目的地', trigger: 'change' }],
    travelDates: [{ required: true, message: '请选择行程期间', trigger: 'change' }],
    transportModes: [{ required: true, message: '请选择交通工具', trigger: 'change' }],
    travelerEmployeeIds: multipleTravelers.value
      ? [{ required: true, message: '请选择出差人', trigger: 'change' }]
      : [],
    expenseItemId: [{ required: true, message: '请选择费用项目', trigger: 'change' }],
    requestedAmount: [
      {
        required: true,
        type: 'number' as const,
        min: 0.01,
        message: '申请金额须大于零',
        trigger: 'change'
      }
    ]
  }))

  function regionLabel(path: string[]): string {
    return path
      .map((code) => regionTree.findNode(regionOptions.value, code)?.name)
      .filter(Boolean)
      .join(' / ')
  }
  async function handleOpen(data: OpenData): Promise<void> {
    tenantId.value = data.tenantId
    applicantEmployeeId.value = data.applicantEmployeeId
    multipleTravelers.value = data.multipleTravelers
    model.value = {
      ...initial(),
      ...(data.line
        ? {
            departureRegionPath: data.line.departureRegionPath,
            destinationRegionPath: data.line.destinationRegionPath,
            travelDates: [data.line.startDate, data.line.endDate] as [string, string],
            transportModes: data.line.transportModes,
            travelerEmployeeIds: data.line.travelerEmployeeIds,
            expenseItemId: data.line.expenseItemId,
            projectId: data.line.projectId,
            requestedAmount: data.line.requestedAmount,
            remark: data.line.remark ?? ''
          }
        : { travelerEmployeeIds: [data.applicantEmployeeId] })
    }
    await dialogRef.value?.handleOpen(data, {
      title: data.line ? '编辑行程' : '添加行程',
      subtitle: '填写地点、日期、交通方式与预计费用。',
      confirmText: data.line ? '保存行程' : '添加行程',
      onOpen: async () => {
        formRef.value?.clearValidate()
        try {
          regionOptions.value = await fetchRegionOptions()
        } catch (error) {
          notifyFriendlyError(error, '地区选项加载失败，请关闭后重试')
        }
      },
      onConfirm: async () => {
        if (!(await validateArtFormForSubmit(formRef.value))) return false
        if (!model.value.travelDates[0] || !model.value.travelDates[1]) return false
        if (!model.value.requestedAmount || model.value.requestedAmount <= 0) return false
        emit('save', {
          departureRegionPath: model.value.departureRegionPath,
          departurePlace: regionLabel(model.value.departureRegionPath),
          destinationRegionPath: model.value.destinationRegionPath,
          destinationPlace: regionLabel(model.value.destinationRegionPath),
          startDate: model.value.travelDates[0],
          endDate: model.value.travelDates[1],
          transportModes: model.value.transportModes,
          travelerEmployeeIds: multipleTravelers.value
            ? model.value.travelerEmployeeIds
            : [applicantEmployeeId.value],
          expenseItemId: model.value.expenseItemId,
          projectId: model.value.projectId,
          requestedAmount: model.value.requestedAmount,
          remark: model.value.remark || null
        })
        return true
      }
    })
  }
  defineExpose({ handleOpen })
</script>

<style lang="scss">
  @media (width <= 640px) {
    .travel-region-popper {
      max-width: calc(100vw - 24px);

      .el-cascader-menu {
        flex: 1;
        min-width: 0;
      }

      .el-cascader-node {
        padding-inline: 24px 20px;
      }

      .el-cascader-node__label {
        padding-inline: 0;
      }
    }
  }
</style>
