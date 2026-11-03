<template>
  <ArtDialog
    ref="dialogRef"
    size="md"
    :confirm-disabled="!formRef?.readyToSubmit || !candidateIds.length"
    @close="() => void invalidateDialogSession()"
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
    <ArtForm
      ref="formRef"
      v-model="form.data"
      :items="formItems"
      :rules="form.rules"
      :span="24"
      label-width="108px"
    />
  </ArtDialog>
</template>

<script setup lang="ts">
  import { ElMessage } from 'element-plus'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { artOverlayRequestScopeKey, useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { validateArtFormForSubmit } from '@/utils/form/validate-art-form'
  import { normalizeNullableText } from '@/utils/form/normalize'
  import type { FormRules } from 'element-plus'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
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
  const formRef = ref<InstanceType<typeof ArtForm>>()
  const line = shallowRef<Api.Fms.BankStatementLineRecord>()
  const candidateIds = shallowRef<string[]>([])
  const captureOperation = useTenantOperationGuard('FinanceBankReconciliation:Match')
  const ownerScope = inject(artOverlayRequestScopeKey, undefined)
  const {
    version: dialogSession,
    invalidate: invalidateDialogSession,
    isCurrent: isDialogSessionCurrent
  } = useArtOverlaySession(() => Boolean(unref(dialogRef.value?.visible)))
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
  let candidateCurrent: (() => boolean) | undefined
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
      immediate: false,
      params: { lineId: line.value?.id },
      beforeFetch: (params) => {
        form.data.ledgerEntryId = ''
        candidateIds.value = []
        const requestLine = line.value
        const operationCurrent = captureOperation()
        const session = dialogSession.value
        const ownerVersion = ownerScope?.version.value
        candidateCurrent = () =>
          operationCurrent() &&
          isDialogSessionCurrent(session) &&
          (!ownerScope ||
            (ownerScope.visible.value && ownerScope.version.value === ownerVersion)) &&
          line.value === requestLine &&
          line.value?.id === params?.lineId
        return params
      },
      api: async (params) => {
        const lineId = typeof params?.lineId === 'string' ? params.lineId : ''
        if (!lineId) throw new Error('银行流水已变化，请重新打开后重试')
        return fetchBankMatchCandidates(lineId, undefined, { showErrorMessage: false })
      },
      afterFetch: (result) => {
        if (
          !result ||
          typeof result !== 'object' ||
          !('data' in result) ||
          !Array.isArray(result.data)
        )
          throw new Error('匹配候选数据无效，请重新加载')
        const ids = result.data.map((candidate: unknown) => {
          if (
            !candidate ||
            typeof candidate !== 'object' ||
            !('id' in candidate) ||
            typeof candidate.id !== 'string'
          )
            throw new Error('匹配候选数据无效，请重新加载')
          return candidate.id
        })
        if (candidateCurrent?.()) candidateIds.value = ids
        return result
      },
      resultField: 'data',
      valueField: 'id',
      labelFn: (candidate) =>
        `${candidate.entryDate} · ${candidate.summary} · ${formatCurrencyValue(candidate.amount)}${candidate.sourceNo ? ` · ${candidate.sourceNo}` : ''}`,
      props: {
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
    const selectedLine = line.value
    if (!selectedLine || !formRef.value?.readyToSubmit) return false
    const submitted = {
      lineId: selectedLine.id,
      tenantId: selectedLine.tenantId,
      batchId: selectedLine.batchId,
      status: selectedLine.status,
      remainingAmount: getRemainingAmount(),
      ledgerEntryId: form.data.ledgerEntryId,
      amount: Number(form.data.amount),
      remark: normalizeNullableText(form.data.remark)
    }
    const operationCurrent = captureOperation()
    const session = dialogSession.value
    const ownerVersion = ownerScope?.version.value
    const isCurrent = () =>
      operationCurrent() &&
      isDialogSessionCurrent(session) &&
      (!ownerScope || (ownerScope.visible.value && ownerScope.version.value === ownerVersion)) &&
      line.value === selectedLine &&
      line.value.id === submitted.lineId &&
      line.value.tenantId === submitted.tenantId &&
      line.value.batchId === submitted.batchId &&
      line.value.status === submitted.status &&
      getRemainingAmount() === submitted.remainingAmount &&
      form.data.ledgerEntryId === submitted.ledgerEntryId &&
      Object.is(Number(form.data.amount), submitted.amount) &&
      normalizeNullableText(form.data.remark) === submitted.remark
    try {
      if (!isCurrent() || !['unmatched', 'partial_matched'].includes(submitted.status)) return false
      if (!(await validateArtFormForSubmit(formRef.value))) return false
      if (
        !isCurrent() ||
        !candidateIds.value.includes(submitted.ledgerEntryId) ||
        !Number.isFinite(submitted.amount) ||
        submitted.amount <= 0 ||
        submitted.amount > submitted.remainingAmount
      )
        return false
      await matchBankStatementLine(
        submitted.lineId,
        submitted.ledgerEntryId,
        submitted.amount,
        submitted.remark,
        { showMessage: false, showErrorMessage: false }
      )
      if (!isCurrent() || !candidateIds.value.includes(submitted.ledgerEntryId)) return false
      ElMessage.success('银行流水已匹配')
      emit('success')
      return true
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '银行流水匹配失败，请稍后重试')
      return false
    }
  }

  async function handleOpen(row: Api.Fms.BankStatementLineRecord): Promise<void> {
    invalidateDialogSession()
    line.value = row
    candidateIds.value = []
    Object.assign(form.data, {
      ledgerEntryId: '',
      amount: Number(row.remainingAmount ?? 0),
      remark: ''
    })
    await dialogRef.value?.handleOpen(undefined, {
      title: `手工匹配 · 第 ${row.lineNo} 行`,
      confirmText: '确认匹配',
      loading: true,
      loadingText: '正在加载匹配候选…',
      onConfirm: handleSubmit,
      onOpen: async (_openData, api) => {
        formRef.value?.clearValidate()
        try {
          await formRef.value?.reloadOptions('ledgerEntryId')
        } finally {
          api.setLoading(false)
        }
      },
      dialogProps: { closeOnClickModal: false }
    })
  }

  onDeactivated(invalidateDialogSession)

  function getRemainingAmount(): number {
    const value = Number(line.value?.remainingAmount ?? 0)
    return Number.isFinite(value) ? value : 0
  }

  defineExpose({ handleOpen })
</script>
