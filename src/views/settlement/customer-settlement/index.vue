<template>
  <div class="business-workspace-page art-full-height">
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="CUSTOMER SETTLEMENT"
      title="客户对账"
      description="按客户汇总运输应收、对账周期与单据状态，推动确认、开票和回款流程衔接。"
      icon="ri:bill-line"
      :tags="[
        { label: '应收对账', type: 'primary' },
        { label: '回款前置', type: 'success' }
      ]"
      :metrics="metrics"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableQueryRef" />
      </template>
    </BusinessWorkspaceHeader>

    <MasterDeleteProcessingNotice
      :table="tableQueryRef"
      v-if="customerDeleteContext.active"
      :customer-id="customerDeleteContext.customerId"
      :customer-name="customerDeleteContext.customerName"
      action-hint="请核对关联对账单。草稿可直接删除；其他状态请先按现有审核、驳回或作废规则处理。"
    />

    <ArtTableQuery
      ref="tableQueryRef"
      v-model="searchQuery"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :columns-factory="columnsFactory"
      :header-actions="headerActions"
      header-actions-placement="workspace"
      :search-bar-props="{ span: 6, labelWidth: 86, isExpand: true, showExpand: false }"
      :table-props="{
        rowKey: 'id',
        tableLayout: 'fixed',
        emptyText: '暂无客户对账单',
        emptyDescription: '可创建客户对账单，或调整客户、状态、周期和单号后重新查询。'
      }"
      focusable
    />

    <CustomerStatementDialog ref="dialogRef" @success="handleCreateSuccess" />
    <CustomerStatementDetailDrawer ref="drawerRef" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </div>
</template>

