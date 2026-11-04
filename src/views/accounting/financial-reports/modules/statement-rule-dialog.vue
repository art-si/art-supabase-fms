<template>
  <ArtDialog :loading="formulasLoading" ref="dialogRef" size="lg">
    <ArtAsyncState :error="formulasError" @retry="loadFormulas">
      <div class="statement-rule-dialog">
        <div class="statement-rule-dialog__toolbar">
          <div>
            <strong>{{ currentItem?.itemCode }} {{ currentItem?.itemName }}</strong>
            <small>{{ ruleHint }}</small>
          </div>
          <ElButton v-if="editable" type="primary" plain @click="addRule">
            <ArtSvgIcon icon="ri:add-line" />
            添加规则
          </ElButton>
        </div>

        <ElAlert
          v-if="currentItem?.statementType === 'cash_flow_statement'"
          type="info"
          :closable="false"
          show-icon
          title="现金流量表明细由凭证现金分录归集，不使用科目余额映射。"
        />

        <ArtTable
          v-if="rows.length && !isNarrow"
          ref="ruleTableRef"
          class="statement-rule-dialog__table"
          :data="rows"
          :columns="ruleColumns"
          row-key="rowKey"
          :pagination="false"
          :border="false"
          height="auto"
          table-layout="fixed"
          max-height="56vh"
        />

        <ArtForm
          v-if="rows.length && isNarrow"
          ref="mobileFormRef"
          v-model="mobileFormModel"
          :items="mobileItems"
          :span="12"
          :gutter="16"
          root-class="statement-rule-dialog__mobile-form"
        >
          <template v-for="(row, index) in rows" :key="row.rowKey" #[`rule-${row.rowKey}Actions`]>
            <ArtButtonTable
              v-if="editable"
              type="delete"
              label="删除规则"
              permission=""
              @click="removeRule(index)"
            />
          </template>
        </ArtForm>

        <ArtEmptyState
          v-if="!rows.length"
          :title="isFormula ? '尚未配置计算来源' : '尚未配置科目映射'"
          :description="
            editable ? '添加第一条规则后可在此核对配置。' : '请联系有权限的人员配置报表规则。'
          "
          :visual-size="96"
        >
          <ElButton v-if="editable" type="primary" plain @click="addRule">
            添加第一条规则
          </ElButton>
        </ArtEmptyState>
      </div>
    </ArtAsyncState>
  </ArtDialog>
</template>

