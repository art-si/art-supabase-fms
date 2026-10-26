<template>
  <ArtPermissionGuard :permission="permissions.View" :resource-name="title">
    <div class="business-workspace-page art-full-height min-w-0">
      <BusinessWorkspaceHeader
        :title="title"
        :description="description"
        icon="ri:wallet-3-line"
        density="compact"
      >
        <template #actions><BusinessTableWorkspaceActions :table="tableRef" /></template>
      </BusinessWorkspaceHeader>
      <ArtTableQuery
        ref="tableRef"
        :model-value="search"
        @update:model-value="replaceReactiveModel(search, $event)"
        :api-fn="fetchRows"
        :columns-factory="columnsFactory"
        :search-items="searchItems"
        :header-actions="headerActions"
        header-actions-placement="workspace"
        focusable
        :table-props="{
          rowKey: 'id',
          emptyText: `暂无${title}`,
          emptyDescription: '新建草稿，或从上游已审核单据关联生成。'
        }"
      />
      <ArSettlementDrawer ref="settlementDrawer" @success="tableRef?.refreshData()" />
      <MasterDataDeleteGuard ref="deleteGuard" />
      <ArPrintSheet ref="printSheet" />
      <ArtTableSingleSelect
        ref="picker"
        :show-trigger="false"
        :api-fn="pickerOptions"
        :columns="pickerColumns"
        row-key="id"
        label-key="name"
        :title="kind === 'receipt' ? '选择待入账收款交易' : '选择已审核暂估应收'"
        @confirm="(_key, rows) => selectSource(rows)"
      />
      <ArtDialog ref="detailDialog" title="收入成本确认详情" size="xl" :show-footer="false">
        <ArtDescriptions v-if="detail" :data="detail" :items="detailItems" />
        <ArtTable
          class="mt-5"
          :data="detail?.lines || []"
          :columns="costColumns"
          :pagination="false"
        />
      </ArtDialog>
      <FinanceVoucherPreview ref="voucherDialog" :result="voucherResult" />
    </div>
  </ArtPermissionGuard>
