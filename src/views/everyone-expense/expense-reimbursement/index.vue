<template>
  <ArtPermissionGuard permission="FinanceExpenseReimbursement:View">
    <div class="business-workspace-page art-full-height flex min-w-0 flex-col gap-4">
      <MasterDeleteProcessingNotice :table="tableRef" />
      <BusinessWorkspaceHeader
        density="compact"
        eyebrow="EXPENSE REIMBURSEMENTS"
        title="费用报销单"
        description="统一查看运单费用与员工差旅报销，按来源处理明细、审批和付款。"
        icon="ri:refund-2-line"
      >
        <template #actions><BusinessTableWorkspaceActions :table="tableRef" /></template>
      </BusinessWorkspaceHeader>
      <ArtTableQuery
        ref="tableRef"
        v-model="search"
        :search-items="searchItems"
        :api-fn="fetchTableData"
        :columns-factory="columnsFactory"
        :columns-context-key="search.displayMode"
        :header-actions="headerActions"
        header-actions-placement="workspace"
        :search-bar-props="{ span: 6, labelWidth: 86, showExpand: true }"
        :table-props="{
          rowKey: 'id',
          spanMethod: mergeDocumentCells,
          tableLayout: 'fixed',
          emptyText: '暂无费用报销单',
          emptyDescription: '可直接新增差旅报销草稿，或从已审运单费用生成报销单。'
        }"
        focusable
      />
      <TravelReimbursementDialog ref="dialogRef" @success="refreshTable" />
      <TravelReimbursementPaymentDialog ref="paymentDialogRef" @success="refreshTable" />
      <ReimbursementPrintSheet ref="printSheetRef" />
      <ExpenseDelegationDialog ref="delegationDialog" />
      <MasterDataDeleteGuard ref="deleteGuardRef" />
    </div>
  </ArtPermissionGuard>
</template>

