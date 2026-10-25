<template>
  <ArtDialog ref="dialogRef" size="lg">
    <ArtEntitySummary
      v-if="loan"
      class="mb-4"
      compact
      icon="ri:bank-card-line"
      :title="`${loan.loanNo} · ${loan.applicantName}`"
      :description="`核定借款 ${formatCurrencyValue(loan.approvedAmount ?? 0)} · 已付 ${formatCurrencyValue(loan.paidAmount ?? 0)} · 待付 ${formatCurrencyValue(remainingAmount)}`"
    />
    <ElAlert
      v-if="demo"
      class="mx-4 mb-3 w-auto"
      type="warning"
      :closable="false"
      title="演示付款只记录测试单据，不产生银行划转或真实资金流水。"
    />
    <ElAlert
      v-else
      class="mx-4 mb-3 w-auto"
      type="info"
      :closable="false"
      title="请先完成实际转账，再登记银行流水号；保存后将记入资金日记账。"
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
    >
      <template #voucherUrls>
        <ArtUploadImage
          v-model="model.voucherUrls"
          :resource-tenant-id="loan?.tenantId || ''"
          title="付款凭证"
          :size="80"
          :limit="5"
          multiple
        />
      </template>
    </ArtForm>
    <ElAlert
      v-if="!eligibleAccounts.length"
      class="mx-4 mt-2 w-auto"
      type="warning"
      :closable="false"
      :title="demo ? '请先维护可用的界面验收资金账户。' : '请先维护可用的真实付款资金账户。'"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { ElMessage } from 'element-plus'
  import dayjs from 'dayjs'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import ArtEntitySummary from '@/components/core/surfaces/art-entity-summary/index.vue'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { formatCurrencyValue } from '@/utils/ui'
  import { createTenantScopeReadGuard } from '@/utils/tenant-scope-context'
  import {
    fetchFundAccountOptions,
    fetchTravelLoanDetail,
    recordTravelLoanPayment,
    type TravelLoan,
    type TravelLoanPayee
  } from '@fms/api'

  interface OpenData {
    row: TravelLoan
    demo: boolean
  }
  interface PaymentForm {
    loanPayeeId: string
    fundAccountId: string
    amount: number
    paymentDate: string
    bankReference: string
    voucherUrls: string[]
    remark: string
  }

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose<OpenData>>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const loan = ref<TravelLoan>()
  const demo = ref(false)
  const fundAccounts = ref<Api.Fms.FundAccountOption[]>([])
  const idempotencyKey = ref('')
  const model = ref<PaymentForm>({
    loanPayeeId: '',
    fundAccountId: '',
    amount: 0,
    paymentDate: dayjs().format('YYYY-MM-DD'),
    bankReference: '',
    voucherUrls: [],
    remark: ''
  })
  const remainingAmount = computed(() =>
    Math.max(0, (loan.value?.approvedAmount ?? 0) - (loan.value?.paidAmount ?? 0))
  )
  const payeeOptions = computed(() =>
    (loan.value?.payees ?? [])
      .filter((payee) => remainingForPayee(payee) > 0)
      .map((payee) => ({
        label: `${payee.payeeName} · ${payee.bankName} · 待付 ${formatCurrencyValue(remainingForPayee(payee))}`,
        value: payee.id
      }))
  )
  const selectedPayee = computed<TravelLoanPayee | undefined>(() =>
    loan.value?.payees?.find((payee) => payee.id === model.value.loanPayeeId)
  )
  const selectedRemaining = computed(() =>
    Math.min(remainingAmount.value, remainingForPayee(selectedPayee.value))
  )
  const eligibleAccounts = computed(() =>
    fundAccounts.value.filter(
      (account) =>
        account.tenantId === loan.value?.tenantId &&
        (demo.value
          ? account.accountName.startsWith('界面验收')
          : !account.accountName.startsWith('界面验收'))
    )
  )
  const items = computed<FormItem[]>(() => [
    { key: 'section', label: '付款信息', type: 'divider', span: 24 },
    {
      key: 'loanPayeeId',
      label: '收款明细',
      type: 'select',
      props: {
        options: payeeOptions.value,
        filterable: true,
        placeholder: '选择本次付款的收款账户',
        onChange: setPayee
      }
    },
    {
      key: 'fundAccountId',
      label: '付款资金账户',
      type: 'select',
      props: {
        options: eligibleAccounts.value,
        filterable: true,
        placeholder: demo.value ? '选择界面验收资金账户' : '选择实际付款账户'
      }
    },
    {
      key: 'amount',
      label: '本次付款金额（元）',
      type: 'number',
      props: {
        min: 0.01,
        max: selectedRemaining.value,
        precision: 2,
        class: 'w-full!'
      }
    },
    {
      key: 'paymentDate',
      label: '付款日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD', class: 'w-full' }
    },
    {
      key: 'bankReference',
      label: demo.value ? '演示流水号' : '银行流水号',
      type: 'input',
      span: 24,
      props: { maxlength: 160 }
    },
    {
      key: 'remark',
      label: '付款备注',
      type: 'input',
      span: 24,
      props: { type: 'textarea', rows: 2, maxlength: 500 }
    },
    { key: 'voucherUrls', label: '付款凭证', type: 'input', span: 24 }
  ])
  const rules = {
    loanPayeeId: [{ required: true, message: '请选择收款明细', trigger: 'change' }],
    fundAccountId: [{ required: true, message: '请选择付款资金账户', trigger: 'change' }],
    amount: [{ required: true, message: '请输入付款金额', trigger: 'change' }],
    paymentDate: [{ required: true, message: '请选择付款日期', trigger: 'change' }],
    bankReference: [{ required: true, message: '请填写付款流水号', trigger: 'blur' }]
  }

  function remainingForPayee(payee: TravelLoanPayee | undefined): number {
    if (!payee) return 0
    const paid = (loan.value?.payments ?? [])
      .filter((payment) => payment.loanPayeeId === payee.id)
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
    return Math.max(0, payee.amount - paid)
  }
  function setPayee(): void {
    model.value.amount = selectedRemaining.value
  }
  async function handleOpen(data: OpenData): Promise<void> {
    const assertScope = createTenantScopeReadGuard()
    try {
      const [detailResult, accountsResult] = await Promise.all([
        fetchTravelLoanDetail(data.row.id),
        fetchFundAccountOptions({ status: 'active', baseCurrencyOnly: true })
      ])
      assertScope()
      if (!detailResult.data || accountsResult.error) {
        throw new Error('借款单或资金账户不可用')
      }
      loan.value = detailResult.data
      if (
        loan.value.isDemo !== data.demo ||
        !['approved', 'awaiting_payment'].includes(loan.value.status) ||
        (loan.value.approvedAmount ?? 0) <= (loan.value.paidAmount ?? 0)
      ) {
        throw new Error('借款状态或待付金额已变化，请刷新列表后重试')
      }
      demo.value = data.demo
      fundAccounts.value = accountsResult.data ?? []
      idempotencyKey.value = crypto.randomUUID()
      const firstPayee = loan.value.payees?.find((payee) => remainingForPayee(payee) > 0)
      model.value = {
        loanPayeeId: firstPayee?.id ?? '',
        fundAccountId: '',
        amount: Math.min(remainingAmount.value, remainingForPayee(firstPayee)),
        paymentDate: dayjs().format('YYYY-MM-DD'),
        bankReference: data.demo ? `DEMO-${data.row.loanNo}-${dayjs().format('YYYYMMDD')}` : '',
        voucherUrls: [],
        remark: data.demo ? '演示付款；无实际银行划转' : ''
      }
      model.value.fundAccountId = eligibleAccounts.value[0]?.id ?? ''
      await dialogRef.value?.handleOpen(data, {
        title: data.demo ? '模拟借款付款' : '登记借款付款',
        subtitle: data.demo
          ? '仅针对测试收款账户和界面验收资金账户，不生成真实资金流水。'
          : '逐笔核对收款账户及真实银行流水。',
        confirmText: data.demo ? '记录模拟付款' : '登记已付款',
        onOpen: () => formRef.value?.clearValidate(),
        onConfirm: async () => {
          try {
            if (!(await validateArtFormForSubmit(formRef.value))) return false
            assertScope()
            if (!loan.value || !selectedPayee.value || !model.value.fundAccountId) return false
            if (
              model.value.amount <= 0 ||
              model.value.amount > remainingAmount.value ||
              model.value.amount > remainingForPayee(selectedPayee.value)
            ) {
              notifyFriendlyError(
                new Error('金额超出待付'),
                '本次金额超过借款或收款明细的剩余待付金额'
              )
              return false
            }
            await recordTravelLoanPayment({
              loanId: loan.value.id,
              loanPayeeId: model.value.loanPayeeId,
              fundAccountId: model.value.fundAccountId,
              amount: model.value.amount,
              paymentDate: model.value.paymentDate,
              bankReference: model.value.bankReference,
              voucherUrls: model.value.voucherUrls,
              remark: model.value.remark,
              demo: demo.value,
              idempotencyKey: idempotencyKey.value
            })
            ElMessage.success(demo.value ? '模拟付款已记录' : '付款已登记')
            emit('success')
            return true
          } catch (error) {
            notifyFriendlyError(error, '借款付款登记失败，请核对付款账户、流水和金额')
            return false
          }
        }
      })
    } catch (error) {
      notifyFriendlyError(error, '借款付款表单加载失败，请重试')
    }
  }
  defineExpose({ handleOpen })
</script>
