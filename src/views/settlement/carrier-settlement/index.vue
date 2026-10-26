<template>
  <div class="business-workspace-page art-full-height">
    <MasterDeleteProcessingNotice
      :table="tableQueryRef"
      v-if="deleteContext.active"
      :customer-id="deleteContext.customerId"
      :customer-name="deleteContext.customerName"
      action-hint="请核对关联对账单；财务历史不可随主数据级联删除。"
    />
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="CARRIER SETTLEMENT"
      title="承运商对账"
      description="归集承运成本与结算周期，跟踪账单确认、付款申请和供应商结算进度。"
      icon="ri:hand-coin-line"
      :tags="[
        { label: '应付对账', type: 'primary' },
        { label: '成本核验', type: 'warning' }
      ]"
      :metrics="metrics"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableQueryRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ElAlert
      v-if="linkedDocumentError"
      class="mb-4!"
      type="error"
      title="关联承运商对账单暂未打开"
      :closable="false"
      show-icon
    >
      <span>请核对来源查看权限与租户范围，原链接已保留。</span>
      <ElButton type="primary" link @click="retryLinkedDocument"
        ><ArtSvgIcon icon="ri:refresh-line" />重新打开对账单</ElButton
      >
    </ElAlert>
    <ArtTableQuery
      ref="tableQueryRef"
      :model-value="searchQuery"
      @update:model-value="replaceReactiveModel(searchQuery, $event)"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :columns-factory="columnsFactory"
      :header-actions="headerActions"
      header-actions-placement="workspace"
      refresh-feedback="icon"
      :search-bar-props="{ span: 6, labelWidth: 86, isExpand: true, showExpand: false }"
      :table-props="{
        rowKey: 'id',
        tableLayout: 'fixed',
        emptyText: '暂无承运商对账单',
        emptyDescription: '可创建承运商对账单，或调整承运商、状态、周期和单号后查询。'
      }"
      focusable
    />
    <CarrierStatementDialog ref="dialogRef" @success="handleCreateSuccess" />
    <CarrierStatementDetailDrawer ref="drawerRef" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </div>
</template>

