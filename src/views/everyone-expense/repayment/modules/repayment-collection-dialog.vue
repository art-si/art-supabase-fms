<template>
  <ArtDialog ref="dialogRef" size="md">
    <ElAlert
      v-if="currentRow?.isDemo"
      class="mx-4 mb-3 w-auto"
      type="warning"
      :closable="false"
      title="演示收款仅更新测试借款余额，不代表实际银行到账。"
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
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { formatCurrencyValue } from '@/utils/ui'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { recordTravelRepaymentCollection, type TravelRepayment } from '@fms/api'

  interface CollectionInput {
    amount: number
    receiptDate: string
    bankReference: string | null
    remark: string | null
  }
  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose<TravelRepayment>>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const currentRow = ref<TravelRepayment>()
  const idempotencyKey = ref('')
  const model = ref<CollectionInput>({
    amount: 0,
    receiptDate: dayjs().format('YYYY-MM-DD'),
    bankReference: null,
    remark: null
  })
  const items: FormItem[] = [
    {
      key: 'amount',
      label: '本次收款金额（元）',
      type: 'number',
      props: { min: 0.01, precision: 2, class: 'w-full!' }
    },
    {
      key: 'receiptDate',
      label: '收款日期',
      type: 'date',
      props: { type: 'date', valueFormat: 'YYYY-MM-DD', class: 'w-full!' }
    },
    {
      key: 'bankReference',
      label: '银行流水号',
      type: 'input',
      span: 24,
      props: { maxlength: 100 }
    },
    {
      key: 'remark',
      span: 24,
      label: '备注',
      type: 'input',
      props: { type: 'textarea', rows: 2, maxlength: 500 }
    }
  ]
  const rules = {
    amount: [{ required: true, message: '请输入本次收款金额', trigger: 'change' }],
    receiptDate: [{ required: true, message: '请选择收款日期', trigger: 'change' }]
  }
  async function handleOpen(row: TravelRepayment): Promise<void> {
    currentRow.value = row
    idempotencyKey.value = crypto.randomUUID()
    const remaining = Math.max(0, row.amount - row.receivedAmount)
    model.value = {
      amount: remaining,
      receiptDate: dayjs().format('YYYY-MM-DD'),
      bankReference: row.isDemo ? `DEMO-${row.repaymentNo}-${dayjs().format('YYYYMMDD')}` : null,
      remark: row.isDemo ? '演示收款；无真实银行入账' : null
    }
    await dialogRef.value?.handleOpen(row, {
      title: `${row.isDemo ? '模拟收款' : '确认收款'} · ${row.repaymentNo}`,
      subtitle: `尚未收款 ${formatCurrencyValue(remaining)}。${row.isDemo ? '记录演示收款后将更新测试借款余额。' : '保存后将写入收款流水并更新借款未还余额。'}`,
      confirmText: row.isDemo ? '记录模拟收款' : '确认收款',
      onOpen: () => formRef.value?.clearValidate(),
      onConfirm: async () => {
        try {
          if (!(await validateArtFormForSubmit(formRef.value))) return false
          if (model.value.amount <= 0 || model.value.amount > remaining) {
            notifyFriendlyError(new Error('收款金额无效'), '本次收款金额应大于零且不超过未收金额')
            return false
          }
          await recordTravelRepaymentCollection({
            repaymentId: row.id,
            idempotencyKey: idempotencyKey.value,
            ...model.value
          })
          ElMessage.success(row.isDemo ? '模拟收款已记录' : '收款已登记')
          emit('success')
          return true
        } catch (error) {
          notifyFriendlyError(error, '还款收款结果未确认，请核对收款记录后重试当前表单')
          return false
        }
      }
    })
  }
  defineExpose({ handleOpen })
</script>
