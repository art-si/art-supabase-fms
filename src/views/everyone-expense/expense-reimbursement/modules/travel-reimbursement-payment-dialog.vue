<template>
  <ArtDialog ref="dialogRef" size="md">
    <ElAlert
      :type="demo ? 'warning' : 'info'"
      class="mx-4 mb-3 w-auto"
      :closable="false"
      :title="
        demo
          ? '仅记录演示付款，不产生银行划转、资金流水或费用凭证。'
          : '登记真实付款前，请核对收款账户、付款资金账户及银行流水。'
      "
    />
    <ArtForm
      ref="formRef"
      v-model="model"
      :items="items"
      :rules="rules"
      :span="12"
      :show-reset="false"
      :show-submit="false"
      label-position="top"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { ElMessage } from 'element-plus'
  import dayjs from 'dayjs'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { formatCurrencyValue } from '@/utils/ui'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import {
    fetchFundAccountOptions,
    fetchTravelReimbursementDetail,
    recordTravelReimbursementPayment
  } from '@fms/api'

  type Reimbursement = Api.Fms.ExpenseReimbursementRecord
  interface OpenData {
    row: Reimbursement
    demo: boolean
  }
  interface PaymentForm {
    payeeId: string
    fundAccountId: string
    amount: number
    paymentDate: string
    bankReference: string
    remark: string
  }

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const row = ref<Reimbursement>()
  const demo = ref(false)
  const fundAccounts = ref<Api.Fms.FundAccountOption[]>([])
  const idempotencyKey = ref('')
  const model = ref<PaymentForm>({
    payeeId: '',
    fundAccountId: '',
    amount: 0,
    paymentDate: dayjs().format('YYYY-MM-DD'),
    bankReference: '',
    remark: ''
  })
  const remainingAmount = computed(() =>
    typeof row.value?.remainingAmount === 'number' ? row.value.remainingAmount : 0
  )
  const eligiblePayees = computed(() =>
    (row.value?.payees ?? []).filter(
      (payee) => typeof payee.remainingAmount === 'number' && payee.remainingAmount > 0
    )
  )
  const selectedPayee = computed(() =>
    eligiblePayees.value.find((payee) => payee.id === model.value.payeeId)
  )
  const selectedRemaining = computed(() =>
    Math.min(
      remainingAmount.value,
      typeof selectedPayee.value?.remainingAmount === 'number'
        ? selectedPayee.value.remainingAmount
        : 0
    )
  )
  function selectPayee(): void {
    model.value.amount = selectedRemaining.value
  }
  const items = computed<FormItem[]>(() => [
    { key: 'section', label: demo.value ? '演示付款' : '付款信息', type: 'divider', span: 24 },
    {
      key: 'payeeId',
      label: '收款明细',
      type: 'select',
      props: {
        filterable: true,
        placeholder: '选择本次付款的收款人和账户',
        onChange: selectPayee,
        options: eligiblePayees.value.map((payee) => ({
          value: payee.id,
          label: `${payee.payeeNameSnapshot || '收款人'} · ${payee.bankNameSnapshot || '开户银行'} · 待付 ${formatCurrencyValue(typeof payee.remainingAmount === 'number' ? payee.remainingAmount : 0)}`
        }))
      }
    },
    {
      key: 'fundAccountId',
      label: demo.value ? '界面验收资金账户' : '付款资金账户',
      type: 'select',
      props: {
        options: fundAccounts.value,
        filterable: true,
        placeholder: demo.value ? '选择界面验收资金账户' : '选择真实付款资金账户'
      }
    },
    {
      key: 'amount',
      label: '本次付款金额（元）',
      type: 'number',
      props: { min: 0.01, max: selectedRemaining.value, precision: 2, class: 'w-full!' }
    },
    {
      key: 'paymentDate',
      label: '付款日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD', class: 'w-full!' }
    },
    {
      key: 'bankReference',
      span: 24,
      label: demo.value
        ? '演示流水号'
        : selectedPayee.value?.settlementMethod === 'cash'
          ? '收款确认号'
          : '银行流水号',
      type: 'input',
      props: { maxlength: 160 }
    },
    {
      key: 'remark',
      label: '备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500 }
    }
  ])
  const rules = {
    payeeId: [{ required: true, message: '请选择本次付款的收款明细', trigger: 'change' }],
    fundAccountId: [{ required: true, message: '请选择付款资金账户', trigger: 'change' }],
    amount: [{ required: true, message: '请输入本次付款金额', trigger: 'change' }],
    paymentDate: [{ required: true, message: '请选择付款日期', trigger: 'change' }],
    bankReference: [{ required: true, message: '请填写付款流水号', trigger: 'blur' }]
  }

  async function handleOpen(data: OpenData): Promise<void> {
    const assertScope = createTenantScopeReadGuard()
    try {
      const [detailResult, accountsResult] = await Promise.all([
        fetchTravelReimbursementDetail(data.row.id),
        fetchFundAccountOptions({ status: 'active', baseCurrencyOnly: true })
      ])
      assertScope()
      const record = detailResult.data
      if (
        !record ||
        record.sourceType !== 'travel' ||
        record.isDemo !== data.demo ||
        !['approved', 'partially_paid'].includes(record.status) ||
        typeof record.remainingAmount !== 'number' ||
        record.remainingAmount <= 0
      ) {
        throw new Error('该报销单当前不能登记付款')
      }
      if (accountsResult.error) throw accountsResult.error
      demo.value = data.demo
      fundAccounts.value = (accountsResult.data ?? []).filter(
        (account) =>
          account.tenantId === record.tenantId &&
          (data.demo
            ? account.accountName.startsWith('界面验收')
            : !account.accountName.startsWith('界面验收'))
      )
      if (!fundAccounts.value.length)
        throw new Error(data.demo ? '请先维护界面验收资金账户' : '请先维护真实付款资金账户')
      row.value = record
      const firstPayee = eligiblePayees.value[0]
      if (!firstPayee || typeof firstPayee.remainingAmount !== 'number')
        throw new Error('收款明细不可用或字段权限不足，请核对后重试')
      idempotencyKey.value = crypto.randomUUID()
      model.value = {
        payeeId: firstPayee.id,
        fundAccountId: fundAccounts.value[0]?.id ?? '',
        amount: Math.min(record.remainingAmount, firstPayee.remainingAmount),
        paymentDate: dayjs().format('YYYY-MM-DD'),
        bankReference: data.demo
          ? `DEMO-${record.reimbursementNo}-${dayjs().format('YYYYMMDD')}`
          : '',
        remark: data.demo ? '演示付款；无实际银行划转' : ''
      }
      await dialogRef.value?.handleOpen(data, {
        title: `${data.demo ? '模拟报销付款' : '登记报销付款'} · ${record.reimbursementNo}`,
        subtitle: `尚待付款 ${formatCurrencyValue(record.remainingAmount)}。${data.demo ? '仅用于流程验收。' : '付款后将登记真实资金流水。'}`,
        confirmText: data.demo ? '记录模拟付款' : '登记已付款',
        onOpen: () => formRef.value?.clearValidate(),
        onConfirm: async () => {
          try {
            if (!(await validateArtFormForSubmit(formRef.value))) return false
            assertScope()
            if (
              !row.value ||
              model.value.amount <= 0 ||
              model.value.amount > selectedRemaining.value
            ) {
              notifyFriendlyError(new Error('金额超出待付'), '本次金额须大于零且不超过剩余待付金额')
              return false
            }
            await recordTravelReimbursementPayment({
              reimbursementId: row.value.id,
              payeeId: model.value.payeeId,
              fundAccountId: model.value.fundAccountId,
              amount: model.value.amount,
              paymentDate: model.value.paymentDate,
              bankReference: model.value.bankReference,
              demo: demo.value,
              idempotencyKey: idempotencyKey.value,
              remark: model.value.remark
            })
            ElMessage.success(demo.value ? '模拟付款已记录' : '付款已登记')
            emit('success')
            return true
          } catch (error) {
            notifyFriendlyError(error, '报销付款登记失败，请核对账户、流水和金额')
            return false
          }
        }
      })
    } catch (error) {
      notifyFriendlyError(error, '付款表单加载失败，请重试')
    }
  }

  defineExpose({ handleOpen })
</script>
