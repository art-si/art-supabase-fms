<template>
  <ArtDialog ref="dialogRef" size="lg" @close="() => void invalidateSession()">
    <ElAlert
      v-if="payeeOptionsLoaded && !payeeOptions.length"
      class="mb-3"
      type="warning"
      :closable="false"
      title="当前申请人没有可用的收款信息，请先维护收款银行和账号。"
    />
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
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { ElMessage } from 'element-plus'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNonNullableText, normalizeNullableText } from '@/utils/form/normalize'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import {
    fetchLoanPayeeOptions,
    fetchReimbursementPayeeOptions,
    type LoanPayeeOption,
    type TravelLoanPayeeInput
  } from '@fms/api'

  interface OpenData {
    payee?: TravelLoanPayeeInput
    tenantId: string
    employeeId: string
    defaultAmount: number
    documentType: 'loan' | 'reimbursement'
    copy?: boolean
  }
  const emit = defineEmits<{ save: [payee: TravelLoanPayeeInput] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const {
    version: sessionVersion,
    invalidate: invalidateSession,
    isCurrent
  } = useArtOverlaySession(() => Boolean(unref(dialogRef.value?.visible)))
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const settlementOptions = useDictionaryOptions('fmsSettlementMethod')
  const payeeTypeOptions = useDictionaryOptions('fmsPayeeType')
  const tenantId = ref('')
  const employeeId = ref('')
  const documentType = ref<'loan' | 'reimbursement'>('loan')
  const payeeOptions = ref<LoanPayeeOption[]>([])
  const payeeOptionsLoaded = ref(false)
  const model = ref<TravelLoanPayeeInput>({
    settlementMethod: 'bank_transfer',
    payeeType: 'person',
    payeeInformationId: '',
    bankAccount: '',
    accountName: null,
    bankName: '',
    amount: 0,
    remark: null
  })

  const items = computed<FormItem[]>(() => [
    {
      key: 'settlementMethod',
      label: '支付方式',
      type: 'select',
      props: { filterable: true, options: settlementOptions }
    },
    {
      key: 'payeeType',
      label: '收款人类型',
      type: 'select',
      props: { options: payeeTypeOptions }
    },
    {
      key: 'payeeInformationId',
      label: '收款人',
      type: 'select',
      api: async () => {
        const session = sessionVersion.value
        const result =
          documentType.value === 'loan'
            ? await fetchLoanPayeeOptions(tenantId.value, employeeId.value)
            : await fetchReimbursementPayeeOptions(tenantId.value, employeeId.value)
        if (!isCurrent(session)) return { ...result, data: [] }
        payeeOptions.value = result.data ?? []
        payeeOptionsLoaded.value = true
        if (
          model.value.payeeInformationId &&
          !payeeOptions.value.some((payee) => payee.id === model.value.payeeInformationId)
        ) {
          return {
            ...result,
            data: [
              ...payeeOptions.value,
              {
                id: model.value.payeeInformationId,
                payeeName: `${model.value.payeeName || '原收款资料'}（不可用）`,
                accountName: model.value.accountName,
                bankName: model.value.bankName,
                bankAccount: model.value.bankAccount,
                employeeId: null,
                isDefault: false,
                disabled: true
              }
            ]
          }
        }
        return result
      },
      resultField: 'data',
      labelField: 'payeeName',
      valueField: 'id',
      labelFn: (option) => {
        const payee = option as LoanPayeeOption
        return `${payee.payeeName} · ${payee.bankName} · ${payee.bankAccount.slice(-4)}`
      },
      props: {
        filterable: true,
        placeholder: '从收款信息中选择',
        onChange: (value: string) => selectPayee(value)
      }
    },
    { key: 'bankAccount', label: '银行账号', type: 'input', props: { maxlength: 64 } },
    { key: 'accountName', label: '账户名称', type: 'input', props: { maxlength: 120 } },
    { key: 'bankName', label: '开户银行', type: 'input', props: { maxlength: 120 } },
    {
      key: 'amount',
      label: '收款金额（元）',
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
  const rules = {
    settlementMethod: [{ required: true, message: '请选择支付方式', trigger: 'change' }],
    payeeType: [{ required: true, message: '请选择收款人类型', trigger: 'change' }],
    payeeInformationId: [{ required: true, message: '请选择收款人', trigger: 'change' }],
    bankAccount: [{ required: true, message: '请输入银行账号', trigger: 'blur' }],
    bankName: [{ required: true, message: '请输入开户银行', trigger: 'blur' }],
    amount: [
      {
        required: true,
        type: 'number' as const,
        min: 0.01,
        message: '收款金额须大于零',
        trigger: 'change'
      }
    ]
  }
  function selectPayee(id: string): void {
    const payee = payeeOptions.value.find((item) => item.id === id)
    if (!payee) return
    model.value.payeeName = payee.payeeName
    model.value.bankAccount = payee.bankAccount
    model.value.accountName = payee.accountName
    model.value.bankName = payee.bankName
  }
  async function handleOpen(data: OpenData): Promise<void> {
    invalidateSession()
    tenantId.value = data.tenantId
    employeeId.value = data.employeeId
    documentType.value = data.documentType
    payeeOptionsLoaded.value = false
    payeeOptions.value = []
    model.value = {
      settlementMethod: data.payee?.settlementMethod ?? 'bank_transfer',
      payeeType: 'person',
      payeeInformationId: data.payee?.payeeInformationId ?? '',
      payeeName: data.payee?.payeeName,
      bankAccount: data.payee?.bankAccount ?? '',
      accountName: data.payee?.accountName ?? null,
      bankName: data.payee?.bankName ?? '',
      amount: data.payee?.amount ?? data.defaultAmount,
      remark: data.payee?.remark ?? null,
      id: data.copy ? undefined : data.payee?.id
    }
    await dialogRef.value?.handleOpen(data, {
      title: data.copy ? '复制收款明细' : data.payee ? '编辑收款明细' : '添加收款信息',
      subtitle: '选择收款资料后自动带入银行信息，保存前仍可核对和修正。',
      confirmText: data.payee && !data.copy ? '保存收款明细' : '添加收款明细',
      onOpen: () => formRef.value?.clearValidate(),
      onConfirm: async () => {
        const session = sessionVersion.value
        if (!(await validateArtFormForSubmit(formRef.value))) return false
        if (!isCurrent(session)) return false
        if (!payeeOptionsLoaded.value) {
          ElMessage.warning('收款资料仍在加载，请稍候重试')
          return false
        }
        if (!payeeOptions.value.some((payee) => payee.id === model.value.payeeInformationId)) {
          ElMessage.warning('原收款资料已失效或不再授权，请重新选择可用收款资料')
          return false
        }
        if (model.value.amount <= 0) return false
        emit('save', {
          ...model.value,
          payeeName:
            payeeOptions.value.find((item) => item.id === model.value.payeeInformationId)
              ?.payeeName ?? data.payee?.payeeName,
          bankAccount: normalizeNonNullableText(model.value.bankAccount),
          accountName: normalizeNullableText(model.value.accountName),
          bankName: normalizeNonNullableText(model.value.bankName),
          remark: normalizeNullableText(model.value.remark)
        })
        return true
      }
    })
  }
  defineExpose({ handleOpen })
</script>
