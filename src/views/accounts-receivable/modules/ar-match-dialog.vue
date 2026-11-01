<template>
  <ArtDialog ref="dialog" title="先开票应收后续勾稽" size="xl" confirm-text="确认勾稽并冲回暂估">
    <ElAlert
      title="仅关联已审核、同客户、同币种、同组织的暂估；确认后按原暂估计价生成冲回记录。"
      type="info"
      :closable="false"
      class="mb-4"
    />
    <ArtForm v-model="selectionForm" :items="selectionItems" :span="24" label-position="top" />
    <ArtTable
      ref="lineTable"
      class="mt-4"
      :data="lines"
      :columns="lineColumns"
      :pagination="false"
      :height="350"
    />
  </ArtDialog>
</template>
<script setup lang="tsx">
  import type { DataSelectColumn } from '@/components/core/forms/art-data-select/types'
  import { ref, computed } from 'vue'
  import { ElSelect, ElOption, ElInputNumber, ElMessage } from 'element-plus'
  import {
    fetchArWorkspace,
    matchAdvanceReceivable,
    type ReceivableDocument
  } from '@/api/receivables'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import type { DataSelectFetchParams } from '@/components/core/forms/art-data-select/types'
  import type { ColumnOption } from '@/types'
  defineOptions({ name: 'ArMatchDialog' })
  const emit = defineEmits<{ success: [] }>()
  const dialog = ref<ArtDialogExpose>()
  const lineTable = ref<ArtTableExpose>()
  const document = ref<ReceivableDocument>()
  const estimate = ref<ReceivableDocument>()
  const selectionForm = ref({ estimateId: undefined as string | undefined })
  const selectionItems = computed<FormItem[]>(() => [
    {
      key: 'estimateId',
      label: '暂估应收',
      type: 'dataSelect',
      props: {
        mode: 'table',
        multiple: false,
        showSelectedPanel: false,
        showPagination: true,
        modelValue: estimate.value?.id,
        selectedData: estimate.value ? [estimate.value] : [],
        apiFn: estimates,
        columns: estimateColumns,
        rowKey: 'id',
        labelKey: 'documentNo',
        title: '选择暂估应收',
        placeholder: '选择已审核暂估应收',
        onConfirm: (_key: unknown, selected: ReceivableDocument[]) => selectEstimate(selected),
        onClear: () => selectEstimate([])
      }
    }
  ])
  interface MatchRow {
    financialLineId: string
    estimatedLineId: string
    description: string
    basis: string
    quantity: number
    amount: number
  }
  const lines = ref<MatchRow[]>([])
  const estimateColumns: DataSelectColumn<ReceivableDocument>[] = [
    { prop: 'documentNo', label: '暂估单号', minWidth: 210 },
    { prop: 'customerName', label: '客户', minWidth: 180 },
    { prop: 'businessDate', label: '业务日期', width: 125 }
  ]
  async function estimates(params: DataSelectFetchParams) {
    const result = await fetchArWorkspace('estimate', {
      status: 'approved',
      documentKind: 'estimate',
      currencyCode: document.value?.currencyCode,
      onlyUnlinked: true,
      tenantId: document.value?.tenantId,
      customerId: document.value?.customerId,
      organizationId: document.value?.settlementOrganizationId || '',
      keyword: params.keyword,
      current: params.page,
      size: params.pageSize
    })
    return result
  }
  function selectEstimate(rows: ReceivableDocument[]): void {
    if (estimate.value?.id !== rows[0]?.id)
      lines.value.forEach((line) => {
        line.estimatedLineId = ''
      })
    estimate.value = rows[0]
  }
  const lineColumns = computed<ColumnOption<MatchRow>[]>(() => [
    { prop: 'description', label: '财务应收明细', minWidth: 210 },
    {
      prop: 'estimatedLineId',
      label: '关联暂估明细',
      minWidth: 240,
      formatter: (row) => (
        <ElSelect
          v-model={row.estimatedLineId}
          clearable
          aria-label={`${row.description} 关联暂估明细`}
        >
          {(estimate.value?.lines || [])
            .filter(
              (item) =>
                item.basis === row.basis &&
                (item.basis === 'quantity'
                  ? item.quantity > (item.linkedQuantity ?? 0)
                  : (item.totalAmount ?? 0) > (item.linkedFinancialAmount ?? 0))
            )
            .map((item) => (
              <ElOption
                key={item.id}
                label={`${item.lineNo} · ${item.materialDescription}`}
                value={item.id}
              />
            ))}
        </ElSelect>
      )
    },
    {
      prop: 'quantity',
      label: '勾稽数量',
      width: 160,
      rules: {
        validator: ({ row }) =>
          !row.estimatedLineId || row.basis !== 'quantity' || row.quantity > 0,
        message: '已关联明细的勾稽数量须大于零'
      },
      formatter: (row) =>
        row.basis === 'quantity' ? (
          <ElInputNumber
            v-model={row.quantity}
            min={0}
            controls={false}
            class="w-full!"
            aria-label={`${row.description} 勾稽数量`}
          />
        ) : (
          '—'
        )
    },
    {
      prop: 'amount',
      label: '勾稽价税金额',
      width: 170,
      rules: {
        validator: ({ row }) => !row.estimatedLineId || row.basis !== 'amount' || row.amount > 0,
        message: '已关联明细的勾稽金额须大于零'
      },
      formatter: (row) =>
        row.basis === 'amount' ? (
          <ElInputNumber
            v-model={row.amount}
            aria-label={`${row.description} 勾稽价税金额`}
            min={0}
            precision={2}
            controls={false}
            class="w-full!"
          />
        ) : (
          '按原暂估数量计价'
        )
    }
  ])
  async function open(row: ReceivableDocument): Promise<void> {
    if (row.status !== 'approved' || row.estimateId || row.isCredit) {
      ElMessage.warning('请选择未关联暂估的已审核先开票应收')
      return
    }
    document.value = row
    estimate.value = undefined
    lines.value = (row.lines || [])
      .filter((item) => item.advanceInvoice)
      .map((item) => ({
        financialLineId: item.id,
        estimatedLineId: '',
        description: item.materialDescription,
        basis: item.basis,
        quantity: item.quantity,
        amount: item.totalAmount ?? 0
      }))
    if (!lines.value.length) {
      ElMessage.warning('所选应收单没有标记先开票的明细，请重新选择')
      return
    }
    await dialog.value?.handleOpen(undefined, {
      onConfirm: async () => {
        if (!estimate.value || !lines.value.some((line) => line.estimatedLineId)) {
          ElMessage.warning('请选择暂估及对应明细')
          return false
        }
        try {
          const validation = await lineTable.value?.validate()
          if (validation && !validation.valid) {
            ElMessage.warning(validation.firstError?.message || '请核对勾稽数量和金额')
            return false
          }
          await matchAdvanceReceivable(
            row.id,
            estimate.value.id,
            lines.value.filter((line) => line.estimatedLineId)
          )
          ElMessage.success('勾稽完成，已生成暂估冲回')
          emit('success')
          return true
        } catch (error) {
          notifyFriendlyError(error, '勾稽未完成，请核对可用数量和金额')
          return false
        }
      }
    })
  }
  defineExpose({ open })
</script>
