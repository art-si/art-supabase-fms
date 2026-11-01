<template>
  <ArtDialog ref="dialogRef" size="md"
    ><template v-if="!form.id" #subtitle
      >按账套、会计期间和税种建立台账，再维护计税明细与调整金额。</template
    >
    <ElAlert v-if="periodLoadFailed" type="error" :closable="false" show-icon class="mb-4">
      <template #title>会计期间加载失败，请重新加载后再保存。</template>
      <ElButton plain type="primary" @click="loadPeriods">重新加载期间</ElButton>
    </ElAlert>
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model="form"
      :items="items"
      :rules="rules"
      :span="12"
      :gutter="18"
      label-width="112px"
  /></ArtDialog>
</template>
<script setup lang="ts">
  import { normalizeNullableNumber } from '@/utils/form/normalize'
  import { useAccountingPeriodOptions } from '../../../modules/use-accounting-period-options'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import { storeToRefs } from 'pinia'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { fetchAccountSetOptions, fetchTaxPeriodDetail, saveTaxPeriod } from '@fms/api'
  import { canEditField, canViewField } from '@/utils/field-permission'
  import { formatSensitiveCurrencyValue as formatProtectedAmount } from '@/utils/ui'
  import { useUserStore } from '@/store/modules/user'
  import { ACCOUNTING_SELECT_EMPTY_TEXT } from '../../../modules/accounting-select-text'
  defineOptions({ name: 'FinanceTaxPeriodDialog' })
  const emit = defineEmits<{ success: [] }>()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const dialogRef = ref<ArtDialogExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(dialogRef)
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const currentRecord = shallowRef<Api.Fms.TaxPeriodRecord>()
  const fieldAccess = ref<Api.Fms.TaxFieldAccessMap>({})
  const form = ref<Api.Fms.SaveTaxPeriodPayload & { accountSetId: string }>({
    accountSetId: '',
    accountingPeriodId: '',
    taxType: 'vat',
    transferableInputAmount: 0,
    adjustmentAmount: 0,
    remark: null
  })
  const { periodOptions, periodsLoading, periodLoadFailed, loadPeriods, resetPeriods } =
    useAccountingPeriodOptions(
      computed({
        get: () => form.value.accountSetId,
        set: (value) => {
          form.value.accountSetId = value
        }
      }),
      computed({
        get: () => form.value.accountingPeriodId,
        set: (value) => {
          form.value.accountingPeriodId = value
        }
      }),
      computed(() => Boolean(form.value.id))
    )
  const rules: FormRules = {
    accountSetId: [{ required: true, message: '请选择账套', trigger: 'change' }],
    accountingPeriodId: [{ required: true, message: '请选择期间', trigger: 'change' }],
    taxType: [{ required: true, message: '请选择税种', trigger: 'change' }]
  }
  const isEditing = computed(() => Boolean(form.value.id))
  const canViewAmounts = computed(
    () => !isEditing.value || canViewField(fieldAccess.value, 'taxAmounts')
  )
  const canEditAmounts = computed(
    () => !isEditing.value || canEditField(fieldAccess.value, 'taxAmounts')
  )
  const items = computed<FormItem[]>(() => {
    const result: FormItem[] = [
      { label: '核算范围', key: 'scopeSection', type: 'divider', span: 24 },
      {
        label: '所属账套',
        key: 'accountSetId',
        type: 'select',
        span: 24,
        props: {
          options: accountSetOptions.value,
          filterable: true,
          onChange: loadPeriods,
          disabled: Boolean(form.value.id),
          noDataText: ACCOUNTING_SELECT_EMPTY_TEXT.accountSet
        }
      },
      {
        label: '会计期间',
        key: 'accountingPeriodId',
        type: 'select',
        span: 24,
        props: {
          options: periodOptions.value,
          disabled:
            Boolean(form.value.id) ||
            !form.value.accountSetId ||
            periodsLoading.value ||
            periodLoadFailed.value,
          loading: periodsLoading.value,
          noDataText: form.value.accountSetId
            ? ACCOUNTING_SELECT_EMPTY_TEXT.openAccountingPeriod
            : ACCOUNTING_SELECT_EMPTY_TEXT.chooseAccountSet
        }
      },
      {
        label: '税种',
        key: 'taxType',
        type: 'select',
        span: 24,
        props: { options: getDictMap.value.fmsTaxType ?? [], disabled: Boolean(form.value.id) }
      }
    ]
    if (canViewAmounts.value) {
      result.push(
        { label: '税额调整', key: 'amountSection', type: 'divider', span: 24 },
        ...(canEditAmounts.value
          ? [
              {
                label: '上期留抵',
                key: 'transferableInputAmount',
                type: 'number' as const,
                props: { min: 0, precision: 2, controlsPosition: 'right', class: '!w-full' }
              },
              {
                label: '调整金额',
                key: 'adjustmentAmount',
                type: 'number' as const,
                props: { precision: 2, controlsPosition: 'right', class: '!w-full' }
              }
            ]
          : [
              {
                label: '上期留抵',
                key: '__transferableInputAmountDisplay',
                type: 'text' as const,
                props: {
                  formatter: () =>
                    formatProtectedAmount(currentRecord.value?.transferableInputAmount)
                }
              },
              {
                label: '调整金额',
                key: '__adjustmentAmountDisplay',
                type: 'text' as const,
                props: {
                  formatter: () => formatProtectedAmount(currentRecord.value?.adjustmentAmount)
                }
              }
            ])
      )
    }
    result.push({ label: '期间说明', key: 'remarkSection', type: 'divider', span: 24 })
    result.push({
      label: '备注',
      key: 'remark',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 300 }
    })
    return result
  })
  async function submit() {
    try {
      if (periodsLoading.value || periodLoadFailed.value) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      const result = await saveTaxPeriod({
        id: form.value.id,
        accountingPeriodId: form.value.accountingPeriodId,
        taxType: form.value.taxType,
        ...(canEditAmounts.value
          ? {
              transferableInputAmount: Number(form.value.transferableInputAmount ?? 0),
              adjustmentAmount: Number(form.value.adjustmentAmount ?? 0)
            }
          : {}),
        remark: form.value.remark
      })
      if (result.error) throw result.error
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '税期保存失败，请检查内容后重试')
      return false
    }
  }
  async function handleOpen(row?: Api.Fms.TaxPeriodRecord, accountSetId?: string) {
    resetPeriods()
    accountSetOptions.value = []
    currentRecord.value = undefined
    form.value.id = undefined
    const prepare = async () => {
      await userStore.ensureDictLoaded('fmsTaxType')
      const { data, error } = await fetchAccountSetOptions({ status: 'active', from: 0, to: 999 })
      if (error) throw error
      accountSetOptions.value = data ?? []
      const detailResult = row ? await fetchTaxPeriodDetail(row.id) : undefined
      if (detailResult?.error) throw detailResult.error
      if (row && !detailResult?.data) throw new Error('税务期间不存在或已不可访问，请刷新列表')
      const record = detailResult?.data ?? undefined
      if (
        !record &&
        accountSetId &&
        !accountSetOptions.value.some((item) => item.value === accountSetId)
      ) {
        throw new Error('所选账套已不可用，请刷新列表后重试')
      }
      currentRecord.value = record
      fieldAccess.value = record?.fieldAccess ?? {}
      Object.assign(form.value, {
        id: record?.id,
        accountSetId:
          record?.accountSetId ?? accountSetId ?? accountSetOptions.value[0]?.value ?? '',
        accountingPeriodId: record?.accountingPeriodId || '',
        taxType: record?.taxType || 'vat',
        transferableInputAmount: canEditField(record?.fieldAccess, 'taxAmounts')
          ? (normalizeNullableNumber(record?.transferableInputAmount) ?? 0)
          : 0,
        adjustmentAmount: canEditField(record?.fieldAccess, 'taxAmounts')
          ? (normalizeNullableNumber(record?.adjustmentAmount) ?? 0)
          : 0,
        remark: record?.remark || null
      })
      await loadPeriods()
    }
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? '编辑税务期间' : '新建税务期间',
      confirmText: row ? '保存修改' : '创建台账',
      loading: true,
      loadingText: '正在加载税务期间与账套…',
      onConfirm: submit,
      onOpen: async () => {
        try {
          await prepare()
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '税务期间加载失败，请重新打开重试')
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