<script setup lang="tsx">
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExcelColumn,
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import type { ColumnOption } from '@/types'
  import {
    deleteCustomerStatement,
    exportCustomerStatementList,
    fetchCustomerOptions,
    fetchCustomerStatementList,
    updateCustomerStatementStatus
  } from '@fms/api'
  import { useUserStore } from '@/store/modules/user'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import {
    canViewField,
    mergeFieldAccessMaps,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useAuth } from '@/hooks/core/useAuth'
  import CustomerStatementDialog from './modules/customer-statement-dialog.vue'
  import CustomerStatementDetailDrawer from './modules/customer-statement-detail-drawer.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import { useMasterDataDeleteProcessingContext } from '@/hooks/core/useMasterDataDeleteProcessing'

  defineOptions({ name: 'FinanceCustomerSettlement' })

  type CustomerStatement = Api.Fms.CustomerStatementRecord
  type CustomerStatementFieldKey = Api.Fms.CustomerStatementFieldKey
  type SearchParams = Api.Fms.CustomerStatementSearchParams
  type TableParams = SearchParams & Pick<Api.Common.PaginationParams, 'current' | 'size'>

  interface DialogExpose {
    handleOpen: () => Promise<void>
  }

  interface DrawerExpose {
    handleOpen: (row: CustomerStatement) => Promise<void>
  }

  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const { promptReason, confirmAction } = useArtFeedback()
  const { hasAuth } = useAuth()
  const route = useRoute()
  const customerDeleteContext = useMasterDataDeleteProcessingContext()
  const tableQueryRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<DialogExpose>()
  const drawerRef = ref<DrawerExpose>()
  const { deleteGuardRef, deleteRecord } = useRecordDeleteGuard(
    'tms_customer_statement',
    '客户对账单'
  )
  const customerOptions = ref<Array<{ label: string; value: string }>>([])
  const fieldAccess = ref<Api.Fms.CustomerStatementFieldAccessMap>({})
  const currentRows = ref<CustomerStatement[]>([])
  const openedRouteRecordId = ref('')
  const totalCount = ref(0)
  const metrics = computed<BusinessWorkspaceMetric[]>(() => [
    {
      key: 'total',
      label: '当前结果',
      value: totalCount.value,
      description: '随筛选条件更新',
      icon: 'ri:file-list-3-line'
    },
    {
      key: 'draft',
      label: '本页草稿',
      value: currentRows.value.filter((row) => row.status === 'draft').length,
      description: '待提交审核',
      icon: 'ri:edit-line',
      tone: 'info'
    },
    {
      key: 'review',
      label: '本页待审核',
      value: currentRows.value.filter((row) => row.status === 'pending_review').length,
      description: '需核对金额与运单',
      icon: 'ri:time-line',
      tone: 'warning'
    },
    {
      key: 'confirmed',
      label: '本页已确认',
      value: currentRows.value.filter((row) => row.status === 'confirmed').length,
      description: '可继续开票和回款',
      icon: 'ri:checkbox-circle-line',
      tone: 'success'
    }
  ])
  const searchQuery = ref<SearchParams>({
    customerId:
      customerDeleteContext.value.customerId ||
      (typeof route.query.customerId === 'string' ? route.query.customerId : ''),
    keyword: '',
    periodRange: [],
    recordId:
      customerDeleteContext.value.recordId ||
      (typeof route.query.recordId === 'string' ? route.query.recordId : ''),
    status: typeof route.query.status === 'string' ? route.query.status : ''
  })

  const searchItems = computed<SearchFormItem[]>(() => [
    {
      label: '对账客户',
      key: 'customerId',
      type: 'select',
      props: {
        options: customerOptions.value,
        filterable: true,
        clearable: true,
        placeholder: '请选择客户'
      }
    },
    {
      label: '对账状态',
      key: 'status',
      type: 'select',
      props: {
        options: getDictMap.value.tmsSettlementStatus ?? [],
        clearable: true
      }
    },
    {
      label: '对账账期',
      key: 'periodRange',
      type: 'date',
      props: {
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
        startPlaceholder: '开始日期',
        endPlaceholder: '结束日期',
        rangeSeparator: '至'
      }
    },
    {
      label: '关键词',
      key: 'keyword',
      type: 'input',
      props: {
        clearable: true,
        placeholder: '对账单号、客户或备注'
      }
    }
  ])

  const columnsFactory = (): ColumnOption<CustomerStatement>[] => [
    { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
    {
      prop: 'statementNo',
      label: '对账单',
      minWidth: 195,
      formatter: (row) => (
        <div
          class="min-w-0 py-1"
          title={`${row.statementNo} · ${row.periodStart} 至 ${row.periodEnd}`}
        >
          <strong class="block truncate text-sm font-semibold text-[var(--el-text-color-primary)]">
            {row.statementNo}
          </strong>
          <small class="block truncate text-xs text-[var(--el-text-color-secondary)]">
            {row.periodStart} 至 {row.periodEnd}
          </small>
        </div>
      )
    },
    {
      prop: 'customerName',
      label: '对账客户',
      minWidth: 160,
      formatter: (row) => (
        <div class="min-w-0 py-1" title={`${row.customerName} · ${row.waybillCount} 单运单`}>
          <strong class="block truncate text-sm font-medium text-[var(--el-text-color-primary)]">
            {row.customerName}
          </strong>
          <small class="block truncate text-xs text-[var(--el-text-color-secondary)]">
            {row.waybillCount} 单运单
          </small>
        </div>
      )
    },
    ...(canViewListField('statementAmounts')
      ? [
          {
            prop: 'statementAmount',
            label: '对账金额',
            width: 125,
            align: 'right' as const,
            formatter: (row: CustomerStatement) =>
              formatSensitiveNumberWithAffix(row.statementAmount, { prefix: '¥' })
          }
        ]
      : []),
    ...(canViewListField('settlementAmounts')
      ? [
          {
            prop: 'outstandingAmount',
            label: '结算余额',
            width: 150,
            align: 'right' as const,
            formatter: (row: CustomerStatement) => (
              <div
                class="py-1 text-right leading-5"
                title={`已结 ${formatSensitiveNumberWithAffix(row.settledAmount, { prefix: '¥' })} · 未结 ${formatSensitiveNumberWithAffix(row.outstandingAmount, { prefix: '¥' })}`}
              >
                <small class="block text-xs text-[var(--el-text-color-secondary)]">
                  已结 {formatSensitiveNumberWithAffix(row.settledAmount, { prefix: '¥' })}
                </small>
                <strong class="block text-sm font-semibold text-[var(--el-text-color-primary)]">
                  未结 {formatSensitiveNumberWithAffix(row.outstandingAmount, { prefix: '¥' })}
                </strong>
              </div>
            )
          }
        ]
      : []),
    {
      prop: 'status',
      label: '状态',
      width: 100,
      dict: { code: 'tmsSettlementStatus', display: 'tag' }
    },
    {
      prop: 'operation',
      label: '操作',
      width: 138,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          {hasAuth('FinanceCustomerSettlement:View') ? (
            <ArtButtonTable
              type="view"
              permission="FinanceCustomerSettlement:View"
              onClick={() => void drawerRef.value?.handleOpen(row)}
            />
          ) : null}
          {renderStatusActions(row)}
          <ArtButtonMore
            trigger="click"
            list={() => getMoreActions(row)}
            onClick={(item: ButtonMoreItem) => handleMoreAction(item, row)}
          />
        </BusinessTableRowActions>
      )
    }
  ]

  const renderStatusActions = (row: CustomerStatement) => {
    if (row.status === 'draft') {
      return hasAuth('FinanceCustomerSettlement:Submit') ? (
        <ArtButtonTable
          type="sign"
          icon="ri:send-plane-line"
          label="提交审核"
          permission="FinanceCustomerSettlement:Submit"
          onClick={() => void handleSubmitReview(row)}
        />
      ) : null
    }
    if (row.status === 'pending_review') {
      return hasAuth('FinanceCustomerSettlement:Approve') ? (
        <ArtButtonTable
          type="sign"
          label="审核通过"
          permission="FinanceCustomerSettlement:Approve"
          onClick={() => void handleApprove(row)}
        />
      ) : null
    }
    return null
  }

  const getMoreActions = (row: CustomerStatement): ButtonMoreItem[] => {
    if (row.status === 'draft')
      return [
        {
          key: 'delete',
          auth: 'FinanceCustomerSettlement:Delete',
          label: '删除草稿',
          icon: 'ri:delete-bin-line',
          color: 'var(--el-color-danger)'
        }
      ]
    if (row.status === 'pending_review')
      return [
        {
          key: 'reject',
          auth: 'FinanceCustomerSettlement:Reject',
          label: '驳回对账单',
          icon: 'ri:arrow-go-back-line',
          color: 'var(--el-color-danger)'
        }
      ]
    if (row.status === 'confirmed')
      return [
        {
          key: 'void',
          auth: 'FinanceCustomerSettlement:Void',
          label: '作废对账单',
          icon: 'ri:close-circle-line',
          color: 'var(--el-color-danger)'
        }
      ]
    return []
  }

  const handleMoreAction = (item: ButtonMoreItem, row: CustomerStatement): void => {
    if (item.key === 'delete') void handleDelete(row)
    if (item.key === 'reject') void handleReject(row)
    if (item.key === 'void') void handleVoid(row)
  }

  const excelColumns = computed<ArtTableQueryExcelColumn[]>(() => [
    { key: 'statementNo', title: '对账单号' },
    { key: 'customerName', title: '对账客户' },
    { key: 'periodStart', title: '账期开始' },
    { key: 'periodEnd', title: '账期结束' },
    { key: 'waybillCount', title: '运单数' },
    ...(canViewListField('statementAmounts')
      ? [{ key: 'statementAmount', title: '对账金额' }]
      : []),
    ...(canViewListField('settlementAmounts')
      ? [
          { key: 'settledAmount', title: '已结金额' },
          { key: 'outstandingAmount', title: '未结金额' }
        ]
      : []),
    { key: 'status', title: '状态' },
    { key: 'createBy', title: '创建人' },
    { key: 'createTime', title: '创建时间' }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceCustomerSettlement:Add',
      type: 'add',
      label: '生成客户对账单',
      onClick: () => void dialogRef.value?.handleOpen()
    },
    {
      permission: 'FinanceCustomerSettlement:Export',
      type: 'export',
      exportFilename: 'TMS客户对账单',
      exportSheetName: '客户对账单',
      exportColumns: excelColumns.value,
      exportApi: ({ selectedIds, searchParams, maxRows }) =>
        exportCustomerStatementList({
          ...(searchParams as SearchParams),
          ids: selectedIds.map(String),
          maxRows
        })
    }
  ])

  const fetchTableData = async (params: TableParams) => {
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    const result = await fetchCustomerStatementList({ ...params, from, to })

    fieldAccess.value = result.fieldAccess
    currentRows.value = result.data
    totalCount.value = result.total

    return result
  }

  const canViewListField = (field: CustomerStatementFieldKey): boolean =>
    canViewField(
      mergeFieldAccessMaps(fieldAccess.value, ...currentRows.value.map((row) => row.fieldAccess)),
      field
    )

  const canViewRowField = (row: CustomerStatement, field: CustomerStatementFieldKey): boolean =>
    canViewField(row.fieldAccess ?? fieldAccess.value, field)

  async function loadCustomerOptions(): Promise<void> {
    const { data } = await fetchCustomerOptions()
    customerOptions.value = (data ?? []).map((item) => ({
      label: item.customerName,
      value: item.id
    }))
  }

  function handleCreateSuccess(): void {
    void tableQueryRef.value?.refreshCreate()
  }

  async function handleSubmitReview(row: CustomerStatement): Promise<void> {
    try {
      await confirmAction(
        `提交后将锁定 ${row.waybillCount} 条运单明细，确定提交审核吗？`,
        '提交审核',
        {
          type: 'warning',
          confirmButtonText: '提交',
          cancelButtonText: '取消'
        }
      )
      await updateCustomerStatementStatus({
        id: row.id,
        status: 'pending_review',
        businessTitle: `客户对账单 ${row.statementNo} · ${row.customerName}`
      })
      await tableQueryRef.value?.refreshUpdate()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '提交审核失败，请检查审批流程配置后重试')
      }
    }
  }

  async function handleApprove(row: CustomerStatement): Promise<void> {
    try {
      const amountHint = canViewRowField(row, 'statementAmounts')
        ? `对账金额 ${formatSensitiveNumberWithAffix(row.statementAmount, { prefix: '¥' })}`
        : '该对账单'
      await confirmAction(`确认${amountHint}无误并审核通过吗？`, '审核通过', {
        type: 'success',
        confirmButtonText: '通过',
        cancelButtonText: '取消'
      })
      await updateCustomerStatementStatus({ id: row.id, status: 'confirmed' })
      await tableQueryRef.value?.refreshUpdate()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '审核失败，请刷新审批状态后重试')
      }
    }
  }

  async function handleReject(row: CustomerStatement): Promise<void> {
    try {
      const reason = await promptReason('请填写驳回原因', '驳回对账单', {
        confirmButtonText: '确认驳回',
        emptyMessage: '驳回原因不能为空',
        placeholder: '请说明对账单被驳回的原因'
      })
      await updateCustomerStatementStatus({
        id: row.id,
        status: 'draft',
        reviewRemark: reason
      })
      await tableQueryRef.value?.refreshUpdate()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '驳回失败，请刷新审批状态后重试')
      }
    }
  }

  async function handleVoid(row: CustomerStatement): Promise<void> {
    try {
      const reason = await promptReason(
        '作废后会释放关联运单，可重新生成对账单；历史记录仍保留。',
        '作废对账单',
        {
          confirmButtonText: '确认作废',
          placeholder: '请填写作废原因',
          emptyMessage: '作废原因不能为空'
        }
      )
      await updateCustomerStatementStatus({
        id: row.id,
        status: 'voided',
        voidReason: reason
      })
      await tableQueryRef.value?.refreshUpdate()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '作废失败，请刷新对账单后重试')
      }
    }
  }

  async function handleDelete(row: CustomerStatement): Promise<void> {
    await deleteRecord({
      resource: { id: row.id, label: row.statementNo },
      permission: 'FinanceCustomerSettlement:Delete',
      confirmMessage: `确认删除客户对账单 ${row.statementNo}？仅草稿可删除，删除后无法恢复。`,
      remove: () => deleteCustomerStatement(row.id),
      onDeleted: async () => {
        await tableQueryRef.value?.refreshRemove()
      }
    })
  }

  function syncCustomerDeleteRoute(forceRefresh = false): void {
    const context = customerDeleteContext.value
    const customerId = context.active
      ? context.customerId
      : typeof route.query.customerId === 'string'
        ? route.query.customerId
        : ''
    const recordId = context.active
      ? context.recordId
      : typeof route.query.recordId === 'string'
        ? route.query.recordId
        : ''
    const changed =
      searchQuery.value.customerId !== customerId || searchQuery.value.recordId !== recordId
    Object.assign(searchQuery.value, {
      customerId,
      recordId
    })
    if (context.active || changed) {
      Object.assign(searchQuery.value, { keyword: '', periodRange: [], status: '' })
    }
    if (changed || forceRefresh) {
      void nextTick().then(() => tableQueryRef.value?.refreshCreate())
    }
  }

  watch(
    () => route.fullPath,
    () => syncCustomerDeleteRoute(),
    { flush: 'post' }
  )

  function openRouteRecordDetail(): void {
    const recordId = route.query.recordId
    if (
      typeof recordId !== 'string' ||
      !recordId ||
      openedRouteRecordId.value === recordId ||
      !hasAuth('FinanceCustomerSettlement:View')
    )
      return

    const row = currentRows.value.find((item) => item.id === recordId)
    if (!row) return

    openedRouteRecordId.value = recordId
    void nextTick()
      .then(() => drawerRef.value?.handleOpen(row))
      .catch((error) => {
        openedRouteRecordId.value = ''
        notifyFriendlyError(error, '客户对账详情打开失败，请刷新列表后重试')
      })
  }

  watch([() => route.query.recordId, currentRows], openRouteRecordDetail, { flush: 'post' })

  watch(
    () => route.query.recordId,
    () => {
      openedRouteRecordId.value = ''
    },
    { flush: 'sync' }
  )

  watch(
    () => route.query.status,
    (value) => {
      if (typeof value !== 'string' || searchQuery.value.status === value) return
      searchQuery.value.status = value
      void tableQueryRef.value?.getData()
    }
  )

  onActivated(() => {
    openedRouteRecordId.value = ''
    syncCustomerDeleteRoute(true)
    openRouteRecordDetail()
  })

  onMounted(() => {
    void userStore.ensureDictLoaded('tmsSettlementStatus').catch(() => undefined)
    void loadCustomerOptions()
  })
</script>
