<template>
  <ArtDialog ref="dialogRef" size="md">
    <template v-if="!form.data.id" #subtitle>
      手工项目仅适用于自定义或项目维度；业务同步维度请回到对应主数据维护。
    </template>
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model="form.data"
      :items="formItems"
      :rules="form.rules"
      :span="12"
      :gutter="20"
      label-width="104px"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import {
    normalizeNonNullableText,
    normalizeNullableNumber,
    normalizeNullableText
  } from '@/utils/form/normalize'
  import { ElMessage, type FormRules } from 'element-plus'
  import { useAuth } from '@/hooks/core/useAuth'
  import { storeToRefs } from 'pinia'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { saveAuxiliaryItem } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'FinanceAuxiliaryItemDialog' })

  type AuxiliaryItem = Api.Fms.AuxiliaryItemRecord
  type FormData = Api.Fms.SaveAuxiliaryItemPayload

  interface FormGroup {
    data: FormData
    rules: FormRules<FormData>
  }

  const emit = defineEmits<{ success: [] }>()
  const { hasAuth } = useAuth()
  const savePermission = ref('FinanceAccountingAuxiliary:Add')
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()

  const createInitialForm = (): FormData => ({
    id: undefined,
    tenantId: '',
    accountSetId: '',
    auxiliaryTypeId: '',
    itemCode: '',
    itemName: '',
    isEnabled: true,
    sort: 100,
    remark: null
  })

  const form = reactive<FormGroup>({
    data: createInitialForm(),
    rules: {
      itemCode: [
        { required: true, whitespace: true, message: '请输入项目编码', trigger: 'blur' },
        { max: 60, message: '项目编码不能超过 60 个字符', trigger: 'blur' }
      ],
      itemName: [
        { required: true, whitespace: true, message: '请输入项目名称', trigger: 'blur' },
        { max: 120, message: '项目名称不能超过 120 个字符', trigger: 'blur' }
      ]
    }
  })

  const enabledOptions = computed(() =>
    (getDictMap.value.commonEnabledStatus ?? []).map((item) => ({
      ...item,
      value: item.value === 'enabled'
    }))
  )
  const formItems = computed<FormItem[]>(() => [
    {
      label: '项目编码',
      key: 'itemCode',
      type: 'input',
      span: 12,
      props: { maxlength: 60, placeholder: '请输入唯一项目编码' }
    },
    {
      label: '项目名称',
      key: 'itemName',
      type: 'input',
      span: 12,
      props: { maxlength: 120, placeholder: '请输入项目名称' }
    },
    {
      label: '启用状态',
      key: 'isEnabled',
      type: 'segment',
      span: 12,
      props: { options: enabledOptions.value }
    },
    {
      label: '排序号',
      key: 'sort',
      type: 'number',
      span: 12,
      props: { min: 0, max: 9999, controlsPosition: 'right', class: '!w-full' }
    },
    {
      label: '备注',
      key: 'remark',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 500, showWordLimit: true }
    }
  ])

  function createPayload(): FormData {
    return {
      id: form.data.id,
      tenantId: form.data.tenantId,
      accountSetId: form.data.accountSetId,
      auxiliaryTypeId: form.data.auxiliaryTypeId,
      itemCode: normalizeNonNullableText(form.data.itemCode),
      itemName: normalizeNonNullableText(form.data.itemName),
      isEnabled: form.data.isEnabled,
      sort: normalizeNullableNumber(form.data.sort) ?? 100,
      remark: normalizeNullableText(form.data.remark)
    }
  }

  function canSave(): boolean {
    if (hasAuth(savePermission.value)) return true
    ElMessage.warning('核算项目操作权限已变化，请刷新页面后重试')
    return false
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!canSave()) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (!canSave()) return false
      await saveAuxiliaryItem(createPayload())
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '辅助核算项目保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(
    accountSet: Api.Fms.AccountSetOption,
    type: Api.Fms.AuxiliaryTypeRecord,
    row?: AuxiliaryItem
  ): Promise<void> {
    const permission = row ? 'FinanceAccountingAuxiliary:Edit' : 'FinanceAccountingAuxiliary:Add'
    if (!hasAuth(permission)) {
      ElMessage.warning('没有核算项目操作权限，请联系管理员')
      return
    }
    savePermission.value = permission
    Object.assign(form.data, createInitialForm(), {
      ...(row ?? {}),
      id: row?.id,
      tenantId: accountSet.tenantId,
      accountSetId: accountSet.value,
      auxiliaryTypeId: type.id,
      remark: row?.remark ?? null
    })
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? `编辑项目 · ${row.itemName}` : `新增项目 · ${type.typeName}`,
      confirmText: row ? '保存修改' : '创建项目',
      contentMaxHeight: '65vh',
      loading: true,
      loadingText: '正在加载核算项目选项…',
      onConfirm: handleSubmit,
      onOpen: async (_data, api) => {
        try {
          await userStore.ensureDictLoaded('commonEnabledStatus')
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '核算项目选项加载失败，请重新打开重试')
          await api.handleClose()
        } finally {
          api.setLoading(false)
        }
      },
      dialogProps: { closeOnClickModal: false }
    })
  }

  defineExpose({ handleOpen })
</script>
