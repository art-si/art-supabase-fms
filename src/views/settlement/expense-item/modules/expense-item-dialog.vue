<template>
  <ArtDialog ref="dialogRef" size="md">
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model="form"
      :items="items"
      :rules="rules"
      :validate-on-rule-change="false"
      :span="12"
      :gutter="20"
      label-width="108px"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import {
    normalizeNonNullableText,
    normalizeNullableNumber,
    normalizeNullableText
  } from '@/utils/form/normalize'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { ElMessage, type FormRules } from 'element-plus'
  import { useAuth } from '@/hooks/core/useAuth'
  import { storeToRefs } from 'pinia'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { addExpenseItem, editExpenseItem, fetchExpenseItemTree } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'
  import TreeUtils from '@/utils/tree'

  const fmsExpenseItemAccountingModeOptions = useDictionaryOptions(
    'fmsExpenseItemAccountingMode',
    (value) => value === 'true'
  )
  const enabledOptions = useDictionaryOptions('commonEnabledStatus', (value) => value === 'enabled')

  defineOptions({ name: 'FinanceExpenseItemDialog' })

  type ExpenseItem = Api.Fms.ExpenseItem
  type ExpenseItemForm = Omit<ExpenseItem, 'children'>

  const emit = defineEmits<{ success: [type: 'add' | 'edit'] }>()
  const userStore = useUserStore()
  const { hasAuth } = useAuth()
  const savePermission = ref('FinanceExpenseItem:Add')
  const parentTreeUtils = new TreeUtils({ parentKey: 'parentId' })
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose<{ row?: ExpenseItem; parent?: ExpenseItem }>>()
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()

  const createInitialForm = (): ExpenseItemForm => ({
    id: undefined,
    parentId: null,
    itemCode: '',
    itemName: '',
    businessCategory: null,
    isSelectable: false,
    reimbursementAllowed: false,
    isEnabled: true,
    sort: 100,
    remark: ''
  })

  const form = ref<ExpenseItemForm>(createInitialForm())
  const parentOptions = ref<ExpenseItem[]>([])

  const rules = computed<FormRules<ExpenseItemForm>>(() => ({
    itemName: [
      { required: true, whitespace: true, message: '请输入费用项目名称', trigger: 'blur' },
      { min: 2, max: 80, message: '长度应为 2 到 80 个字符', trigger: 'blur' }
    ],
    itemCode: [
      { required: true, whitespace: true, message: '请输入项目编码', trigger: 'blur' },
      {
        pattern: /^[A-Za-z0-9_-]{2,50}$/,
        message: '编码仅支持字母、数字、下划线和中横线，长度 2 到 50',
        trigger: 'blur'
      }
    ],
    businessCategory: form.value.isSelectable
      ? [{ required: true, message: '请选择业务分类', trigger: 'change' }]
      : [],
    sort: [{ type: 'number', min: 0, max: 9999, message: '排序范围为 0 到 9999' }],
    remark: [{ max: 500, message: '备注不能超过 500 个字符', trigger: 'blur' }]
  }))

  const booleanOptions = computed(() =>
    (getDictMap.value.commonBoolean ?? []).map((item) => ({
      ...item,
      value: item.value === 'true'
    }))
  )

  const items = computed<FormItem[]>(() => [
    { label: '层级与编码', key: 'structureSection', type: 'divider', span: 24 },
    {
      label: '上级项目',
      key: 'parentId',
      type: 'treeSelect',
      span: 24,
      options: parentOptions.value,
      labelField: 'itemName',
      valueField: 'id',
      childrenField: 'children',
      props: {
        clearable: true,
        checkStrictly: true,
        defaultExpandAll: true,
        renderAfterExpand: false,
        placeholder: '不选则为一级项目'
      }
    },
    { label: '项目名称', key: 'itemName', type: 'input', span: 24, props: { maxlength: 80 } },
    { label: '项目编码', key: 'itemCode', type: 'input', props: { maxlength: 50 } },
    {
      label: '排序',
      key: 'sort',
      type: 'number',
      props: { min: 0, max: 9999, controlsPosition: 'right', class: '!w-full' }
    },
    { label: '业务设置', key: 'businessSection', type: 'divider', span: 24 },
    {
      label: '节点用途',
      key: 'isSelectable',
      type: 'segment',
      span: 24,
      props: {
        options: fmsExpenseItemAccountingModeOptions
      }
    },
    {
      label: '业务分类',
      key: 'businessCategory',
      type: 'select',
      span: 24,
      hidden: !form.value.isSelectable,
      props: {
        options: getDictMap.value.tmsWaybillCostType ?? [],
        placeholder: '请选择费用所属业务分类'
      }
    },
    {
      label: '允许报销',
      key: 'reimbursementAllowed',
      type: 'segment',
      hidden: !form.value.isSelectable,
      props: { options: booleanOptions.value }
    },
    {
      label: '启用状态',
      key: 'isEnabled',
      type: 'segment',
      props: { options: enabledOptions }
    },
    {
      label: '备注',
      key: 'remark',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 500, showWordLimit: true }
    }
  ])

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!checkSavePermission()) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (!checkSavePermission()) return false
      const payload: Api.Fms.ExpenseItemWritePayload = {
        parentId: form.value.parentId || null,
        itemCode: normalizeNonNullableText(form.value.itemCode),
        itemName: normalizeNonNullableText(form.value.itemName),
        businessCategory: form.value.isSelectable ? form.value.businessCategory || null : null,
        isSelectable: form.value.isSelectable,
        reimbursementAllowed: form.value.isSelectable && form.value.reimbursementAllowed,
        isEnabled: form.value.isEnabled,
        sort: normalizeNullableNumber(form.value.sort) ?? 0,
        remark: normalizeNullableText(form.value.remark)
      }
      const type = form.value.id ? 'edit' : 'add'
      await (form.value.id
        ? editExpenseItem({ ...payload, id: form.value.id })
        : addExpenseItem(payload))
      emit('success', type)
      return true
    } catch (error) {
      notifyFriendlyError(error, '费用项目保存失败，请检查内容后重试')
      return false
    }
  }

  function checkSavePermission(): boolean {
    if (hasAuth(savePermission.value)) return true
    ElMessage.warning('费用项目操作权限已变化，请刷新页面后重试')
    return false
  }

  async function handleOpen(row?: ExpenseItem, parent?: ExpenseItem): Promise<void> {
    const permission = row
      ? 'FinanceExpenseItem:Edit'
      : parent
        ? 'FinanceExpenseItem:AddChild'
        : 'FinanceExpenseItem:Add'
    if (!hasAuth(permission)) {
      ElMessage.warning('没有费用项目操作权限，请联系管理员')
      return
    }
    savePermission.value = permission
    parentOptions.value = []
    Object.assign(form.value, createInitialForm(), row ? structuredClone(toRaw(row)) : {})
    delete (form.value as ExpenseItem).children
    if (!row && parent?.id) form.value.parentId = parent.id
    await dialogRef.value?.handleOpen(
      { row, parent },
      {
        title: row ? '编辑费用项目' : parent ? '新增下级费用项目' : '新增一级费用项目',
        subtitle: row
          ? `${row.itemName} · ${row.itemCode}`
          : parent
            ? `上级项目：${parent.itemName} · ${parent.itemCode}`
            : '分组用于组织层级；可记账项目会出现在运单费用的必选字段中。',
        confirmText: row ? '保存修改' : '确认新增',
        loading: true,
        loadingText: '正在加载费用项目选项…',
        onConfirm: handleSubmit,
        onOpen: async (_data, api) => {
          try {
            await Promise.all([
              userStore.ensureDictLoaded('commonBoolean'),
              userStore.ensureDictLoaded('commonEnabledStatus'),
              userStore.ensureDictLoaded('fmsExpenseItemAccountingMode'),
              userStore.ensureDictLoaded('tmsWaybillCostType')
            ])
            const result = await fetchExpenseItemTree()
            if (result.error) throw result.error
            parentOptions.value = parentTreeUtils.removeNodesByCondition(
              result.data,
              (node) => node.id === form.value.id
            ).tree
            formRef.value?.clearValidate()
          } catch (error) {
            notifyFriendlyError(error, '费用项目选项加载失败，请重新打开重试')
            await api.handleClose()
          } finally {
            api.setLoading(false)
          }
        },
        dialogProps: { appendToBody: true, closeOnClickModal: false }
      }
    )
  }

  defineExpose({ handleOpen })
</script>
