<template>
  <ArtPermissionGuard permission="FinanceRepayment:View">
    <div class="business-workspace-page art-full-height flex min-w-0 flex-col gap-4">
      <MasterDeleteProcessingNotice :table="tableRef" />
      <BusinessWorkspaceHeader
        density="compact"
        eyebrow="TRAVEL REPAYMENTS"
        title="还款单"
        description="关联已付款借款，登记员工归还的借款明细与金额。"
        icon="ri:refund-line"
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
          emptyText: '暂无还款单',
          emptyDescription: '借款付款后，可新增还款单并关联借款明细。'
        }"
        focusable
      >
        <template #search-applicantEmployeeId>
          <ArtEmployeeSelect
            :model-value="search.applicantEmployeeId || undefined"
            :tenant-id="effectiveTenantId || ''"
            :allow-all-tenant-read="isAllTenants"
            placeholder="选择还款人"
            @update:model-value="search.applicantEmployeeId = $event || ''"
          />
        </template>
      </ArtTableQuery>
      <RepaymentDialog ref="dialogRef" @success="refreshTable" />
      <RepaymentCollectionDialog ref="collectionDialogRef" @success="refreshTable" />
      <RepaymentPrintSheet ref="printRef" />
      <MasterDataDeleteGuard ref="deleteGuardRef" />
    </div>
  </ArtPermissionGuard>
</template>

