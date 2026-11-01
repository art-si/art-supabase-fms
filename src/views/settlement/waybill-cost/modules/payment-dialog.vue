<template>
  <ArtDialog ref="dialogRef" size="md">
    <ArtEntitySummary
      class="mb-4"
      compact
      icon="ri:bank-card-line"
      :title="`${state.reimbursement?.reimbursementNo || ''} · ${state.reimbursement?.payeeName || ''}`"
      :description="`申请报销 ${money(state.reimbursement?.totalAmount)} · 已付 ${money(state.reimbursement?.paidAmount ?? 0)} · 待付 ${money(remainingAmount)}`"
    />
    <ArtForm
      root-class="art-form--mobile-stack"
      ref="formRef"
      v-model="form.data"
      :items="form.items"
      :rules="form.rules"
      :span="12"
      :gutter="20"
    >
      <template #voucherUrls>
        <ArtUploadImage
          v-model="form.data.voucherUrls"
          :resource-tenant-id="state.reimbursement?.tenantId || ''"
          title="付款凭证"
          :size="82"
          :limit="5"
          multiple
        />
      </template>
    </ArtForm>
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import dayjs from 'dayjs'
  import type { ComputedRef } from 'vue'
  import { ElMessage, type FormRules } from 'element-plus'
  import ArtEntitySummary from '@/components/core/surfaces/art-entity-summary/index.vue'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import { executeExpenseReimbursement, fetchFundAccountOptions } from '@fms/api'
  import { formatCurrencyValue } from '@/utils/ui'
  import { isReadableFieldAccess, getFieldAccess, isMaskedValue } from '@/utils/field-permission'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'

  defineOptions({ name: 'FinanceWaybillExpensePaymentDialog' })

  type Reimbursement = Api.Fms.ExpenseReimbursementRecord

  interface PaymentForm {
    paymentNo: string
    fundAccountId: string
    amount?: number
    paymentDate: string
    bankReference: string
    voucherUrls: string[]
    remark: string
  }

  interface FormGroup {
    data: PaymentForm
    items: ComputedRef<FormItem[]>
    rules: ComputedRef<FormRules<PaymentForm>>
  }

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose<Reimbursement>>()
  const formRef = ref<FormExpose>()
  const state = reactive<{ reimbursement?: Reimbursement }>({ reimbursement: undefined })
  const paymentNumber = useDocumentNumberRule('tms.expense_payment')
  const fundAccountOptions = ref<Api.Fms.FundAccountOption[]>([])
  const createInitialForm = (): PaymentForm => ({
    paymentNo: '',
    fundAccountId: '',
    amount: undefined,
    paymentDate: dayjs().format('YYYY-MM-DD'),
    bankReference: '',
    voucherUrls: [],
    remark: ''
  })
  const form = reactive<FormGroup>({
    data: createInitialForm(),
    rules: computed<FormRules<PaymentForm>>(() => ({
      paymentNo: [
        {
          validator: (_rule, value, callback) =>
            paymentNumber.manualRequired(false) && !String(value || '').trim()
              ? callback(new Error('请输入费用付款单号'))
              : callback(),
          trigger: 'blur'
        }
      ],
      paymentDate: [{ required: true, message: '请选择实际付款日期', trigger: 'change' }],
      fundAccountId: [{ required: true, message: '请选择实际付款账户', trigger: 'change' }],
      amount: [
        {
          required: true,
          validator: (_rule, value, callback) => {
            const amount = Number(value)
            if (!Number.isFinite(amount) || amount <= 0) {
              callback(new Error('请输入大于 0 的实付金额'))
              return
            }
            if (amount > remainingAmount.value) {
              callback(new Error(`实付金额不能大于剩余待付金额 ${money(remainingAmount.value)}`))
              return
            }
            callback()
          },
          trigger: ['blur', 'change']
        }
      ],
      bankReference: [
        {
          required: state.reimbursement?.paymentMethod === 'bank_transfer',
          validator: (_rule, value, callback) =>
            state.reimbursement?.paymentMethod !== 'bank_transfer' || String(value || '').trim()
              ? callback()
              : callback(new Error('银行转账必须填写银行流水号')),
          trigger: 'blur'
        }
      ]
    })),
    items: computed<FormItem[]>(() => [
      { label: '付款信息', key: 'paymentSection', type: 'divider', span: 24 },
      {
        label: '付款单号',
        key: 'paymentNo',
        type: 'input',
        props: { maxlength: 50, ...paymentNumber.inputProps(false, '请输入费用付款单号') },
        description: paymentNumber.description.value
      },
      {
        label: '付款日期',
        key: 'paymentDate',
        type: 'date',
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '实付金额(元)',
        key: 'amount',
        type: 'number',
        props: {
          min: 0.01,
          max: remainingAmount.value,
          precision: 2,
          step: 100,
          controlsPosition: 'right',
          class: '!w-full',
          placeholder: '请输入本次实际付款金额'
        },
        description: `本次最多可支付 ${money(remainingAmount.value)}`
      },
      {
        label: '付款账户',
        key: 'fundAccountId',
        type: 'select',
        props: {
          options: fundAccountOptions.value,
          filterable: true,
          placeholder: '选择实际扣款资金账户'
        },
        description: '付款成功后自动登记资金流出日记账'
      },
      { label: '流水与凭证', key: 'evidenceSection', type: 'divider', span: 24 },
      {
        label: '银行流水号',
        key: 'bankReference',
        type: 'input',
        span: 24,
        props: {
          maxlength: 160,
          placeholder: state.reimbursement?.paymentMethod === 'bank_transfer' ? '必填' : '可选'
        }
      },
      {
        label: '付款备注',
        key: 'remark',
        type: 'textarea',
        span: 24,
        props: { rows: 3, maxlength: 500, showWordLimit: true }
      },
      { label: '付款凭证', key: 'voucherUrls', type: 'input', span: 24 }
    ])
  })

  const remainingAmount = computed(() => {
    const explicitRemaining = toReadableAmount(state.reimbursement?.remainingAmount)
    if (explicitRemaining !== undefined) return explicitRemaining
    const total = toReadableAmount(state.reimbursement?.totalAmount) ?? 0
    const paid = toReadableAmount(state.reimbursement?.paidAmount) ?? 0
    return Math.max(total - paid, 0)
  })

  function toReadableAmount(value?: Api.Fms.SensitiveNumber): number | undefined {
    if (value === null || value === undefined || isMaskedValue(value)) return undefined
    const amount = Number(value)
    return Number.isFinite(amount) ? amount : undefined
  }

  function money(value?: Api.Fms.SensitiveNumber): string {
    if (isMaskedValue(value)) return '***'
    if (value === null || value === undefined) return '--'
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? formatCurrencyValue(numericValue) : String(value)
  }

  async function handleSubmit(): Promise<boolean> {
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '运单付款校验失败，请重试')
      return false
    }
    if (!state.reimbursement) return false
    try {
      await executeExpenseReimbursement({
        paymentNo: normalizeNullableText(form.data.paymentNo),
        reimbursementId: state.reimbursement.id,
        fundAccountId: form.data.fundAccountId,
        amount: Number(form.data.amount),
        paymentDate: form.data.paymentDate,
        bankReference: normalizeNullableText(form.data.bankReference),
        voucherUrls: [...form.data.voucherUrls],
        remark: normalizeNullableText(form.data.remark)
      })
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '运单付款保存失败，请检查内容后重试')
      return false
    }
  }

  async function resetForm(): Promise<void> {
    Object.assign(form.data, createInitialForm())
    state.reimbursement = undefined
    await nextTick()
    formRef.value?.clearValidate()
  }

  async function handleOpen(row: Reimbursement): Promise<void> {
    const canReadPaymentContext = ['reimbursementAmounts', 'payeeDetails'].every((field) =>
      isReadableFieldAccess(
        getFieldAccess(row.fieldAccess, field as Api.Fms.ExpenseReimbursementFieldKey)
      )
    )
    if (!canReadPaymentContext || getFieldAccess(row.fieldAccess, 'paymentExecution') !== 'edit') {
      ElMessage.warning('当前字段权限不足，无法读取报销付款信息或登记付款结果')
      return
    }
    await resetForm()
    fundAccountOptions.value = []
    state.reimbursement = structuredClone(toRaw(row))
    form.data.amount = remainingAmount.value
    await dialogRef.value?.handleOpen(row, {
      title: '出纳登记付款',
      subtitle: '可按实际付款金额分次登记；全部付清后系统才会核销报销单内的关联费用',
      confirmText: '确认登记付款',
      contentMaxHeight: '70vh',
      loading: true,
      loadingText: '正在加载编号规则与资金账户…',
      onOpen: async (_openData, api) => {
        try {
          const [, fundAccounts] = await Promise.all([
            paymentNumber.loadRule(),
            fetchFundAccountOptions({ status: 'active', baseCurrencyOnly: true })
          ])
          fundAccountOptions.value = fundAccounts.data ?? []
        } finally {
          api.setLoading(false)
        }
      },
      onConfirm: handleSubmit,
      onReset: () => void resetForm(),
      dialogProps: { appendToBody: true, closeOnClickModal: false }
    })
  }

  defineExpose({ handleOpen })
</script>
