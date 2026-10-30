<template>
  <ArtPermissionGuard permission="FinanceTravelApplication:View">
    <div class="business-workspace-page art-full-height flex min-w-0 flex-col gap-4">
      <MasterDeleteProcessingNotice :table="tableRef" />
      <BusinessWorkspaceHeader
        density="compact"
        eyebrow="TRAVEL APPLICATIONS"
        title="出差申请单"
        description="登记出差行程与预算，跟进审批状态，通过后关联差旅报销。"
        icon="ri:flight-takeoff-line"
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
          emptyText: '暂无出差申请',
          emptyDescription: '可新增草稿，填写申请人和行程信息。'
        }"
        focusable
      >
        <template #search-applicantEmployeeId>
          <ArtEmployeeSelect
            :model-value="search.applicantEmployeeId || undefined"
            :tenant-id="effectiveTenantId || ''"
            :allow-all-tenant-read="isAllTenants"
            placeholder="选择申请人"
            @update:model-value="search.applicantEmployeeId = $event || ''"
          />
        </template>
      </ArtTableQuery>
      <TravelApplicationDialog ref="dialogRef" @success="refreshTable" />
      <TravelApplicationPrintSheet ref="printRef" />
      <MasterDataDeleteGuard ref="deleteGuardRef" />
    </div>
  </ArtPermissionGuard>
</template>

