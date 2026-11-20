<template>
  <FinanceAccountingWorkspaceShell class="fixed-asset-page" hide-master-delete-notice>
    <MasterDeleteProcessingNotice :table="tableRef" v-if="deleteContext.active" />
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="FIXED ASSET LEDGER"
      title="固定资产"
      description="以资产卡片为核心管理类别、转固、使用状态、月度折旧和处置，关键动作自动进入凭证生成队列。"
      icon="ri:building-2-line"
      :tags="[
        { label: '一卡一档', type: 'primary' },
        { label: '月度折旧', type: 'success' },
        { label: '处置留痕', type: 'warning' }
      ]"
      :metrics="metrics"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ArtTableQuery
      ref="tableRef"
      v-model="table.search"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :columns-factory="columnsFactory"
      :header-actions="headerActions"
      header-actions-placement="workspace"
      :search-bar-props="{ span: 6, labelWidth: 82, isExpand: true, showExpand: false }"
      :table-props="{
        rowKey: 'id',
        tableLayout: 'fixed',
        emptyText: '暂无固定资产',
        emptyDescription: '先建立资产类别，再新增资产卡片。'
      }"
      focusable
    />

    <FixedAssetDialog ref="dialogRef" @success="handleSaved" />
    <FixedAssetDisposalDialog ref="disposalDialogRef" @success="refreshAll" />
    <AssetCategoryDrawer ref="categoryDialogRef" @success="handleCategorySaved" />
    <AssetDepreciationDrawer ref="depreciationRef" @success="refreshAll" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import { storeToRefs } from 'pinia'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import {
    useFinanceAccountSetPrerequisite,
    type FinancePrerequisiteOverlay
  } from '../../modules/use-finance-account-set-prerequisite'
  import { ACCOUNTING_SELECT_EMPTY_TEXT } from '../../modules/accounting-select-text'
  import type { ColumnOption } from '@/types'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { formatSensitiveCurrencyValue as formatProtectedAmount } from '@/utils/ui'
  import {
    isReadableFieldAccess,
    canEditField,
    canViewField,
    getFieldAccess,
    mergeFieldAccessMaps
  } from '@/utils/field-permission'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useMasterDataDeleteProcessingContext } from '@/hooks/core/useMasterDataDeleteProcessing'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import { useUserStore } from '@/store/modules/user'
  import {
    actFixedAsset,
    deleteFixedAsset,
    fetchAccountSetOptions,
    fetchAssetCategoryList,
    fetchFixedAssetDetail,
    fetchFixedAssetList,
    fetchFixedAssetSummary
  } from '@fms/api'
  import FixedAssetDialog from './modules/fixed-asset-dialog.vue'
  import FixedAssetDisposalDialog from './modules/fixed-asset-disposal-dialog.vue'
  import AssetCategoryDrawer from './modules/asset-category-drawer.vue'
  import AssetDepreciationDrawer from './modules/asset-depreciation-drawer.vue'

  defineOptions({ name: 'FinanceFixedAsset' })

  type Asset = Api.Fms.FixedAssetRecord
  type SearchParams = Api.Fms.FixedAssetSearchParams
  type TableParams = SearchParams & { current: number; size: number }

  const emptySummary = (): Api.Fms.FixedAssetSummary => ({
    categoryCount: 0,
    assetCount: 0,
    activeCount: 0,
    originalValue: 0,
    netValue: 0,
    periodDepreciation: 0
  })

  const { confirmAction } = useArtFeedback()
  const { deleteGuardRef, deleteRecord, deleteBusy } = useRecordDeleteGuard(
    'fms_fixed_asset',
    '固定资产'
  )
  const { hasAuth } = useAuth()
  const actionBusy = ref(false)
  const { runWithAccountSet } = useFinanceAccountSetPrerequisite()
  const deleteContext = useMasterDataDeleteProcessingContext()
  const route = useRoute()
  const navigationReady = ref(false)
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const tableRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<
    {
      handleOpen: (row?: Asset, accountSetId?: string) => Promise<void>
    } & FinancePrerequisiteOverlay
  >()
  const disposalDialogRef = ref<{ handleOpen: (row: Asset) => Promise<void> }>()
  const categoryDialogRef = ref<
    { handleOpen: (accountSetId?: string) => Promise<void> } & FinancePrerequisiteOverlay
  >()
  const depreciationRef = ref<
    {
      handleOpen: (accountSetId?: string, runNo?: string) => Promise<void>
    } & FinancePrerequisiteOverlay
  >()
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const categoryOptions = ref<Array<{ label: string; value: string }>>([])
  const currentRows = ref<Asset[]>([])
  const listFieldAccess = ref<Api.Fms.FixedAssetFieldAccessMap>({})
  const summary = ref<Api.Fms.FixedAssetSummary>(emptySummary())
  const summaryLoading = ref(true)
  let summaryRequestId = 0
  const table = reactive<{ search: SearchParams }>({
    search: { accountSetId: undefined, keyword: '' }
  })

  const effectiveFieldAccess = computed(() =>
    mergeFieldAccessMaps(listFieldAccess.value, ...currentRows.value.map((row) => row.fieldAccess))
  )
  const canViewListField = (field: Api.Fms.FixedAssetFieldKey): boolean =>
    canViewField(effectiveFieldAccess.value, field)

  const metrics = computed<BusinessWorkspaceMetric[]>(() => [
    {
      auth: 'FinanceFixedAsset:ManageCategory',
      key: 'category',
      label: '资产类别',
      value: summary.value.categoryCount,
      loading: summaryLoading.value,
      description: '启用中的类别',
      icon: 'ri:folder-chart-line',
      tone: 'primary'
    },
    {
      key: 'asset',
      label: '资产卡片',
      value: summary.value.assetCount,
      loading: summaryLoading.value,
      description: `${summary.value.activeCount} 项使用中`,
      icon: 'ri:building-2-line',
      tone: 'success'
    },
    ...(canViewListField('assetValues')
      ? [
          {
            key: 'original',
            label: '资产原值',
            value: formatProtectedAmount(summary.value.originalValue),
            loading: summaryLoading.value,
            description: '全部资产口径',
            icon: 'ri:money-cny-box-line',
            tone: 'warning' as const
          },
          {
            key: 'net',
            label: '资产净值',
            value: formatProtectedAmount(summary.value.netValue),
            loading: summaryLoading.value,
            description: '扣除累计折旧与减值',
            icon: 'ri:line-chart-line',
            tone: 'info' as const
          }
        ]
      : [])
  ])

  const searchItems = computed<SearchFormItem[]>(() => [
    {
      label: '所属账套',
      key: 'accountSetId',
      span: 12,
      type: 'select',
      props: {
        options: accountSetOptions.value,
        clearable: false,
        filterable: true,
        placeholder: '选择核算账套',
        noDataText: ACCOUNTING_SELECT_EMPTY_TEXT.accountSet
      }
    },
    {
      label: '资产类别',
      key: 'categoryId',
      type: 'select',
      props: {
        options: categoryOptions.value,
        clearable: true,
        placeholder: '全部类别',
        disabled: !table.search.accountSetId,
        noDataText: table.search.accountSetId
          ? ACCOUNTING_SELECT_EMPTY_TEXT.assetCategory
          : ACCOUNTING_SELECT_EMPTY_TEXT.chooseAccountSet
      }
    },
    {
      label: '资产状态',
      key: 'status',
      type: 'select',
      props: {
        options: getDictMap.value.fmsAssetStatus ?? [],
        clearable: true,
        placeholder: '全部状态'
      }
    },
    {
      label: '关键字',
      key: 'keyword',
      span: 12,
      type: 'input',
      props: {
        clearable: true,
        placeholder:
          canViewListField('assetCustody') || canViewListField('assetReferences')
            ? '资产编号、名称、地点或序列号'
            : '资产编号或名称'
      }
    }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceFixedAsset:Add',
      type: 'add',
      label: '新建资产',
      onClick: () =>
        void runWithAccountSet(
          {
            actionLabel: '新建资产',
            activeRequired: true,
            accountSetId: table.search.accountSetId,
            foundationRequired: true,
            available: accountSetOptions.value.length > 0
          },
          () => dialogRef.value?.handleOpen(undefined, table.search.accountSetId),
          dialogRef.value
        )
    },
    {
      permission: 'FinanceFixedAsset:ManageCategory',
      key: 'manage-category',
      label: '资产类别',
      icon: 'ri:folder-add-line',
      onClick: () =>
        void runWithAccountSet(
          {
            actionLabel: '维护资产类别',
            activeRequired: true,
            accountSetId: table.search.accountSetId,
            foundationRequired: true,
            available: accountSetOptions.value.length > 0
          },
          () => categoryDialogRef.value?.handleOpen(table.search.accountSetId),
          categoryDialogRef.value
        )
    },
    {
      permission: 'FinanceFixedAsset:Depreciation',
      key: 'depreciation',
      label: '折旧管理',
      icon: 'ri:calendar-todo-line',
      onClick: () =>
        void runWithAccountSet(
          {
            actionLabel: '折旧管理',
            activeRequired: true,
            accountSetId: table.search.accountSetId,
            foundationRequired: true,
            available: accountSetOptions.value.length > 0
          },
          () => depreciationRef.value?.handleOpen(table.search.accountSetId),
          depreciationRef.value
        )
    }
  ])

  function columnsFactory(): ColumnOption<Asset>[] {
    return [
      { prop: 'assetNo', label: '资产编号', minWidth: 160, fixed: 'left' },
      { prop: 'assetName', label: '资产名称', minWidth: 180, showOverflowTooltip: true },
      {
        prop: 'category',
        label: '资产类别',
        minWidth: 140,
        formatter: (row) => row.category?.categoryName || '--'
      },
      ...(canViewListField('assetValues')
        ? [
            {
              prop: 'originalValue',
              label: '原值',
              minWidth: 130,
              align: 'right' as const,
              formatter: (row: Asset) => formatProtectedAmount(row.originalValue)
            },
            {
              prop: 'accumulatedDepreciation',
              label: '累计折旧',
              minWidth: 130,
              align: 'right' as const,
              formatter: (row: Asset) => formatProtectedAmount(row.accumulatedDepreciation)
            }
          ]
        : []),
      {
        prop: 'usefulLifeMonths',
        label: '使用寿命',
        width: 110,
        formatter: (row) => `${row.depreciatedMonths}/${row.usefulLifeMonths} 月`
      },
      ...(canViewListField('assetCustody')
        ? [
            {
              prop: 'location',
              label: '存放地点',
              minWidth: 140,
              formatter: (row: Asset) => row.location || '--',
              showOverflowTooltip: true
            }
          ]
        : []),
      {
        prop: 'status',
        label: '状态',
        width: 100,
        dict: { code: 'fmsAssetStatus', display: 'tag' }
      },
      {
        prop: 'operation',
        label: '操作',
        width: 150,
        fixed: 'right',
        formatter: (row) => (
          <BusinessTableRowActions>
            {row.status === 'draft' ? (
              <ArtButtonTable
                type="edit"
                permission="FinanceFixedAsset:Edit"
                disabled={actionBusy.value || deleteBusy.value}
                onClick={() => void dialogRef.value?.handleOpen(row)}
              />
            ) : null}
            {getActionItems(row).length ? (
              <ArtButtonMore
                trigger="click"
                list={getActionItems(row).map((item) => ({
                  ...item,
                  disabled: actionBusy.value || deleteBusy.value
                }))}
                onClick={(item: ButtonMoreItem) => void handleAction(item, row)}
              />
            ) : null}
          </BusinessTableRowActions>
        )
      }
    ]
  }

  function getActionItems(row: Asset): ButtonMoreItem[] {
    if (row.status === 'draft')
      return [
        ...(isReadableFieldAccess(getFieldAccess(row.fieldAccess, 'assetValues'))
          ? [
              {
                auth: 'FinanceFixedAsset:Activate',
                key: 'activate',
                label: '确认转固',
                icon: 'ri:checkbox-circle-line',
                color: 'var(--el-color-success)'
              }
            ]
          : []),
        {
          auth: 'FinanceFixedAsset:Delete',
          key: 'delete',
          label: '删除草稿',
          icon: 'ri:delete-bin-line',
          color: 'var(--el-color-danger)'
        }
      ]
    if (row.status === 'active')
      return [
        {
          auth: 'FinanceFixedAsset:Suspend',
          key: 'suspend',
          label: '暂停折旧',
          icon: 'ri:pause-circle-line',
          color: 'var(--el-color-warning)'
        },
        ...(canEditField(row.fieldAccess, 'assetValues')
          ? [
              {
                auth: 'FinanceFixedAsset:Dispose',
                key: 'dispose',
                label: '资产处置',
                icon: 'ri:delete-bin-6-line',
                color: 'var(--el-color-danger)'
              }
            ]
          : [])
      ]
    if (row.status === 'suspended')
      return [
        {
          auth: 'FinanceFixedAsset:Resume',
          key: 'resume',
          label: '恢复使用',
          icon: 'ri:play-circle-line',
          color: 'var(--el-color-success)'
        },
        ...(canEditField(row.fieldAccess, 'assetValues')
          ? [
              {
                auth: 'FinanceFixedAsset:Dispose',
                key: 'dispose',
                label: '资产处置',
                icon: 'ri:delete-bin-6-line',
                color: 'var(--el-color-danger)'
              }
            ]
          : [])
      ]
    return []
  }

  async function fetchTableData(params: TableParams) {
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    const result = await fetchFixedAssetList({ ...params, from, to })
    listFieldAccess.value = result.fieldAccess
    currentRows.value = result.data ?? []
    return result
  }

  async function loadCategories(): Promise<void> {
    if (!table.search.accountSetId) return void (categoryOptions.value = [])
    const { data } = await fetchAssetCategoryList(table.search.accountSetId)
    categoryOptions.value = (data ?? [])
      .filter((item) => item.isEnabled)
      .map((item) => ({ label: `${item.categoryName}（${item.categoryCode}）`, value: item.id }))
  }

  async function loadSummary(): Promise<void> {
    const requestId = ++summaryRequestId
    summaryLoading.value = true
    if (!table.search.accountSetId) {
      summary.value = emptySummary()
      summaryLoading.value = false
      return
    }
    try {
      const { data } = await fetchFixedAssetSummary(table.search.accountSetId)
      if (requestId !== summaryRequestId) return
      summary.value = data ?? emptySummary()
      if (data?.fieldAccess) listFieldAccess.value = data.fieldAccess
    } finally {
      if (requestId === summaryRequestId) summaryLoading.value = false
    }
  }

  async function handleAction(item: ButtonMoreItem, row: Asset): Promise<void> {
    if (actionBusy.value || deleteBusy.value) return
    const action = getActionItems(row).find((candidate) => candidate.key === item.key)
    const canRunAction = () =>
      Boolean(
        action?.auth &&
        hasAuth(action.auth) &&
        getActionItems(row).some(
          (candidate) => candidate.key === action.key && candidate.auth === action.auth
        )
      )
    if (!canRunAction() || !action) {
      ElMessage.error('资产操作权限或状态已变化，请刷新页面后重试')
      return
    }
    if (item.key === 'delete') {
      await deleteRecord({
        resource: { id: row.id, label: `${row.assetName}（${row.assetNo}）` },
        permission: 'FinanceFixedAsset:Delete',
        confirmMessage: `确定删除资产草稿“${row.assetName}”吗？`,
        remove: () => deleteFixedAsset(row.id),
        onDeleted: refreshAll,
        failureMessage: '资产草稿删除失败，请刷新资产状态后重试'
      })
      return
    }
    actionBusy.value = true
    try {
      if (item.key === 'dispose') {
        await disposalDialogRef.value?.handleOpen(row)
        return
      } else {
        if (item.key !== 'activate' && item.key !== 'suspend' && item.key !== 'resume') return
        await confirmAction(`确定执行“${action.label}”吗？`, action.label, {
          type: 'warning',
          confirmButtonText: action.label
        })
        if (!canRunAction()) {
          ElMessage.error('资产操作权限或状态已变化，请刷新页面后重试')
          return
        }
        await actFixedAsset(row.id, item.key)
      }
      await refreshAll()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      notifyFriendlyError(error, `${item.label}失败，请刷新资产状态后重试。`)
    } finally {
      actionBusy.value = false
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([tableRef.value?.refreshUpdate(), loadSummary(), loadCategories()])
  }

  async function handleSaved(): Promise<void> {
    await refreshAll()
  }
  async function handleCategorySaved(): Promise<void> {
    await loadCategories()
  }

  async function locateReferencedAsset(): Promise<boolean> {
    const context = deleteContext.value
    if (!context.active || !context.recordId || !context.recordNo) return false
    await categoryDialogRef.value?.currentSession()?.dismiss()
    const { data, error } = await fetchFixedAssetDetail(context.recordId)
    if (error || !data) return true
    table.search.accountSetId = data.accountSetId
    table.search.keyword = data.assetNo
    table.search.categoryId = undefined
    table.search.status = undefined
    await tableRef.value?.getData()
    if (route.query.dependencyCode === 'fms_asset_depreciation_run') {
      await depreciationRef.value?.handleOpen(data.accountSetId, context.recordNo)
    }
    return true
  }

  watch(
    () => [deleteContext.value.recordId, deleteContext.value.recordNo],
    () => {
      if (!navigationReady.value) return
      if (deleteContext.value.active) void locateReferencedAsset()
      else {
        table.search.keyword = ''
        void tableRef.value?.getData()
      }
    },
    { flush: 'post' }
  )

  watch(
    () => table.search.accountSetId,
    async () => {
      table.search.categoryId = undefined
      await Promise.all([loadCategories(), loadSummary()])
    }
  )

  onMounted(async () => {
    await userStore.ensureDictLoaded('fmsAssetStatus').catch(() => undefined)
    const { data } = await fetchAccountSetOptions({ status: 'active', from: 0, to: 999 })
    accountSetOptions.value = data ?? []
    table.search.accountSetId = accountSetOptions.value[0]?.value
    await Promise.all([loadCategories(), loadSummary()])
    navigationReady.value = true
    if (!(await locateReferencedAsset())) await tableRef.value?.getData()
  })
</script>

<style scoped lang="scss"></style>
