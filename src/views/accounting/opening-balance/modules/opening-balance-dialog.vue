<template>
  <ArtDialog ref="dialogRef" size="md">
    <template #subtitle>
      选择末级启用科目，按科目余额方向录入期初金额，并补充本年累计发生额。
    </template>
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model="form.data"
      :items="formItems"
      :rules="formRules"
      :validate-on-rule-change="false"
      :span="12"
      :gutter="20"
      label-width="118px"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import TreeUtils from '@/utils/tree'
  import { normalizeNullableNumber } from '@/utils/form/normalize'
  import { useAuth } from '@/hooks/core/useAuth'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { ElMessage, type FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { isReadableFieldAccess, canEditField, getFieldAccess } from '@/utils/field-permission'
  import { saveOpeningBalance } from '@fms/api'

  defineOptions({ name: 'FinanceOpeningBalanceDialog' })

  interface OpeningBalanceForm {
    id?: string
    accountSetId: string
    fiscalYear: number
    subjectId: string
    currencyId?: string | null
    auxiliaryValues: Record<string, string>
    openingAmount: number
    yearToDateDebit: number
    yearToDateCredit: number
    openingQuantity: number
    originalCurrencyAmount: number
  }

  interface DialogContext {
    subjects: Api.Fms.SubjectRecord[]
    currencies: Api.Fms.CurrencyRecord[]
    auxiliaryTypes: Api.Fms.AuxiliaryTypeRecord[]
    auxiliaryItems: Api.Fms.AuxiliaryItemRecord[]
  }

  const optionTree = new TreeUtils({ idKey: 'value', parentKey: 'parentId' })
  const emit = defineEmits<{ success: [] }>()
  const { hasAuth } = useAuth()
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const fieldAccess = ref<Api.Fms.OpeningBalanceFieldAccessMap>({})
  const context = reactive<DialogContext>({
    subjects: [],
    currencies: [],
    auxiliaryTypes: [],
    auxiliaryItems: []
  })

  const createInitialForm = (): OpeningBalanceForm => ({
    id: undefined,
    accountSetId: '',
    fiscalYear: new Date().getFullYear(),
    subjectId: '',
    currencyId: null,
    auxiliaryValues: {},
    openingAmount: 0,
    yearToDateDebit: 0,
    yearToDateCredit: 0,
    openingQuantity: 0,
    originalCurrencyAmount: 0
  })
  const form = reactive<{ data: OpeningBalanceForm; rules: FormRules<OpeningBalanceForm> }>({
    data: createInitialForm(),
    rules: {
      subjectId: [{ required: true, message: '请选择末级科目', trigger: 'change' }],
      openingAmount: [
        { required: true, message: '请输入期初余额', trigger: 'blur' },
        { type: 'number', min: 0, message: '期初余额不能小于 0', trigger: 'blur' }
      ],
      yearToDateDebit: [{ type: 'number', min: 0, message: '借方累计不能小于 0' }],
      yearToDateCredit: [{ type: 'number', min: 0, message: '贷方累计不能小于 0' }],
      openingQuantity: [{ type: 'number', min: 0, message: '期初数量不能小于 0' }],
      originalCurrencyAmount: [{ type: 'number', min: 0, message: '原币金额不能小于 0' }]
    }
  })

  const selectedSubject = computed(() =>
    context.subjects.find((item) => item.id === form.data.subjectId)
  )
  const subjectOptions = computed(() =>
    optionTree.listToTree(
      context.subjects.map((item) => ({
        label: `${item.subjectCode} ${item.subjectName}`,
        value: item.id,
        parentId: item.parentId,
        disabled:
          !item.isEnabled || context.subjects.some((candidate) => candidate.parentId === item.id)
      }))
    )
  )
  const currencyOptions = computed(() =>
    context.currencies
      .filter((item) => item.isEnabled && !item.isBase)
      .map((item) => ({ label: `${item.currencyName}（${item.currencyCode}）`, value: item.id }))
  )
  const subjectAuxiliaryConfigs = computed(() => selectedSubject.value?.auxiliaryConfigs ?? [])
  const amountAccess = computed(() => getFieldAccess(fieldAccess.value, 'balanceAmounts'))
  const auxiliaryAccess = computed(() => getFieldAccess(fieldAccess.value, 'auxiliaryDetails'))
  const canReadAmounts = computed(() => isReadableFieldAccess(amountAccess.value))
  const canReadAuxiliary = computed(() => isReadableFieldAccess(auxiliaryAccess.value))
  const canEditAmounts = computed(() => canEditField(fieldAccess.value, 'balanceAmounts'))
  const canEditAuxiliary = computed(() => canEditField(fieldAccess.value, 'auxiliaryDetails'))

  const formRules = computed<FormRules>(() => {
    const rules: FormRules = { ...form.rules }
    if (!canEditAuxiliary.value) return rules
    if (selectedSubject.value?.allowForeignCurrency) {
      rules.currencyId = [{ required: true, message: '请选择核算外币', trigger: 'change' }]
    }
    for (const config of subjectAuxiliaryConfigs.value) {
      if (!config.isRequired) continue
      rules[`auxiliaryValues.${config.auxiliaryTypeId}`] = [
        {
          required: true,
          message: `请选择${config.auxiliaryType?.typeName ?? '核算维度'}`,
          trigger: 'change'
        }
      ]
    }
    return rules
  })

  const formItems = computed<FormItem[]>(() => [
    {
      label: '会计科目',
      key: 'subjectId',
      type: 'treeSelect',
      span: 24,
      props: {
        disabled: Boolean(form.data.id),
        filterable: true,
        data: subjectOptions.value,
        checkStrictly: true,
        placeholder: '搜索科目编码或名称',
        onChange: handleSubjectChange
      }
    },
    ...(canReadAmounts.value
      ? [
          { label: '科目余额', key: 'balanceSection', type: 'divider' as const, span: 24 },
          {
            label:
              selectedSubject.value?.balanceDirection === 'credit'
                ? '期初贷方余额'
                : '期初借方余额',
            key: 'openingAmount',
            type: 'number' as const,
            span: 24,
            description: '余额方向由所选会计科目确定，金额录入正数。',
            props: {
              min: 0,
              precision: 2,
              controlsPosition: 'right',
              class: '!w-full',
              disabled: !canEditAmounts.value
            }
          },
          {
            label: '本年借方累计',
            key: 'yearToDateDebit',
            type: 'number' as const,
            span: 12,
            props: {
              min: 0,
              precision: 2,
              controlsPosition: 'right',
              class: '!w-full',
              disabled: !canEditAmounts.value
            }
          },
          {
            label: '本年贷方累计',
            key: 'yearToDateCredit',
            type: 'number' as const,
            span: 12,
            props: {
              min: 0,
              precision: 2,
              controlsPosition: 'right',
              class: '!w-full',
              disabled: !canEditAmounts.value
            }
          },
          ...(selectedSubject.value?.allowQuantity
            ? [
                {
                  label: `期初数量${selectedSubject.value.unitName ? `（${selectedSubject.value.unitName}）` : ''}`,
                  key: 'openingQuantity',
                  type: 'number' as const,
                  span: 12,
                  props: {
                    min: 0,
                    precision: 4,
                    controlsPosition: 'right',
                    class: '!w-full',
                    disabled: !canEditAmounts.value
                  }
                }
              ]
            : [])
        ]
      : []),
    ...(selectedSubject.value?.allowForeignCurrency &&
    (canReadAuxiliary.value || canReadAmounts.value)
      ? [
          { label: '外币核算', key: 'currencySection', type: 'divider' as const, span: 24 },
          ...(canReadAuxiliary.value
            ? [
                {
                  label: '核算外币',
                  key: 'currencyId',
                  type: 'select' as const,
                  span: 12,
                  props: {
                    clearable: true,
                    filterable: true,
                    options: currencyOptions.value,
                    placeholder: '请选择外币',
                    disabled: !canEditAuxiliary.value
                  }
                }
              ]
            : []),
          ...(canReadAmounts.value
            ? [
                {
                  label: '原币期初金额',
                  key: 'originalCurrencyAmount',
                  type: 'number' as const,
                  span: 12,
                  props: {
                    min: 0,
                    precision: 2,
                    controlsPosition: 'right',
                    class: '!w-full',
                    disabled: !canEditAmounts.value
                  }
                }
              ]
            : [])
        ]
      : []),
    ...(subjectAuxiliaryConfigs.value.length && canReadAuxiliary.value
      ? [
          { label: '辅助核算', key: 'auxiliarySection', type: 'divider' as const, span: 24 },
          ...subjectAuxiliaryConfigs.value.map((config) => ({
            label: config.auxiliaryType?.typeName ?? '核算维度',
            key: `auxiliaryValues.${config.auxiliaryTypeId}`,
            type: 'select' as const,
            span: 12,
            help: config.isRequired ? '该维度为科目必录项' : undefined,
            props: {
              clearable: !config.isRequired,
              filterable: true,
              disabled: !canEditAuxiliary.value,
              options: context.auxiliaryItems
                .filter((item) => item.auxiliaryTypeId === config.auxiliaryTypeId && item.isEnabled)
                .map((item) => ({ label: `${item.itemCode} ${item.itemName}`, value: item.id }))
            }
          }))
        ]
      : [])
  ])

  function handleSubjectChange(): void {
    form.data.currencyId = null
    form.data.auxiliaryValues = {}
    form.data.openingQuantity = 0
    form.data.originalCurrencyAmount = 0
  }

  function validateBusinessRules(): boolean {
    const subject = selectedSubject.value
    if (!subject) return false
    if (canEditAuxiliary.value && subject.allowForeignCurrency && !form.data.currencyId) {
      ElMessage.warning('该科目启用了外币核算，请选择核算外币')
      return false
    }
    if (!canEditAuxiliary.value) return true
    const missing = subjectAuxiliaryConfigs.value.find(
      (config) => config.isRequired && !form.data.auxiliaryValues[config.auxiliaryTypeId]
    )
    if (missing) {
      ElMessage.warning(`请选择必录维度“${missing.auxiliaryType?.typeName ?? '辅助核算'}”`)
      return false
    }
    return true
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!checkSavePermission()) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (!checkSavePermission()) return false
      if (!canEditAmounts.value && !canEditAuxiliary.value) {
        ElMessage.warning('当前期初余额字段不可编辑，请刷新页面后重试')
        return false
      }
      if (!validateBusinessRules() || !selectedSubject.value) return false
      const isDebit = selectedSubject.value.balanceDirection === 'debit'
      await saveOpeningBalance({
        id: form.data.id,
        accountSetId: form.data.accountSetId,
        fiscalYear: form.data.fiscalYear,
        subjectId: form.data.subjectId,
        ...(canEditAuxiliary.value && {
          currencyId: selectedSubject.value.allowForeignCurrency ? form.data.currencyId : null,
          auxiliaryValues: Object.fromEntries(
            Object.entries(form.data.auxiliaryValues).filter(([, value]) => Boolean(value))
          )
        }),
        ...(canEditAmounts.value && {
          openingDebit: isDebit ? Number(form.data.openingAmount) : 0,
          openingCredit: isDebit ? 0 : Number(form.data.openingAmount),
          yearToDateDebit: Number(form.data.yearToDateDebit),
          yearToDateCredit: Number(form.data.yearToDateCredit),
          openingQuantity: selectedSubject.value.allowQuantity
            ? Number(form.data.openingQuantity)
            : 0,
          originalCurrencyAmount: selectedSubject.value.allowForeignCurrency
            ? Number(form.data.originalCurrencyAmount)
            : 0
        })
      })
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '期初余额保存失败，请检查内容后重试')
      return false
    }
  }

  function checkSavePermission(): boolean {
    if (hasAuth(form.data.id ? 'FinanceOpeningBalance:Edit' : 'FinanceOpeningBalance:Add'))
      return true
    ElMessage.warning('期初余额操作权限已变化，请刷新页面后重试')
    return false
  }

  async function handleOpen(
    accountSet: Api.Fms.AccountSetOption,
    fiscalYear: number,
    dialogContext: DialogContext,
    row?: Api.Fms.OpeningBalanceRecord
  ): Promise<void> {
    if (!hasAuth(row ? 'FinanceOpeningBalance:Edit' : 'FinanceOpeningBalance:Add')) {
      ElMessage.warning('没有期初余额操作权限，请联系管理员')
      return
    }
    Object.assign(context, dialogContext)
    fieldAccess.value = row?.fieldAccess ?? {
      balanceAmounts: 'edit',
      auxiliaryDetails: 'edit',
      controlAudit: 'edit'
    }
    Object.assign(form.data, createInitialForm(), {
      id: row?.id,
      accountSetId: accountSet.value,
      fiscalYear,
      subjectId: row?.subjectId ?? '',
      currencyId: row?.currencyId ?? null,
      auxiliaryValues: { ...(row?.auxiliaryValues ?? {}) },
      openingAmount: normalizeNullableNumber(row ? row.openingDebit || row.openingCredit : 0) ?? 0,
      yearToDateDebit: normalizeNullableNumber(row?.yearToDateDebit) ?? 0,
      yearToDateCredit: normalizeNullableNumber(row?.yearToDateCredit) ?? 0,
      openingQuantity: normalizeNullableNumber(row?.openingQuantity) ?? 0,
      originalCurrencyAmount: normalizeNullableNumber(row?.originalCurrencyAmount) ?? 0
    })
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? `编辑期初余额 · ${row.subject?.subjectCode ?? ''}` : '录入期初余额',
      confirmText: row ? '保存修改' : '保存余额',
      confirmDisabled: !canEditAmounts.value && !canEditAuxiliary.value,
      contentMaxHeight: '70vh',
      onConfirm: handleSubmit,
      onOpen: () => formRef.value?.clearValidate(),
      dialogProps: { closeOnClickModal: false }
    })
  }

  defineExpose({ handleOpen })
</script>
