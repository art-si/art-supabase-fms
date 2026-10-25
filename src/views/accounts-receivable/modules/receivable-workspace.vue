<template>
  <ArtPermissionGuard :permission="permissions.View" :resource-name="title">
    <div class="business-workspace-page art-full-height min-w-0">
      <BusinessWorkspaceHeader
        :title="title"
        :description="description"
        icon="ri:bill-line"
        density="compact"
      >
        <template #actions><BusinessTableWorkspaceActions :table="tableRef" /></template>
      </BusinessWorkspaceHeader>
      <ArtTableQuery
        ref="tableRef"
        v-model="search"
        :api-fn="fetchRows"
        :search-items="searchItems"
        :columns-factory="columnsFactory"
        :columns-context-key="search.viewMode"
        :header-actions="headerActions"
        header-actions-placement="workspace"
        focusable
        :table-props="{
          rowKey: 'recordKey',
          emptyText: '暂无应收单据',
          emptyDescription:
            kind === 'estimate'
              ? '新建暂估应收，或从已审核销售出库、已签收运输来源生成暂估。'
              : '新建财务应收，或从已审核暂估应收下推；先开票单据可后续勾稽。'
        }"
      >
        <template #ar-push="{ selectedRows }">
          <ArtButtonMore
            :list="pushItems"
            trigger="click"
            @click="(item) => command(String(item.key), String(selectedRows[0]?.id || ''))"
          >
            <template #trigger
              ><ElButton size="small" :disabled="approvedSelectionDisabled(selectedRows)" plain
                ><ArtSvgIcon icon="ri:file-transfer-line" />下推<ArtSvgIcon
                  icon="ri:arrow-down-s-line" /></ElButton
            ></template>
          </ArtButtonMore>
        </template>
        <template #ar-voucher="{ selectedRows }">
          <ArtButtonMore
            :list="voucherItems"
            trigger="click"
            @click="(item) => voucher(String(selectedRows[0]?.id || ''), item.key === 'generate')"
          >
            <template #trigger
              ><ElButton
                size="small"
                :disabled="approvedSelectionDisabled(selectedRows, true)"
                plain
                ><ArtSvgIcon icon="ri:file-list-3-line" />生成凭证<ArtSvgIcon
                  icon="ri:arrow-down-s-line" /></ElButton
            ></template>
          </ArtButtonMore>
        </template>
        <template #selection-details="{ selectedRows }">
          <div
            v-if="selectedRows.length"
            class="flex w-full flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums"
            aria-live="polite"
          >
            <span>金额 {{ selectionTotal(selectedRows, 'amount') }}</span
            ><span>税额 {{ selectionTotal(selectedRows, 'taxAmount') }}</span>
            <strong>价税合计 {{ selectionTotal(selectedRows, 'totalAmount') }}</strong>
            <template v-if="kind === 'financial'">
              <span>未核销金额 {{ selectionTotal(selectedRows, 'outstandingAmount') }}</span>
              <span>未勾稽金额 {{ selectionTotal(selectedRows, 'unmatchedAmount') }}</span>
            </template>
          </div>
        </template>
      </ArtTableQuery>
      <ReceivableDocumentDrawer
        ref="drawer"
        :kind="kind"
        :edit-permission="permissions.Edit"
        @success="tableRef?.refreshData()"
      />
      <ArSettlementDrawer ref="settlementDrawer" @success="tableRef?.refreshData()" />
      <ArCreditPaymentDialog ref="creditPaymentDialog" @success="openPaymentRequest" />
      <ArAdjustmentDialog ref="adjustmentDialog" @success="tableRef?.refreshData()" />
      <ArAdjustmentHistory ref="adjustmentHistory" />
      <ArMatchDialog ref="matchDialog" @success="tableRef?.refreshData()" />
      <MasterDataDeleteGuard ref="deleteGuard" />
      <ArPrintSheet ref="printSheet" />
      <ArtTableSingleSelect
        ref="sourcePicker"
        :show-trigger="false"
        :api-fn="sourceOptions"
        :columns="sourceColumns"
        row-key="id"
        label-key="name"
        :title="sourceKind === 'wms_source' ? '选择已审核销售出库' : '选择已签收运单'"
        @confirm="(_key, rows) => importSource(rows)"
      />
      <FinanceVoucherPreview ref="voucherDialog" :result="voucherResult" />
    </div>
  </ArtPermissionGuard>
