<template>
  <ArtPermissionGuard permission="FinanceLoanApplication:View">
    <div class="business-workspace-page art-full-height flex min-w-0 flex-col gap-4">
      <MasterDeleteProcessingNotice :table="tableRef" />
      <BusinessWorkspaceHeader
        density="compact"
        eyebrow="TRAVEL LOANS"
        title="借款单"
        description="登记员工差旅借款、借款明细与收款账户，提交后进入可配置审批流程。"
        icon="ri:hand-coin-line"
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
        :search-bar-props="{ span: 6, labelWidth: 86 }"
        :table-props="{
          rowKey: 'id',
          spanMethod: mergeDocumentCells,
          tableLayout: 'fixed',
          emptyText: '暂无借款单',
          emptyDescription: '可新增借款草稿，录入费用明细与收款账户。'
        }"
        focusable
      >
        <template #loan-push="{ selectedRows }">
          <ArtButtonMore
            :list="loanPushActions(selectedRows)"
            trigger="click"
            @click="pushLoan($event, selectedRows)"
          >
            <template #trigger>
              <ElButton size="small" plain :disabled="!selectedLoan(selectedRows)">
                <ArtSvgIcon icon="ri:share-forward-line" aria-hidden="true" />下推
                <ArtSvgIcon icon="ri:arrow-down-s-line" aria-hidden="true" />
              </ElButton>
            </template>
          </ArtButtonMore>
        </template>
        <template #search-applicantEmployeeId>
          <ArtEmployeeSelect
            :model-value="search.applicantEmployeeId || undefined"
            :tenant-id="effectiveTenantId || ''"
            :allow-all-tenant-read="isAllTenants"
            placeholder="选择借款人"
            @update:model-value="search.applicantEmployeeId = $event || ''"
          />
        </template>
      </ArtTableQuery>
      <TravelLoanDialog ref="dialogRef" @success="refreshTable" />
      <TravelLoanPaymentDialog ref="paymentDialogRef" @success="refreshTable" />
      <TravelLoanPrintSheet ref="printRef" />
      <MasterDataDeleteGuard ref="deleteGuardRef" />
    </div>
  </ArtPermissionGuard>
</template>

