<template>
  <ArtDialog ref="dialogRef" size="md">
    <template v-if="!form.id" #subtitle
      >类别定义折旧方法、默认使用寿命和残值率，新增资产时自动带入。</template
    >
    <ArtForm
      ref="formRef"
      v-model="form"
      :items="items"
      :rules="rules"
      :span="isNarrow ? 24 : 12"
      :gutter="18"
      label-width="106px"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useMediaQuery } from '@vueuse/core'
  import { useUserStore } from '@/store/modules/user'
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { fetchAccountSetOptions, saveAssetCategory } from '@fms/api'

  const fmsDepreciationMethodOptions = useDictionaryOptions('fmsDepreciationMethod')
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const enabledOptions = computed(() =>
    (getDictMap.value.commonEnabledStatus ?? []).map((item) => ({
      ...item,
      value: item.value === 'enabled'
    }))
  )
  const isNarrow = useMediaQuery('(max-width: 520px)')

  defineOptions({ name: 'FinanceAssetCategoryDialog' })
  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(dialogRef)
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const initial = (): Api.Fms.SaveAssetCategoryPayload => ({
    accountSetId: '',
    categoryCode: '',
    categoryName: '',
    depreciationMethod: 'straight_line',
    defaultUsefulLifeMonths: 60,
    defaultResidualRate: 0.05,
    isEnabled: true,
    sort: 100,
    assetSubjectId: null,
    accumulatedDepreciationSubjectId: null,
    depreciationExpenseSubjectId: null,
    disposalSubjectId: null,
    remark: null
  })
  const form = ref(initial())
  const rules: FormRules = {
    accountSetId: [{ required: true, message: '请选择账套', trigger: 'change' }],
    categoryCode: [
      { required: true, whitespace: true, message: '请输入类别编码', trigger: 'blur' }
    ],
    categoryName: [
      { required: true, whitespace: true, message: '请输入类别名称', trigger: 'blur' }
    ],
    defaultUsefulLifeMonths: [{ required: true, message: '请输入使用寿命', trigger: 'change' }]
  }
  const items = computed<FormItem[]>(() => [
    { label: '类别档案', key: 'identitySection', type: 'divider', span: 24 },
    {
      label: '所属账套',
      key: 'accountSetId',
      type: 'select',
      span: 24,
      props: {
        options: accountSetOptions.value,
        filterable: true,
        disabled: Boolean(form.value.id)
      }
    },
    {
      label: '类别编码',
      key: 'categoryCode',
      type: 'input',
      props: { maxlength: 40, placeholder: '例如：EQ' }
    },
    {
      label: '类别名称',
      key: 'categoryName',
      type: 'input',
      props: { maxlength: 80, placeholder: '例如：机器设备' }
    },
    { label: '折旧规则', key: 'depreciationSection', type: 'divider', span: 24 },
    {
      label: '折旧方法',
      key: 'depreciationMethod',
      type: 'select',
      props: { options: fmsDepreciationMethodOptions, disabled: true }
    },
    {
      label: '使用寿命',
      key: 'defaultUsefulLifeMonths',
      type: 'number',
      description: '单位：月，例如 60 个月为 5 年。',
      props: { min: 1, max: 1200, controlsPosition: 'right', class: '!w-full' }
    },
    {
      label: '残值率',
      key: 'defaultResidualRate',
      type: 'number',
      description: '以小数录入，例如 0.05 表示 5%。',
      props: {
        min: 0,
        max: 0.9999,
        step: 0.01,
        precision: 4,
        controlsPosition: 'right',
        class: '!w-full'
      }
    },
    { label: '管理设置', key: 'managementSection', type: 'divider', span: 24 },
    {
      label: '排序',
      key: 'sort',
      type: 'number',
      props: { min: 0, max: 9999, controlsPosition: 'right', class: '!w-full' }
    },
    {
      label: '启用状态',
      key: 'isEnabled',
      type: 'segment',
      props: { options: enabledOptions.value }
    },
    {
      label: '备注',
      key: 'remark',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 300 }
    }
  ])
  async function submit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      const result = await saveAssetCategory({
        ...form.value,
        categoryCode: form.value.categoryCode.trim().toUpperCase(),
        categoryName: form.value.categoryName.trim()
      })
      if (result.error) throw result.error
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '资产类别保存失败，请检查内容后重试')
      return false
    }
  }
  async function handleOpen(
    accountSetId?: string,
    row?: Api.Fms.AssetCategoryRecord
  ): Promise<void> {
    accountSetOptions.value = []
    delete form.value.id
    Object.assign(form.value, initial())
    if (row) {
      Object.assign(form.value, {
        id: row.id,
        accountSetId: row.accountSetId,
        categoryCode: row.categoryCode,
        categoryName: row.categoryName,
        depreciationMethod: row.depreciationMethod,
        defaultUsefulLifeMonths: row.defaultUsefulLifeMonths,
        defaultResidualRate: row.defaultResidualRate,
        assetSubjectId: row.assetSubjectId,
        accumulatedDepreciationSubjectId: row.accumulatedDepreciationSubjectId,
        depreciationExpenseSubjectId: row.depreciationExpenseSubjectId,
        disposalSubjectId: row.disposalSubjectId,
        isEnabled: row.isEnabled,
        sort: row.sort,
        remark: row.remark
      })
    }
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? '编辑资产类别' : '新建资产类别',
      confirmText: row ? '保存修改' : '创建类别',
      loading: true,
      loadingText: '正在加载账套…',
      onConfirm: submit,
      onOpen: async () => {
        formRef.value?.clearValidate()
        try {
          await Promise.all([
            userStore.ensureDictLoaded('commonEnabledStatus'),
            userStore.ensureDictLoaded('fmsDepreciationMethod')
          ])
          const { data, error } = await fetchAccountSetOptions({
            status: 'active',
            from: 0,
            to: 999
          })
          if (error) throw error
          accountSetOptions.value = data ?? []
          if (
            accountSetId &&
            !accountSetOptions.value.some((item) => item.value === accountSetId)
          ) {
            throw new Error('所选账套已不可用，请刷新列表后重试')
          }
          form.value.accountSetId = accountSetId ?? accountSetOptions.value[0]?.value ?? ''
        } catch (error) {
          notifyFriendlyError(error, '账套加载失败，请重新打开重试')
          await dialogRef.value?.handleClose()
        } finally {
          prerequisiteOverlay.finishLoading()
        }
      },
      dialogProps: { closeOnClickModal: false }
    })
  }
  defineExpose({ handleOpen, ...prerequisiteOverlay })
</script>
