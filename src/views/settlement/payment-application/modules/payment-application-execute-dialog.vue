<template>
  <ArtDialog ref="dialogRef" size="md">
    <ElAlert
      class="payment-execute-dialog__notice"
      type="info"
      :closable="false"
      show-icon
      :title="noticeTitle"
      description="确认后将生成正式付款流水，并按审批明细自动核销承运商对账单。"
    />
    <ElAlert
      v-if="!attachmentTenantId"
      class="mt-3"
      type="warning"
      :closable="false"
      show-icon
      title="无法确定付款申请所属租户，暂不能上传付款凭证"
    />
    <ArtForm
      ref="formRef"
      v-model="form.data"
      :items="form.items"
      :rules="form.rules"
      label-width="100px"
    >
      <template #voucherUrls>
        <ArtUploadImage
          v-model="form.data.voucherUrls"
          title="付款凭证"
          :size="84"
          :limit="5"
          :resource-tenant-id="attachmentTenantId"
          :disabled="!attachmentTenantId"
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
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtUploadImage from '@/components/core/forms/art-upload-image/index.vue'
  import { executeCarrierPaymentApplication, fetchFundAccountOptions } from '@fms/api'
  import {
    isReadableFieldAccess,
    getFieldAccess,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'
  import { useDocumentNumberRule } from '@/hooks/core/useDocumentNumberRule'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'

  defineOptions({ name: 'FinancePaymentApplicationExecuteDialog' })

  type Application = Api.Fms.CarrierPaymentApplicationRecord

  interface ExecuteForm {
    transactionNo: string
    fundAccountId: string
    transactionDate: string
    bankReference: string
    voucherUrls: string[]
  }

  interface FormGroup {
    data: ExecuteForm
    items: ComputedRef<FormItem[]>
    rules: FormRules<ExecuteForm>
  }

  interface FormExpose {
    validate: () => Promise<boolean>
    clearValidate: () => void
  }

  const emit = defineEmits<{ success: [transactionId?: string | null] }>()
  const dialogRef = ref<ArtDialogExpose<Application>>()
  const formRef = ref<FormExpose>()
  const application = shallowRef<Application>()
  const tenantScopeStore = useTenantScopeStore()
  const attachmentTenantId = computed(
    () => application.value?.tenantId || tenantScopeStore.effectiveTenantId || ''
  )
  const transactionNumber = useDocumentNumberRule('tms.cash_transaction')
  const fundAccountOptions = ref<Api.Fms.FundAccountOption[]>([])

  const createInitialForm = (): ExecuteForm => ({
    transactionNo: '',
    fundAccountId: '',
    transactionDate: dayjs().format('YYYY-MM-DD'),
    bankReference: '',
    voucherUrls: []
  })

  const form = reactive<FormGroup>({
    data: createInitialForm(),
    rules: {
      transactionNo: [
        {
          validator: (_rule, value, callback) =>
            transactionNumber.manualRequired(false) && !String(value || '').trim()
              ? callback(new Error('请输入付款流水号'))
              : callback(),
          trigger: 'blur'
        }
      ],
      transactionDate: [{ required: true, message: '请选择实际付款日期', trigger: 'change' }],
      fundAccountId: [{ required: true, message: '请选择实际付款账户', trigger: 'change' }],
      bankReference: [
        {
          validator: (_rule, value, callback) => {
            if (
              application.value?.paymentMethod === 'bank_transfer' &&
              !String(value ?? '').trim()
            ) {
              callback(new Error('银行转账必须填写银行流水号'))
              return
            }
            callback()
          },
          trigger: 'blur'
        }
      ]
    },
    items: computed<FormItem[]>(() => [
      { label: '付款登记', key: 'base', type: 'divider', span: 24 },
      {
        label: '付款流水号',
        key: 'transactionNo',
        type: 'input',
        span: 24,
        props: { maxlength: 50, ...transactionNumber.inputProps(false, '请输入付款流水号') },
        description: transactionNumber.description.value
      },
      {
        label: '实际付款日期',
        key: 'transactionDate',
        type: 'date',
        span: 24,
        props: { valueFormat: 'YYYY-MM-DD', class: '!w-full' }
      },
      {
        label: '付款账户',
        key: 'fundAccountId',
        type: 'select',
        span: 24,
        props: {
          options: fundAccountOptions.value,
          filterable: true,
          placeholder: '选择实际扣款资金账户'
        },
        description: '付款登记后自动生成资金流出日记账'
      },
      {
        label: '银行流水号',
        key: 'bankReference',
        type: 'input',
        span: 24,
        props: {
          maxlength: 100,
          clearable: true,
          placeholder:
            application.value?.paymentMethod === 'bank_transfer'
              ? '银行转账必填，用于防止重复付款'
              : '选填，用于资金追溯'
        }
      },
      { label: '付款凭证', key: 'voucher', type: 'divider', span: 24 },
      { label: '凭证附件', key: 'voucherUrls', type: 'input', span: 24 }
    ])
  })

  const noticeTitle = computed(() => {
    if (!application.value) return '确认实际付款信息'
    return `${application.value.carrierName} · ${formatSensitiveNumberWithAffix(application.value.amount, { prefix: '¥' })} · ${application.value.statementCount} 份对账单`
  })

  async function handleSubmit(): Promise<boolean> {
    if (!application.value) return false
    try {
      if (!(await validateArtFormForSubmit(formRef.value))) return false
    } catch (error) {
      notifyFriendlyError(error, '付款执行校验失败，请重试')
      return false
    }
    try {
      const { data } = await executeCarrierPaymentApplication({
        transactionNo: normalizeNullableText(form.data.transactionNo),
        applicationId: application.value.id,
        fundAccountId: form.data.fundAccountId,
        transactionDate: form.data.transactionDate,
        bankReference: normalizeNullableText(form.data.bankReference),
        voucherUrls: [...form.data.voucherUrls]
      })
      emit('success', data)
      return true
    } catch (error) {
      notifyFriendlyError(error, '付款执行保存失败，请检查内容后重试')
      return false
    }
  }

  async function resetForm(): Promise<void> {
    Object.assign(form.data, createInitialForm())
    application.value = undefined
    await nextTick()
    formRef.value?.clearValidate()
  }

  async function handleOpen(row: Application): Promise<void> {
    if (!isReadableFieldAccess(getFieldAccess(row.fieldAccess, 'applicationAmounts'))) {
      ElMessage.warning('当前字段权限不允许读取付款申请金额，无法登记付款')
      return
    }
    await resetForm()
    fundAccountOptions.value = []
    application.value = row
    await dialogRef.value?.handleOpen(row, {
      title: '登记付款',
      subtitle: `${row.applicationNo} · 每份已批准申请仅允许成功付款一次`,
      confirmText: '确认付款并核销',
      contentMaxHeight: '68vh',
      loading: true,
      loadingText: '正在加载编号规则与资金账户…',
      onOpen: async (_openData, api) => {
        try {
          const [, fundAccounts] = await Promise.all([
            transactionNumber.loadRule(),
            fetchFundAccountOptions({ status: 'active', baseCurrencyOnly: true })
          ])
          if (fundAccounts.error) {
            await api.handleClose()
            return
          }
          fundAccountOptions.value = fundAccounts.data ?? []
        } catch (error) {
          notifyFriendlyError(error, '付款资金账户加载失败，请重新打开后重试')
          await api.handleClose()
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

<style scoped lang="scss">
  .payment-execute-dialog {
    &__notice {
      margin-bottom: var(--art-space-4);
    }
  }
</style>