<script setup lang="tsx">
  import { orderBy, uniqBy } from 'lodash-es'
  import { useRoute, useRouter } from 'vue-router'
  import { storeToRefs } from 'pinia'
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
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { startWorkflow } from '@/api/workflow'
  import {
    canDeleteExpenseDocument,
    resolveExpenseDeleteResources
  } from '../shared/expense-delete-resources'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import ArtEmployeeSelect from '@/components/business/art-employee-select/index.vue'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import type { TableRequestOptions } from '@/hooks/core/useTable'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { documentGroupSpan } from '@/utils/business/document-detail-list'
  import { formatCurrencyValue } from '@/utils/ui'
  import {
    fetchTravelApplicationList,
    fetchTravelApplicationDetail,
    deleteTravelApplications,
    fetchTravelItineraryList,
    type TravelApplication,
    type TravelApplicationSearch,
    type TravelLineRecord
  } from '@fms/api'
  import TravelApplicationDialog from './modules/travel-application-dialog.vue'
  import TravelApplicationPrintSheet from './modules/travel-application-print-sheet.vue'

  defineOptions({ name: 'FinanceTravelApplication' })
  interface DialogExpose {
    handleOpen: (data?: {
      row?: TravelApplication
      copy?: boolean
      readonly?: boolean
    }) => Promise<void>
  }
  type TableRecord = TravelApplication | TravelLineRecord
  type TravelSearch = TravelApplicationSearch & { displayMode: 'document' | 'line' }
  const tableRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<DialogExpose>()
  const printRef = ref<InstanceType<typeof TravelApplicationPrintSheet>>()
  const printing = ref(false)
  const route = useRoute()
  const router = useRouter()
  const { confirmAction } = useArtFeedback()
  const submittingId = ref<string | null>(null)
  const { hasAuth } = useAuth()
  const capturePrintOperation = useTenantOperationGuard('FinanceTravelApplication:Print')
  const captureViewOperation = useTenantOperationGuard('FinanceTravelApplication:View')
  const captureSubmitOperation = useTenantOperationGuard('FinanceTravelApplication:Submit')
  const { deleteGuardRef, deleteRecord, deleteRecords, deleteBusy } = useRecordDeleteGuard(
    'fms_travel_application',
    '出差申请单'
  )
  const lineProperties = new Set([
    'lineNo',
    'departurePlace',
    'destinationPlace',
    'startDate',
    'endDate',
    'expenseItem',
    'project',
    'requestedAmount'
  ])
  const { effectiveTenantId, isAllTenants } = storeToRefs(useTenantScopeStore())
  const statusOptions = useDictionaryOptions('fmsExpenseDocumentStatus')
  const displayModeOptions = useDictionaryOptions('commonDocumentDisplayMode')
  const search = ref<TravelSearch>({
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
      props: { optionType: 'button', 'aria-label': '出差申请列表展示方式' }
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
    { label: '申请人', key: 'applicantEmployeeId', type: 'input' },
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
      props: { placeholder: '单据编号、申请人或事由', clearable: true }
    }
  ])
  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      type: 'add',
      permission: 'FinanceTravelApplication:Add',
      label: '新增出差申请',
      onClick: () => dialogRef.value?.handleOpen()
    },
    {
      key: 'deleteSelected',
      label: '批量删除',
      icon: 'ri:delete-bin-line',
      permission: 'FinanceTravelApplication:Delete',
      selectionRequired: true,
      disabled: ({ selectedRows }) =>
        search.value.displayMode !== 'document' ||
        deleteBusy.value ||
        selectedRows.some((row) => !canDeleteExpenseDocument('application', row)),
      onClick: ({ selectedRows }) => deleteSelected(selectedRows as TravelApplication[])
    },
    {
      key: 'batchPrint',
      label: '批量打印',
      icon: 'ri:printer-line',
      permission: 'FinanceTravelApplication:Print',
      selectionRequired: true,
      buttonProps: { loading: printing.value },
      onClick: ({ selectedRows }) => printSelected(selectedRows as TableRecord[])
    }
  ])

  async function fetchTableData(
    params: TravelSearch & { current: number; size: number },
    options?: TableRequestOptions
  ) {
    const range = buildSupabasePageRange(params)
    const { displayMode, ...filters } = params
    const query = { ...filters, ...range, tenantId: effectiveTenantId.value }
    if (displayMode === 'line') {
      const result = await fetchTravelItineraryList(query, options)
      const rows = orderBy(
        result.data ?? [],
        [
          (row) => row.application.applicationDate,
          (row) => row.application.id,
          (row) => row.lineNo
        ],
        ['desc', 'asc', 'asc']
      )
      return { ...result, data: rows, total: result.total ?? 0 }
    }
    const result = await fetchTravelApplicationList(query, options)
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
          (row) => applicationOf(row).id ?? ''
        )
      : ([1, 1] as [number, number])
  }
  const applicationOf = (row: TableRecord): TravelApplication =>
    'application' in row ? row.application : row
  const money = (value: number | null | undefined): string =>
    value == null ? '—' : formatCurrencyValue(value)
  const columnsFactory = (): ColumnOption<TableRecord>[] => {
    if (search.value.displayMode === 'line') {
      return [
        { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
        {
          prop: 'applicationNo',
          label: '单据编号',
          minWidth: 170,
          fixed: 'left',
          formatter: (row) => applicationOf(row).applicationNo
        },
        {
          prop: 'applicantName',
          label: '申请人',
          minWidth: 120,
          formatter: (row) => applicationOf(row).applicantName
        },
        {
          prop: 'lineNo',
          label: '行程',
          width: 75,
          formatter: (row) => ('lineNo' in row ? row.lineNo : '—')
        },
        { prop: 'departurePlace', label: '出发地', minWidth: 135 },
        { prop: 'destinationPlace', label: '目的地', minWidth: 135 },
        { prop: 'startDate', label: '开始日期', width: 125 },
        { prop: 'endDate', label: '结束日期', width: 125 },
        {
          prop: 'expenseItem',
          label: '费用项目',
          minWidth: 140,
          formatter: (row) => ('expenseItem' in row ? row.expenseItem?.itemName || '—' : '—')
        },
        {
          prop: 'project',
          label: '项目',
          minWidth: 140,
          formatter: (row) =>
            'project' in row
              ? row.project?.projectName || (row.projectId ? '已关联项目' : '—')
              : '—'
        },
        {
          prop: 'requestedAmount',
          label: '申请金额',
          width: 125,
          align: 'right',
          formatter: (row) => money(row.requestedAmount)
        },
        {
          prop: 'status',
          label: '状态',
          width: 100,
          dict: {
            code: 'fmsExpenseDocumentStatus',
            display: 'tag',
            value: (row) => applicationOf(row).status
          }
        },
        {
          prop: 'operation',
          label: '操作',
          width: 230,
          fixed: 'right',
          formatter: (row) => applicationActions(applicationOf(row))
        }
      ]
    }
    return [
      { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
      {
        prop: 'applicationNo',
        label: '单据编号',
        minWidth: 175,
        fixed: 'left',
        showOverflowTooltip: true
      },
      { prop: 'applicantName', label: '申请人', minWidth: 115 },
      { prop: 'applicationDate', label: '申请日期', width: 120 },
      { prop: 'reason', label: '事由', minWidth: 180, showOverflowTooltip: true },
      {
        prop: 'requestedAmount',
        label: '申请金额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(row.requestedAmount)
      },
      {
        prop: 'loanAmount',
        label: '借款金额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(applicationOf(row).loanAmount)
      },
      {
        prop: 'approvedAmount',
        label: '核定金额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(applicationOf(row).approvedAmount)
      },
      {
        prop: 'pendingCollectionAmount',
        label: '待收款金额（元）',
        width: 145,
        align: 'right',
        formatter: (row) => money(applicationOf(row).pendingCollectionAmount)
      },
      {
        prop: 'repaidAmount',
        label: '已还款金额（元）',
        width: 145,
        align: 'right',
        formatter: (row) => money(applicationOf(row).repaidAmount)
      },
      {
        prop: 'remainingBalance',
        label: '未还余额（元）',
        width: 135,
        align: 'right',
        formatter: (row) => money(applicationOf(row).remainingBalance)
      },
      {
        prop: 'usedAmount',
        label: '已用金额（元）',
        width: 130,
        align: 'right',
        formatter: (row) => money(applicationOf(row).usedAmount)
      },
      {
        prop: 'paidAmount',
        label: '已付金额（元）',
        width: 130,
        align: 'right',
        formatter: (row) => money(applicationOf(row).paidAmount)
      },
      { prop: 'currentHandler', label: '当前处理人', minWidth: 130 },
      {
        prop: 'status',
        label: '单据状态',
        width: 110,
        dict: { code: 'fmsExpenseDocumentStatus', display: 'tag' }
      },
      { prop: 'rejectionOpinion', label: '反审核意见', minWidth: 150, showOverflowTooltip: true },
      { prop: 'expenseDepartmentName', label: '部门', minWidth: 135, showOverflowTooltip: true },
      { prop: 'remark', label: '备注', minWidth: 160, showOverflowTooltip: true },
      {
        prop: 'attachmentUrls',
        label: '附件',
        width: 75,
        formatter: (row) => `${applicationOf(row).attachmentUrls?.length ?? 0} 个`
      },
      {
        prop: 'operation',
        label: '操作',
        width: 230,
        fixed: 'right',
        formatter: (row) => applicationActions(applicationOf(row))
      }
    ]
  }
  function refreshTable(): Promise<unknown> {
    return tableRef.value?.refreshData() ?? Promise.resolve()
  }
  function applicationActions(row: TravelApplication) {
    return (
      <BusinessTableRowActions>
        <ArtButtonTable
          type="view"
          permission="FinanceTravelApplication:View"
          onClick={() => dialogRef.value?.handleOpen({ row, readonly: true })}
        />
        <ArtButtonTable
          type="edit"
          permission="FinanceTravelApplication:Edit"
          disabled={!['draft', 'rejected'].includes(row.status)}
          onClick={() => dialogRef.value?.handleOpen({ row })}
        />
        <ArtButtonTable
          icon="ri:file-copy-line"
          label="复制出差申请"
          permission="FinanceTravelApplication:Copy"
          disabled={!hasAuth('FinanceTravelApplication:Add')}
          onClick={() => dialogRef.value?.handleOpen({ row, copy: true })}
        />
        {row.status === 'draft' ? (
          <ArtButtonTable
            type="delete"
            permission="FinanceTravelApplication:Delete"
            disabled={deleteBusy.value}
            onClick={() => void deleteOne(row)}
          />
        ) : null}
        {['draft', 'rejected'].includes(row.status) ? (
          <ArtButtonTable
            icon="ri:send-plane-line"
            label="提交审批"
            permission="FinanceTravelApplication:Submit"
            disabled={Boolean(submittingId.value)}
            onClick={() => void submitApplication(row)}
          />
        ) : null}
        {['approved', 'paid', 'closed'].includes(row.status) ? (
          <ArtButtonTable
            icon="ri:refund-2-line"
            label="下推差旅报销"
            permission="FinanceTravelApplication:PushReimbursement"
            disabled={
              !hasAuth('FinanceExpenseReimbursement:Add') ||
              !hasAuth('FinanceExpenseReimbursement:View')
            }
            onClick={() =>
              void router.push({
                name: 'FinanceExpenseReimbursement',
                query: { fromApplication: row.id }
              })
            }
          />
        ) : null}
      </BusinessTableRowActions>
    )
  }
  async function submitApplication(row: TravelApplication): Promise<void> {
    if (submittingId.value || !hasAuth('FinanceTravelApplication:Submit')) return
    const isCurrent = captureSubmitOperation()
    submittingId.value = row.id
    try {
      await confirmAction(
        `提交出差申请“${row.applicationNo}”后，申请人与行程预算将锁定。`,
        '提交出差审批',
        {
          confirmButtonText: '提交审批'
        }
      )
      if (!isCurrent()) {
        ElMessage.warning('操作范围或权限已变化，请重新查询后提交')
        return
      }
      await startWorkflow({
        businessType: 'fms_travel_application',
        businessId: row.id,
        businessTitle: `出差申请 ${row.applicationNo}`
      })
      if (isCurrent()) await refreshTable()
    } catch (error) {
      if (isCurrent() && error !== 'cancel' && error !== 'close')
        notifyFriendlyError(error, '出差申请提交失败，请核对行程和已启用的审批流程后重试')
    } finally {
      submittingId.value = null
    }
  }
  async function deleteOne(row: TravelApplication): Promise<void> {
    await deleteRecord({
      resource: { id: row.id, label: row.applicationNo },
      resolveResources: () => resolveExpenseDeleteResources('application', [row.id]),
      successMessage: '出差申请已删除',
      permission: 'FinanceTravelApplication:Delete',
      remove: () => deleteTravelApplications([row.id]),
      onDeleted: refreshTable
    })
  }
  async function deleteSelected(rows: TravelApplication[]): Promise<void> {
    if (search.value.displayMode !== 'document' || !rows.length) return
    await deleteRecords({
      resources: rows.map((row) => ({ id: row.id, label: row.applicationNo })),
      resolveResources: () =>
        resolveExpenseDeleteResources(
          'application',
          rows.map((row) => row.id)
        ),
      successMessage: '所选出差申请已删除',
      permission: 'FinanceTravelApplication:Delete',
      remove: () => deleteTravelApplications(rows.map((row) => row.id)),
      onDeleted: refreshTable
    })
  }
  async function printSelected(rows: TableRecord[]): Promise<void> {
    if (!hasAuth('FinanceTravelApplication:Print') || printing.value || !rows.length) return
    const isCurrent = capturePrintOperation()
    printing.value = true
    try {
      const selected = uniqBy(rows.map(applicationOf), (row) => row.id)
      const details = await Promise.all(selected.map((row) => fetchTravelApplicationDetail(row.id)))
      if (!isCurrent()) return
      const records = details.flatMap((result) => (result.data ? [result.data] : []))
      if (records.length !== selected.length) throw new Error('部分申请已变化，请刷新后重试')
      await printRef.value?.print(records)
    } catch (error) {
      if (isCurrent()) notifyFriendlyError(error, '出差申请打印内容加载失败，请重试')
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
    () => route.query.applicationId,
    async (id) => {
      if (typeof id !== 'string' || !id || !hasAuth('FinanceTravelApplication:View')) return
      const isCurrent = captureViewOperation()
      try {
        const { data } = await fetchTravelApplicationDetail(id)
        if (!isCurrent()) return
        if (!data) throw new Error('关联申请不可用')
        search.value.displayMode = 'document'
        search.value.keyword = data.applicationNo
        await nextTick()
        if (!isCurrent()) return
        await tableRef.value?.getData()
      } catch (error) {
        if (isCurrent()) notifyFriendlyError(error, '关联出差申请定位失败，请刷新后重试')
      }
    },
    { immediate: true }
  )
</script>