<script setup lang="tsx">
  import type { ColumnOption } from '@/types'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtPermissionGuard from '@/components/core/feedback/art-permission-guard/index.vue'
  import ArtTableQuery from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { documentGroupSpan } from '@/utils/business/document-detail-list'
  import { formatCurrencyValue } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'
  import { financePaths, getExpenseReimbursementDetailPath } from '@/router/business-paths'
  import {
    deleteTravelReimbursements,
    prepareTravelLoanPush,
    prepareTravelApplicationReimbursement,
    fetchExpenseReimbursementDetail,
    fetchReimbursementWorkspaceList,
    fetchReimbursementWorkspaceLines,
    type ReimbursementWorkspaceLine,
    submitExpenseReimbursement,
    type ReimbursementWorkspaceSearch
  } from '@fms/api'
  import TravelReimbursementDialog from './modules/travel-reimbursement-dialog.vue'
  import TravelReimbursementPaymentDialog from './modules/travel-reimbursement-payment-dialog.vue'
  import ReimbursementPrintSheet from './modules/reimbursement-print-sheet.vue'
  import ExpenseDelegationDialog from './modules/expense-delegation-dialog.vue'
  import { useExpensePushRoute } from '../shared/use-expense-push-route'
  import {
    canDeleteExpenseDocument,
    resolveExpenseDeleteResources
  } from '../shared/expense-delete-resources'
  import { uniqBy } from 'lodash-es'

  defineOptions({ name: 'FinanceExpenseReimbursement' })

  type Reimbursement = Api.Fms.ExpenseReimbursementRecord
  type TableRecord = Reimbursement | ReimbursementWorkspaceLine
  type WorkspaceSearch = ReimbursementWorkspaceSearch & { displayMode: 'document' | 'line' }
  interface DialogExpose {
    handleOpen: (data?: {
      row?: Reimbursement
      copy?: boolean
      sourceLoan?: import('@fms/api').TravelLoan
      sourceApplication?: import('@fms/api').TravelApplication
      isCurrent?: () => boolean
    }) => Promise<void>
  }
  const router = useRouter()
  const { confirmAction } = useArtFeedback()
  const { hasAuth } = useAuth()
  const capturePrintOperation = useTenantOperationGuard('FinanceExpenseReimbursement:Print')
  const captureSubmitOperation = useTenantOperationGuard('FinanceExpenseReimbursement:Submit')
  const tableRef = ref<ArtTableQueryExpose>()
  const delegationDialog = ref<InstanceType<typeof ExpenseDelegationDialog>>()
  const dialogRef = ref<DialogExpose>()
  useExpensePushRoute({
    queryKey: 'fromLoan',
    target: 'FinanceExpenseReimbursement',
    prepare: (id) => prepareTravelLoanPush(id, 'reimbursement'),
    openDraft: async (sourceLoan, isCurrent) => {
      await dialogRef.value?.handleOpen({ sourceLoan, isCurrent })
    },
    errorMessage: '借款下推失败，请核对可用余额和目标单据权限'
  })
  useExpensePushRoute({
    queryKey: 'fromApplication',
    target: 'FinanceExpenseReimbursement',
    prepare: prepareTravelApplicationReimbursement,
    openDraft: async (sourceApplication, isCurrent) => {
      await dialogRef.value?.handleOpen({ sourceApplication, isCurrent })
    },
    errorMessage: '出差报销来源加载失败，请核对审批状态和目标单据权限'
  })
  const paymentDialogRef = ref<InstanceType<typeof TravelReimbursementPaymentDialog>>()
  const visibleLines = ref<ReimbursementWorkspaceLine[]>([])
  const lineProperties = new Set([
    'lineNo',
    'expenseItemName',
    'projectName',
    'occurredOn',
    'grossAmount',
    'taxRate',
    'taxAmount',
    'netAmount',
    'invoiceNo',
    'reimburseeName',
    'waybillNo'
  ])
  let latestRequest = 0
  const printSheetRef = ref<InstanceType<typeof ReimbursementPrintSheet>>()
  const printing = ref(false)
  const { deleteGuardRef, deleteRecord, deleteRecords, deleteBusy } = useRecordDeleteGuard(
    'tms_expense_reimbursement',
    '费用报销单'
  )
  const submittingId = ref<string | null>(null)
  const statusOptions = useDictionaryOptions('tmsReimbursementApprovalStatus')
  const displayModeOptions = useDictionaryOptions('commonDocumentDisplayMode')
  const search = ref<WorkspaceSearch>({
    displayMode: 'document',
    sourceType: undefined,
    reimbursementDateRange: [],
    applicantName: '',
    status: '',
    keyword: ''
  })
  const searchItems = computed<SearchFormItem[]>(() => [
    {
      label: '展示方式',
      key: 'displayMode',
      type: 'radioGroup',
      span: 12,
      options: displayModeOptions,
      props: { optionType: 'button', 'aria-label': '费用报销列表展示方式' }
    },
    {
      label: '报销来源',
      key: 'sourceType',
      type: 'select',
      props: {
        clearable: true,
        options: [
          { label: '运单费用', value: 'waybill' },
          { label: '差旅费用', value: 'travel' }
        ],
        placeholder: '全部来源'
      }
    },
    {
      label: '报销日期',
      key: 'reimbursementDateRange',
      type: 'date',
      props: {
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
        startPlaceholder: '开始日期',
        endPlaceholder: '结束日期'
      }
    },
    {
      label: '报销人',
      key: 'applicantName',
      type: 'input',
      props: { clearable: true, placeholder: '输入报销人姓名' }
    },
    {
      label: '状态',
      key: 'status',
      type: 'select',
      props: { options: statusOptions, clearable: true }
    },
    {
      label: '关键词',
      key: 'keyword',
      type: 'input',
      props: { clearable: true, placeholder: '单据编号、事由或运单编号' }
    }
  ])
  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      key: 'delegation',
      label: '费用委托',
      icon: 'ri:user-shared-line',
      permission: 'FinanceExpenseReimbursement:Delegate',
      onClick: () => delegationDialog.value?.handleOpen()
    },
    {
      type: 'add',
      permission: 'FinanceExpenseReimbursement:Add',
      label: '新增差旅报销',
      onClick: () => dialogRef.value?.handleOpen()
    },
    {
      key: 'waybill-expense',
      permission: 'FinanceWaybillCost:View',
      label: '运单费用',
      buttonProps: { plain: true },
      onClick: () => {
        void router.push(financePaths.waybillCost)
      }
    },
    {
      key: 'deleteSelected',
      label: '批量删除',
      icon: 'ri:delete-bin-line',
      permission: 'FinanceExpenseReimbursement:Delete',
      selectionRequired: true,
      disabled: ({ selectedRows }) =>
        search.value.displayMode !== 'document' ||
        deleteBusy.value ||
        selectedRows.some((row) => !canDeleteExpenseDocument('reimbursement', row)),
      onClick: ({ selectedRows }) => deleteSelected(selectedRows as Reimbursement[])
    },
    {
      key: 'batchPrint',
      label: '批量打印',
      icon: 'ri:printer-line',
      permission: 'FinanceExpenseReimbursement:Print',
      selectionRequired: true,
      buttonProps: { loading: printing.value },
      onClick: ({ selectedRows }) => printSelected(selectedRows as TableRecord[])
    }
  ])

  async function fetchTableData(params: WorkspaceSearch & { current: number; size: number }) {
    const request = ++latestRequest
    const range = buildSupabasePageRange(params)
    const { displayMode, ...filters } = params
    const query = { ...filters, ...range }
    if (displayMode === 'line') {
      const result = await fetchReimbursementWorkspaceLines(query)
      if (request === latestRequest) visibleLines.value = result.data ?? []
      return { ...result, total: result.total ?? 0 }
    }
    const result = await fetchReimbursementWorkspaceList(query)
    if (request === latestRequest) visibleLines.value = []
    return { ...result, total: result.total ?? 0 }
  }
  function mergeDocumentCells({
    rowIndex,
    column
  }: {
    rowIndex: number
    column: { property?: string }
  }) {
    return search.value.displayMode === 'line'
      ? documentGroupSpan(
          visibleLines.value,
          rowIndex,
          column.property,
          lineProperties,
          (row) => row.reimbursementId
        )
      : ([1, 1] as [number, number])
  }

  const money = (value: Api.Fms.SensitiveNumber | undefined): string =>
    typeof value === 'number' ? formatCurrencyValue(value) : value === '***' ? '***' : '—'

  const parentOf = (row: TableRecord): Reimbursement =>
    'reimbursement' in row ? row.reimbursement : row

  function reimbursementNumber(row: Reimbursement) {
    return (
      <span class="inline-flex items-center gap-2">
        <span>{row.reimbursementNo}</span>
        {row.isDemo ? (
          <span class="rounded px-1.5 py-0.5 text-xs text-[var(--el-color-warning)] bg-[var(--el-color-warning-light-9)]">
            演示
          </span>
        ) : null}
      </span>
    )
  }

  const lineColumns = (): ColumnOption<TableRecord>[] => [
    { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
    {
      prop: 'reimbursementNo',
      label: '单据编号',
      minWidth: 185,
      fixed: 'left',
      formatter: (row) => reimbursementNumber(parentOf(row))
    },
    {
      prop: 'sourceType',
      label: '来源',
      width: 100,
      formatter: (row) => (parentOf(row).sourceType === 'travel' ? '差旅费用' : '运单费用')
    },
    {
      prop: 'applicantNameSnapshot',
      label: '报销人',
      minWidth: 125,
      formatter: (row) => parentOf(row).applicantNameSnapshot
    },
    {
      prop: 'reimbursementDate',
      label: '报销日期',
      width: 125,
      formatter: (row) => parentOf(row).reimbursementDate
    },
    {
      prop: 'lineNo',
      label: '明细',
      width: 75,
      formatter: (row) => ('lineNo' in row ? row.lineNo : '—')
    },
    {
      prop: 'expenseItemName',
      label: '费用项目',
      minWidth: 140,
      formatter: (row) => ('expenseItemName' in row ? row.expenseItemName : '—')
    },
    {
      prop: 'projectName',
      label: '项目',
      minWidth: 125,
      formatter: (row) => ('projectName' in row ? row.projectName || '—' : '—')
    },
    {
      prop: 'occurredOn',
      label: '费用发生日期',
      width: 130,
      formatter: (row) => ('occurredOn' in row ? row.occurredOn : '—')
    },
    {
      prop: 'grossAmount',
      label: '报销金额（元）',
      width: 145,
      align: 'right',
      formatter: (row) => ('grossAmount' in row ? money(row.grossAmount) : '—')
    },
    {
      prop: 'taxRate',
      label: '税率',
      width: 85,
      align: 'right',
      formatter: (row) => ('taxRate' in row ? `${row.taxRate}%` : '—')
    },
    {
      prop: 'taxAmount',
      label: '税额',
      width: 115,
      align: 'right',
      formatter: (row) => ('taxAmount' in row ? money(row.taxAmount) : '—')
    },
    {
      prop: 'netAmount',
      label: '不含税金额',
      width: 135,
      align: 'right',
      formatter: (row) => ('netAmount' in row ? money(row.netAmount) : '—')
    },
    {
      prop: 'invoiceNo',
      label: '发票号码',
      minWidth: 130,
      formatter: (row) => ('invoiceNo' in row ? row.invoiceNo || '—' : '—')
    },
    {
      prop: 'reimburseeName',
      label: '报销人',
      minWidth: 120,
      formatter: (row) => ('reimburseeName' in row ? row.reimburseeName || '—' : '—')
    },
    {
      prop: 'waybillNo',
      label: '运单号',
      minWidth: 150,
      formatter: (row) => ('waybillNo' in row ? row.waybillNo || '—' : '—')
    },
    {
      prop: 'status',
      label: '单据状态',
      width: 120,
      dict: {
        code: 'tmsReimbursementApprovalStatus',
        display: 'tag',
        value: (row) => parentOf(row).status
      }
    },
    {
      prop: 'operation',
      label: '操作',
      width: 240,
      fixed: 'right',
      formatter: (row) => rowActions(parentOf(row))
    }
  ]

  const documentColumns = (): ColumnOption<TableRecord>[] => [
    { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
    {
      prop: 'reimbursementNo',
      label: '单据编号',
      minWidth: 185,
      fixed: 'left',
      formatter: (row) => reimbursementNumber(parentOf(row))
    },
    {
      prop: 'sourceType',
      label: '来源',
      width: 105,
      formatter: (row) => (parentOf(row).sourceType === 'travel' ? '差旅费用' : '运单费用')
    },
    { prop: 'applicantNameSnapshot', label: '报销人', minWidth: 125 },
    { prop: 'reimbursementDate', label: '报销日期', width: 125 },
    { prop: 'reason', label: '事由', minWidth: 180, showOverflowTooltip: true },
    {
      prop: 'totalAmount',
      label: '报销金额（元）',
      width: 145,
      align: 'right',
      formatter: (row) => money(parentOf(row).totalAmount)
    },
    {
      prop: 'approvedAmount',
      label: '核定金额（元）',
      width: 145,
      align: 'right',
      formatter: (row) => money(parentOf(row).approvedAmount)
    },
    {
      prop: 'cashPayableAmount',
      label: '付现金额（元）',
      width: 145,
      align: 'right',
      formatter: (row) => money(parentOf(row).cashPayableAmount)
    },
    {
      prop: 'remainingAmount',
      label: '待收款金额（元）',
      width: 150,
      align: 'right',
      formatter: (row) => money(parentOf(row).remainingAmount)
    },
    {
      prop: 'paidAt',
      label: '付款日期',
      width: 155,
      formatter: (row) =>
        parentOf(row).paidAt ? formatWithDayjs(parentOf(row).paidAt, 'YYYY-MM-DD') : '—'
    },
    {
      prop: 'status',
      label: '单据状态',
      width: 120,
      dict: { code: 'tmsReimbursementApprovalStatus', display: 'tag' }
    },
    {
      prop: 'reviewRemark',
      label: '反审核意见',
      minWidth: 150,
      showOverflowTooltip: true,
      formatter: (row) =>
        parentOf(row).status === 'rejected' ? parentOf(row).reviewRemark || '—' : '—'
    },
    { prop: 'expenseDepartmentNameSnapshot', label: '部门', minWidth: 140 },
    { prop: 'remark', label: '备注', minWidth: 170, showOverflowTooltip: true },
    {
      prop: 'basisUrls',
      label: '附件',
      width: 80,
      formatter: (row) =>
        Array.isArray(parentOf(row).basisUrls) ? `${parentOf(row).basisUrls?.length ?? 0} 个` : '—'
    },
    {
      prop: 'operation',
      label: '操作',
      width: 240,
      fixed: 'right',
      formatter: (row) => rowActions(parentOf(row))
    }
  ]

  const columnsFactory = (): ColumnOption<TableRecord>[] =>
    search.value.displayMode === 'line' ? lineColumns() : documentColumns()

  function rowActions(row: Reimbursement) {
    return (
      <BusinessTableRowActions>
        {row.sourceType === 'travel' && ['draft', 'rejected'].includes(row.status) ? (
          <ArtButtonTable
            type="edit"
            permission="FinanceExpenseReimbursement:Edit"
            onClick={() => dialogRef.value?.handleOpen({ row })}
          />
        ) : null}
        {row.sourceType === 'travel' ? (
          <ArtButtonTable
            type="add"
            icon="ri:file-copy-line"
            label="复制"
            permission="FinanceExpenseReimbursement:Copy"
            disabled={!hasAuth('FinanceExpenseReimbursement:Add')}
            onClick={() => dialogRef.value?.handleOpen({ row, copy: true })}
          />
        ) : null}
        {row.sourceType === 'travel' && ['draft', 'rejected'].includes(row.status) ? (
          <ArtButtonTable
            type="delete"
            permission="FinanceExpenseReimbursement:Delete"
            disabled={deleteBusy.value}
            onClick={() => void deleteOne(row)}
          />
        ) : null}
        {row.sourceType === 'travel' && ['draft', 'rejected'].includes(row.status) ? (
          <ArtButtonTable
            type="sign"
            icon="ri:send-plane-line"
            label="提交审批"
            permission="FinanceExpenseReimbursement:Submit"
            disabled={Boolean(submittingId.value)}
            loading={submittingId.value === row.id}
            onClick={() => void submitTravelReimbursement(row)}
          />
        ) : null}
        {row.sourceType === 'travel' &&
        row.isDemo &&
        typeof row.remainingAmount === 'number' &&
        row.remainingAmount > 0 &&
        ['approved', 'partially_paid'].includes(row.status) ? (
          <ArtButtonTable
            icon="ri:bank-card-line"
            label="模拟付款"
            permission="FinanceExpenseReimbursement:SimulatePayment"
            onClick={() => void paymentDialogRef.value?.handleOpen({ row, demo: true })}
          />
        ) : null}
        {row.sourceType === 'travel' &&
        !row.isDemo &&
        typeof row.remainingAmount === 'number' &&
        row.remainingAmount > 0 &&
        ['approved', 'partially_paid'].includes(row.status) ? (
          <ArtButtonTable
            icon="ri:bank-card-line"
            label="登记付款"
            permission="FinanceExpenseReimbursement:Pay"
            onClick={() => void paymentDialogRef.value?.handleOpen({ row, demo: false })}
          />
        ) : null}
        <ArtButtonTable
          type="view"
          permission="FinanceExpenseReimbursement:View"
          onClick={() => router.push(getExpenseReimbursementDetailPath(row.id))}
        />
      </BusinessTableRowActions>
    )
  }

  function refreshTable(): Promise<unknown> {
    return tableRef.value?.refreshData() ?? Promise.resolve()
  }
  async function deleteOne(row: Reimbursement): Promise<void> {
    await deleteRecord({
      resource: { id: row.id, label: row.reimbursementNo },
      resolveResources: () => resolveExpenseDeleteResources('reimbursement', [row.id]),
      successMessage: '费用报销单已删除',
      permission: 'FinanceExpenseReimbursement:Delete',
      remove: () => deleteTravelReimbursements([row.id]),
      onDeleted: refreshTable
    })
  }
  async function deleteSelected(rows: Reimbursement[]): Promise<void> {
    if (search.value.displayMode !== 'document' || !rows.length) return
    await deleteRecords({
      resources: rows.map((row) => ({ id: row.id, label: row.reimbursementNo })),
      resolveResources: () =>
        resolveExpenseDeleteResources(
          'reimbursement',
          rows.map((row) => row.id)
        ),
      successMessage: '所选费用报销单已删除',
      permission: 'FinanceExpenseReimbursement:Delete',
      remove: () => deleteTravelReimbursements(rows.map((row) => row.id)),
      onDeleted: refreshTable
    })
  }
  async function printSelected(rows: TableRecord[]): Promise<void> {
    if (!hasAuth('FinanceExpenseReimbursement:Print') || printing.value || !rows.length) return
    const isCurrent = capturePrintOperation()
    printing.value = true
    try {
      const selected = uniqBy(rows.map(parentOf), (row) => row.id)
      const details = await Promise.all(
        selected.map((row) => fetchExpenseReimbursementDetail(row.id))
      )
      if (!isCurrent()) return
      const records = details.flatMap((result) => (result.data ? [result.data] : []))
      if (records.length !== selected.length) throw new Error('部分报销单已变化，请刷新后重试')
      await printSheetRef.value?.print(records)
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '报销单打印内容加载失败，请重试')
    } finally {
      printing.value = false
    }
  }
  watch(
    () => search.value.displayMode,
    () => {
      tableRef.value?.clearSelection()
      void tableRef.value?.getData()
    }
  )

  async function submitTravelReimbursement(row: Reimbursement): Promise<void> {
    if (submittingId.value || !hasAuth('FinanceExpenseReimbursement:Submit')) return
    const isCurrent = captureSubmitOperation()
    submittingId.value = row.id
    try {
      await confirmAction(
        `提交报销单“${row.reimbursementNo}”后，费用和收款内容将锁定。`,
        '提交报销审批',
        {
          confirmButtonText: '提交审批'
        }
      )
      if (!isCurrent()) {
        ElMessage.warning('操作范围或权限已变化，请重新查询后提交')
        return
      }
      await submitExpenseReimbursement(row)
      if (isCurrent()) await refreshTable()
    } catch (error) {
      if (isCurrent() && error !== 'cancel' && error !== 'close')
        notifyFriendlyError(error, '报销单提交失败，请核对费用和收款信息后重试')
    } finally {
      submittingId.value = null
    }
  }
</script>
