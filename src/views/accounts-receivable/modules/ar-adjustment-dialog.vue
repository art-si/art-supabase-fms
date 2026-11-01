<template>
  <ArtDialog ref="dialogRef" title="应收调整" size="md" confirm-text="保存调整草稿">
    <ArtForm
      ref="formRef"
      v-model="form"
      :items="items"
      :rules="rules"
      label-position="top"
      :span="12"
    />
  </ArtDialog>
</template>
<script setup lang="ts">
  import { ref, computed } from 'vue'
  import dayjs from 'dayjs'
  import { ElMessage } from 'element-plus'
  import { saveArAdjustment, type ReceivableDocument } from '@/api/receivables'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  defineOptions({ name: 'ArAdjustmentDialog' })
  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const document = ref<ReceivableDocument>()
  const form = ref({
    requestId: crypto.randomUUID(),
    financialLineId: '',
    kind: 'decrease',
    amount: 0,
    businessDate: dayjs().format('YYYY-MM-DD'),
    reason: ''
  })
  const kindOptions = useDictionaryOptions('arAdjustmentKind')
  const items = computed<FormItem[]>(() => [
    {
      key: 'financialLineId',
      label: '应收明细',
      type: 'select',
      span: 24,
      props: {
        options: (document.value?.lines || []).map((row) => ({
          label: `${row.lineNo} · ${row.materialDescription}`,
          value: row.id
        }))
      }
    },
    { key: 'kind', label: '调整类型', type: 'select', props: { options: kindOptions } },
    { key: 'amount', label: '调整金额', type: 'number', props: { min: 0, precision: 2 } },
    { key: 'businessDate', label: '业务日期', type: 'date', props: { valueFormat: 'YYYY-MM-DD' } },
    {
      key: 'reason',
      label: '调整原因',
      type: 'textarea',
      span: 24,
      props: { maxlength: 2000, rows: 3 }
    }
  ])
  const rules = {
    financialLineId: [{ required: true, message: '请选择应收明细' }],
    amount: [{ required: true, type: 'number' as const, min: 0.01, message: '调整金额须大于零' }],
    businessDate: [{ required: true, message: '请选择业务日期' }],
    reason: [{ required: true, message: '请填写调整原因' }]
  }
  async function open(row: ReceivableDocument): Promise<void> {
    document.value = row
    form.value = {
      requestId: crypto.randomUUID(),
      financialLineId: row.lines?.[0]?.id || '',
      kind: 'decrease',
      amount: 0,
      businessDate: dayjs().format('YYYY-MM-DD'),
      reason: ''
    }
    await dialogRef.value?.handleOpen(undefined, {
      onConfirm: async () => {
        if (!(await validateArtFormForSubmit(formRef.value))) return false
        try {
          await saveArAdjustment(form.value)
          ElMessage.success('应收调整草稿已保存，请在调整记录中提交审核')
          emit('success')
          return true
        } catch (error) {
          notifyFriendlyError(error, '应收调整未保存，请重试')
          return false
        }
      }
    })
  }
  defineExpose({ open })
</script>
