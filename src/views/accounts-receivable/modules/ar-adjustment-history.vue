<template>
  <ArtDialog ref="dialog" title="应收调整记录" size="xl" :show-footer="false">
    <ArtTableQuery
      ref="table"
      :api-fn="rows"
      :columns-factory="columns"
      :header-actions="actions"
      :table-props="{ height: 'clamp(320px, 60vh, 480px)' }"
    />
  </ArtDialog>
</template>
<script setup lang="tsx">
  import { ref } from 'vue'
  import { ElMessage } from 'element-plus'
  import {
    fetchArWorkspace,
    actArAdjustment,
    type ArQuery,
    type ArAdjustment
  } from '@/api/receivables'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { formatSensitiveCurrencyValue as money } from '@/utils/ui/format'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtTableQuery, {
    type ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import type { ColumnOption } from '@/types'
  defineOptions({ name: 'ArAdjustmentHistory' })
  const dialog = ref<ArtDialogExpose>()
  const table = ref<InstanceType<typeof ArtTableQuery>>()
  const recordId = ref<string>()
  const busy = ref(false)
  async function rows(query: ArQuery) {
    return fetchArWorkspace('adjustment', {
      ...query,
      id: recordId.value,
      tenantId: useTenantScopeStore().effectiveTenantId
    })
  }
  async function act(ids: string[], action: 'submit' | 'approve'): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      for (const id of ids) await actArAdjustment(id, action)
      ElMessage.success('调整状态已更新')
    } catch (error) {
      notifyFriendlyError(error, '调整操作未完成，请刷新后重试')
    } finally {
      busy.value = false
      await table.value?.refreshData()
    }
  }
  const actions: ArtTableQueryHeaderAction[] = [
    {
      key: 'submit',
      label: '提交调整',
      permission: 'FinanceFinancialReceivable:Adjust',
      selectionRequired: true,
      disabled: (ctx) => busy.value || ctx.selectedRows.some((row) => row.status !== 'draft'),
      onClick: (ctx) =>
        act(
          ctx.selectedRows.map((row) => String(row.id)),
          'submit'
        )
    },
    {
      key: 'approve',
      label: '审核调整',
      permission: 'FinanceFinancialReceivable:AdjustApprove',
      selectionRequired: true,
      disabled: (ctx) => busy.value || ctx.selectedRows.some((row) => row.status !== 'submitted'),
      onClick: (ctx) =>
        act(
          ctx.selectedRows.map((row) => String(row.id)),
          'approve'
        )
    }
  ]
  const columns = (): ColumnOption<ArAdjustment>[] => [
    { type: 'selection', width: 48 },
    { prop: 'documentNo', label: '调整单号', minWidth: 210 },
    { prop: 'sourceNo', label: '来源应收', minWidth: 210 },
    { prop: 'customerName', label: '客户', minWidth: 180 },
    { prop: 'kind', label: '调整类型', width: 130, dict: { code: 'arAdjustmentKind' } },
    { prop: 'status', label: '状态', width: 115, dict: { code: 'arDocumentStatus' } },
    { prop: 'businessDate', label: '业务日期', width: 125 },
    {
      prop: 'amount',
      label: '金额',
      width: 160,
      formatter: (row) => (row.amount === null ? '—' : money(row.amount, row.currencyCode))
    },
    { prop: 'reason', label: '原因', minWidth: 240 }
  ]
  async function open(id?: string): Promise<void> {
    recordId.value = id
    await dialog.value?.handleOpen()
    await table.value?.refreshData()
  }
  defineExpose({ open })
</script>