<script setup lang="tsx">
  import {
    canDeleteExpenseDocument,
    resolveExpenseDeleteResources
  } from '../shared/expense-delete-resources'
  import { orderBy, uniqBy } from 'lodash-es'
  import { storeToRefs } from 'pinia'
  import { useRoute, useRouter } from 'vue-router'
  import type { ColumnOption } from '@/types'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtPermissionGuard from '@/components/core/feedback/art-permission-guard/index.vue'
  import ArtTableQuery from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { documentGroupSpan } from '@/utils/business/document-detail-list'
  import { formatCurrencyValue } from '@/utils/ui'
  import { startWorkflow } from '@/api/workflow'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import {
    fetchTravelLoanList,
    fetchTravelLoanItemList,
    fetchTravelLoanDetail,
    deleteTravelLoans,
    type TravelLoan,
    type TravelLoanSearch,
    type TravelLoanItemRecord
  } from '@fms/api'
  import TravelLoanDialog from './modules/travel-loan-dialog.vue'
  import TravelLoanPaymentDialog from './modules/travel-loan-payment-dialog.vue'
  import TravelLoanPrintSheet from './modules/travel-loan-print-sheet.vue'

  defineOptions({ name: 'FinanceLoanApplication' })
  interface DialogExpose {
    handleOpen: (data?: { row?: TravelLoan; copy?: boolean }) => Promise<void>
  }
  type TableRecord = TravelLoan | TravelLoanItemRecord
  type LoanSearch = TravelLoanSearch & { displayMode: 'document' | 'line' }
  const tableRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<DialogExpose>()
  const paymentDialogRef = ref<InstanceType<typeof TravelLoanPaymentDialog>>()
  const printRef = ref<InstanceType<typeof TravelLoanPrintSheet>>()
  const printing = ref(false)
  const route = useRoute()
  const router = useRouter()
  const { hasAuth } = useAuth()
  const capturePrintOperation = useTenantOperationGuard('FinanceLoanApplication:Print')
  const captureViewOperation = useTenantOperationGuard('FinanceLoanApplication:View')
  const captureSubmitOperation = useTenantOperationGuard('FinanceLoanApplication:Submit')
  const { deleteGuardRef, deleteRecord, deleteRecords, deleteBusy } = useRecordDeleteGuard(
    'fms_travel_loan',
    '借款单'
  )
  const { confirmAction } = useArtFeedback()
  const submittingId = ref<string | null>(null)
  const lineProperties = new Set(['lineNo', 'expenseItem', 'projectId', 'purpose', 'amount'])
  const { effectiveTenantId, isAllTenants } = storeToRefs(useTenantScopeStore())
  const statusOptions = useDictionaryOptions('fmsExpenseDocumentStatus')
  const displayModeOptions = useDictionaryOptions('commonDocumentDisplayMode')
  const search = ref<LoanSearch>({
    displayMode: 'document',
    applicationDateRange: [],
    applicantEmployeeId: '',
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
      props: { optionType: 'button', 'aria-label': '借款单列表展示方式' }
    },
    {
      label: '申请日期',
      key: 'applicationDateRange',
      type: 'date',
      props: {
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
        startPlaceholder: '开始日期',
        endPlaceholder: '结束日期'
      }
    },
    { label: '借款人', key: 'applicantEmployeeId', type: 'input' },
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
      props: { clearable: true, placeholder: '单据编号、借款人或事由' }
    }
  ])
  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      type: 'add',
      permission: 'FinanceLoanApplication:Add',
      label: '新增借款单',
      onClick: () => dialogRef.value?.handleOpen()
    },
    {
      key: 'loanPush',
      label: '下推',
      slot: 'loan-push',
      // The group only opens its menu; each target has its own managed permission.
      permission: '',
      selectionRequired: true,
      rowAction: false,
      hidden:
        !hasAuth('FinanceLoanApplication:PushReimbursement') &&
        !hasAuth('FinanceLoanApplication:PushRepayment')
    },
    {
      key: 'deleteSelected',
      label: '批量删除',
      icon: 'ri:delete-bin-line',
      permission: 'FinanceLoanApplication:Delete',
      selectionRequired: true,
      disabled: ({ selectedRows }) =>
        search.value.displayMode !== 'document' ||
        deleteBusy.value ||
        selectedRows.some((row) => !canDeleteExpenseDocument('loan', row)),
      onClick: ({ selectedRows }) => deleteSelected(selectedRows as TravelLoan[])
    },
    {
      key: 'batchPrint',
      label: '批量打印',
      icon: 'ri:printer-line',
      permission: 'FinanceLoanApplication:Print',
      selectionRequired: true,
      buttonProps: { loading: printing.value },
      onClick: ({ selectedRows }) => printSelected(selectedRows as TableRecord[])
    }
  ])
  async function fetchTableData(params: LoanSearch & { current: number; size: number }) {
    const range = buildSupabasePageRange(params)
    const { displayMode, ...filters } = params
    const query = { ...filters, ...range, tenantId: effectiveTenantId.value }
    if (displayMode === 'line') {
      const result = await fetchTravelLoanItemList(query)
      const rows = orderBy(
        result.data ?? [],
        [(row) => row.loan.applicationDate, (row) => row.loan.id, (row) => row.lineNo],
        ['desc', 'asc', 'asc']
      )
      return { ...result, data: rows, total: result.total ?? 0 }
    }
    const result = await fetchTravelLoanList(query)
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
          (tableRef.value?.dataState.rows.value as TableRecord[] | undefined) ?? [],
          rowIndex,
          column.property,
          lineProperties,
          (row) => loanOf(row).id ?? ''
        )
      : ([1, 1] as [number, number])
  }
  const loanOf = (row: TableRecord): TravelLoan => ('loan' in row ? row.loan : row)
  function selectedLoan(rows: unknown[]): TravelLoan | undefined {
    const loans = uniqBy((rows as TableRecord[]).map(loanOf), (row) => row.id)
    const loan = loans[0]
    return loans.length === 1 &&
      loan?.status === 'paid' &&
      (loan.availableAmount ?? loan.remainingBalance ?? 0) > 0
      ? loan
      : undefined
  }
  function loanPushActions(rows: unknown[]): ButtonMoreItem[] {
    const disabled = !selectedLoan(rows)
    return [
      {
        key: 'reimbursement',
        label: '差旅报销单',
        icon: 'ri:refund-2-line',
        auth: 'FinanceLoanApplication:PushReimbursement',
        disabled:
          disabled ||
          !hasAuth('FinanceExpenseReimbursement:Add') ||
          !hasAuth('FinanceExpenseReimbursement:View')
      },
      {
        key: 'repayment',
        label: '还款单',
        icon: 'ri:refund-line',
        auth: 'FinanceLoanApplication:PushRepayment',
        disabled: disabled || !hasAuth('FinanceRepayment:Add') || !hasAuth('FinanceRepayment:View')
      }
    ]
  }
  async function pushLoan(item: ButtonMoreItem, rows: unknown[]): Promise<void> {
    const loan = selectedLoan(rows)
    if (!loan || item.disabled || (item.auth && !hasAuth(item.auth))) return
    if (item.key !== 'repayment' && item.key !== 'reimbursement') return
    await router.push({
      name: item.key === 'repayment' ? 'FinanceRepayment' : 'FinanceExpenseReimbursement',
      query: { fromLoan: loan.id }
    })
  }
  const money = (value: number | null | undefined): string =>
    value == null ? '—' : formatCurrencyValue(value)
  const columnsFactory = (): ColumnOption<TableRecord>[] => {
    if (search.value.displayMode === 'line') {
      return [
        { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
        {
          prop: 'loanNo',
          label: '单据编号',
          minWidth: 175,
          fixed: 'left',
          formatter: (row) => loanNumber(loanOf(row))
        },
        {
          prop: 'applicantName',
          label: '借款人',
          minWidth: 120,
          formatter: (row) => loanOf(row).applicantName
        },
        {
          prop: 'lineNo',
          label: '明细',
          width: 70,
          formatter: (row) => ('lineNo' in row ? row.lineNo : '—')
        },
        {
          prop: 'expenseItem',
          label: '费用项目',
          minWidth: 145,
          formatter: (row) => ('expenseItem' in row ? row.expenseItem?.itemName || '—' : '—')
        },
        {
          prop: 'projectId',
          label: '项目',
          minWidth: 130,
          formatter: (row) =>
            'projectId' in row
              ? row.project?.projectName || (row.projectId ? '已关联项目' : '—')
              : '—'
        },
        { prop: 'purpose', label: '借款用途', minWidth: 190, showOverflowTooltip: true },
        {
          prop: 'amount',
          label: '借款金额（元）',
          width: 135,
          align: 'right',
          formatter: (row) => ('amount' in row ? money(row.amount) : '—')
        },
        {
          prop: 'status',
          label: '单据状态',
          width: 110,
          dict: {
            code: 'fmsExpenseDocumentStatus',
            display: 'tag',
            value: (row) => loanOf(row).status
          }
        },
        {
          prop: 'operation',
          label: '操作',
          width: 230,
          fixed: 'right',
          formatter: (row) => loanRowActions(loanOf(row))
        }
      ]
    }
    return [
      { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
      {
        prop: 'loanNo',
        label: '单据编号',
        minWidth: 175,
        fixed: 'left',
        showOverflowTooltip: true,
        formatter: (row) => loanNumber(loanOf(row))
      },
      { prop: 'applicantName', label: '借款人', minWidth: 120 },
      { prop: 'applicationDate', label: '申请日期', width: 120 },
      { prop: 'reason', label: '事由', minWidth: 170, showOverflowTooltip: true },
      {
        prop: 'loanAmount',
        label: '借款金额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(loanOf(row).loanAmount)
      },
      {
        prop: 'approvedAmount',
        label: '核定金额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(loanOf(row).approvedAmount)
      },
      {
        prop: 'reimbursedAmount',
        label: '已报销金额（元）',
        width: 145,
        align: 'right',
        formatter: (row) => money(loanOf(row).reimbursedAmount)
      },
      {
        prop: 'pendingCollectionAmount',
        label: '待收款金额（元）',
        width: 145,
        align: 'right',
        formatter: (row) => money(loanOf(row).pendingCollectionAmount)
      },
      {
        prop: 'repaidAmount',
        label: '已还款金额（元）',
        width: 145,
        align: 'right',
        formatter: (row) => money(loanOf(row).repaidAmount)
      },
      {
        prop: 'remainingBalance',
        label: '未还余额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(loanOf(row).remainingBalance)
      },
      {
        prop: 'usedAmount',
        label: '已用金额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(loanOf(row).usedAmount)
      },
      {
        prop: 'paidAmount',
        label: '已付金额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(loanOf(row).paidAmount)
      },
      { prop: 'currentHandler', label: '当前处理人', minWidth: 125 },
      { prop: 'paymentDate', label: '付款日期', width: 125 },
      {
        prop: 'status',
        label: '单据状态',
        width: 110,
        dict: { code: 'fmsExpenseDocumentStatus', display: 'tag' }
      },
      { prop: 'rejectionOpinion', label: '反审核意见', minWidth: 150, showOverflowTooltip: true },
      { prop: 'expenseDepartmentName', label: '部门', minWidth: 140, showOverflowTooltip: true },
      { prop: 'remark', label: '备注', minWidth: 160, showOverflowTooltip: true },
      {
        prop: 'attachmentUrls',
        label: '附件',
        width: 75,
        formatter: (row) => `${loanOf(row).attachmentUrls?.length ?? 0} 个`
      },
      {
        prop: 'operation',
        label: '操作',
        width: 230,
        fixed: 'right',
        formatter: (row) => loanRowActions(loanOf(row))
      }
    ]
  }
  function loanNumber(row: TravelLoan) {
    return (
      <span class="inline-flex items-center gap-2">
        <span>{row.loanNo}</span>
        {row.isDemo ? (
          <span class="rounded px-1.5 py-0.5 text-xs text-[var(--el-color-warning)] bg-[var(--el-color-warning-light-9)]">
            演示
          </span>
        ) : null}
      </span>
    )
  }
  function loanRowActions(row: TravelLoan) {
    return (
      <BusinessTableRowActions>
        <ArtButtonTable
          type="edit"
          permission="FinanceLoanApplication:Edit"
          disabled={!['draft', 'rejected'].includes(row.status)}
          onClick={() => dialogRef.value?.handleOpen({ row })}
        />
        <ArtButtonTable
          icon="ri:file-copy-line"
          label="复制借款单"
          permission="FinanceLoanApplication:Copy"
          disabled={!hasAuth('FinanceLoanApplication:Add')}
          onClick={() => dialogRef.value?.handleOpen({ row, copy: true })}
        />
        {row.status === 'draft' ? (
          <ArtButtonTable
            type="delete"
            permission="FinanceLoanApplication:Delete"
            onClick={() => void deleteOne(row)}
          />
        ) : null}
        {['draft', 'rejected'].includes(row.status) ? (
          <ArtButtonTable
            icon="ri:send-plane-line"
            label="提交审批"
            permission="FinanceLoanApplication:Submit"
            disabled={Boolean(submittingId.value)}
            onClick={() => void submitLoan(row)}
          />
        ) : null}
        {['approved', 'awaiting_payment'].includes(row.status) &&
        (row.approvedAmount ?? 0) > (row.paidAmount ?? 0) ? (
          row.isDemo ? (
            <ArtButtonTable
              icon="ri:bank-card-line"
              label="模拟付款"
              permission="FinanceLoanApplication:SimulatePayment"
              onClick={() => paymentDialogRef.value?.handleOpen({ row, demo: true })}
            />
          ) : (
            <ArtButtonTable
              icon="ri:bank-card-line"
              label="登记付款"
              permission="FinanceLoanApplication:Pay"
              onClick={() => paymentDialogRef.value?.handleOpen({ row, demo: false })}
            />
          )
        ) : null}
      </BusinessTableRowActions>
    )
  }
  async function submitLoan(row: TravelLoan): Promise<void> {
    if (submittingId.value || !hasAuth('FinanceLoanApplication:Submit')) return
    const isCurrent = captureSubmitOperation()
    submittingId.value = row.id
    try {
      await confirmAction(`提交借款单“${row.loanNo}”后，借款与收款明细将锁定。`, '提交借款审批', {
        confirmButtonText: '提交审批'
      })
      if (!isCurrent()) {
        ElMessage.warning('操作范围或权限已变化，请重新查询后提交')
        return
      }
      await startWorkflow({
        businessType: 'fms_travel_loan',
        businessId: row.id,
        businessTitle: `借款单 ${row.loanNo}`,
        context: { loanNo: row.loanNo }
      })
      if (isCurrent()) await refreshTable()
    } catch (error) {
      if (isCurrent() && error !== 'cancel' && error !== 'close')
        notifyFriendlyError(error, '借款单提交失败，请核对借款与收款明细后重试')
    } finally {
      submittingId.value = null
    }
  }
  function refreshTable(): Promise<unknown> {
    return tableRef.value?.refreshData() ?? Promise.resolve()
  }
  async function deleteOne(row: TravelLoan): Promise<void> {
    await deleteRecord({
      resource: { id: row.id, label: row.loanNo },
      resolveResources: () => resolveExpenseDeleteResources('loan', [row.id]),
      successMessage: '借款单已删除',
      permission: 'FinanceLoanApplication:Delete',
      remove: () => deleteTravelLoans([row.id]),
      onDeleted: refreshTable
    })
  }
  async function deleteSelected(rows: TravelLoan[]): Promise<void> {
    if (search.value.displayMode !== 'document' || !rows.length) return
    await deleteRecords({
      resources: rows.map((row) => ({ id: row.id, label: row.loanNo })),
      resolveResources: () =>
        resolveExpenseDeleteResources(
          'loan',
          rows.map((row) => row.id)
        ),
      successMessage: '所选借款单已删除',
      permission: 'FinanceLoanApplication:Delete',
      remove: () => deleteTravelLoans(rows.map((row) => row.id)),
      onDeleted: refreshTable
    })
  }
  async function printSelected(rows: TableRecord[]): Promise<void> {
    if (!hasAuth('FinanceLoanApplication:Print') || printing.value || !rows.length) return
    const isCurrent = capturePrintOperation()
    printing.value = true
    try {
      const selected = uniqBy(rows.map(loanOf), (row) => row.id)
      const details = await Promise.all(selected.map((row) => fetchTravelLoanDetail(row.id)))
      if (!isCurrent()) return
      const records = details.flatMap((result) => (result.data ? [result.data] : []))
      if (records.length !== selected.length) throw new Error('部分借款单已变化，请刷新后重试')
      await printRef.value?.print(records)
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '借款单打印内容加载失败，请重试')
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
  watch(
    () => route.query.loanId,
    async (id) => {
      if (typeof id !== 'string' || !id || !hasAuth('FinanceLoanApplication:View')) return
      const isCurrent = captureViewOperation()
      try {
        const result = await fetchTravelLoanDetail(id)
        if (!isCurrent()) return
        if (!result.data) throw new Error('关联借款单不可用')
        search.value.displayMode = 'document'
        search.value.keyword = result.data.loanNo
        await nextTick()
        if (!isCurrent()) return
        await tableRef.value?.getData()
      } catch (error) {
        if (isCurrent()) notifyFriendlyError(error, '关联借款单定位失败，请刷新后重试')
      }
    },
    { immediate: true }
  )
</script>
