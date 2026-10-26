<template>
  <ArtPermissionGuard
    permission="FinanceReceivablePaymentRequest:View"
    resource-name="应收付款申请"
  >
    <div class="business-workspace-page art-full-height min-w-0">
      <BusinessWorkspaceHeader
        title="应收付款申请"
        description="仅以已审核退款或贷方余额申请付款；贷方申请保存即占用额度，审核后确认付款才核销并登记资金。"
        icon="ri:bank-card-line"
        density="compact"
      >
        <template #actions><BusinessTableWorkspaceActions :table="table" /></template>
      </BusinessWorkspaceHeader>
      <ArtTableQuery
        :table-props="{
          emptyText: '暂无应收付款申请',
          emptyDescription: '可从已审核退款或未占用的贷方应收余额生成申请。'
        }"
        ref="table"
        :model-value="search"
        @update:model-value="replaceReactiveModel(search, $event)"
        :api-fn="rows"
        :search-items="searchItems"
        :columns-factory="columns"
        :header-actions="actions"
        header-actions-placement="workspace"
        focusable
      />
      <ArtDialog ref="detailDialog" title="应收付款申请详情" size="lg" :show-footer="false"
        ><ArtDescriptions v-if="detail" :data="detail" :items="detailItems" /><RouterLink
          v-if="
            detail?.refundId &&
            hasAuth('FinanceReceiptRefund:View') &&
            router.hasRoute('FinanceReceiptRefund')
          "
          :to="{ path: financePaths.receiptRefund, query: { recordId: detail.refundId } }"
          class="art-icon-label mt-4 text-sm text-primary"
          >前往原退款单确认实际付款<ArtSvgIcon icon="ri:arrow-right-line" /></RouterLink
      ></ArtDialog>
      <ArtTableSingleSelect
        ref="picker"
        :show-trigger="false"
        :api-fn="creditOptions"
        :columns="creditColumns"
        row-key="id"
        label-key="documentNo"
        title="选择已审核贷方应收"
        @confirm="(_key, selected) => creditDialog?.open(selected[0])"
      />
      <ArCreditPaymentDialog ref="creditDialog" @success="() => table?.refreshData()" />
      <MasterDataDeleteGuard ref="deleteGuard" />
      <ArPrintSheet ref="printSheet" />
    </div>
  </ArtPermissionGuard>
