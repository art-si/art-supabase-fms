<template>
  <ArtDialog ref="dialogRef" size="md">
    <template v-if="!form.data.id" #subtitle>
      系统维度的编码和主数据来源受保护；手工维度可用于企业自定义核算口径。
    </template>
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model="form.data"
      :items="formItems"
      :rules="form.rules"
      :span="12"
      :gutter="20"
      label-width="108px"
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
  import { saveAuxiliaryType } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'

  defineOptions({ name: 'FinanceAuxiliaryTypeDialog' })

  type AuxiliaryType = Api.Fms.AuxiliaryTypeRecord
  type FormData = Api.Fms.SaveAuxiliaryTypePayload

  interface FormGroup {
    data: FormData
    rules: FormRules<FormData>
  }

  const emit = defineEmits<{ success: [] }>()
  const { hasAuth } = useAuth()
  const savePermission = ref('FinanceAccountingAuxiliary:AddType')
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const context = reactive({ isSystem: false })

  const createInitialForm = (): FormData => ({
    id: undefined,
    tenantId: '',
    accountSetId: '',
    typeCode: '',
    typeName: '',
    sourceType: 'manual',
    isEnabled: true,
    sort: 100,
    remark: null
  })

  const form = reactive<FormGroup>({
    data: createInitialForm(),
    rules: {
      typeCode: [
        { required: true, whitespace: true, message: '请输入维度编码', trigger: 'blur' },
        {
          pattern: /^[A-Z][A-Z0-9_]{1,29}$/,
          message: '使用 2 到 30 位大写字母、数字或下划线',
          trigger: 'blur'
        }
      ],
      typeName: [
        { required: true, whitespace: true, message: '请输入维度名称', trigger: 'blur' },
        { max: 60, message: '维度名称不能超过 60 个字符', trigger: 'blur' }
      ],
      sourceType: [{ required: true, message: '请选择主数据来源', trigger: 'change' }]
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
      label: '维度名称',
      key: 'typeName',
      type: 'input',
      span: 12,
      props: { maxlength: 60, placeholder: '例如：业务区域' }
    },
    {
      label: '维度编码',
      key: 'typeCode',
      type: 'input',
      span: 12,
      props: {
        maxlength: 30,
        disabled: context.isSystem,
        placeholder: '例如：REGION',
        onInput: (value: string) => {
          form.data.typeCode = value.toUpperCase()
        }
      }
    },
    {
      label: '主数据来源',
      key: 'sourceType',
      type: 'select',
      span: 12,
      help: '客户、承运商、部门和员工维度由对应业务档案同步。',
      props: {
        options: getDictMap.value.fmsAuxiliarySourceType ?? [],
        disabled: context.isSystem,
        placeholder: '请选择来源'
      }
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
      typeCode: normalizeNonNullableText(form.data.typeCode).toUpperCase(),
      typeName: normalizeNonNullableText(form.data.typeName),
      sourceType: form.data.sourceType,
      isEnabled: form.data.isEnabled,
      sort: normalizeNullableNumber(form.data.sort) ?? 100,
      remark: normalizeNullableText(form.data.remark)
    }
  }

  function canSave(): boolean {
    if (hasAuth(savePermission.value)) return true
    ElMessage.warning('核算维度操作权限已变化，请刷新页面后重试')
    return false
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!canSave()) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (!canSave()) return false
      await saveAuxiliaryType(createPayload())
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '辅助核算类型保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(
    accountSet: Api.Fms.AccountSetOption,
    row?: AuxiliaryType
  ): Promise<void> {
    const permission = row
      ? 'FinanceAccountingAuxiliary:EditType'
      : 'FinanceAccountingAuxiliary:AddType'
    if (!hasAuth(permission)) {
      ElMessage.warning('没有核算维度操作权限，请联系管理员')
      return
    }
    savePermission.value = permission
    context.isSystem = row?.isSystem ?? false
    Object.assign(form.data, createInitialForm(), {
      ...(row ?? {}),
      id: row?.id,
      tenantId: accountSet.tenantId,
      accountSetId: accountSet.value,
      remark: row?.remark ?? null
    })
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? `编辑维度 · ${row.typeName}` : '新增辅助核算维度',
      confirmText: row ? '保存修改' : '创建维度',
      contentMaxHeight: '65vh',
      loading: true,
      loadingText: '正在加载核算维度选项…',
      onConfirm: handleSubmit,
      onOpen: async (_data, api) => {
        try {
          await Promise.all([
            userStore.ensureDictLoaded('commonEnabledStatus'),
            userStore.ensureDictLoaded('fmsAuxiliarySourceType')
          ])
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '核算维度选项加载失败，请重新打开重试')
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
