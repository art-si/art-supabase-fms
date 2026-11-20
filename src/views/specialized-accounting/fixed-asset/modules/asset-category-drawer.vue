<template>
  <ArtDrawer
    header-icon="ri:folder-settings-line"
    ref="drawerRef"
    :show-footer="false"
    @close="prerequisiteOverlay.invalidate"
    @reset="prerequisiteOverlay.invalidate"
  >
    <ArtTableQuery
      ref="tableRef"
      v-model="search"
      :search-items="searchItems"
      :api-fn="fetchRows"
      :columns-factory="columnsFactory"
      :header-actions="headerActions"
      :search-bar-props="{
        span: isNarrow ? 24 : 16,
        labelWidth: 64,
        showExpand: false,
        defaultExpanded: true
      }"
      :table-props="{
        rowKey: 'id',
        border: false,
        emptyText: '暂无资产类别',
        emptyDescription: '新增类别后可为资产设置使用寿命与残值率。'
      }"
    />
    <AssetCategoryDialog ref="editorRef" @success="refresh" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </ArtDrawer>
</template>

<script setup lang="tsx">
  import { useMediaQuery } from '@vueuse/core'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtTableQuery, {
    type ArtTableQueryExpose,
    type ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { createFinancePrerequisiteOverlay } from '../../../modules/use-finance-account-set-prerequisite'
  import type { ColumnOption } from '@/types'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import { fetchAssetCategoryList, deleteAssetCategory } from '@fms/api'
  import AssetCategoryDialog from './asset-category-dialog.vue'

  defineOptions({ name: 'FinanceAssetCategoryDrawer' })
  type Category = Api.Fms.AssetCategoryRecord
  const emit = defineEmits<{ success: [] }>()
  const drawerRef = ref<ArtDrawerExpose>()
  const prerequisiteOverlay = createFinancePrerequisiteOverlay(drawerRef)
  const editorRef = ref<{ handleOpen: (accountSetId?: string, row?: Category) => Promise<void> }>()
  const tableRef = ref<ArtTableQueryExpose>()
  const accountSetId = ref('')
  const search = ref({ keyword: '' })
  const isNarrow = useMediaQuery('(max-width: 520px)')
  const { deleteGuardRef, deleteRecord } = useRecordDeleteGuard('fms_asset_category', '资产类别')
  const searchItems: SearchFormItem[] = [
    {
      key: 'keyword',
      label: '类别',
      type: 'input',
      props: { placeholder: '搜索类别编码或名称', clearable: true }
    }
  ]
  const headerActions: ArtTableQueryHeaderAction[] = [
    {
      key: 'add',
      label: '新增类别',
      permission: 'FinanceFixedAsset:ManageCategory',
      icon: 'ri:add-line',
      onClick: () => void editorRef.value?.handleOpen(accountSetId.value)
    }
  ]

  function columnsFactory(): ColumnOption<Category>[] {
    return [
      {
        prop: 'categoryName',
        label: '资产类别',
        minWidth: 220,
        formatter: (row) => (
          <BusinessTableIdentityCell primary={row.categoryName} secondary={row.categoryCode} />
        )
      },
      { prop: 'defaultUsefulLifeMonths', label: '寿命（月）', width: 100 },
      {
        prop: 'defaultResidualRate',
        label: '残值率',
        width: 100,
        formatter: (row) => `${(row.defaultResidualRate * 100).toFixed(2)}%`
      },
      {
        prop: 'isEnabled',
        label: '状态',
        width: 90,
        dict: {
          code: 'commonEnabledStatus',
          display: 'tag',
          value: (row) => (row.isEnabled ? 'enabled' : 'disabled')
        }
      },
      {
        prop: 'operation',
        label: '操作',
        width: 100,
        fixed: 'right',
        formatter: (row) => (
          <BusinessTableRowActions>
            <ArtButtonTable
              type="edit"
              permission="FinanceFixedAsset:ManageCategory"
              onClick={() => void editorRef.value?.handleOpen(row.accountSetId, row)}
            />
            <ArtButtonTable
              type="delete"
              permission="FinanceFixedAsset:ManageCategory"
              onClick={() => void remove(row)}
            />
          </BusinessTableRowActions>
        )
      }
    ]
  }

  async function fetchRows(params: { keyword?: string; current?: number; size?: number }) {
    const result = await fetchAssetCategoryList(accountSetId.value)
    const keyword = (params.keyword ?? '').trim().toLowerCase()
    const data = (result.data ?? []).filter(
      (row) => !keyword || `${row.categoryName} ${row.categoryCode}`.toLowerCase().includes(keyword)
    )
    const size = params.size ?? 20
    const from = ((params.current ?? 1) - 1) * size
    return { ...result, data: data.slice(from, from + size), total: data.length }
  }

  async function refresh(): Promise<void> {
    await tableRef.value?.refreshUpdate()
    emit('success')
  }

  async function remove(row: Category): Promise<void> {
    await deleteRecord({
      resource: { id: row.id, label: `${row.categoryName}（${row.categoryCode}）` },
      permission: 'FinanceFixedAsset:ManageCategory',
      confirmMessage: `确定删除资产类别“${row.categoryName}”吗？`,
      remove: () => deleteAssetCategory(row.id),
      onDeleted: refresh,
      failureMessage: '资产类别删除失败，请刷新列表后重试'
    })
  }

  async function handleOpen(id?: string): Promise<void> {
    const opening = prerequisiteOverlay.beginOpen()
    accountSetId.value = id ?? ''
    search.value.keyword = ''
    await drawerRef.value?.handleOpen(undefined, {
      title: '资产类别',
      subtitle: '维护使用寿命与残值率，已被引用的类别需先处理关联',
      size: 'lg',
      onOpen: async (_openData, api) => {
        opening.attach(api)
        if (!opening.isCurrent()) return
        try {
          await tableRef.value?.getData()
        } finally {
          opening.finishLoading()
        }
      },
      drawerProps: { closeOnClickModal: true, class: 'fms-asset-category-workspace' }
    })
  }
  defineExpose({ handleOpen, ...prerequisiteOverlay })
</script>

<style scoped lang="scss">
  :global(.fms-asset-category-workspace .art-drawer__scrollbar),
  :global(.fms-asset-category-workspace .el-scrollbar__view),
  :global(.fms-asset-category-workspace .art-drawer__content) {
    height: 100%;
    min-height: 0;
  }

  :global(.fms-asset-category-workspace .art-drawer__content) {
    display: flex;
    flex-direction: column;
  }
</style>