</template>
<script setup lang="tsx">
  import { replaceReactiveModel } from '@/utils/form/model'
  import { createArDeleteMetadata } from '../modules/ar-delete-metadata'
  import { useRouteDocumentDrawer } from '@/hooks/core/useRouteDocumentDrawer'
  import { ref, reactive, computed } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import {
    fetchArWorkspace,
    fetchArDeleteDependencies,
    actArPaymentRequest,
    deleteArRecords,
    type ArQuery,
    type ArPaymentRequest,
    type ReceivableDocument
  } from '@/api/receivables'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useArtFeedback, notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { formatSensitiveCurrencyValue as money } from '@/utils/ui/format'
  import { financePaths } from '@/router/business-paths'
  import ArtTableQuery, {
    type ArtTableQueryHeaderAction,
    type ArtTableQueryHeaderActionContext
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtTableSingleSelect from '@/components/core/forms/art-data-select/table-single.vue'
  import type {
    ArtDataSelectExpose,
    DataSelectColumn,
    DataSelectFetchParams
  } from '@/components/core/forms/art-data-select/types'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import ArCreditPaymentDialog from '../modules/ar-credit-payment-dialog.vue'
  import ArPrintSheet, { type ArPrintRecord } from '../modules/ar-print-sheet.vue'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type { ColumnOption } from '@/types'
  defineOptions({ name: 'FinanceReceivablePaymentRequest' })
  const table = ref<InstanceType<typeof ArtTableQuery>>()
  const picker = ref<ArtDataSelectExpose>()
  const creditDialog = ref<InstanceType<typeof ArCreditPaymentDialog>>()
  const detailDialog = ref<ArtDialogExpose>()
  const deleteGuard = ref<InstanceType<typeof MasterDataDeleteGuard>>()
  const printSheet = ref<InstanceType<typeof ArPrintSheet>>()
  const detail = ref<ArPaymentRequest>()
  const busy = ref(false)
  const route = useRoute()
  const router = useRouter()
  const { hasAuth } = useAuth()
  const captureActionOperation = useTenantOperationGuard('FinanceReceivablePaymentRequest:View')
  const { confirmAction, confirmDelete } = useArtFeedback()
  const search = reactive({ keyword: '', status: '', businessDateRange: [] })
  const statuses = useDictionaryOptions('arDocumentStatus')
  const searchItems = computed<SearchFormItem[]>(() => [
    {
      key: 'keyword',
      label: '组合查询',
      type: 'input',
      props: { placeholder: '申请单号、客户', clearable: true }
    },
    { key: 'status', label: '状态', type: 'select', props: { options: statuses, clearable: true } },
    {
      key: 'businessDateRange',
      label: '业务日期',
      type: 'daterange',
      props: { valueFormat: 'YYYY-MM-DD' }
    }
  ])
  async function rows(query: ArQuery) {
    return fetchArWorkspace('payment_request', {
      ...query,
      tenantId: useTenantScopeStore().effectiveTenantId,
      id: typeof route.query.recordId === 'string' ? route.query.recordId : undefined
    })
  }
  const ids = (ctx: ArtTableQueryHeaderActionContext) =>
    ctx.selectedRows.map((row) => String(row.id))
  const actions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      type: 'add',
      permission: 'FinanceReceivablePaymentRequest:Add',
      disabled: busy.value,
      onClick: () => picker.value?.open()
    },
    {
      key: 'submit',
      label: '提交',
      permission: 'FinanceReceivablePaymentRequest:Submit',
      selectionRequired: true,
      disabled: (ctx) => busy.value || ctx.selectedRows.some((row) => row.status !== 'draft'),
      onClick: (ctx) => act(ids(ctx), 'submit')
    },
    {
      key: 'approve',
      label: '审核',
      permission: 'FinanceReceivablePaymentRequest:Approve',
      selectionRequired: true,
      disabled: (ctx) => busy.value || ctx.selectedRows.some((row) => row.status !== 'submitted'),
      onClick: (ctx) => act(ids(ctx), 'approve')
    },
    {
      key: 'pay',
      label: '确认付款',
      permission: 'FinanceReceivablePaymentRequest:Pay',
      selectionRequired: true,
      disabled: (ctx) =>
        busy.value ||
        ctx.selectedRows.some((row) => Boolean(row.refundId) || row.status !== 'approved'),
      onClick: (ctx) => act(ids(ctx), 'pay')
    },
    {
      type: 'delete',
      permission: 'FinanceReceivablePaymentRequest:Delete',
      disabled: busy.value,
      confirm: false,
      onClick: (ctx) => remove(ids(ctx))
    },
    {
      key: 'print',
      label: '打印',
      permission: 'FinanceReceivablePaymentRequest:Print',
      disabled: busy.value,
      selectionRequired: true,
      onClick: (ctx) => print(ids(ctx))
    },
    {
      type: 'export',
      permission: 'FinanceReceivablePaymentRequest:Export',
      exportFilename: '应收付款申请'
    }
  ])
  async function act(selectedIds: string[], action: 'submit' | 'approve' | 'pay'): Promise<void> {
    const requiredPermission =
      action === 'submit'
        ? 'FinanceReceivablePaymentRequest:Submit'
        : action === 'approve'
          ? 'FinanceReceivablePaymentRequest:Approve'
          : 'FinanceReceivablePaymentRequest:Pay'
    if (busy.value || !selectedIds.length || !hasAuth(requiredPermission)) return
    const currentScope = captureActionOperation()
    const isCurrent = () => currentScope() && hasAuth(requiredPermission)
    let attempted = false
    busy.value = true
    try {
      if (action === 'pay') {
        try {
          await confirmAction(
            `确认登记 ${selectedIds.length} 张已审核贷方付款申请的实际付款？`,
            '确认实际付款'
          )
        } catch (error) {
          if (error === 'cancel' || error === 'close') return
          throw error
        }
      }
      if (!isCurrent()) {
        ElMessage.warning('操作范围或权限已变化，请重新查询后操作')
        return
      }
      for (const id of selectedIds) {
        if (!isCurrent()) return
        attempted = true
        await actArPaymentRequest(id, action)
      }
      if (!isCurrent()) return
      ElMessage.success(
        action === 'pay' ? '付款已登记' : action === 'approve' ? '付款申请已审核' : '付款申请已提交'
      )
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '付款申请操作未完成，请核对状态后重试')
    } finally {
      try {
        if (attempted && isCurrent()) await table.value?.refreshData()
      } catch (error) {
        if (isCurrent()) notifyFriendlyError(error, '状态已处理，但列表未刷新，请重新查询')
      }
      busy.value = false
    }
  }
  const creditColumns: DataSelectColumn<ReceivableDocument>[] = [
    { prop: 'documentNo', label: '贷方应收单号', minWidth: 210 },
    { prop: 'customerName', label: '客户', minWidth: 180 },
    { prop: 'currencyCode', label: '币种', width: 90 },
    {
      prop: 'availableAmount',
      label: '可付余额',
      width: 150,
      align: 'right',
      formatter: (row) => money(row.availableAmount, row.currencyCode)
    }
  ]
  async function creditOptions(params: DataSelectFetchParams) {
    const result = await fetchArWorkspace('financial', {
      status: 'approved',
      isCredit: true,
      tenantId: useTenantScopeStore().effectiveTenantId,
      keyword: params.keyword,
      current: params.page,
      size: params.pageSize
    })
    return { ...result, data: result.data.filter((row) => row.isCredit) }
  }
  const columns = (): ColumnOption<ArPaymentRequest>[] => [
    { type: 'selection', width: 48 },
    { prop: 'documentNo', label: '付款申请号', minWidth: 220, fixed: 'left' },
    { prop: 'status', label: '状态', width: 120, dict: { code: 'arDocumentStatus' } },
    { prop: 'customerName', label: '结算客户', minWidth: 180 },
    { prop: 'organizationName', label: '结算组织', minWidth: 180 },
    { prop: 'businessDate', label: '付款日期', width: 125 },
    { prop: 'currencyCode', label: '币种', width: 90 },
    {
      prop: 'amount',
      label: '申请金额(原币)',
      width: 160,
      formatter: (row) => money(row.amount, row.currencyCode)
    },
    { prop: 'paymentPurpose', label: '申请依据', width: 140, dict: { code: 'arPaymentPurpose' } },
    { prop: 'sourceNo', label: '来源单号', minWidth: 210 },
    { prop: 'fundAccountName', label: '付款账户', minWidth: 180 },
    { prop: 'remark', label: '付款事由', minWidth: 220 },
    {
      prop: 'operation',
      label: '操作',
      width: 90,
      fixed: 'right',
      formatter: (row) => (
        <ArtButtonTable
          type="view"
          permission="FinanceReceivablePaymentRequest:View"
          label="查看"
          onClick={() => {
            detail.value = row
            detailDialog.value?.handleOpen()
          }}
        />
      )
    }
  ]
  const detailItems: ArtDescriptionItem<ArPaymentRequest>[] = [
    { key: 'documentNo', label: '付款申请号', field: 'documentNo' },
    { key: 'status', label: '状态', field: 'status', dictCode: 'arDocumentStatus' },
    { key: 'customerName', label: '结算客户', field: 'customerName' },
    { key: 'organizationName', label: '结算组织', field: 'organizationName' },
    { key: 'sourceNo', label: '来源单据', field: 'sourceNo' },
    {
      key: 'amount',
      label: '申请金额',
      field: 'amount',
      formatter: (value, row) => money(value, row.currencyCode)
    },
    { key: 'businessDate', label: '付款日期', field: 'businessDate' },
    { key: 'fundAccountName', label: '付款账户', field: 'fundAccountName' },
    { key: 'remark', label: '付款事由', field: 'remark', span: 3 }
  ]
  async function remove(selectedIds: string[]): Promise<void> {
    if (busy.value || !selectedIds.length) return
    const currentScope = captureActionOperation()
    const isCurrent = () => currentScope() && hasAuth('FinanceReceivablePaymentRequest:Delete')
    if (!isCurrent()) return
    const result = await fetchArWorkspace('payment_request', { ids: selectedIds, size: 500 })
    if (!isCurrent()) return
    if (result.data.length !== selectedIds.length)
      throw new Error('所选付款申请已变化，请重新查询后再删除')
    const options = {
      resourceLabel: '付款申请',
      resources: result.data.map((row) => ({ id: row.id, label: row.documentNo })),
      fetchDependencies: (values: string[]) => fetchArDeleteDependencies('payment_request', values),
      dependencyMeta: createArDeleteMetadata('payment_request', hasAuth)
    }
    if (!deleteGuard.value || (await deleteGuard.value.inspect(options))) return
    if (!isCurrent()) return
    try {
      await confirmDelete(`确认删除 ${result.data.length} 张草稿付款申请并释放其占用额度？`)
    } catch {
      return
    }
    if (!isCurrent()) {
      ElMessage.warning('操作范围或权限已变化，请重新查询后再删除')
      return
    }
    busy.value = true
    try {
      await deleteArRecords('payment_request', selectedIds)
      if (!isCurrent()) return
      ElMessage.success('草稿申请已删除，额度已释放')
    } catch (error) {
      if (!isCurrent()) return
      if (!(await deleteGuard.value?.inspect(options)) && isCurrent())
        notifyFriendlyError(error, '付款申请删除未完成，请重新检查关联记录')
    } finally {
      try {
        if (isCurrent()) await table.value?.refreshData()
      } finally {
        busy.value = false
      }
    }
  }
  async function print(selectedIds: string[]): Promise<void> {
    const result = await fetchArWorkspace('payment_request', { ids: selectedIds, size: 500 })
    if (result.data.length !== selectedIds.length)
      throw new Error('部分所选付款申请已变化或不可查看，请重新查询后再打印')
    const records: ArPrintRecord[] = result.data.map((row) => ({
      documentNo: row.documentNo,
      fields: [
        { label: '结算客户', value: row.customerName },
        { label: '结算组织', value: row.organizationName },
        { label: '付款日期', value: row.businessDate },
        { label: '付款账户', value: row.fundAccountName || '' }
      ],
      columns: [{ label: '来源单据' }, { label: '币种' }, { label: '申请金额', align: 'right' }],
      rows: [[row.sourceNo, row.currencyCode, money(row.amount, row.currencyCode)]],
      totals: [{ label: '付款金额', value: money(row.amount, row.currencyCode) }],
      remark: row.remark
    }))
    await printSheet.value?.print(records, '应收付款申请')
  }
  useRouteDocumentDrawer({
    routeName: String(route.name || ''),
    queryKey: 'recordId',
    clearQueryOnOpen: false,
    canOpen: () => hasAuth('FinanceReceivablePaymentRequest:View'),
    fetchDocument: async (id) => {
      const result = await fetchArWorkspace('payment_request', {
        id,
        size: 1
      })
      const row = result.data[0]
      if (!row) throw new Error('付款申请不存在或无权查看')
      return row
    },
    openDocument: async (row) => {
      detail.value = row
      await detailDialog.value?.handleOpen()
    },
    onOpened: async () => table.value?.refreshData(),
    onError: () => ElMessage.error('关联付款申请未加载，请刷新后重试')
  })
</script>
