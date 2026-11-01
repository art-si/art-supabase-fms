<template>
  <ArtDialog ref="dialog" title="贷方余额生成付款申请" size="md" confirm-text="生成付款申请">
    <ArtDescriptions v-if="source" :data="source" :items="sourceItems" :columns="2" class="mb-5" />
    <ArtForm
      ref="formRef"
      v-model="form"
      :items="items"
      :rules="rules"
      :span="12"
      label-position="top"
    />
  </ArtDialog>
</template>
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import dayjs from 'dayjs'
  import { ElMessage } from 'element-plus'
  import {
    createArCreditPaymentRequest,
    fetchArOptions,
    type ReceivableDocument
  } from '@/api/receivables'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { formatSensitiveCurrencyValue } from '@/utils/ui/format'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  defineOptions({ name: 'ArCreditPaymentDialog' })
  const emit = defineEmits<{ success: [id: string] }>()
  const dialog = ref<ArtDialogExpose>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const source = ref<ReceivableDocument>()
  const methods = useDictionaryOptions('arSettlementMethod')
  const form = ref({
    requestId: '',
    amount: 0,
    businessDate: dayjs().format('YYYY-MM-DD'),
    fundAccountId: '',
    paymentMethod: 'bank_transfer',
    remark: ''
  })
  const sourceItems: ArtDescriptionItem<ReceivableDocument>[] = [
    { key: 'documentNo', label: '来源应收', field: 'documentNo' },
    { key: 'customerName', label: '结算客户', field: 'customerName' },
    { key: 'currencyCode', label: '币种', field: 'currencyCode' },
    {
      key: 'availableAmount',
      label: '未占用贷方余额',
      field: 'availableAmount',
      formatter: (value, row) => formatSensitiveCurrencyValue(value, row.currencyCode)
    }
  ]
  const items = computed<FormItem[]>(() => [
    {
      key: 'amount',
      label: '本次申请金额',
      type: 'number',
      props: { min: 0, precision: 2, max: source.value?.availableAmount ?? 0 }
    },
    { key: 'businessDate', label: '付款日期', type: 'date', props: { valueFormat: 'YYYY-MM-DD' } },
    {
      key: 'fundAccountId',
      label: '付款账户',
      type: 'select',
      span: 24,
      api: async () =>
        (await fetchArOptions('fund', source.value?.tenantId)).filter(
          (row) => row.currencyCode === source.value?.currencyCode
        ),
      labelField: 'name',
      valueField: 'id',
      props: { filterable: true }
    },
    { key: 'paymentMethod', label: '结算方式', type: 'select', props: { options: methods } },
    {
      key: 'remark',
      label: '付款事由',
      type: 'textarea',
      span: 24,
      props: { rows: 3, maxlength: 2000 }
    }
  ])
  const rules = {
    amount: [{ required: true, type: 'number' as const, min: 0.01, message: '付款金额须大于零' }],
    businessDate: [{ required: true, message: '请选择付款日期' }],
    paymentMethod: [{ required: true, message: '请选择结算方式' }],
    fundAccountId: [{ required: true, message: '请选择付款账户' }],
    remark: [{ required: true, message: '请填写付款事由' }]
  }
  async function open(row: ReceivableDocument): Promise<void> {
    if (!row.isCredit || row.status !== 'approved') {
      ElMessage.warning('仅已审核贷方应收可直接申请付款；正向应收请先完成退款审核')
      return
    }
    if (!(row.availableAmount && row.availableAmount > 0)) {
      ElMessage.warning('该贷方应收已无可付余额或金额不可见')
      return
    }
    source.value = row
    form.value = {
      requestId: crypto.randomUUID(),
      amount: row.availableAmount,
      businessDate: dayjs().format('YYYY-MM-DD'),
      fundAccountId: '',
      paymentMethod: 'bank_transfer',
      remark: ''
    }
    await dialog.value?.handleOpen(undefined, {
      onConfirm: async () => {
        if (!(await validateArtFormForSubmit(formRef.value))) return false
        try {
          const id = await createArCreditPaymentRequest(row.id, form.value)
          ElMessage.success('付款申请已生成，提交审核后可确认付款')
          emit('success', id)
          return true
        } catch (error) {
          notifyFriendlyError(error, '付款申请未生成，请检查贷方可付余额和账户后重试')
          return false
        }
      }
    })
  }
  defineExpose({ open })
</script>