<script setup lang="tsx">
  import { ElMessage } from 'element-plus'
  import {
    canDeleteExpenseDocument,
    resolveExpenseDeleteResources
  } from '../shared/expense-delete-resources'
  import { orderBy, uniqBy } from 'lodash-es'
  import { storeToRefs } from 'pinia'
  import { useRoute } from 'vue-router'
  import type { ColumnOption } from '@/types'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtPermissionGuard from '@/components/core/feedback/art-permission-guard/index.vue'
  import ArtTableQuery from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import type { TableRequestOptions } from '@/hooks/core/useTable'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { documentGroupSpan } from '@/utils/business/document-detail-list'
  import { formatCurrencyValue } from '@/utils/ui'
  import {
    fetchTravelRepaymentList,
    fetchTravelRepaymentLineList,
    fetchTravelRepaymentDetail,
    submitTravelRepayment,
    deleteTravelRepayments,
    prepareTravelLoanPush,
    type TravelRepayment,
    type TravelRepaymentLine,
    type TravelRepaymentSearch
  } from '@fms/api'
  import RepaymentDialog from './modules/repayment-dialog.vue'
  import RepaymentCollectionDialog from './modules/repayment-collection-dialog.vue'
  import RepaymentPrintSheet from './modules/repayment-print-sheet.vue'
  import { useExpensePushRoute } from '../shared/use-expense-push-route'

  defineOptions({ name: 'FinanceRepayment' })
  interface DialogExpose {
    handleOpen: (data?: {
      row?: TravelRepayment
      copy?: boolean
      readonly?: boolean
      sourceLoan?: import('@fms/api').TravelLoan
      isCurrent?: () => boolean
    }) => Promise<void>
  }
  type TableRecord = TravelRepayment | TravelRepaymentLine
  type RepaymentSearch = TravelRepaymentSearch & { displayMode: 'document' | 'line' }
  const tableRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<DialogExpose>()
  useExpensePushRoute({
    queryKey: 'fromLoan',
    target: 'FinanceRepayment',
    prepare: (id) => prepareTravelLoanPush(id, 'repayment'),
    openDraft: async (sourceLoan, isCurrent) => {
      await dialogRef.value?.handleOpen({ sourceLoan, isCurrent })
    },
    errorMessage: '借款下推失败，请核对可用余额和目标单据权限'
  })
  const collectionDialogRef = ref<InstanceType<typeof RepaymentCollectionDialog>>()
  const printRef = ref<InstanceType<typeof RepaymentPrintSheet>>()
  const lineProperties = new Set([
    'lineNo',
    'expenseItemName',
    'loanPurpose',
    'currencyCode',
    'exchangeRate',
    'baseAmount',
    'lineAmount'
  ])
  const { effectiveTenantId, isAllTenants } = storeToRefs(useTenantScopeStore())
  const { hasAuth } = useAuth()
  const { confirmAction } = useArtFeedback()
  const { deleteGuardRef, deleteRecord, deleteRecords, deleteBusy } = useRecordDeleteGuard(
    'fms_travel_repayment',
    '还款单'
  )
  const submittingId = ref<string | null>(null)
  const printing = ref(false)
  const route = useRoute()
  const capturePrintOperation = useTenantOperationGuard('FinanceRepayment:Print')
  const captureViewOperation = useTenantOperationGuard('FinanceRepayment:View')
  const captureSubmitOperation = useTenantOperationGuard('FinanceRepayment:Submit')
  const statusOptions = useDictionaryOptions('fmsRepaymentStatus')
  const displayModeOptions = useDictionaryOptions('commonDocumentDisplayMode')
  const search = ref<RepaymentSearch>({
    displayMode: 'document',
    repaymentDateRange: [],
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
      props: { optionType: 'button', 'aria-label': '还款单列表展示方式' }
    },
    {
      label: '还款日期',
      key: 'repaymentDateRange',
      type: 'date',
      props: {
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
        startPlaceholder: '开始日期',
        endPlaceholder: '结束日期'
      }
    },
    { label: '还款人', key: 'applicantEmployeeId', type: 'input' },
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
      props: { clearable: true, placeholder: '单据编号、还款人或事由' }
    }
  ])
  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      type: 'add',
      permission: 'FinanceRepayment:Add',
      label: '新增还款单',
      onClick: () => dialogRef.value?.handleOpen()
    },
    {
      key: 'deleteSelected',
      label: '批量删除',
      icon: 'ri:delete-bin-line',
      permission: 'FinanceRepayment:Delete',
      selectionRequired: true,
      disabled: ({ selectedRows }) =>
        search.value.displayMode !== 'document' ||
        deleteBusy.value ||
        selectedRows.some((row) => !canDeleteExpenseDocument('repayment', row)),
      onClick: ({ selectedRows }) => deleteSelected(selectedRows as TravelRepayment[])
    },
    {
      key: 'batchPrint',
      label: '批量打印',
      icon: 'ri:printer-line',
      permission: 'FinanceRepayment:Print',
      selectionRequired: true,
      buttonProps: { loading: printing.value },
      onClick: ({ selectedRows }) => printSelected(selectedRows as TableRecord[])
    }
  ])
  async function fetchTableData(
    params: RepaymentSearch & { current: number; size: number },
    options?: TableRequestOptions
  ) {
    const range = buildSupabasePageRange(params)
    const { displayMode, ...filters } = params
    const query = { ...filters, ...range, tenantId: effectiveTenantId.value }
    if (displayMode === 'line') {
      const result = await fetchTravelRepaymentLineList(query, options)
      const rows = orderBy(
        result.data ?? [],
        [(row) => row.repayment.repaymentDate, (row) => row.repaymentId, (row) => row.lineNo],
        ['desc', 'asc', 'asc']
      )
      return { ...result, data: rows, total: result.total ?? 0 }
    }
    const result = await fetchTravelRepaymentList(query, options)
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
          (row) => ('repaymentId' in row ? row.repaymentId : '')
        )
      : ([1, 1] as [number, number])
  }
  const parentOf = (row: TableRecord): TravelRepayment => ('repayment' in row ? row.repayment : row)
  const money = (value: number | null | undefined): string =>
    value == null ? '—' : formatCurrencyValue(value)
  const columnsFactory = (): ColumnOption<TableRecord>[] => [
    { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
    {
      prop: 'repaymentNo',
      label: '单据编号',
      minWidth: 165,
      fixed: 'left',
      formatter: (row) => (
        <span class="inline-flex items-center gap-2">
          <span>{parentOf(row).repaymentNo}</span>
          {parentOf(row).isDemo ? (
            <span class="rounded px-1.5 py-0.5 text-xs text-[var(--el-color-warning)] bg-[var(--el-color-warning-light-9)]">
              演示
            </span>
          ) : null}
        </span>
      )
    },
    {
      prop: 'applicantName',
      label: '还款人',
      minWidth: 110,
      formatter: (row) => parentOf(row).applicantName
    },
    {
      prop: 'repaymentDate',
      label: '还款日期',
      width: 120,
      formatter: (row) => parentOf(row).repaymentDate
    },
    {
      prop: 'reason',
      label: '事由',
      minWidth: 180,
      showOverflowTooltip: true,
      formatter: (row) => parentOf(row).reason
    },
    ...(search.value.displayMode === 'line'
      ? [
          {
            prop: 'lineNo',
            label: '明细',
            width: 70,
            formatter: (row: TableRecord) => ('lineNo' in row ? row.lineNo : '—')
          },
          {
            prop: 'expenseItemName',
            label: '费用项目',
            minWidth: 140,
            formatter: (row: TableRecord) => ('expenseItemName' in row ? row.expenseItemName : '—')
          },
          {
            prop: 'loanPurpose',
            label: '借款事项',
            minWidth: 160,
            formatter: (row: TableRecord) => ('loanPurpose' in row ? row.loanPurpose : '—')
          },
          {
            prop: 'currencyCode',
            label: '币种',
            width: 80,
            formatter: (row: TableRecord) => ('currencyCode' in row ? row.currencyCode : '—')
          },
          {
            prop: 'exchangeRate',
            label: '汇率',
            width: 85,
            align: 'right' as const,
            formatter: (row: TableRecord) => ('exchangeRate' in row ? row.exchangeRate : '—')
          },
          {
            prop: 'lineAmount',
            label: '本行还款金额',
            width: 130,
            align: 'right' as const,
            formatter: (row: TableRecord) => ('amount' in row ? money(row.amount) : '—')
          },
          {
            prop: 'baseAmount',
            label: '还款金额本位币',
            width: 145,
            align: 'right' as const,
            formatter: (row: TableRecord) => ('baseAmount' in row ? money(row.baseAmount) : '—')
          }
        ]
      : []),
    {
      prop: 'amount',
      label: '还款金额（元）',
      width: 135,
      align: 'right',
      formatter: (row) => money(parentOf(row).amount)
    },
    {
      prop: 'approvedAmount',
      label: '核定金额（元）',
      width: 140,
      align: 'right',
      formatter: (row) => money(parentOf(row).approvedAmount)
    },
    {
      prop: 'receivedAmount',
      label: '已收款金额（元）',
      width: 145,
      align: 'right',
      formatter: (row) => money(parentOf(row).receivedAmount)
    },
    {
      prop: 'remainingBalance',
      label: '未还余额（元）',
      width: 140,
      align: 'right',
      formatter: (row) => money(parentOf(row).loan?.remainingBalance)
    },
    {
      prop: 'loanNo',
      label: '源单编号 / 关联借款',
      minWidth: 175,
      formatter: (row) => parentOf(row).loan?.loanNo || '—'
    },
    {
      prop: 'currentHandler',
      label: '当前处理人',
      minWidth: 120,
      formatter: (row) => parentOf(row).currentHandler || '—'
    },
    {
      prop: 'receiptDate',
      label: '收款日期',
      width: 120,
      formatter: (row) => parentOf(row).receiptDate || '—'
    },
    {
      prop: 'paymentDate',
      label: '借款付款日期',
      width: 130,
      formatter: (row) => parentOf(row).loan?.paymentDate || '—'
    },
    {
      prop: 'status',
      label: '单据状态',
      width: 115,
      dict: { code: 'fmsRepaymentStatus', display: 'tag', value: (row) => parentOf(row).status }
    },
    {
      prop: 'rejectionOpinion',
      label: '反审核意见',
      minWidth: 145,
      formatter: (row) => parentOf(row).rejectionOpinion || '—'
    },
    {
      prop: 'payerName',
      label: '付款人',
      minWidth: 110,
      formatter: (row) => parentOf(row).payerName || '—'
    },
    {
      prop: 'payerBank',
      label: '付款银行',
      minWidth: 150,
      formatter: (row) => parentOf(row).payerBank || '—'
    },
    {
      prop: 'bankAccount',
      label: '银行账号',
      minWidth: 175,
      formatter: (row) => parentOf(row).bankAccount || '—'
    },
    {
      prop: 'expenseDepartmentName',
      label: '部门',
      minWidth: 135,
      formatter: (row) => parentOf(row).expenseDepartmentName
    },
    {
      prop: 'remark',
      label: '备注',
      minWidth: 150,
      showOverflowTooltip: true,
      formatter: (row) => parentOf(row).remark || '—'
    },
    {
      prop: 'attachmentUrls',
      label: '附件',
      width: 75,
      formatter: (row) => `${parentOf(row).attachmentUrls.length} 个`
    },
    {
      prop: 'operation',
      label: '操作',
      width: 215,
      fixed: 'right',
      formatter: (row) => rowActions(parentOf(row))
    }
  ]
  function rowActions(row: TravelRepayment) {
    return (
      <BusinessTableRowActions>
        <ArtButtonTable
          type="view"
          permission="FinanceRepayment:View"
          onClick={() => dialogRef.value?.handleOpen({ row, readonly: true })}
        />
        {['approved', 'awaiting_collection'].includes(row.status) &&
        row.amount > row.receivedAmount ? (
          <ArtButtonTable
            icon="ri:bank-card-line"
            label={row.isDemo ? '模拟收款' : '确认收款'}
            permission="FinanceRepayment:Collect"
            onClick={() => collectionDialogRef.value?.handleOpen(row)}
          />
        ) : null}
        {['draft', 'rejected'].includes(row.status) ? (
          <>
            <ArtButtonTable
              type="edit"
              permission="FinanceRepayment:Edit"
              onClick={() => dialogRef.value?.handleOpen({ row })}
            />
            <ArtButtonTable
              icon="ri:file-copy-line"
              label="复制还款单"
              permission="FinanceRepayment:Copy"
              disabled={!hasAuth('FinanceRepayment:Add')}
              onClick={() => dialogRef.value?.handleOpen({ row, copy: true })}
            />
            {row.status === 'draft' ? (
              <ArtButtonTable
                type="delete"
                permission="FinanceRepayment:Delete"
                onClick={() => void deleteOne(row)}
              />
            ) : null}
            <ArtButtonTable
              icon="ri:send-plane-line"
              label="提交审批"
              permission="FinanceRepayment:Submit"
              disabled={Boolean(submittingId.value)}
              onClick={() => void submitOne(row)}
            />
          </>
        ) : null}
      </BusinessTableRowActions>
    )
  }
  function refreshTable(): Promise<unknown> {
    return tableRef.value?.refreshData() ?? Promise.resolve()
  }
  async function deleteOne(row: TravelRepayment): Promise<void> {
    await deleteRecord({
      resource: { id: row.id, label: row.repaymentNo },
      resolveResources: () => resolveExpenseDeleteResources('repayment', [row.id]),
      successMessage: '还款单已删除',
      permission: 'FinanceRepayment:Delete',
      remove: () => deleteTravelRepayments([row.id]),
      onDeleted: refreshTable
    })
  }
  async function deleteSelected(rows: TravelRepayment[]): Promise<void> {
    if (search.value.displayMode !== 'document' || !rows.length) return
    await deleteRecords({
      resources: rows.map((row) => ({ id: row.id, label: row.repaymentNo })),
      resolveResources: () =>
        resolveExpenseDeleteResources(
          'repayment',
          rows.map((row) => row.id)
        ),
      successMessage: '所选还款单已删除',
      permission: 'FinanceRepayment:Delete',
      remove: () => deleteTravelRepayments(rows.map((row) => row.id)),
      onDeleted: refreshTable
    })
  }
  async function submitOne(row: TravelRepayment): Promise<void> {
    if (submittingId.value || !hasAuth('FinanceRepayment:Submit')) return
    const isCurrent = captureSubmitOperation()
    submittingId.value = row.id
    try {
      await confirmAction(`提交还款单“${row.repaymentNo}”后，明细将锁定。`, '提交还款审批', {
        confirmButtonText: '提交审批'
      })
      if (!isCurrent()) {
        ElMessage.warning('操作范围或权限已变化，请重新查询后提交')
        return
      }
      await submitTravelRepayment(row.id)
      if (!isCurrent()) return
      ElMessage.success('还款单已提交审批')
      await refreshTable()
    } catch (error) {
      if (isCurrent() && error !== 'cancel' && error !== 'close')
        notifyFriendlyError(error, '还款单提交失败，请核对借款余额后重试')
    } finally {
      submittingId.value = null
    }
  }
  async function printSelected(rows: TableRecord[]): Promise<void> {
    if (!hasAuth('FinanceRepayment:Print') || printing.value || !rows.length) return
    const isCurrent = capturePrintOperation()
    printing.value = true
    try {
      const selected = uniqBy(rows.map(parentOf), (row) => row.id)
      const details = await Promise.all(selected.map((row) => fetchTravelRepaymentDetail(row.id)))
      if (!isCurrent()) return
      const records = details.flatMap((result) => (result.data ? [result.data] : []))
      if (records.length !== selected.length) throw new Error('部分还款单已变化，请刷新后重试')
      await printRef.value?.print(records)
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '还款单打印内容加载失败，请重试')
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
    () => route.query.openRepayment,
    async (id) => {
      if (typeof id !== 'string' || !id || !hasAuth('FinanceRepayment:View')) return
      const isCurrent = captureViewOperation()
      try {
        const result = await fetchTravelRepaymentDetail(id)
        if (!isCurrent()) return
        if (!result.data) throw new Error('关联还款单不可用')
        await nextTick()
        if (!isCurrent()) return
        await dialogRef.value?.handleOpen({ row: result.data, readonly: true, isCurrent })
      } catch (error) {
        if (isCurrent()) notifyFriendlyError(error, '关联还款单定位失败，请刷新后重试')
      }
    },
    { immediate: true }
  )
</script>