<script setup lang="tsx">
  import { replaceReactiveModel } from '@/utils/form/model'
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
    deleteCarrierStatement,
    exportCarrierStatementList,
    fetchCarrierOptions,
    fetchCarrierStatementList,
    fetchCarrierStatementDetail,
    updateCarrierStatementStatus
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
  import { useRouteDocumentDrawer } from '@/hooks/core/useRouteDocumentDrawer'
  import CarrierStatementDialog from './modules/carrier-statement-dialog.vue'
  import CarrierStatementDetailDrawer from './modules/carrier-statement-detail-drawer.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useMasterDataDeleteProcessingContext } from '@/hooks/core/useMasterDataDeleteProcessing'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'

  defineOptions({ name: 'FinanceCarrierSettlement' })

  type Statement = Api.Fms.CarrierStatementRecord
  type StatementFieldKey = Api.Fms.CarrierStatementFieldKey
  type SearchParams = Api.Fms.CarrierStatementSearchParams
  type TableParams = SearchParams & Pick<Api.Common.PaginationParams, 'current' | 'size'>

  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const { promptReason, confirmAction } = useArtFeedback()
  const { hasAuth } = useAuth()
  const route = useRoute()
  const deleteContext = useMasterDataDeleteProcessingContext()
  const tableQueryRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<{ handleOpen: () => Promise<void> }>()
  const drawerRef = ref<{ handleOpen: (row: Statement, preloaded?: boolean) => Promise<void> }>()
  const { error: linkedDocumentError, retry: retryLinkedDocument } = useRouteDocumentDrawer({
    routeName: 'FinanceCarrierSettlement',
    queryKey: 'recordId',
    canOpen: () => hasAuth('FinanceCarrierSettlement:View'),
    fetchDocument: async (id) => {
      const result = await fetchCarrierStatementDetail(id)
      if (result.error) throw result.error
      if (!result.data || result.data.id !== id) throw new Error('对账单不存在或暂无查看权限')
      return result.data
    },
    openDocument: async (record) => {
      if (!drawerRef.value) throw new Error('对账详情尚未就绪，请重试')
      await drawerRef.value.handleOpen(record, true)
    }
  })
  const { deleteGuardRef, deleteRecord } = useRecordDeleteGuard(
    'tms_carrier_statement',
    '承运商对账单'
  )
  const carrierOptions = ref<Array<{ label: string; value: string }>>([])
  const fieldAccess = ref<Api.Fms.CarrierStatementFieldAccessMap>({})
  const currentRows = ref<Statement[]>([])
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
      description: '待核对费用明细',
      icon: 'ri:edit-line',
      tone: 'info'
    },
    {
      key: 'review',
      label: '本页待审核',
      value: currentRows.value.filter((row) => row.status === 'pending_review').length,
      description: '需确认承运成本',
      icon: 'ri:time-line',
      tone: 'warning'
    },
    {
      key: 'confirmed',
      label: '本页已确认',
      value: currentRows.value.filter((row) => row.status === 'confirmed').length,
      description: '可继续付款与开票',
      icon: 'ri:checkbox-circle-line',
      tone: 'success'
    }
  ])
  const searchQuery = reactive<SearchParams>({
    carrierId: deleteContext.value.carrierId,
    keyword: '',
    periodRange: [],
    recordId: deleteContext.value.recordId,
    status: typeof route.query.status === 'string' ? route.query.status : ''
  })

  const searchItems = computed<SearchFormItem[]>(() => [
    {
      label: '对账承运商',
      key: 'carrierId',
      type: 'select',
      props: {
        options: carrierOptions.value,
        filterable: true,
        clearable: true,
        placeholder: '请选择承运商'
      }
    },
    {
      label: '对账状态',
      key: 'status',
      type: 'select',
      props: { options: getDictMap.value.tmsSettlementStatus ?? [], clearable: true }
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
      props: { clearable: true, placeholder: '对账单号、承运商或备注' }
    }
  ])

  const renderStatusActions = (row: Statement) => {
    if (row.status === 'draft')
      return hasAuth('FinanceCarrierSettlement:Submit') ? (
        <ArtButtonTable
          type="sign"
          icon="ri:send-plane-line"
          label="提交审核"
          permission="FinanceCarrierSettlement:Submit"
          onClick={() => void changeStatus(row, 'pending_review')}
        />
      ) : null
    if (row.status === 'pending_review')
      return hasAuth('FinanceCarrierSettlement:Approve') ? (
        <ArtButtonTable
          type="sign"
          label="审核通过"
          permission="FinanceCarrierSettlement:Approve"
          onClick={() => void changeStatus(row, 'confirmed')}
        />
      ) : null
    return null
  }

  const getMoreActions = (row: Statement): ButtonMoreItem[] => {
    if (row.status === 'draft')
      return [
        {
          key: 'delete',
          auth: 'FinanceCarrierSettlement:Delete',
          label: '删除草稿',
          icon: 'ri:delete-bin-line',
          color: 'var(--el-color-danger)'
        }
      ]
    if (row.status === 'pending_review')
      return [
        {
          key: 'reject',
          auth: 'FinanceCarrierSettlement:Reject',
          label: '驳回对账单',
          icon: 'ri:arrow-go-back-line',
          color: 'var(--el-color-danger)'
        }
      ]
    if (row.status === 'confirmed')
      return [
        {
          key: 'void',
          auth: 'FinanceCarrierSettlement:Void',
          label: '作废对账单',
          icon: 'ri:close-circle-line',
          color: 'var(--el-color-danger)'
        }
      ]
    return []
  }

  const handleMoreAction = (item: ButtonMoreItem, row: Statement): void => {
    if (item.key === 'delete') void handleDelete(row)
    if (item.key === 'reject') void handleReject(row)
    if (item.key === 'void') void handleVoid(row)
  }

  const columnsFactory = (): ColumnOption<Statement>[] => [
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
      prop: 'carrierName',
      label: '对账承运商',
      minWidth: 185,
      formatter: (row) => (
        <div
          class="min-w-0 py-1"
          title={`${row.carrierName} · ${row.costCount} 笔费用 · ${row.waybillCount} 单运单`}
        >
          <strong class="block truncate text-sm font-medium text-[var(--el-text-color-primary)]">
            {row.carrierName}
          </strong>
          <small class="block truncate text-xs text-[var(--el-text-color-secondary)]">
            {row.costCount} 笔费用 · {row.waybillCount} 单运单
          </small>
        </div>
      )
    },
    ...(canViewListField('statementAmounts')
      ? [
          {
            prop: 'statementAmount',
            label: '应付金额',
            width: 125,
            align: 'right' as const,
            formatter: (row: Statement) =>
              formatSensitiveNumberWithAffix(row.statementAmount, { prefix: '¥' })
          }
        ]
      : []),
    ...(canViewListField('settlementAmounts')
      ? [
          {
            prop: 'outstandingAmount',
            label: '付款余额',
            width: 150,
            align: 'right' as const,
            formatter: (row: Statement) => (
              <div
                class="py-1 text-right leading-5"
                title={`已付 ${formatSensitiveNumberWithAffix(row.settledAmount, { prefix: '¥' })} · 未付 ${formatSensitiveNumberWithAffix(row.outstandingAmount, { prefix: '¥' })}`}
              >
                <small class="block text-xs text-[var(--el-text-color-secondary)]">
                  已付 {formatSensitiveNumberWithAffix(row.settledAmount, { prefix: '¥' })}
                </small>
                <strong class="block text-sm font-semibold text-[var(--el-text-color-primary)]">
                  未付 {formatSensitiveNumberWithAffix(row.outstandingAmount, { prefix: '¥' })}
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
          {hasAuth('FinanceCarrierSettlement:View') ? (
            <ArtButtonTable
              type="view"
              permission="FinanceCarrierSettlement:View"
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

  const excelColumns = computed<ArtTableQueryExcelColumn[]>(() => [
    { key: 'statementNo', title: '对账单号' },
    { key: 'carrierName', title: '对账承运商' },
    { key: 'periodStart', title: '账期开始' },
    { key: 'periodEnd', title: '账期结束' },
    { key: 'costCount', title: '费用数' },
    { key: 'waybillCount', title: '运单数' },
    ...(canViewListField('statementAmounts')
      ? [{ key: 'statementAmount', title: '应付金额' }]
      : []),
    ...(canViewListField('settlementAmounts')
      ? [
          { key: 'settledAmount', title: '已付金额' },
          { key: 'outstandingAmount', title: '未付金额' }
        ]
      : []),
    { key: 'status', title: '状态' }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceCarrierSettlement:Add',
      type: 'add',
      label: '生成承运商对账单',
      onClick: () => void dialogRef.value?.handleOpen()
    },
    {
      permission: 'FinanceCarrierSettlement:Export',
      type: 'export',
      exportFilename: 'TMS承运商对账单',
      exportSheetName: '承运商对账单',
      exportColumns: excelColumns.value,
      exportApi: ({ selectedIds, searchParams, maxRows }) =>
        exportCarrierStatementList({
          ...(searchParams as SearchParams),
          ids: selectedIds.map(String),
          maxRows
        })
    }
  ])

  async function fetchTableData(params: TableParams) {
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    const result = await fetchCarrierStatementList({ ...params, from, to })

    fieldAccess.value = result.fieldAccess
    currentRows.value = result.data
    totalCount.value = result.total

    return result
  }

  const canViewListField = (field: StatementFieldKey): boolean =>
    canViewField(
      mergeFieldAccessMaps(fieldAccess.value, ...currentRows.value.map((row) => row.fieldAccess)),
      field
    )

  async function changeStatus(row: Statement, status: Api.Fms.CustomerStatementStatus) {
    const label = status === 'pending_review' ? '提交审核' : '审核通过'
    try {
      await confirmAction(`确定${label}对账单 ${row.statementNo} 吗？`, label, {
        type: 'warning'
      })
    } catch {
      return
    }
    try {
      await updateCarrierStatementStatus({
        id: row.id,
        status,
        businessTitle: `承运商对账单 ${row.statementNo}`
      })
      await tableQueryRef.value?.refreshUpdate()
    } catch (error) {
      notifyFriendlyError(error, `${label}失败，请检查审批流程配置后重试`)
    }
  }

  async function handleReject(row: Statement) {
    try {
      const reason = await promptReason('请填写驳回原因', '驳回对账单', {
        confirmButtonText: '确认驳回',
        emptyMessage: '驳回原因不能为空',
        placeholder: '请说明对账单被驳回的原因'
      })
      await updateCarrierStatementStatus({
        id: row.id,
        status: 'draft',
        reviewRemark: reason,
        businessTitle: `承运商对账单 ${row.statementNo}`
      })
      await tableQueryRef.value?.refreshUpdate()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '驳回失败，请刷新审批状态后重试')
      }
    }
  }

  async function handleVoid(row: Statement) {
    try {
      const reason = await promptReason('作废后会释放费用，可重新生成对账单。', '作废对账单', {
        confirmButtonText: '确认作废',
        emptyMessage: '作废原因不能为空',
        placeholder: '请填写作废原因'
      })
      await updateCarrierStatementStatus({ id: row.id, status: 'voided', voidReason: reason })
      await tableQueryRef.value?.refreshUpdate()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '作废失败，请刷新对账单后重试')
      }
    }
  }

  async function handleDelete(row: Statement) {
    await deleteRecord({
      resource: { id: row.id, label: row.statementNo },
      permission: 'FinanceCarrierSettlement:Delete',
      confirmMessage: `确认删除承运商对账单 ${row.statementNo}？仅草稿可删除，删除后无法恢复。`,
      remove: () => deleteCarrierStatement(row.id),
      onDeleted: async () => {
        await tableQueryRef.value?.refreshRemove()
      }
    })
  }

  async function loadCarrierOptions() {
    const { data } = await fetchCarrierOptions()
    carrierOptions.value = (data ?? []).map((item) => ({ label: item.companyName, value: item.id }))
  }

  function handleCreateSuccess() {
    void tableQueryRef.value?.refreshCreate()
  }
  function syncMasterDeleteRoute(forceRefresh = false): void {
    const context = deleteContext.value
    const carrierId = context.active ? context.carrierId : ''
    const recordId = context.active ? context.recordId : ''
    const changed = searchQuery.carrierId !== carrierId || searchQuery.recordId !== recordId
    Object.assign(searchQuery, {
      carrierId,
      recordId
    })
    if (context.active || changed) {
      Object.assign(searchQuery, { keyword: '', periodRange: [], status: '' })
    }
    if (changed || forceRefresh) void nextTick().then(() => tableQueryRef.value?.refreshCreate())
  }
  watch(
    () => route.fullPath,
    () => syncMasterDeleteRoute(),
    { flush: 'post' }
  )

  watch(
    () => route.query.status,
    (value) => {
      if (typeof value !== 'string' || searchQuery.status === value) return
      searchQuery.status = value
      void tableQueryRef.value?.getData()
    }
  )
  onActivated(() => syncMasterDeleteRoute(true))
  onMounted(() => {
    void userStore.ensureDictLoaded('tmsSettlementStatus').catch(() => undefined)
    void loadCarrierOptions()
  })
</script>
