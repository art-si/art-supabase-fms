<template>
  <ArtDialog
    :loading="candidatesLoading"
    ref="dialogRef"
    size="md"
    :confirm-disabled="candidatesLoading || candidateLoadFailed || !ledgerOptions.length"
  >
    <template #subtitle> 同账户、同方向的资金流水可按剩余金额分摊匹配。 </template>
    <ArtDescriptions
      v-if="line"
      :data="line"
      :items="lineDescriptionItems"
      :columns="1"
      :border="true"
      label-width="108px"
      class="mb-4"
    />
    <ElAlert v-if="candidateLoadFailed" type="error" :closable="false" show-icon class="mb-4">
      <template #title>匹配候选加载失败，请重试。</template>
      <ElButton plain type="primary" :loading="candidatesLoading" @click="loadCandidates">
        重新加载候选
      </ElButton>
    </ElAlert>
    <ArtAsyncState loading-text="正在加载匹配候选…">
      <ArtEmptyState
        v-if="!candidatesLoading && !candidateLoadFailed && !ledgerOptions.length"
        title="暂无可匹配资金流水"
        description="请先核对同账户、同方向的资金流水是否已登记，且仍有未匹配金额。"
        size="compact"
        :visual-size="64"
      >
        <ElButton type="primary" plain @click="loadCandidates">刷新候选</ElButton>
      </ArtEmptyState>
      <ArtForm
        v-if="ledgerOptions.length || candidateLoadFailed"
        ref="formRef"
        v-model="form.data"
        :items="formItems"
        :rules="form.rules"
        :span="24"
        label-width="108px"
      />
    </ArtAsyncState>
  </ArtDialog>
</template>

<script setup lang="ts">
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtEmptyState from '@/components/core/feedback/art-empty-state/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import { fetchBankMatchCandidates, matchBankStatementLine } from '@fms/api'
  import { formatCurrencyValue } from '@/utils/ui'

  defineOptions({ name: 'FinanceBankLineMatchDialog' })

  interface FormData {
    ledgerEntryId: string
    amount: number
    remark: string
  }

  const emit = defineEmits<{ success: [] }>()
  const dialogRef = ref<ArtDialogExpose>()
  const formRef = ref<{ validate: () => Promise<boolean>; clearValidate: () => void }>()
  const line = shallowRef<Api.Fms.BankStatementLineRecord>()
  const lineDescriptionItems: ArtDescriptionItem<Api.Fms.BankStatementLineRecord>[] = [
    { key: 'transactionDate', field: 'transactionDate', label: '交易日期', format: 'date' },
    { key: 'counterpartyName', field: 'counterpartyName', label: '对方名称' },
    { key: 'amount', field: 'amount', label: '流水金额', format: 'money' },
    {
      key: 'remainingAmount',
      field: 'remainingAmount',
      label: '待匹配金额',
      format: 'money'
    }
  ]
  const ledgerOptions = ref<Array<{ label: string; value: string; amount: number }>>([])
  const candidatesLoading = ref(false)
  const candidateLoadFailed = ref(false)
  let candidateRequestId = 0
  watch(
    () => candidatesLoading.value || candidateLoadFailed.value || !ledgerOptions.value.length,
    (confirmDisabled) => dialogRef.value?.setOptions({ confirmDisabled })
  )
  const form = reactive<{ data: FormData; rules: FormRules<FormData> }>({
    data: { ledgerEntryId: '', amount: 0, remark: '' },
    rules: {
      ledgerEntryId: [{ required: true, message: '请选择资金流水', trigger: 'change' }],
      amount: [
        { required: true, message: '请输入匹配金额', trigger: 'change' },
        {
          validator: (_rule, value, callback) =>
            Number(value) > 0 && Number(value) <= getRemainingAmount()
              ? callback()
              : callback(new Error('匹配金额必须大于 0 且不超过银行流水剩余金额')),
          trigger: 'change'
        }
      ]
    }
  })

  const formItems = computed<FormItem[]>(() => [
    {
      label: '资金流水',
      key: 'ledgerEntryId',
      type: 'select',
      props: {
        options: ledgerOptions.value,
        loading: candidatesLoading.value,
        disabled: candidatesLoading.value || candidateLoadFailed.value,
        noDataText: '暂无同账户、同方向的可匹配资金流水',
        filterable: true,
        placeholder: '选择同账户、同方向的资金流水'
      }
    },
    {
      label: '匹配金额',
      key: 'amount',
      type: 'number',
      props: {
        min: 0.01,
        max: getRemainingAmount(),
        precision: 2,
        controlsPosition: 'right',
        class: '!w-full'
      }
    },
    {
      label: '匹配说明',
      key: 'remark',
      type: 'input',
      props: { type: 'textarea', rows: 3, maxlength: 300, showWordLimit: true }
    }
  ])

  async function handleSubmit(): Promise<boolean> {
    try {
      if (candidatesLoading.value || candidateLoadFailed.value) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (!line.value) return false
      await matchBankStatementLine(
        line.value.id,
        form.data.ledgerEntryId,
        form.data.amount,
        normalizeNullableText(form.data.remark)
      )
      emit('success')
      return true
    } catch (error) {
      notifyFriendlyError(error, '银行流水匹配失败，请稍后重试')
      return false
    }
  }

  async function handleOpen(row: Api.Fms.BankStatementLineRecord): Promise<void> {
    ++candidateRequestId
    candidateLoadFailed.value = false
    line.value = row
    Object.assign(form.data, {
      ledgerEntryId: '',
      amount: Number(row.remainingAmount ?? 0),
      remark: ''
    })
    ledgerOptions.value = []
    await dialogRef.value?.handleOpen(undefined, {
      title: `手工匹配 · 第 ${row.lineNo} 行`,
      confirmText: '确认匹配',
      loading: true,
      loadingText: '正在加载匹配候选…',
      onConfirm: handleSubmit,
      onOpen: async (_openData, api) => {
        formRef.value?.clearValidate()
        try {
          await loadCandidates()
        } finally {
          api.setLoading(false)
        }
      },
      dialogProps: { closeOnClickModal: false }
    })
  }

  async function loadCandidates(): Promise<void> {
    const currentLineId = line.value?.id
    const requestId = ++candidateRequestId
    candidateLoadFailed.value = false
    ledgerOptions.value = []
    form.data.ledgerEntryId = ''
    if (!currentLineId) return
    candidatesLoading.value = true
    try {
      const { data, error } = await fetchBankMatchCandidates(currentLineId)
      if (requestId !== candidateRequestId || line.value?.id !== currentLineId) return
      if (error) {
        candidateLoadFailed.value = true
        return
      }
      ledgerOptions.value = (data ?? []).map((item) => ({
        label: `${item.entryDate} · ${item.summary} · ${formatCurrencyValue(item.amount)}${item.sourceNo ? ` · ${item.sourceNo}` : ''}`,
        value: item.id,
        amount: Number(item.amount ?? 0)
      }))
    } catch {
      if (requestId === candidateRequestId) candidateLoadFailed.value = true
    } finally {
      if (requestId === candidateRequestId) candidatesLoading.value = false
    }
  }

  function getRemainingAmount(): number {
    const value = Number(line.value?.remainingAmount ?? 0)
    return Number.isFinite(value) ? value : 0
  }

  defineExpose({ handleOpen })
</script>