</template>
<script setup lang="tsx">
  import { createArDeleteMetadata } from './ar-delete-metadata'
  import { useRouteDocumentDrawer } from '@/hooks/core/useRouteDocumentDrawer'
  import { useRouteOperationGuard } from '@/hooks/core/useRouteTableContext'
  import ArCreditPaymentDialog from './ar-credit-payment-dialog.vue'
  import ArPrintSheet, { type ArPrintRecord } from './ar-print-sheet.vue'
  import FinanceVoucherPreview from '@/components/business/finance-voucher-preview/index.vue'
  import type { DataSelectColumn } from '@/components/core/forms/art-data-select/types'
  import { ref, computed, reactive, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { ElMessage, ElButton } from 'element-plus'
  import { uniq, groupBy } from 'lodash-es'
  import { fetchArOrganizationTree } from '@/api/receivables'
  import {
    fetchArWorkspace,
    fetchArOptions,
    fetchArDeleteDependencies,
    actReceivableDocument,
    deleteArRecords,
    pushFinancialReceivable,
    pushArRevenueCost,
    pushArInvoice,
    createEstimatedReceivableFromSource,
    createTransportEstimatedReceivables,
    arVoucher,
    type ReceivableDocument,
    type ArQuery,
    type ArOption,
    type ArVoucherResult
  } from '@/api/receivables'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useArtFeedback, notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { formatSensitiveCurrencyValue as money } from '@/utils/ui/format'
  import { financePaths } from '@/router/business-paths'
  import ArtTableQuery, {
    type ArtTableQueryHeaderAction,
    type ArtTableQueryHeaderActionContext
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import ArtTableSingleSelect from '@/components/core/forms/art-data-select/table-single.vue'
  import type {
    ArtDataSelectExpose,
    DataSelectFetchParams
  } from '@/components/core/forms/art-data-select/types'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import ReceivableDocumentDrawer from './receivable-document-drawer.vue'
  import ArSettlementDrawer from './ar-settlement-drawer.vue'
  import ArAdjustmentDialog from './ar-adjustment-dialog.vue'
  import ArAdjustmentHistory from './ar-adjustment-history.vue'
  import ArMatchDialog from './ar-match-dialog.vue'
  import type { ColumnOption } from '@/types'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  defineOptions({ name: 'ReceivableWorkspace' })
  const props = defineProps<{ kind: 'estimate' | 'financial' }>()
  const route = useRoute()
  const router = useRouter()
  const captureRouteOperation = useRouteOperationGuard()
  const { hasAuth } = useAuth()
  const { confirmDelete } = useArtFeedback()
  const printSheet = ref<InstanceType<typeof ArPrintSheet>>()
  const tableRef = ref<InstanceType<typeof ArtTableQuery>>()
  const drawer = ref<InstanceType<typeof ReceivableDocumentDrawer>>()
  const settlementDrawer = ref<InstanceType<typeof ArSettlementDrawer>>()
  const creditPaymentDialog = ref<InstanceType<typeof ArCreditPaymentDialog>>()
  async function openPaymentRequest(id: string): Promise<void> {
    await router.push({ path: financePaths.receivablePaymentRequest, query: { recordId: id } })
  }
  const adjustmentDialog = ref<InstanceType<typeof ArAdjustmentDialog>>()
  const adjustmentHistory = ref<InstanceType<typeof ArAdjustmentHistory>>()
  const matchDialog = ref<InstanceType<typeof ArMatchDialog>>()
  const deleteGuard = ref<InstanceType<typeof MasterDataDeleteGuard>>()
  const sourcePicker = ref<ArtDataSelectExpose>()
  const sourceKind = ref('wms_source')
  const voucherDialog = ref<InstanceType<typeof FinanceVoucherPreview>>()
  const voucherResult = ref<ArVoucherResult>()
  const busy = ref(false)
  const permissionCatalog = {
    estimate: {
      View: 'FinanceEstimatedReceivable:View',
      Add: 'FinanceEstimatedReceivable:Add',
      Edit: 'FinanceEstimatedReceivable:Edit',
      Copy: 'FinanceEstimatedReceivable:Copy',
      Submit: 'FinanceEstimatedReceivable:Submit',
      Approve: 'FinanceEstimatedReceivable:Approve',
      Delete: 'FinanceEstimatedReceivable:Delete',
      Push: 'FinanceEstimatedReceivable:Push',
      VoucherPreview: 'FinanceEstimatedReceivable:VoucherPreview',
      VoucherGenerate: 'FinanceEstimatedReceivable:VoucherGenerate',
      Print: 'FinanceEstimatedReceivable:Print',
      Export: 'FinanceEstimatedReceivable:Export'
    },
    financial: {
      View: 'FinanceFinancialReceivable:View',
      Add: 'FinanceFinancialReceivable:Add',
      Edit: 'FinanceFinancialReceivable:Edit',
      Copy: 'FinanceFinancialReceivable:Copy',
      Submit: 'FinanceFinancialReceivable:Submit',
      Approve: 'FinanceFinancialReceivable:Approve',
      Delete: 'FinanceFinancialReceivable:Delete',
      Push: 'FinanceFinancialReceivable:Push',
      VoucherPreview: 'FinanceFinancialReceivable:VoucherPreview',
      VoucherGenerate: 'FinanceFinancialReceivable:VoucherGenerate',
      Print: 'FinanceFinancialReceivable:Print',
      Export: 'FinanceFinancialReceivable:Export'
    }
  }
  const permissions = computed(() => permissionCatalog[props.kind])
  const captureDocumentOperation = useTenantOperationGuard(permissions.value.View)
  const title = computed(() => (props.kind === 'estimate' ? '暂估应收单' : '财务应收单'))
  const description = computed(() =>
    props.kind === 'estimate'
      ? '统一销售出库与运输履约暂估，跟踪关联金额、开票冲回和收入成本确认。'
      : hasAuth('FinanceFinancialReceivable:Writeoff') && !canOpenWriteoff()
        ? '应收核销另需收款核销工作台查看及核销权限，请联系管理员授权。'
        : '审核确认财务应收，按明细控制收款占用、核销、开票与退款。'
  )
  const search = reactive({
    keyword: '',
    status: '',
    organizationId: '',
    documentTypeId: '',
    projectId: '',
    businessDateRange: [],
    viewMode: 'document',
    accountingStatus: '',
    voucherGenerated: ''
  })
  const statusOptions = useDictionaryOptions('arDocumentStatus')
  const viewOptions = useDictionaryOptions('arViewMode')
  const accountingOptions = useDictionaryOptions('arPartialStatus')
  const booleanOptions = useDictionaryOptions('commonBoolean')
  const searchItems = computed<SearchFormItem[]>(() => [
    {
      key: 'viewMode',
      label: '展示方式',
      type: 'radioGroup',
      span: 12,
      props: { options: viewOptions, optionType: 'button' }
    },
    {
      key: 'keyword',
      label: '组合查询',
      type: 'input',
      props: { placeholder: '单据编号、客户、来源单号', clearable: true }
    },
    {
      key: 'organizationId',
      label: '结算组织',
      type: 'treeSelect',
      api: () => fetchArOrganizationTree('organization'),
      labelField: 'name',
      valueField: 'id',
      childrenField: 'children',
      props: { clearable: true, filterable: true, checkStrictly: true }
    },
    {
      key: 'documentTypeId',
      label: '单据类型',
      type: 'select',
      api: () => fetchArOptions(`${props.kind}_type`),
      labelField: 'name',
      valueField: 'id',
      props: { clearable: true }
    },
    {
      key: 'status',
      label: '单据状态',
      type: 'select',
      props: {
        options: statusOptions.filter((item) =>
          ['draft', 'submitted', 'approved'].includes(item.value)
        ),
        clearable: true
      }
    },
    {
      key: 'projectId',
      label: '项目名称',
      type: 'select',
      api: () => fetchArOptions('project'),
      labelField: 'name',
      valueField: 'id',
      props: { clearable: true, filterable: true }
    },
    {
      key: 'businessDateRange',
      label: '业务日期',
      type: 'daterange',
      props: { valueFormat: 'YYYY-MM-DD' }
    },
    ...(props.kind === 'financial'
      ? [
          {
            key: 'accountingStatus',
            label: '核算状态',
            type: 'select' as const,
            props: { options: accountingOptions, clearable: true }
          }
        ]
      : []),
    {
      key: 'voucherGenerated',
      label: '已生成凭证',
      type: 'select',
      props: { options: booleanOptions, clearable: true }
    }
  ])
  async function fetchRows(query: ArQuery) {
    const result = await fetchArWorkspace(props.kind, {
      ...query,
      tenantId: useTenantScopeStore().effectiveTenantId,
      id: typeof route.query.recordId === 'string' ? route.query.recordId : undefined
    })
    return {
      ...result,
      data: result.data.map((row) => ({ ...row, recordKey: row.recordKey || row.id }))
    }
  }
  async function getDocument(id: string): Promise<ReceivableDocument> {
    const result = await fetchArWorkspace(props.kind, { id, size: 1 })
    const row = result.data[0]
    if (!row) throw new Error('单据不存在或无权查看')
    return row
  }
  function ids(ctx: ArtTableQueryHeaderActionContext): string[] {
    return uniq(ctx.selectedRows.map((row) => String(row.id)))
  }
  function approvedSelectionDisabled(
    rows: Record<string, unknown>[],
    allowReversal = false
  ): boolean {
    return (
      busy.value ||
      rows.length !== 1 ||
      rows[0]?.status !== 'approved' ||
      (!allowReversal && rows[0]?.kind === 'reversal')
    )
  }
  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      type: 'add',
      permission: permissions.value.Add,
      onClick: () => drawer.value?.open(undefined, true)
    },
    ...(props.kind === 'estimate'
      ? [
          {
            key: 'wms-import',
            label: '销售出库暂估',
            permission: permissions.value.Add,
            icon: 'ri:logout-box-r-line',
            onClick: () => {
              sourceKind.value = 'wms_source'
              sourcePicker.value?.open()
            }
          },
          {
            key: 'tms-import',
            label: '运输服务暂估',
            permission: permissions.value.Add,
            icon: 'ri:truck-line',
            onClick: () => {
              sourceKind.value = 'tms_source'
              sourcePicker.value?.open()
            }
          }
        ]
      : []),
    {
      key: 'copy',
      label: '复制',
      permission: permissions.value.Copy,
      selectionRequired: true,
      disabled: (ctx) =>
        busy.value || ctx.selectedRows.length !== 1 || !hasAuth(permissions.value.Add),
      onClick: (ctx) => drawer.value?.open(ids(ctx)[0], true, true)
    },
    {
      key: 'submit',
      label: '提交',
      permission: permissions.value.Submit,
      selectionRequired: true,
      disabled: (ctx) =>
        busy.value ||
        ctx.selectedRows.some((row) => row.status !== 'draft' || row.kind === 'reversal'),
      onClick: (ctx) => act(ids(ctx), 'submit')
    },
    {
      key: 'approve',
      label: '审核',
      permission: permissions.value.Approve,
      selectionRequired: true,
      disabled: (ctx) =>
        busy.value ||
        ctx.selectedRows.some((row) => row.status !== 'submitted' || row.kind === 'reversal'),
      onClick: (ctx) => act(ids(ctx), 'approve')
    },
    {
      type: 'delete',
      permission: permissions.value.Delete,
      confirm: false,
      disabled: (ctx) =>
        busy.value ||
        ctx.selectedRows.some((row) => row.status !== 'draft' || row.kind === 'reversal'),
      onClick: (ctx) => remove(ids(ctx))
    },
    {
      key: 'push',
      label: '下推',
      slot: 'ar-push',
      permission: permissions.value.Push,
      selectionRequired: true
    },
    ...(props.kind === 'financial'
      ? [
          {
            key: 'writeoff',
            label: '应收核销',
            permission: 'FinanceFinancialReceivable:Writeoff',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              busy.value ||
              ctx.selectedRows.length !== 1 ||
              !canOpenWriteoff() ||
              !canWriteoffDocument(ctx.selectedRows[0]),
            onClick: async (ctx: ArtTableQueryHeaderActionContext) => openWriteoff(ids(ctx)[0])
          },
          {
            key: 'adjust',
            label: '应收调整',
            permission: 'FinanceFinancialReceivable:Adjust',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              approvedSelectionDisabled(ctx.selectedRows),
            onClick: async (ctx: ArtTableQueryHeaderActionContext) =>
              adjustmentDialog.value?.open(await getDocument(ids(ctx)[0]))
          },
          {
            key: 'writeoff-history',
            label: '核销记录',
            permission: 'FinanceReceiptWriteoff:View',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) => ctx.selectedRows.length !== 1,
            onClick: async (ctx: ArtTableQueryHeaderActionContext) => {
              await router.push({
                path: financePaths.receiptWriteoff,
                query: { sourceDocumentId: ids(ctx)[0] }
              })
            }
          },
          {
            key: 'adjustment-history',
            label: '调整记录',
            permission: 'FinanceFinancialReceivable:View',
            onClick: () => adjustmentHistory.value?.open()
          },
          {
            key: 'match',
            label: '先开票勾稽',
            permission: 'FinanceFinancialReceivable:Match',
            selectionRequired: true,
            disabled: (ctx: ArtTableQueryHeaderActionContext) =>
              approvedSelectionDisabled(ctx.selectedRows) ||
              !!ctx.selectedRows[0]?.isCredit ||
              !!ctx.selectedRows[0]?.estimateId,
            onClick: async (ctx: ArtTableQueryHeaderActionContext) =>
              matchDialog.value?.open(await getDocument(ids(ctx)[0]))
          }
        ]
      : []),
    {
      key: 'voucher',
      label: '生成凭证',
      slot: 'ar-voucher',
      permission: hasAuth(permissions.value.VoucherGenerate)
        ? permissions.value.VoucherGenerate
        : permissions.value.VoucherPreview,
      selectionRequired: true
    },
    {
      key: 'print',
      label: '打印',
      permission: permissions.value.Print,
      selectionRequired: true,
      onClick: (ctx) => print(ids(ctx))
    },
    { type: 'export', permission: permissions.value.Export, exportFilename: title.value }
  ])
  const pushItems = computed<ButtonMoreItem[]>(() =>
    props.kind === 'estimate'
      ? [
          { key: 'financial', label: '财务应收', auth: 'FinanceEstimatedReceivable:Push' },
          { key: 'revenue', label: '收入成本确认', auth: 'FinanceRevenueCost:Add' }
        ]
      : [
          { key: 'receipt', label: '收款', auth: 'FinanceReceipt:Add' },
          { key: 'special', label: '专用发票', auth: 'FinanceFinancialReceivable:Push' },
          { key: 'ordinary', label: '普通发票', auth: 'FinanceFinancialReceivable:Push' },
          { key: 'refund', label: '收款退款', auth: 'FinanceReceiptRefund:Add' },
          {
            key: 'request',
            label: '付款申请（贷方余额）',
            auth: 'FinanceReceivablePaymentRequest:Add'
          }
        ]
  )
  const voucherItems = computed<ButtonMoreItem[]>(() => [
    { key: 'preview', label: '预览凭证', auth: permissions.value.VoucherPreview },
    { key: 'generate', label: '生成凭证', auth: permissions.value.VoucherGenerate }
  ])
  async function act(selectedIds: string[], action: 'submit' | 'approve'): Promise<void> {
    if (busy.value || !selectedIds.length) return
    busy.value = true
    try {
      for (const id of selectedIds) await actReceivableDocument(id, action)
      ElMessage.success(action === 'submit' ? '单据已提交' : '单据已审核')
    } catch (error) {
      notifyFriendlyError(error, '操作未完成，请刷新后核对单据状态')
    } finally {
      try {
        await tableRef.value?.refreshData()
      } catch (error) {
        notifyFriendlyError(error, '单据已处理，但列表未刷新，请重新查询')
      }
      busy.value = false
    }
  }
  const dependencies = createArDeleteMetadata(props.kind, hasAuth)
  async function remove(selectedIds: string[]): Promise<void> {
    if (busy.value || !selectedIds.length) return
    const rows = await Promise.all(selectedIds.map(getDocument))
    const options = {
      resourceLabel: title.value,
      resources: rows.map((row) => ({ id: row.id, label: row.documentNo })),
      fetchDependencies: (values: string[]) => fetchArDeleteDependencies(props.kind, values),
      dependencyMeta: dependencies
    }
    if (!deleteGuard.value || (await deleteGuard.value.inspect(options))) return
    try {
      await confirmDelete(`确认删除所选 ${rows.length} 张草稿单据？`)
    } catch {
      return
    }
    busy.value = true
    try {
      await deleteArRecords(props.kind, selectedIds)
      ElMessage.success('草稿单据已删除')
      await tableRef.value?.refreshRemove()
    } catch (error) {
      if (!(await deleteGuard.value?.inspect(options)))
        notifyFriendlyError(error, '删除未完成，请重新检查关联记录')
    } finally {
      busy.value = false
    }
  }
  async function command(action: string, id: string): Promise<void> {
    if (busy.value || !id) return
    busy.value = true
    const isCurrentRoute = captureRouteOperation()
    try {
      if (action === 'financial') {
        const newId = await pushFinancialReceivable(id)
        ElMessage.success('财务应收草稿已生成')
        if (!isCurrentRoute()) return
        await router.push({ path: financePaths.financialReceivable, query: { recordId: newId } })
      } else if (action === 'revenue') {
        const newId = await pushArRevenueCost(id)
        ElMessage.success('收入成本确认单已就绪')
        if (!isCurrentRoute()) return
        await router.push({ path: financePaths.revenueCost, query: { recordId: newId } })
      } else if (action === 'receipt')
        await settlementDrawer.value?.openReceipt(await getDocument(id))
      else if (action === 'refund') await settlementDrawer.value?.openRefundForFinancial(id)
      else if (action === 'request') await creditPaymentDialog.value?.open(await getDocument(id))
      else if (action === 'ordinary' || action === 'special') {
        await pushArInvoice(id, action)
        ElMessage.success('发票草稿已生成，请到发票管理提交审核')
        await tableRef.value?.refreshData()
      }
    } catch (error) {
      notifyFriendlyError(error, '下推未完成，请核对单据状态和权限')
    } finally {
      busy.value = false
    }
  }
  function canOpenWriteoff(): boolean {
    return (
      hasAuth('FinanceFinancialReceivable:Writeoff') &&
      hasAuth('FinanceReceiptWriteoff:View') &&
      hasAuth('FinanceReceiptWriteoff:Writeoff')
    )
  }
  function canWriteoffDocument(
    row:
      | {
          kind?: unknown
          status?: unknown
          availableAmount?: unknown
          settlementOrganizationId?: unknown
          customerId?: unknown
        }
      | undefined
  ): boolean {
    return (
      row?.kind === 'financial' &&
      row.status === 'approved' &&
      typeof row.availableAmount === 'number' &&
      Number.isFinite(row.availableAmount) &&
      row.availableAmount !== 0 &&
      typeof row.settlementOrganizationId === 'string' &&
      !!row.settlementOrganizationId &&
      typeof row.customerId === 'string' &&
      !!row.customerId
    )
  }
  async function openWriteoff(id: string): Promise<void> {
    if (!id || busy.value || !canOpenWriteoff()) return
    const scopeCurrent = captureDocumentOperation()
    const isCurrent = () => scopeCurrent() && props.kind === 'financial' && canOpenWriteoff()
    if (!isCurrent()) return
    busy.value = true
    try {
      const row = await getDocument(id)
      if (!isCurrent()) return
      if (!canWriteoffDocument(row)) {
        ElMessage.warning('单据状态或可核销余额已变化，请重新查询后操作')
        return
      }
      await router.push({
        path: financePaths.receiptWriteoff,
        query: { organizationId: row.settlementOrganizationId, customerId: row.customerId }
      })
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '核销工作台未打开，请刷新单据后重试')
    } finally {
      busy.value = false
    }
  }
  async function voucher(id: string, generate: boolean): Promise<void> {
    const kind = props.kind
    const requiredPermission = generate
      ? permissions.value.VoucherGenerate
      : permissions.value.VoucherPreview
    const scopeCurrent = captureDocumentOperation()
    const isCurrent = () => scopeCurrent() && props.kind === kind && hasAuth(requiredPermission)
    if (!id || busy.value || !isCurrent()) return
    busy.value = true
    try {
      const row = await getDocument(id)
      if (!isCurrent()) {
        if (scopeCurrent()) ElMessage.warning('操作范围或权限已变化，请重新选择单据')
        return
      }
      if (
        row.status !== 'approved' ||
        (row.kind !== kind && !(kind === 'estimate' && row.kind === 'reversal'))
      ) {
        ElMessage.warning('单据状态已变化，请重新查询后重试')
        return
      }
      const result = await arVoucher(row.kind, id, generate)
      if (!isCurrent()) return
      voucherResult.value = result
      if (generate) {
        ElMessage.success(result.message)
        try {
          await tableRef.value?.refreshData()
        } catch (error) {
          if (isCurrent()) notifyFriendlyError(error, '凭证已生成，但列表未刷新，请重新查询')
        }
      } else await voucherDialog.value?.handleOpen()
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '凭证操作未完成，请重试')
    } finally {
      busy.value = false
    }
  }
  const sourceColumns: DataSelectColumn<ArOption>[] = [
    { prop: 'code', label: '来源单号', minWidth: 200 },
    { prop: 'description', label: '客户', minWidth: 200 }
  ]
  async function sourceOptions(params: DataSelectFetchParams) {
    return fetchArOptions(sourceKind.value, useTenantScopeStore().effectiveTenantId, params.keyword)
  }
  async function importSource(rows: ArOption[]): Promise<void> {
    const row = rows[0]
    if (!row) return
    busy.value = true
    try {
      const ids =
        sourceKind.value === 'wms_source'
          ? [await createEstimatedReceivableFromSource('wms_sales_outbound', row.id)]
          : await createTransportEstimatedReceivables(row.id)
      await tableRef.value?.refreshData()
      ElMessage.success(`已按客户生成 ${ids.length} 张暂估应收草稿`)
      if (ids.length === 1) await drawer.value?.open(ids[0], true)
    } catch (error) {
      notifyFriendlyError(error, '来源暂估未生成，请重试')
    } finally {
      busy.value = false
    }
  }
  function selectionTotal(rows: Record<string, unknown>[], key: string): string {
    return Object.entries(groupBy(rows, (row) => String(row.currencyCode || 'CNY')))
      .map(([currency, records]) => {
        let total = 0
        for (const row of records) {
          const value = row[key]
          if (value === null || value === undefined) return `${currency} —`
          total += Number(value) * (row.kind === 'reversal' || row.isCredit ? -1 : 1)
        }
        return money(total, currency)
      })
      .join(' / ')
  }
  const moneyColumn = (
    prop: keyof ReceivableDocument,
    label: string
  ): ColumnOption<ReceivableDocument> => ({
    prop,
    label,
    width: 165,
    align: 'right',
    formatter: (row) => {
      const value = row[prop]
      return value === null || value === undefined
        ? '—'
        : money(
            Number(value) === 0
              ? 0
              : Number(value) * (row.kind === 'reversal' || row.isCredit ? -1 : 1),
            row.currencyCode
          )
    }
  })
  async function viewDocument(row: ReceivableDocument): Promise<void> {
    await drawer.value?.open(row.id)
  }
  const columnsFactory = (): ColumnOption<ReceivableDocument>[] => [
    { type: 'selection', width: 48 },
    {
      prop: 'documentNo',
      label: '单据编号',
      minWidth: 210,
      fixed: 'left',
      link: { permission: permissions.value.View, onClick: viewDocument }
    },
    ...(search.viewMode === 'line'
      ? [
          {
            prop: 'lineNo',
            label: '行号',
            width: 80,
            formatter: (row: ReceivableDocument) => row.lines?.[0]?.lineNo || '—'
          },
          {
            prop: 'materialDescription',
            label: '物料 / 服务',
            minWidth: 200,
            showOverflowTooltip: true,
            formatter: (row: ReceivableDocument) => row.lines?.[0]?.materialDescription || '—'
          }
        ]
      : []),
    { prop: 'customerName', label: '往来单位 / 结算客户', minWidth: 200 },
    { prop: 'status', label: '单据状态', width: 115, dict: { code: 'arDocumentStatus' } },
    { prop: 'documentTypeName', label: '单据类型', minWidth: 160 },
    { prop: 'projectName', label: '项目名称', minWidth: 170 },
    { prop: 'businessDate', label: '业务日期', width: 125 },
    { prop: 'accountingDate', label: '记账日期', width: 125 },
    { prop: 'currencyCode', label: '币种', width: 100 },
    { prop: 'organizationName', label: '结算组织', minWidth: 160 },
    moneyColumn('amount', '金额(元)'),
    moneyColumn('taxAmount', '税额(元)'),
    moneyColumn('totalAmount', '价税合计(元)'),
    ...(props.kind === 'estimate'
      ? [
          moneyColumn('unreversedAmount', '未冲回价税合计(元)'),
          moneyColumn('linkedFinancialAmount', '已关联财务应收(元)'),
          moneyColumn('unlinkedFinancialAmount', '未关联财务应收(元)')
        ]
      : [
          moneyColumn('outstandingAmount', '未核销金额(元)'),
          moneyColumn('reservedAmount', '收款锁定金额(元)'),
          moneyColumn('availableAmount', '允许收款金额(元)'),
          moneyColumn('unlinkedInvoiceAmount', '未关联销售发票价税合计(元)'),
          moneyColumn('unmatchedAmount', '未勾稽金额(元)'),
          moneyColumn('invoicedAmount', '已开票金额(元)'),
          moneyColumn('uninvoicedAmount', '未开票金额(元)'),
          {
            prop: 'accountingStatus',
            label: '核销状态',
            width: 115,
            dict: { code: 'arPartialStatus' }
          }
        ]),
    {
      prop: 'isReversal',
      label: '冲回单',
      width: 90,
      formatter: (row) => (row.kind === 'reversal' ? '是' : '否')
    },
    { prop: 'paymentTermName', label: '收款条件', minWidth: 140 },
    {
      prop: 'settlementMethod',
      label: '结算方式',
      width: 115,
      dict: { code: 'arSettlementMethod' }
    },
    { prop: 'voucherNo', label: '凭证号', minWidth: 150 },
    {
      prop: 'voucherGenerated',
      label: '已生成凭证',
      width: 115,
      formatter: (row) => (row.voucherId ? '是' : '否')
    },
    {
      prop: 'isInitialization',
      label: '是否初始化',
      width: 110,
      formatter: (row) => (row.isInitialization ? '是' : '否')
    },
    { prop: 'createdBy', label: '创建人', minWidth: 130 },
    { prop: 'requestDepartmentName', label: '申请部门', minWidth: 160 },
    { prop: 'sourceType', label: '源单类型', minWidth: 150, dict: { code: 'arSourceType' } },
    { prop: 'sourceNo', label: '来源单据号', minWidth: 200 },
    ...(search.viewMode === 'line'
      ? [
          {
            prop: 'sourceLineNo',
            label: '源行号',
            width: 110,
            formatter: (row: ReceivableDocument) => row.lines?.[0]?.sourceLineNo || '—'
          }
        ]
      : []),
    { prop: 'remark', label: '备注', minWidth: 200 },
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
            onClick={() => viewDocument(row)}
          />
          {row.status === 'draft' && row.kind !== 'reversal' && (
            <ArtButtonTable
              type="edit"
              permission={permissions.value.Edit}
              label="编辑"
              onClick={() => drawer.value?.open(row.id, true)}
            />
          )}
        </BusinessTableRowActions>
      )
    }
  ]
  async function print(selectedIds: string[]): Promise<void> {
    const rows = await Promise.all(selectedIds.map(getDocument))
    const records: ArPrintRecord[] = rows.map((row) => ({
      title:
        row.kind === 'reversal' ? '暂估应收冲回单' : row.isCredit ? '贷方财务应收单' : title.value,
      documentNo: row.documentNo,
      fields: [
        {
          label: '借贷方向',
          value: row.kind === 'reversal' ? '冲回原暂估' : row.isCredit ? '贷方' : '借方'
        },
        { label: '客户', value: row.customerName || '' },
        { label: '结算组织', value: row.organizationName || '' },
        { label: '业务日期', value: row.businessDate },
        { label: '记账日期', value: row.accountingDate },
        { label: '来源单据', value: row.sourceNo || '手工录入' },
        { label: '币种', value: row.currencyCode }
      ],
      columns: [
        { label: '行号' },
        { label: '物料 / 服务' },
        { label: '数量', align: 'right' },
        { label: '金额', align: 'right' },
        { label: '税额', align: 'right' },
        { label: '价税合计', align: 'right' }
      ],
      rows: (row.lines || []).map((line) => [
        String(line.lineNo),
        line.materialDescription,
        String(line.quantity),
        money(line.amount, row.currencyCode),
        money(line.taxAmount, row.currencyCode),
        money(line.totalAmount, row.currencyCode)
      ]),
      totals: [
        { label: '金额', value: money(row.amount, row.currencyCode) },
        { label: '税额', value: money(row.taxAmount, row.currencyCode) },
        { label: '价税合计', value: money(row.totalAmount, row.currencyCode) }
      ],
      remark: row.remark,
      createdBy: row.createdBy
    }))
    await printSheet.value?.print(records, title.value)
  }
  watch(
    () => useTenantScopeStore().effectiveTenantId,
    () => tableRef.value?.refreshData()
  )
  const linkedRouteName = String(route.name || '')
  useRouteDocumentDrawer({
    routeName: linkedRouteName,
    queryKey: 'recordId',
    canOpen: () => hasAuth(permissions.value.View),
    fetchDocument: getDocument,
    openDocument: async (row) => drawer.value?.open(row.id),
    onOpened: async () => tableRef.value?.refreshData(),
    onError: () => ElMessage.error('关联应收资料未加载，请刷新后重试')
  })
  useRouteDocumentDrawer({
    routeName: linkedRouteName,
    queryKey: 'adjustmentId',
    canOpen: () => props.kind === 'financial' && hasAuth(permissions.value.View),
    fetchDocument: async (id) => id,
    openDocument: async (id) => adjustmentHistory.value?.open(id),
    onOpened: async () => tableRef.value?.refreshData(),
    onError: () => ElMessage.error('关联调整记录未加载，请刷新后重试')
  })
</script>