</template>
<script setup lang="tsx">
  import { replaceReactiveModel } from '@/utils/form/model'
  import { createArDeleteMetadata } from './ar-delete-metadata'
  import { getRevenueCostDisplayState, canCreateReceiptRefund } from './receivable-model'
  import { useRouteDocumentDrawer } from '@/hooks/core/useRouteDocumentDrawer'
  import ArPrintSheet, { type ArPrintRecord } from './ar-print-sheet.vue'
  import FinanceVoucherPreview from '@/components/business/finance-voucher-preview/index.vue'
  import type { DataSelectColumn } from '@/components/core/forms/art-data-select/types'
  import { ref, reactive, computed, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { ElMessage } from 'element-plus'
  import { uniq } from 'lodash-es'
  import {
    fetchArWorkspace,
    fetchArOptions,
    fetchArDeleteDependencies,
    actArDocument,
    deleteArRecords,
    createArRefundPaymentRequest,
    pushArRevenueCost,
    arVoucher,
    type ArQuery,
    type ReceiptDocument,
    type RevenueCostDocument,
    type RevenueCostLine,
    type ArOption,
    type ArVoucherResult
  } from '@/api/receivables'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { useAuth } from '@/hooks/core/useAuth'
  import { cancelSupplierReceipt } from '@/api/receivables'
  import { useRouteOperationGuard } from '@/hooks/core/useRouteTableContext'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useArtFeedback, notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { formatSensitiveCurrencyValue as money } from '@/utils/ui/format'
  import { financePaths } from '@/router/business-paths'
  import ArtTableQuery, {
    type ArtTableQueryHeaderAction,
    type ArtTableQueryHeaderActionContext
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtTableSingleSelect from '@/components/core/forms/art-data-select/table-single.vue'
  import type {
    ArtDataSelectExpose,
    DataSelectFetchParams
  } from '@/components/core/forms/art-data-select/types'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import ArSettlementDrawer from './ar-settlement-drawer.vue'
  import type { ColumnOption } from '@/types'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  defineOptions({ name: 'ArSecondaryWorkspace' })
  const props = defineProps<{ kind: 'receipt' | 'refund' | 'revenue' }>()
  interface ListRow {
    id: string
    tenantId: string
    documentNo: string
    businessDate: string
    status: string
    customerName?: string
    organizationName?: string
    sourceNo?: string
    amount: number | null
    currencyCode?: string
    costAmount?: number | null
    availableAmount?: number | null
    remark?: string
    paymentRequestId?: string
    paymentRequestStatus?: string
    receipt?: ReceiptDocument
    revenue?: RevenueCostDocument
  }
  const route = useRoute()
  const router = useRouter()
  const { hasAuth } = useAuth()
  const captureRouteOperation = useRouteOperationGuard()
  const captureRefundOperation = useTenantOperationGuard('FinanceReceiptRefund:Add')
  const { confirmAction, confirmDelete, promptReason } = useArtFeedback()
  const printSheet = ref<InstanceType<typeof ArPrintSheet>>()
  const tableRef = ref<InstanceType<typeof ArtTableQuery>>()
  const settlementDrawer = ref<InstanceType<typeof ArSettlementDrawer>>()
  const deleteGuard = ref<InstanceType<typeof MasterDataDeleteGuard>>()
  const picker = ref<ArtDataSelectExpose>()
  let revenueCreateContext: { isCurrent: () => boolean } | undefined
  const detailDialog = ref<ArtDialogExpose>()
  const detail = ref<RevenueCostDocument>()
  const voucherDialog = ref<InstanceType<typeof FinanceVoucherPreview>>()
  const voucherResult = ref<ArVoucherResult>()
  const busy = ref(false)
  const search = reactive({ keyword: '', status: '', businessDateRange: [] })
  const catalog = {
    receipt: {
      View: 'FinanceReceipt:View',
      Add: 'FinanceReceipt:Add',
      Edit: 'FinanceReceipt:Edit',
      Submit: 'FinanceReceipt:Submit',
      Approve: 'FinanceReceipt:Approve',
      Final: 'FinanceReceipt:Confirm',
      Delete: 'FinanceReceipt:Delete',
      Print: 'FinanceReceipt:Print',
      Export: 'FinanceReceipt:Export'
    },
    refund: {
      View: 'FinanceReceiptRefund:View',
      Add: 'FinanceReceiptRefund:Add',
      Edit: 'FinanceReceiptRefund:Add',
      Submit: 'FinanceReceiptRefund:Submit',
      Approve: 'FinanceReceiptRefund:Approve',
      Final: 'FinanceReceiptRefund:Pay',
      Delete: 'FinanceReceiptRefund:Delete',
      Print: 'FinanceReceiptRefund:Print',
      Export: 'FinanceReceiptRefund:Export'
    },
    revenue: {
      View: 'FinanceRevenueCost:View',
      Add: 'FinanceRevenueCost:Add',
      Edit: 'FinanceRevenueCost:Add',
      Submit: 'FinanceRevenueCost:Submit',
      Approve: 'FinanceRevenueCost:Approve',
      Final: 'FinanceRevenueCost:RefreshCost',
      Delete: 'FinanceRevenueCost:Delete',
      Print: 'FinanceRevenueCost:Print',
      Export: 'FinanceRevenueCost:Export'
    }
  }
  const permissions = computed(() => catalog[props.kind])
  const captureActionOperation = useTenantOperationGuard(permissions.value.View)
  const title = computed(
    () => ({ receipt: '收款单', refund: '收款退款单', revenue: '收入成本确认' })[props.kind]
  )
  const description = computed(
    () =>
      ({
        receipt: '草稿保存锁定应收额度，确认收款登记资金并生成核销记录，独立收款可后续匹配。',
        refund: '按已确认收款控制可退余额，退款与付款申请各自审批，确认付款后登记反向资金流水。',
        revenue:
          hasAuth('FinanceRevenueCost:Add') && !canCreateRevenue()
            ? '新增需具备暂估应收查看及下推权限，请联系管理员授权；缺少成本时不能审核。'
            : '从已审核暂估下推，独立审核收入和库存/运输实际成本；缺少成本时不能审核。'
      })[props.kind]
  )
  const statusOptions = useDictionaryOptions('arDocumentStatus')
  const searchItems = computed<SearchFormItem[]>(() => [
    {
      key: 'keyword',
      label: '组合查询',
      type: 'input',
      props: { placeholder: '单号、客户、来源单号', clearable: true }
    },
    {
      key: 'status',
      label: '单据状态',
      type: 'select',
      props: { options: statusOptions, clearable: true }
    },
    {
      key: 'businessDateRange',
      label: '业务日期',
      type: 'daterange',
      props: { valueFormat: 'YYYY-MM-DD' }
    }
  ])
  async function fetchRows(query: ArQuery): Promise<{ data: ListRow[]; total: number }> {
    const q = {
      ...query,
      tenantId: useTenantScopeStore().effectiveTenantId,
      id: typeof route.query.recordId === 'string' ? route.query.recordId : undefined
    }
    if (props.kind === 'revenue') {
      const result = await fetchArWorkspace('revenue', q)
      return {
        ...result,
        data: result.data.map((row) => ({ ...row, amount: row.revenueAmount, revenue: row }))
      }
    }
    const result = await fetchArWorkspace(props.kind, q)
    return {
      ...result,
      data: result.data.map((row) => ({
        ...row,
        customerName: row.partyName || row.supplierName || row.customerName || undefined,
        receipt: row
      }))
    }
  }
  async function getRows(ids: string[]): Promise<ListRow[]> {
    const result = await fetchRows({ ids, size: 500 })
    return result.data.filter((row) => ids.includes(row.id))
  }
  const selectedIds = (ctx: ArtTableQueryHeaderActionContext) =>
    uniq(ctx.selectedRows.map((row) => String(row.id)))
  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      type: 'add',
      permission: permissions.value.Add,
      disabled: props.kind === 'revenue' && (busy.value || !canCreateRevenue()),
      onClick: async () => {
        if (props.kind === 'receipt') await settlementDrawer.value?.openReceipt()
        else if (props.kind === 'refund') await settlementDrawer.value?.openRefund()
        else openRevenueSource()
      }
    },
    ...(props.kind === 'receipt'
      ? [
          {
            key: 'cash-import',
            label: '入账交易生成',
            permission: 'FinanceReceipt:Add',
            icon: 'ri:bank-line',
            onClick: () => picker.value?.open()
          }
        ]
      : []),
    {
      key: 'submit',
      label: '提交',
      permission: permissions.value.Submit,
      selectionRequired: true,
      disabled: (ctx) => busy.value || ctx.selectedRows.some((row) => row.status !== 'draft'),
      onClick: (ctx) => act(selectedIds(ctx), 'submit')
    },
    {
      key: 'approve',
      label: '审核',
      permission: permissions.value.Approve,
      selectionRequired: true,
      disabled: (ctx) => busy.value || ctx.selectedRows.some((row) => row.status !== 'submitted'),
      onClick: (ctx) => act(selectedIds(ctx), 'approve')
    },
    ...(props.kind !== 'revenue'
      ? [
          {
            key: 'writeoff-history',
            label: '核销记录',
            permission: 'FinanceReceiptWriteoff:View',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) => ctx.selectedRows.length !== 1,
            onClick: async (ctx: ArtTableQueryHeaderActionContext) => {
              await router.push({
                path: financePaths.receiptWriteoff,
                query: { sourceDocumentId: selectedIds(ctx)[0] }
              })
            }
          }
        ]
      : []),
    {
      key: 'final',
      label:
        props.kind === 'revenue'
          ? '刷新实际成本'
          : props.kind === 'refund'
            ? '确认付款'
            : '确认收款',
      permission: permissions.value.Final,
      selectionRequired: true,
      disabled: (ctx) =>
        busy.value ||
        ctx.selectedRows.some((row) =>
          props.kind === 'revenue' ? row.status === 'approved' : row.status !== 'approved'
        ),
      onClick: (ctx) =>
        act(
          selectedIds(ctx),
          props.kind === 'revenue' ? 'refresh' : props.kind === 'refund' ? 'pay' : 'confirm'
        )
    },
    {
      type: 'delete',
      permission: permissions.value.Delete,
      confirm: false,
      onClick: (ctx) => remove(selectedIds(ctx))
    },
    ...(props.kind === 'receipt'
      ? [
          {
            key: 'refund',
            label: '收款退款',
            permission: 'FinanceReceiptRefund:Add',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              busy.value ||
              ctx.selectedRows.length !== 1 ||
              !canCreateReceiptRefund(ctx.selectedRows[0]),
            onClick: (ctx: ArtTableQueryHeaderActionContext) => openReceiptRefund(selectedIds(ctx))
          }
        ]
      : []),
    ...(props.kind === 'refund'
      ? [
          {
            key: 'request',
            label: '生成付款申请',
            permission: 'FinanceReceiptRefund:PaymentRequest',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              busy.value ||
              ctx.selectedRows.length !== 1 ||
              ctx.selectedRows[0]?.status !== 'approved',
            onClick: (ctx: ArtTableQueryHeaderActionContext) => request(selectedIds(ctx))
          }
        ]
      : []),
    ...(props.kind === 'receipt'
      ? [
          {
            key: 'supplier-cancel',
            label: '取消收款',
            permission: 'FinanceReceipt:Cancel',
            selectionRequired: true,
            hidden: (ctx: ArtTableQueryHeaderActionContext) =>
              ctx.selectedRows.length !== 1 || !ctx.selectedRows[0].supplierId,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              busy.value || ctx.selectedRows[0]?.status !== 'confirmed',
            onClick: (ctx: ArtTableQueryHeaderActionContext) => cancelReceipt(selectedIds(ctx)[0])
          },
          ...[false, true].map((generate) => ({
            key: generate ? 'supplier-voucher-generate' : 'supplier-voucher-preview',
            label: generate ? '生成凭证' : '预览凭证',
            permission: generate
              ? 'FinanceReceipt:VoucherGenerate'
              : 'FinanceReceipt:VoucherPreview',
            selectionRequired: true,
            hidden: (ctx: ArtTableQueryHeaderActionContext) =>
              ctx.selectedRows.length !== 1 || !ctx.selectedRows[0].supplierId,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              busy.value || ctx.selectedRows[0]?.status !== 'confirmed',
            onClick: (ctx: ArtTableQueryHeaderActionContext) =>
              voucher(selectedIds(ctx)[0], generate)
          }))
        ]
      : []),
    ...(props.kind === 'revenue'
      ? [
          {
            key: 'voucher-preview',
            label: '预览凭证',
            permission: 'FinanceRevenueCost:VoucherPreview',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              busy.value ||
              ctx.selectedRows.length !== 1 ||
              ctx.selectedRows[0]?.status !== 'approved',
            onClick: (ctx: ArtTableQueryHeaderActionContext) => voucher(selectedIds(ctx)[0], false)
          },
          {
            key: 'voucher-generate',
            label: '生成凭证',
            permission: 'FinanceRevenueCost:VoucherGenerate',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              busy.value ||
              ctx.selectedRows.length !== 1 ||
              ctx.selectedRows[0]?.status !== 'approved',
            onClick: (ctx: ArtTableQueryHeaderActionContext) => voucher(selectedIds(ctx)[0], true)
          }
        ]
      : []),
    {
      key: 'print',
      label: '打印',
      permission: permissions.value.Print,
      selectionRequired: true,
      onClick: (ctx) => print(selectedIds(ctx))
    },
    { type: 'export', permission: permissions.value.Export, exportFilename: title.value }
  ])
  async function run(
    action: () => Promise<void>,
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      await action()
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '操作未完成，请核对状态和关联记录后重试')
    } finally {
      try {
        if (isCurrent()) await tableRef.value?.refreshData()
      } catch (error) {
        if (isCurrent()) notifyFriendlyError(error, '单据已处理，但列表未刷新，请重新查询')
      }
      busy.value = false
    }
  }
  async function act(ids: string[], action: string): Promise<void> {
    const requiredPermission =
      action === 'submit'
        ? permissions.value.Submit
        : action === 'approve'
          ? permissions.value.Approve
          : permissions.value.Final
    if (busy.value || !ids.length || !hasAuth(requiredPermission)) return
    const currentScope = captureActionOperation()
    const isCurrent = () => currentScope() && hasAuth(requiredPermission)
    const kind = props.kind
    let attempted = false
    busy.value = true
    try {
      if (action === 'confirm' || action === 'pay') {
        await confirmAction(
          `即将${action === 'pay' ? '确认付款' : '确认收款'}，共 ${ids.length} 张单据，并登记实际资金流水。`,
          '确认资金发生'
        )
      }
      if (!isCurrent()) {
        ElMessage.warning('操作范围或权限已变化，请重新查询后操作')
        return
      }
      for (const id of ids) {
        if (!isCurrent()) return
        attempted = true
        await actArDocument(kind, id, action)
      }
      if (isCurrent()) ElMessage.success('操作已完成')
    } catch (error) {
      if (error !== 'cancel' && error !== 'close' && isCurrent())
        notifyFriendlyError(error, '操作未完成，请核对状态和关联记录后重试')
    } finally {
      try {
        if (attempted && isCurrent()) await tableRef.value?.refreshData()
      } catch (error) {
        if (isCurrent()) notifyFriendlyError(error, '单据已处理，但列表未刷新，请重新查询')
      }
      busy.value = false
    }
  }
  async function request(ids: string[]): Promise<void> {
    if (busy.value || ids.length !== 1 || !hasAuth('FinanceReceiptRefund:PaymentRequest')) return
    const isCurrentRoute = captureRouteOperation()
    await run(async () => {
      const id = await createArRefundPaymentRequest(ids[0])
      ElMessage.success('付款申请已生成')
      if (!isCurrentRoute()) return
      await router.push({ path: financePaths.receivablePaymentRequest, query: { recordId: id } })
    })
  }
  async function openReceiptRefund(ids: string[]): Promise<void> {
    if (busy.value || ids.length !== 1 || !hasAuth('FinanceReceiptRefund:Add')) return
    const isCurrent = captureRefundOperation()
    busy.value = true
    try {
      const row = (await getRows(ids))[0]
      if (!isCurrent()) return
      if (!row?.receipt || !canCreateReceiptRefund(row.receipt)) {
        ElMessage.warning('收款状态或可退余额已变化，请重新查询后操作')
        return
      }
      await settlementDrawer.value?.openRefund(row.receipt)
    } catch (cause) {
      if (isCurrent()) notifyFriendlyError(cause, '原收款单未加载，请重新查询后重试')
    } finally {
      busy.value = false
    }
  }
  async function remove(ids: string[]): Promise<void> {
    if (busy.value || !ids.length) return
    const currentScope = captureActionOperation()
    const isCurrent = () => currentScope() && hasAuth(permissions.value.Delete)
    if (!isCurrent()) return
    const rows = await getRows(ids)
    if (!isCurrent()) return
    if (rows.length !== ids.length) throw new Error('所选单据已变化，请重新查询后再删除')
    const options = {
      resourceLabel: title.value,
      resources: rows.map((row) => ({ id: row.id, label: row.documentNo })),
      fetchDependencies: (values: string[]) => fetchArDeleteDependencies(props.kind, values),
      dependencyMeta: createArDeleteMetadata(props.kind, hasAuth)
    }
    if (!deleteGuard.value || (await deleteGuard.value.inspect(options))) return
    if (!isCurrent()) return
    try {
      await confirmDelete(`确认删除 ${rows.length} 张草稿？`)
    } catch {
      return
    }
    if (!isCurrent()) {
      ElMessage.warning('操作范围或权限已变化，请重新查询后再删除')
      return
    }
    await run(async () => {
      try {
        await deleteArRecords(props.kind, ids)
      } catch (error) {
        if (!isCurrent()) return
        if (await deleteGuard.value?.inspect(options)) return
        if (!isCurrent()) return
        throw error
      }
      if (!isCurrent()) return
      ElMessage.success('草稿已删除')
    }, isCurrent)
  }
  const pickerColumns: DataSelectColumn<ArOption>[] = [
    { prop: 'code', label: '来源单号', minWidth: 200 },
    { prop: 'name', label: '名称', minWidth: 200 }
  ]
  function canCreateRevenue(): boolean {
    return (
      hasAuth('FinanceRevenueCost:Add') &&
      hasAuth('FinanceEstimatedReceivable:View') &&
      hasAuth('FinanceEstimatedReceivable:Push')
    )
  }
  function openRevenueSource(): void {
    if (busy.value || props.kind !== 'revenue' || !canCreateRevenue()) return
    const scopeCurrent = captureActionOperation()
    if (!scopeCurrent()) return
    revenueCreateContext = {
      isCurrent: () => scopeCurrent() && props.kind === 'revenue' && canCreateRevenue()
    }
    void picker.value?.open()
  }
  async function pickerOptions(params: DataSelectFetchParams): Promise<ArOption[]> {
    if (props.kind === 'receipt')
      return fetchArOptions('cash', useTenantScopeStore().effectiveTenantId, params.keyword)
    if (!revenueCreateContext?.isCurrent()) return []
    const result = await fetchArWorkspace('estimate', {
      status: 'approved',
      documentKind: 'estimate',
      keyword: params.keyword,
      size: 500,
      tenantId: useTenantScopeStore().effectiveTenantId
    })
    return result.data.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      code: row.documentNo,
      name: row.customerName || row.documentNo
    }))
  }
  async function selectSource(rows: ArOption[]): Promise<void> {
    const row = rows[0]
    if (!row) return
    if (props.kind === 'receipt') await settlementDrawer.value?.openReceipt(undefined, row)
    else {
      const context = revenueCreateContext
      revenueCreateContext = undefined
      if (!context?.isCurrent()) {
        ElMessage.warning('操作范围或权限已变化，请重新选择暂估应收')
        return
      }
      await run(async () => {
        if (!context.isCurrent()) return
        await pushArRevenueCost(row.id)
        if (context.isCurrent()) ElMessage.success('收入成本确认单已就绪')
      }, context.isCurrent)
    }
  }
  async function view(row: ListRow): Promise<void> {
    if (row.receipt)
      await settlementDrawer.value?.view(
        row.receipt,
        props.kind === 'refund' ? 'refund' : 'receipt'
      )
    else if (row.revenue) {
      detail.value = row.revenue
      await detailDialog.value?.handleOpen()
    }
  }
  const detailItems: ArtDescriptionItem<RevenueCostDocument>[] = [
    { key: 'documentNo', label: '单据编号', field: 'documentNo' },
    { key: 'sourceNo', label: '来源暂估', field: 'sourceNo' },
    { key: 'status', label: '单据状态', field: 'status', dictCode: 'arDocumentStatus' },
    { key: 'businessDate', label: '业务日期', field: 'businessDate' },
    { key: 'revenueAmount', label: '确认收入', field: 'revenueAmount', format: 'money' },
    {
      key: 'costAmount',
      label: '实际成本',
      field: 'costAmount',
      formatter: (_value, row) => actualCostText(row)
    }
  ]
  function actualCostText(row: RevenueCostDocument): string {
    const state = getRevenueCostDisplayState(row)
    return state === 'pending' ? '成本待落实' : money(state === 'hidden' ? null : row.costAmount)
  }
  function costLineText(parent: RevenueCostDocument | undefined, line: RevenueCostLine): string {
    if (parent?.costAmount == null) return money(null)
    return line.costAmount === null ? '成本待落实' : money(line.costAmount)
  }
  const costColumns: ColumnOption<RevenueCostLine>[] = [
    { prop: 'lineNo', label: '行号', width: 70 },
    { prop: 'description', label: '物料 / 服务', minWidth: 240 },
    {
      prop: 'revenueAmount',
      label: '确认收入',
      width: 160,
      formatter: (row) => (row.revenueAmount === null ? '—' : money(row.revenueAmount))
    },
    {
      prop: 'costAmount',
      label: '实际成本',
      width: 160,
      formatter: (row) => (detail.value ? costLineText(detail.value, row) : money(null))
    }
  ]
  async function voucher(id: string, generate: boolean): Promise<void> {
    const permission =
      props.kind === 'receipt'
        ? generate
          ? 'FinanceReceipt:VoucherGenerate'
          : 'FinanceReceipt:VoucherPreview'
        : generate
          ? 'FinanceRevenueCost:VoucherGenerate'
          : 'FinanceRevenueCost:VoucherPreview'
    if (!id || !hasAuth(permission)) return
    const isCurrentRoute = captureRouteOperation()
    await run(async () => {
      const result = await arVoucher(props.kind, id, generate)
      if (generate) ElMessage.success(result.message)
      if (!isCurrentRoute()) return
      voucherResult.value = result
      if (!generate) await voucherDialog.value?.handleOpen()
    })
  }
  const cancellationReasons = new Map<string, string>()
  async function cancelReceipt(id: string): Promise<void> {
    if (!id || !hasAuth('FinanceReceipt:Cancel')) return
    const isCurrentRoute = captureRouteOperation()
    await run(async () => {
      let reason: string
      try {
        reason = await promptReason(
          '取消后将冲回本次实际到账；请填写原因。',
          '取消供应商退款收款',
          { initialValue: cancellationReasons.get(id) ?? '' }
        )
      } catch {
        return
      }
      if (!isCurrentRoute()) return
      cancellationReasons.set(id, reason)
      const row = (await getRows([id]))[0]
      if (!isCurrentRoute()) return
      if (!row?.receipt?.supplierId || row.status !== 'confirmed')
        throw new Error('收款状态已变化，请刷新后重新操作')
      await cancelSupplierReceipt(id, reason)
      cancellationReasons.delete(id)
      ElMessage.success('供应商退款收款已取消')
    })
  }
  const columnsFactory = (): ColumnOption<ListRow>[] => [
    { type: 'selection', width: 48 },
    { prop: 'documentNo', label: '单据编号', minWidth: 220, fixed: 'left' },
    { prop: 'status', label: '状态', width: 120, dict: { code: 'arDocumentStatus' } },
    { prop: 'customerName', label: '往来单位', minWidth: 200 },
    { prop: 'organizationName', label: '结算组织', minWidth: 180 },
    { prop: 'businessDate', label: '业务日期', width: 125 },
    {
      prop: 'amount',
      label: props.kind === 'revenue' ? '确认收入(元)' : '金额(元)',
      width: 170,
      align: 'right',
      formatter: (row) => (row.amount === null ? '—' : money(row.amount, row.currencyCode))
    },
    ...(props.kind === 'revenue'
      ? [
          {
            prop: 'costAmount',
            label: '实际成本(元)',
            width: 170,
            formatter: (row: ListRow) => (row.revenue ? actualCostText(row.revenue) : money(null))
          }
        ]
      : []),
    ...(props.kind === 'receipt'
      ? [
          {
            prop: 'availableAmount',
            label: '已收款未核销(元)',
            width: 180,
            formatter: (row: ListRow) =>
              row.status !== 'confirmed' || row.availableAmount === null
                ? '—'
                : money(row.availableAmount ?? 0, row.currencyCode)
          }
        ]
      : []),
    ...(props.kind === 'refund'
      ? [
          {
            prop: 'paymentRequestStatus',
            label: '付款申请状态',
            width: 150,
            dict: { code: 'arDocumentStatus' }
          }
        ]
      : []),
    { prop: 'sourceNo', label: '来源单据', minWidth: 210 },
    { prop: 'remark', label: '备注', minWidth: 220 },
    {
      prop: 'operation',
      label: '操作',
      width: 145,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          <ArtButtonTable
            type="view"
            permission={permissions.value.View}
            label="查看"
            onClick={() => view(row)}
          />
          {props.kind === 'receipt' && row.status === 'draft' && row.receipt && (
            <ArtButtonTable
              type="edit"
              permission="FinanceReceipt:Edit"
              label="编辑"
              onClick={() => settlementDrawer.value?.openReceipt(undefined, undefined, row.receipt)}
            />
          )}
        </BusinessTableRowActions>
      )
    }
  ]
  async function print(ids: string[]): Promise<void> {
    const rows = await getRows(ids)
    if (rows.length !== ids.length)
      throw new Error('部分所选单据已变化或不可查看，请重新查询后再打印')
    const records: ArPrintRecord[] = rows.map((row) => ({
      documentNo: row.documentNo,
      fields: [
        { label: '客户', value: row.customerName || '' },
        { label: '结算组织', value: row.organizationName || '' },
        { label: '业务日期', value: row.businessDate },
        { label: '来源单据', value: row.sourceNo || '' }
      ],
      columns: row.revenue
        ? [
            { label: '行号' },
            { label: '物料 / 服务' },
            { label: '确认收入', align: 'right' },
            { label: '实际成本', align: 'right' }
          ]
        : [{ label: '行号' }, { label: '应收来源' }, { label: '金额', align: 'right' }],
      rows: row.revenue
        ? row.revenue.lines.map((line) => [
            String(line.lineNo),
            line.description,
            money(line.revenueAmount),
            costLineText(row.revenue, line)
          ])
        : (row.receipt?.lines || []).map((line) => [
            String(line.lineNo),
            line.sourceNo || '独立收款',
            money(line.amount, row.receipt?.currencyCode)
          ]),
      totals: [
        {
          label: row.revenue ? '确认收入' : '金额',
          value: money(row.amount, row.receipt?.currencyCode)
        },
        ...(row.revenue ? [{ label: '实际成本', value: actualCostText(row.revenue) }] : [])
      ],
      remark: row.remark
    }))
    await printSheet.value?.print(records, title.value)
  }
  watch(
    () => useTenantScopeStore().effectiveTenantId,
    () => tableRef.value?.refreshData()
  )
  useRouteDocumentDrawer({
    routeName: String(route.name || ''),
    queryKey: 'recordId',
    // ArtDialog closes when fullPath changes; keep this detail's deep link while open.
    clearQueryOnOpen: props.kind !== 'revenue',
    canOpen: () => hasAuth(permissions.value.View),
    fetchDocument: async (id) => {
      const row = (await getRows([id]))[0]
      if (!row) throw new Error('单据不存在或无权查看')
      return row
    },
    openDocument: view,
    onOpened: async () => tableRef.value?.refreshData(),
    onError: () => ElMessage.error('关联应收资料未加载，请刷新后重试')
  })
</script>
