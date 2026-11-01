<template>
  <ArtDialog ref="dialogRef" size="md">
    <template #subtitle>
      同账套、同币种账户间调拨；执行时同步登记转出、转入及手续费流水。
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
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import { normalizeNullableNumber, normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import {
    fetchAccountSetOptions,
    fetchFundAccountOptions,
    fetchFundTransferDetail,
    saveFundTransfer
  } from '@fms/api'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import { canEditField, canViewField } from '@/utils/field-permission'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'

  defineOptions({ name: 'FinanceFundTransferDialog' })

  type FormData = Api.Fms.SaveFundTransferPayload
  type Transfer = Api.Fms.FundTransferRecord

  const emit = defineEmits<{ success: [type: 'add' | 'edit'] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(dialogRef)
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const accountSetId = ref('')
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const accountOptions = ref<Api.Fms.FundAccountOption[]>([])
  const currentRecord = shallowRef<Transfer>()
  const fieldAccess = ref<Api.Fms.FundTransferFieldAccessMap>({})

  const createInitialForm = (): FormData => ({
    id: undefined,
    version: undefined,
    sourceAccountId: '',
    targetAccountId: '',
    transferDate: dayjs().format('YYYY-MM-DD'),
    amount: 0,
    feeAmount: 0,
    purpose: '',
    bankReference: null
  })

  const form = reactive<{ data: FormData; rules: FormRules<FormData> }>({
    data: createInitialForm(),
    rules: {
      sourceAccountId: [{ required: true, message: '请选择转出账户', trigger: 'change' }],
      targetAccountId: [{ required: true, message: '请选择转入账户', trigger: 'change' }],
      transferDate: [{ required: true, message: '请选择调拨日期', trigger: 'change' }],
      amount: [
        { required: true, message: '请输入调拨金额', trigger: 'change' },
        {
          validator: (_rule, value, callback) =>
            Number(value) > 0 ? callback() : callback(new Error('调拨金额必须大于 0')),
          trigger: 'change'
        }
      ],
      feeAmount: [
        {
          validator: (_rule, value, callback) =>
            Number(value) >= 0 ? callback() : callback(new Error('手续费不能为负数')),
          trigger: 'change'
        }
      ],
      purpose: [{ required: true, message: '请填写调拨用途', trigger: 'blur' }]
    }
  })

  const sourceOption = computed(() =>
    accountOptions.value.find((item) => item.value === form.data.sourceAccountId)
  )
  const targetOptions = computed(() =>
    accountOptions.value.filter(
      (item) =>
        item.value !== form.data.sourceAccountId &&
        (!sourceOption.value || item.currencyId === sourceOption.value.currencyId)
    )
  )
  const sourceOptions = computed(() =>
    accountOptions.value.filter((item) => item.value !== form.data.targetAccountId)
  )
  const sourceAvailableBalance = computed(() => {
    const value = sourceOption.value?.availableBalance
    return normalizeNullableNumber(value) ?? undefined
  })
  const isEditing = computed(() => Boolean(form.data.id))
  const canView = (field: Api.Fms.FundTransferFieldKey) =>
    !isEditing.value || canViewField(fieldAccess.value, field)
  const canEdit = (field: Api.Fms.FundTransferFieldKey) =>
    !isEditing.value || canEditField(fieldAccess.value, field)

  const formItems = computed<FormItem[]>(() => {
    const items: FormItem[] = [
      { label: '调拨信息', key: 'identitySection', type: 'divider', span: 24 },
      {
        label: '所属账套',
        key: '__accountSetId',
        type: 'select',
        span: 24,
        props: {
          modelValue: accountSetId.value,
          options: accountSetOptions.value,
          filterable: true,
          disabled: isEditing.value,
          placeholder: '先选择核算账套',
          onChange: (value: string) => void handleAccountSetChange(value)
        }
      },
      {
        label: '调拨日期',
        key: 'transferDate',
        type: 'date',
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      }
    ]

    if (canView('transferAccounts')) {
      if (canEdit('transferAccounts')) {
        items.push(
          {
            label: '转出账户',
            key: 'sourceAccountId',
            type: 'select',
            span: 24,
            props: {
              options: sourceOptions.value,
              filterable: true,
              disabled: !accountSetId.value,
              placeholder: '选择承担资金流出的账户'
            }
          },
          {
            label: '转入账户',
            key: 'targetAccountId',
            type: 'select',
            span: 24,
            props: {
              options: targetOptions.value,
              filterable: true,
              disabled: !form.data.sourceAccountId,
              placeholder: '选择同币种目标账户'
            }
          },
          {
            label: '可用余额',
            key: '__availableBalance',
            type: 'text',
            span: 24,
            props: {
              formatter: () =>
                sourceOption.value
                  ? formatSensitiveCurrencyValue(
                      sourceOption.value.availableBalance,
                      sourceOption.value.currencyCode
                    )
                  : '--'
            }
          }
        )
      } else {
        items.push(
          {
            label: '转出账户',
            key: '__sourceAccountDisplay',
            type: 'text',
            span: 24,
            props: {
              formatter: () =>
                formatAccountDisplay(
                  currentRecord.value?.sourceAccountName,
                  currentRecord.value?.sourceAccountNoMasked
                )
            }
          },
          {
            label: '转入账户',
            key: '__targetAccountDisplay',
            type: 'text',
            span: 24,
            props: {
              formatter: () =>
                formatAccountDisplay(
                  currentRecord.value?.targetAccountName,
                  currentRecord.value?.targetAccountNoMasked
                )
            }
          }
        )
      }
    }

    if (canView('transferAmounts')) {
      items.push({ label: '金额与费用', key: 'amountSection', type: 'divider', span: 24 })
      if (canEdit('transferAmounts')) {
        items.push(
          {
            label: '调拨金额',
            key: 'amount',
            type: 'number',
            props: {
              min: 0.01,
              precision: 2,
              step: 100,
              controlsPosition: 'right',
              class: '!w-full'
            }
          },
          {
            label: '银行手续费',
            key: 'feeAmount',
            type: 'number',
            props: {
              min: 0,
              precision: 2,
              step: 1,
              controlsPosition: 'right',
              class: '!w-full'
            }
          }
        )
      } else {
        items.push(
          {
            label: '调拨金额',
            key: '__amountDisplay',
            type: 'text',
            props: {
              formatter: () =>
                formatSensitiveCurrencyValue(
                  currentRecord.value?.amount,
                  currentRecord.value?.currencyCode
                )
            }
          },
          {
            label: '银行手续费',
            key: '__feeAmountDisplay',
            type: 'text',
            props: {
              formatter: () =>
                formatSensitiveCurrencyValue(
                  currentRecord.value?.feeAmount,
                  currentRecord.value?.currencyCode
                )
            }
          }
        )
      }
    }

    items.push({ label: '调拨说明', key: 'purposeSection', type: 'divider', span: 24 })
    if (canView('bankReference')) {
      items.push(
        canEdit('bankReference')
          ? {
              label: '银行参考号',
              key: 'bankReference',
              type: 'input',
              props: { maxlength: 120, placeholder: '选填，便于银行自动对账' }
            }
          : {
              label: '银行参考号',
              key: '__bankReferenceDisplay',
              type: 'text',
              props: { formatter: () => currentRecord.value?.bankReference || '--' }
            }
      )
    }

    items.push({
      label: '调拨用途',
      key: 'purpose',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 3, maxlength: 300, showWordLimit: true }
    })
    return items
  })

  async function handleAccountSetChange(value: string): Promise<void> {
    accountSetId.value = value
    form.data.sourceAccountId = ''
    form.data.targetAccountId = ''
    if (!value) {
      accountOptions.value = []
      return
    }
    const { data } = await fetchFundAccountOptions({ accountSetId: value, status: 'active' })
    accountOptions.value = data ?? []
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      await formRef.value?.validate()
      const amount = Number(form.data.amount)
      const feeAmount = Number(form.data.feeAmount)
      if (
        canEdit('transferAmounts') &&
        sourceAvailableBalance.value !== undefined &&
        Number.isFinite(amount) &&
        Number.isFinite(feeAmount) &&
        amount + feeAmount > sourceAvailableBalance.value
      ) {
        throw new Error('转出账户可用余额不足')
      }
      const payload: Api.Fms.SaveFundTransferPayload = {
        id: form.data.id,
        version: form.data.version,
        transferNo: form.data.transferNo,
        transferDate: form.data.transferDate,
        purpose: form.data.purpose.trim(),
        ...(canEdit('transferAccounts')
          ? {
              sourceAccountId: form.data.sourceAccountId,
              targetAccountId: form.data.targetAccountId
            }
          : {}),
        ...(canEdit('transferAmounts')
          ? { amount: form.data.amount, feeAmount: form.data.feeAmount }
          : {}),
        ...(canEdit('bankReference')
          ? { bankReference: normalizeNullableText(form.data.bankReference) }
          : {})
      }
      await saveFundTransfer(payload)
      emit('success', form.data.id ? 'edit' : 'add')
      return true
    } catch (error) {
      if (error instanceof Error && error.message === '转出账户可用余额不足') {
        notifyFriendlyError(error, '转出账户可用余额不足', 'warning')
      }
      return false
    }
  }

  function formatAccountDisplay(name?: string, accountNo?: string): string {
    if (!name && !accountNo) return '--'
    if (name === '***' || accountNo === '***') return '***'
    return accountNo ? `${name || '--'}（${accountNo}）` : name || '--'
  }

  async function handleOpen(row?: Transfer): Promise<void> {
    currentRecord.value = row
    Object.assign(form.data, createInitialForm())
    const prepare = async () => {
      const { data, error } = await fetchAccountSetOptions({ status: 'active', from: 0, to: 999 })
      if (error) throw error
      accountSetOptions.value = data ?? []
      const detail = row ? await fetchFundTransferDetail(row.id) : undefined
      if (detail?.error) throw detail.error
      if (row && !detail?.data) throw new Error('资金调拨不存在或无权查看，请刷新列表')
      const record = detail?.data ?? undefined
      currentRecord.value = record
      fieldAccess.value = record?.fieldAccess ?? {}
      Object.assign(
        form.data,
        createInitialForm(),
        record && {
          id: record.id,
          version: record.version,
          sourceAccountId: canEditField(record.fieldAccess, 'transferAccounts')
            ? record.sourceAccountId
            : undefined,
          targetAccountId: canEditField(record.fieldAccess, 'transferAccounts')
            ? record.targetAccountId
            : undefined,
          transferDate: record.transferDate,
          amount: canEditField(record.fieldAccess, 'transferAmounts')
            ? (normalizeNullableNumber(record.amount) ?? undefined)
            : undefined,
          feeAmount: canEditField(record.fieldAccess, 'transferAmounts')
            ? (normalizeNullableNumber(record.feeAmount) ?? undefined)
            : undefined,
          purpose: record.purpose,
          bankReference: canEditField(record.fieldAccess, 'bankReference')
            ? (record.bankReference ?? null)
            : null
        }
      )
      accountSetId.value = record?.accountSetId ?? ''
      if (accountSetId.value && (!record || canEditField(record.fieldAccess, 'transferAccounts'))) {
        const { data: accounts, error: accountsError } = await fetchFundAccountOptions({
          accountSetId: accountSetId.value,
          status: 'active'
        })
        if (accountsError) throw accountsError
        accountOptions.value = accounts ?? []
      } else {
        accountOptions.value = []
      }
    }
    await dialogRef.value?.handleOpen(undefined, {
      title: row ? `编辑资金调拨 · ${row.transferNo}` : '新建资金调拨',
      confirmText: row ? '保存修改' : '创建草稿',
      loading: true,
      loadingText: '正在加载资金账户…',
      onConfirm: handleSubmit,
      onOpen: async (_openData, api) => {
        try {
          await prepare()
          formRef.value?.clearValidate()
        } catch (error) {
          notifyFriendlyError(error, '资金调拨加载失败，请重试')
          await api.handleClose()
        } finally {
          prerequisiteOverlay.finishLoading()
        }
      },
      dialogProps: { closeOnClickModal: false, destroyOnClose: true }
    })
  }

  defineExpose({ handleOpen, ...prerequisiteOverlay })
</script>