<script setup lang="tsx">
  import TreeUtils from '@/utils/tree'
  import { useMediaQuery } from '@vueuse/core'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import {
    ElButton,
    ElInput,
    ElInputNumber,
    ElMessage,
    ElOption,
    ElSelect,
    ElTreeSelect,
    type FormItemRule
  } from 'element-plus'
  import { storeToRefs } from 'pinia'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmptyState from '@/components/core/feedback/art-empty-state/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import type { ColumnOption } from '@/types'
  import {
    fetchFinancialStatementFormulas,
    saveFinancialStatementFormulas,
    saveFinancialStatementMappings
  } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'
  import { statementDictionaryOptions } from '../../../modules/financial-statement-options'

  defineOptions({ name: 'FinanceStatementRuleDialog' })

  type Item = Api.Fms.FinancialStatementItemRecord
  const formulasLoading = ref(false)
  const formulasError = ref('')
  let formulaRequestId = 0

  interface RuleRow {
    rowKey: string
    sourceId: string
    mappingDirection: Api.Fms.FinancialStatementMappingDirection
    factor: number
    remark: string
  }

  const optionTree = new TreeUtils({ idKey: 'value', parentKey: 'parentId' })
  const emit = defineEmits<{ success: [] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose>()
  const currentItem = ref<Item>()
  const items = ref<Item[]>([])
  const subjects = ref<Api.Fms.SubjectRecord[]>([])
  const mobileFormModel = ref({ rows: [] as RuleRow[] })
  const rows = computed({
    get: () => mobileFormModel.value.rows,
    set: (value) => {
      mobileFormModel.value.rows = value
    }
  })
  const ruleTableRef = ref<ArtTableExpose>()
  const mobileFormRef = ref<{
    validate: () => Promise<boolean>
    clearValidate: () => void
    readyToSubmit: boolean
  }>()
  const editable = ref(false)
  const isNarrow = useMediaQuery('(max-width: 840px)')
  watch(
    () =>
      formulasLoading.value ||
      Boolean(formulasError.value) ||
      (isNarrow.value && rows.value.length > 0 && !mobileFormRef.value?.readyToSubmit),
    (confirmDisabled) => dialogRef.value?.setOptions({ confirmDisabled })
  )

  const sourceRules: FormItemRule[] = [
    { required: true, message: '请选择取数来源', trigger: 'change' }
  ]
  const directionRules: FormItemRule[] = [
    { required: true, message: '请选择取数方向', trigger: 'change' }
  ]
  const factorRules: FormItemRule[] = [
    {
      validator: (_rule, value, callback) => {
        if (Number.isFinite(Number(value)) && Number(value) !== 0) callback()
        else callback(new Error('取数系数不能为 0'))
      },
      trigger: 'change'
    }
  ]

  const isFormula = computed(() => currentItem.value?.calculationMethod === 'formula')
  const directionOptions = computed(() =>
    statementDictionaryOptions(getDictMap.value.fmsStatementMappingDirection)
  )
  const sourceOptions = computed(() =>
    optionTree.listToTree(
      isFormula.value
        ? items.value.map((item) => ({
            label: `${item.itemCode} ${item.itemName}`,
            value: item.id,
            parentId: item.parentId,
            disabled: item.calculationMethod !== 'mapping' || !item.isEnabled
          }))
        : subjects.value.map((subject) => ({
            label: `${subject.subjectCode} ${subject.subjectName}`,
            value: subject.id,
            parentId: subject.parentId,
            disabled: !subject.isEnabled
          }))
    )
  )

  const mobileItems = computed<FormItem[]>(() =>
    rows.value.flatMap((row, index): FormItem[] => [
      {
        key: `rule-${row.rowKey}`,
        label: `第 ${index + 1} 条规则`,
        type: 'divider',
        span: 24,
        props: { collapsible: false }
      },
      {
        key: `rows.${index}.sourceId`,
        label: isFormula.value ? '来源项目' : '会计科目',
        type: editable.value ? 'treeSelect' : 'text',
        options: sourceOptions.value,
        props: editable.value
          ? {
              'aria-label': `第 ${index + 1} 条${isFormula.value ? '来源项目' : '会计科目'}`,
              filterable: true,
              placeholder: isFormula.value ? '请选择来源项目' : '请选择会计科目',
              checkStrictly: true
            }
          : { formatter: () => sourceLabel(row.sourceId) },
        formItemProps: { rules: editable.value ? sourceRules : [] }
      },
      {
        key: `rows.${index}.mappingDirection`,
        label: '取数方向',
        hidden: isFormula.value,
        type: editable.value ? 'select' : 'text',
        options: directionOptions.value,
        props: editable.value
          ? { 'aria-label': `第 ${index + 1} 条取数方向` }
          : {
              formatter: () =>
                directionOptions.value.find((option) => option.value === row.mappingDirection)
                  ?.label || '未设置'
            },
        formItemProps: { rules: editable.value ? directionRules : [] }
      },
      {
        key: `rows.${index}.factor`,
        label: '系数',
        type: editable.value ? 'number' : 'text',
        props: editable.value
          ? {
              'aria-label': `第 ${index + 1} 条系数`,
              min: -1000,
              max: 1000,
              precision: 4,
              step: 1,
              controlsPosition: 'right',
              class: 'w-full!'
            }
          : {},
        formItemProps: { rules: editable.value ? factorRules : [] }
      },
      {
        key: `rows.${index}.remark`,
        label: '备注',
        hidden: isFormula.value,
        type: editable.value ? 'input' : 'text',
        props: editable.value
          ? { 'aria-label': `第 ${index + 1} 条备注`, maxlength: 200, placeholder: '可选' }
          : { emptyText: '--' }
      }
    ])
  )

  const ruleHint = computed(() =>
    isFormula.value
      ? '引用当前报表的科目取数行：正数相加、负数相减，来源项目不可重复。'
      : '资产负债表取期初/期末余额，利润表取本期/本年累计发生额。'
  )

  function createRow(): RuleRow {
    return {
      rowKey: crypto.randomUUID(),
      sourceId: '',
      mappingDirection: 'net_debit',
      factor: 1,
      remark: ''
    }
  }

  function addRule(): void {
    rows.value.push(createRow())
  }

  function removeRule(index: number): void {
    rows.value.splice(index, 1)
  }

  function sourceLabel(sourceId: string): string {
    if (isFormula.value) {
      const item = items.value.find((entry) => entry.id === sourceId)
      return item ? `${item.itemCode} ${item.itemName}` : '来源项目已移除'
    }
    const subject = subjects.value.find((entry) => entry.id === sourceId)
    return subject ? `${subject.subjectCode} ${subject.subjectName}` : '会计科目已移除'
  }

  const ruleColumns = computed<ColumnOption<RuleRow>[]>(() => [
    { type: 'globalIndex', label: '#', width: 44, align: 'center' },
    {
      prop: 'sourceId',
      headerTooltip: '选择会计科目或来源报表项目，同一取数方向不能重复。',
      label: isFormula.value ? '来源项目' : '会计科目',
      minWidth: 230,
      required: true,
      requiredMessage: ({ rowIndex }) =>
        `第 ${rowIndex + 1} 行未选择${isFormula.value ? '来源项目' : '会计科目'}`,
      formatter: (row) =>
        editable.value ? (
          <ElTreeSelect
            v-model={row.sourceId}
            aria-label={`第 ${rows.value.indexOf(row) + 1} 条${isFormula.value ? '来源项目' : '会计科目'}`}
            filterable
            class="w-full!"
            placeholder={isFormula.value ? '请选择来源项目' : '请选择会计科目'}
            data={sourceOptions.value}
            checkStrictly
          />
        ) : (
          <span class="text-g-800" title={sourceLabel(row.sourceId)}>
            {sourceLabel(row.sourceId)}
          </span>
        )
    },
    ...(!isFormula.value
      ? [
          {
            prop: 'mappingDirection',
            label: '取数方向',
            width: 144,
            required: true,
            formatter: (row: RuleRow) =>
              editable.value ? (
                <ElSelect
                  v-model={row.mappingDirection}
                  aria-label={`第 ${rows.value.indexOf(row) + 1} 条取数方向`}
                  class="w-full!"
                >
                  {directionOptions.value.map((option) => (
                    <ElOption
                      key={String(option.value)}
                      label={option.label}
                      value={option.value}
                    />
                  ))}
                </ElSelect>
              ) : (
                <span class="text-g-700">
                  {directionOptions.value.find((option) => option.value === row.mappingDirection)
                    ?.label || '未设置'}
                </span>
              )
          }
        ]
      : []),
    {
      prop: 'factor',
      label: '系数',
      width: 152,
      required: true,
      requiredMessage: ({ rowIndex }) => `第 ${rowIndex + 1} 行取数系数不能为 0`,
      rules: [
        {
          validator: ({ value }) => Number.isFinite(Number(value)) && Number(value) !== 0,
          message: ({ rowIndex }) => `第 ${rowIndex + 1} 行取数系数不能为 0`
        }
      ],
      formatter: (row) =>
        editable.value ? (
          <ElInputNumber
            v-model={row.factor}
            aria-label={`第 ${rows.value.indexOf(row) + 1} 条系数`}
            min={-1000}
            max={1000}
            precision={4}
            step={1}
            controlsPosition="right"
            class="w-full!"
          />
        ) : (
          <span class="font-medium text-g-800">{row.factor}</span>
        )
    },
    ...(!isFormula.value
      ? [
          {
            prop: 'remark',
            label: '备注',
            minWidth: 160,
            formatter: (row: RuleRow) =>
              editable.value ? (
                <ElInput
                  v-model={row.remark}
                  aria-label={`第 ${rows.value.indexOf(row) + 1} 条备注`}
                  maxlength={200}
                  placeholder="可选"
                />
              ) : (
                <span class="text-g-700" title={row.remark}>
                  {row.remark || '--'}
                </span>
              )
          }
        ]
      : []),
    ...(editable.value
      ? [
          {
            prop: 'operation',
            label: '操作',
            width: 64,
            fixed: 'right' as const,
            align: 'center' as const,
            formatter: (row: RuleRow) => (
              <ArtButtonTable
                type="delete"
                label="删除规则"
                permission=""
                onClick={() => removeRule(rows.value.indexOf(row))}
              />
            )
          }
        ]
      : [])
  ])

  async function validateRows(): Promise<boolean> {
    if (isNarrow.value) {
      if (!(await mobileFormRef.value?.validate().catch(() => false))) return false
    } else {
      const tableValidation = await ruleTableRef.value?.validate()
      if (tableValidation && !tableValidation.valid) {
        if (tableValidation.firstError) ElMessage.warning(tableValidation.firstError.message)
        return false
      }
    }
    const keys = rows.value.map((row) =>
      isFormula.value ? row.sourceId : `${row.sourceId}:${row.mappingDirection}`
    )
    if (new Set(keys).size !== keys.length) {
      ElMessage.warning(isFormula.value ? '来源项目不可重复' : '同一科目和取数方向不可重复')
      return false
    }
    return true
  }

  async function handleSubmit(): Promise<boolean> {
    if (formulasLoading.value || formulasError.value) return false
    if (!editable.value || !currentItem.value || !(await validateRows())) return false
    try {
      if (isFormula.value) {
        await saveFinancialStatementFormulas(
          currentItem.value.id,
          rows.value.map((row) => ({ sourceItemId: row.sourceId, factor: row.factor }))
        )
      } else {
        await saveFinancialStatementMappings(
          currentItem.value.id,
          rows.value.map((row) => ({
            subjectId: row.sourceId,
            mappingDirection: row.mappingDirection,
            factor: row.factor,
            remark: normalizeNullableText(row.remark)
          }))
        )
      }
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '报表取数规则保存失败，请检查内容后重试')
      return false
    }
  }

  async function handleOpen(
    item: Item,
    statementItems: Item[],
    subjectList: Api.Fms.SubjectRecord[],
    canEdit: boolean
  ): Promise<void> {
    ++formulaRequestId
    formulasError.value = ''
    formulasLoading.value = false
    currentItem.value = item
    items.value = statementItems
    subjects.value = subjectList
    rows.value = []
    ruleTableRef.value?.clearValidate()
    editable.value = canEdit

    if (item.calculationMethod !== 'formula') {
      rows.value = (item.mappings ?? []).map((mapping) => ({
        ...createRow(),
        sourceId: mapping.subjectId,
        mappingDirection: mapping.mappingDirection,
        factor: Number(mapping.factor),
        remark: mapping.remark ?? ''
      }))
    }

    await dialogRef.value?.handleOpen(undefined, {
      size: isFormula.value ? 'md' : 'lg',
      title: `${editable.value ? '配置' : '查看'}${isFormula.value ? '报表公式' : '科目取数'}`,
      confirmText: '保存取数规则',
      showFooter: editable.value,
      contentMaxHeight: '72vh',
      loading: true,
      loadingText: '正在加载报表取数规则…',
      onOpen: async (_openData, api) => {
        try {
          if (item.calculationMethod === 'formula') {
            await loadFormulas()
          } else {
            await userStore.ensureDictLoaded('fmsStatementMappingDirection')
            if (!directionOptions.value.length)
              throw new Error('取数方向字典未配置，请联系管理员维护后重试')
          }
        } catch (error) {
          notifyFriendlyError(error, '报表取数规则加载失败，请重试')
          await api.handleClose()
        } finally {
          api.setLoading(false)
        }
      },
      onConfirm: editable.value ? handleSubmit : undefined,
      dialogProps: { appendToBody: true, closeOnClickModal: !editable.value }
    })
  }

  async function loadFormulas(): Promise<void> {
    const itemId = currentItem.value?.id
    const requestId = ++formulaRequestId
    if (!itemId) return
    formulasLoading.value = true
    formulasError.value = ''
    rows.value = []
    try {
      const { data, error } = await fetchFinancialStatementFormulas(itemId)
      if (requestId !== formulaRequestId || currentItem.value?.id !== itemId) return
      if (error) {
        formulasError.value = '报表公式加载失败，请重试后再配置。'
        return
      }
      rows.value = (data ?? []).map((formula) => ({
        ...createRow(),
        sourceId: formula.sourceItemId,
        factor: Number(formula.factor)
      }))
    } catch {
      if (requestId === formulaRequestId) formulasError.value = '报表公式加载失败，请重试后再配置。'
    } finally {
      if (requestId === formulaRequestId) formulasLoading.value = false
    }
  }

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .statement-rule-dialog {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--art-space-4);

    &__toolbar {
      display: flex;
      gap: var(--art-space-4);
      align-items: center;
      justify-content: space-between;

      > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      strong {
        font-size: 15px;
        color: var(--el-text-color-primary);
      }

      small {
        line-height: 1.5;
        color: var(--el-text-color-secondary);
      }
    }

    &__table :deep(.art-table__cell-content),
    &__table :deep(.art-table__cell-value) {
      display: block;
      width: 100%;
    }
  }

  @media (width <= 840px) {
    .statement-rule-dialog {
      &__toolbar {
        flex-direction: column;
        align-items: stretch;
      }

      :deep(.statement-rule-dialog__mobile-form) {
        padding: 0;
      }
    }
  }
</style>
