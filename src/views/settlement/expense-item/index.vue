<template>
  <div class="business-workspace-page art-full-height">
    <MasterDeleteProcessingNotice :table="tableRef" />
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="EXPENSE TAXONOMY"
      title="费用项目"
      description="用树形项目统一承运、在途和其他运单费用口径，业务表单只能选择可记账的末级项目。"
      icon="ri:node-tree"
      :tags="[
        { label: '树形结构', type: 'primary' },
        { label: '统一费用口径', type: 'success' }
      ]"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ArtTableQuery
      ref="tableRef"
      v-model="search"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :columns-factory="columnsFactory"
      :header-actions="headerActions"
      header-actions-placement="workspace"
      :search-bar-props="{ span: 8, labelWidth: 86, isExpand: true, showExpand: false }"
      :table-props="{
        rowKey: 'id',
        defaultExpandAll: true,
        treeProps: { children: 'children' },
        tableLayout: 'fixed',
        emptyText: '暂无费用项目',
        emptyDescription: '可先新增一级分组，再为分组添加可记账的末级费用项目。'
      }"
      focusable
    />

    <ExpenseItemDialog ref="dialogRef" @success="handleSaved" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </div>
</template>

<script setup lang="tsx">
  import { formatTenantLabel as resolveTenantLabel } from '@/utils/tenant-display'

  import { storeToRefs } from 'pinia'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import type { ColumnOption } from '@/types'
  import { useUserStore } from '@/store/modules/user'
  import { deleteExpenseItem, fetchExpenseItemTree } from '@fms/api'
  import { fetchTenantList } from '@/api/system-manage'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import ExpenseItemDialog from './modules/expense-item-dialog.vue'

  defineOptions({ name: 'FinanceExpenseItem' })

  type ExpenseItem = Api.Fms.ExpenseItem
  type SearchParams = Api.Fms.ExpenseItemSearchParams

  interface DialogExpose {
    handleOpen: (row?: ExpenseItem, parent?: ExpenseItem) => Promise<void>
  }

  const userStore = useUserStore()
  const { getDictMap, isPlatformSuper } = storeToRefs(userStore)
  const route = useRoute()
  const tableRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<DialogExpose>()
  const { deleteGuardRef, deleteRecord, deleteBusy } = useRecordDeleteGuard(
    'tms_expense_item',
    '费用项目'
  )
  const referencedItemCode = computed(() =>
    route.query.fromMasterDelete === '1' &&
    route.query.dependencyCode === 'tms_expense_item' &&
    typeof route.query.recordNo === 'string'
      ? route.query.recordNo
      : ''
  )
  const search = ref<SearchParams>({
    keyword: referencedItemCode.value,
    tenantId: undefined,
    isEnabled: undefined
  })
  const tenantOptions = ref<Array<{ label: string; value: string }>>([])
  const costTypeFallback: Record<Api.Fms.WaybillCostType, string> = {
    carrier_freight: '承运运费',
    toll: '路桥费',
    parking: '停车费',
    fuel: '油费',
    loading: '装卸费',
    waiting: '等候费',
    driver_expense: '司机报销',
    driver_payroll: '司机薪酬',
    vehicle_insurance: '车辆保险',
    vehicle_depreciation: '车辆折旧',
    vehicle_maintenance: '维修保养',
    traffic_fine: '违章罚款',
    cargo_damage: '货损赔偿',
    other: '其他费用',
    in_transit_energy: '在途能源费',
    in_transit_charging: '在途充电费',
    in_transit_gas: '在途充气费',
    in_transit_other: '在途其它费'
  }
  const businessCategoryLabel = (row: ExpenseItem): string => {
    if (!row.isSelectable) return '分组'
    if (!row.businessCategory) return '待设置'
    return (
      userStore.getDictItemByValue('tmsWaybillCostType', row.businessCategory)?.label ??
      costTypeFallback[row.businessCategory]
    )
  }

  const commonBooleanOptions = computed(() =>
    (getDictMap.value.commonBoolean ?? []).map((item) => ({
      ...item,
      value: item.value === 'true'
    }))
  )

  const searchItems = computed<SearchFormItem[]>(() => [
    ...(isPlatformSuper.value
      ? [
          {
            label: '所属租户',
            key: 'tenantId',
            type: 'select' as const,
            props: {
              clearable: true,
              filterable: true,
              options: tenantOptions.value,
              placeholder: '全部租户'
            }
          }
        ]
      : []),
    {
      label: '启用状态',
      key: 'isEnabled',
      type: 'select',
      props: { options: commonBooleanOptions.value, clearable: true }
    },
    {
      label: '关键字',
      key: 'keyword',
      type: 'input',
      props: { clearable: true, placeholder: '项目编码、名称或备注' }
    }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceExpenseItem:Add',
      type: 'add',
      label: '新增一级项目',
      disabled: deleteBusy.value,
      onClick: () => openDialog()
    }
  ])

  const fetchTableData = async (params: SearchParams) => {
    const result = await fetchExpenseItemTree(params)
    return { ...result, total: result.data?.length ?? 0 }
  }

  const columnsFactory = (): ColumnOption<ExpenseItem>[] => [
    {
      prop: 'itemName',
      label: '费用项目 / 备注',
      minWidth: 250,
      formatter: (row) => (
        <div
          class="expense-item-identity"
          title={[row.itemName, row.itemCode, row.remark].filter(Boolean).join(' · ')}
        >
          <strong class="block truncate text-sm font-semibold text-[var(--el-text-color-primary)]">
            {row.itemName}
          </strong>
          <small class="block truncate text-xs text-[var(--el-text-color-secondary)]">
            {row.itemCode}
            {row.remark ? ` · ${row.remark}` : ''}
          </small>
        </div>
      )
    },
    ...(isPlatformSuper.value
      ? [
          {
            prop: 'tenant',
            label: '所属租户',
            minWidth: 170,
            formatter: (row: ExpenseItem) => (
              <div class="expense-item-tenant">
                <strong title={row.tenant?.tenantName || '未识别租户'}>
                  {row.tenant?.tenantName || '未识别租户'}
                </strong>
                <small title={row.tenant?.tenantCode || row.tenantId || '--'} translate="no">
                  {row.tenant?.tenantCode || row.tenantId || '--'}
                </small>
              </div>
            )
          } satisfies ColumnOption<ExpenseItem>
        ]
      : []),
    {
      prop: 'businessCategory',
      label: '业务分类',
      width: 130,
      formatter: (row) => businessCategoryLabel(row)
    },
    {
      prop: 'usage',
      label: '使用范围',
      width: 130,
      formatter: (row) => (
        <span
          title={`记账：${row.isSelectable ? '是' : '否'}；报销：${row.reimbursementAllowed ? '是' : '否'}`}
        >
          {row.isSelectable ? '可记账' : '分组'} · {row.reimbursementAllowed ? '可报销' : '不报销'}
        </span>
      )
    },
    {
      prop: 'isEnabled',
      label: '启用状态',
      width: 90,
      dict: {
        code: 'commonEnabledStatus',
        display: 'tag',
        value: (row) => (row.isEnabled ? 'enabled' : 'disabled')
      }
    },
    { prop: 'sort', label: '排序', width: 65, align: 'center' },
    {
      prop: 'operation',
      label: '操作',
      width: 110,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          <ArtButtonTable
            type="edit"
            permission="FinanceExpenseItem:Edit"
            disabled={deleteBusy.value}
            onClick={() => openDialog(row)}
          />
          <ArtButtonMore
            trigger="click"
            list={() => moreActions.map((item) => ({ ...item, disabled: deleteBusy.value }))}
            onClick={(item: ButtonMoreItem) => handleMoreAction(item, row)}
          />
        </BusinessTableRowActions>
      )
    }
  ]

  const moreActions: ButtonMoreItem[] = [
    {
      auth: 'FinanceExpenseItem:AddChild',
      key: 'addChild',
      label: '新增下级',
      icon: 'ri:add-line'
    },
    {
      auth: 'FinanceExpenseItem:Delete',
      key: 'delete',
      label: '删除',
      icon: 'ri:delete-bin-line',
      color: 'var(--el-color-danger)'
    }
  ]

  function openDialog(row?: ExpenseItem, parent?: ExpenseItem): void {
    if (deleteBusy.value) return
    void dialogRef.value?.handleOpen(row, parent)
  }

  function handleMoreAction(item: ButtonMoreItem, row: ExpenseItem): void {
    if (deleteBusy.value) return
    if (item.key === 'addChild') openDialog(undefined, row)
    if (item.key === 'delete') void handleDelete(row)
  }

  async function handleDelete(row: ExpenseItem): Promise<void> {
    const id = row.id
    if (!id) return
    const tenantContext = isPlatformSuper.value ? `所属租户：${resolveTenantLabel(row)}。` : ''
    await deleteRecord({
      resource: { id, label: row.itemName },
      permission: 'FinanceExpenseItem:Delete',
      confirmMessage: `确定删除费用项目“${row.itemName}”吗？${tenantContext}删除后不可撤销。`,
      remove: () => deleteExpenseItem(id),
      onDeleted: async () => tableRef.value?.refreshRemove(),
      failureMessage: '费用项目删除失败，请重新检查关联记录后重试'
    })
  }

  function handleSaved(type: 'add' | 'edit'): void {
    void (type === 'add' ? tableRef.value?.refreshCreate() : tableRef.value?.refreshUpdate())
  }

  watch(referencedItemCode, (value) => {
    search.value.keyword = value
    void nextTick(() => tableRef.value?.getData())
  })

  async function loadTenantOptions(): Promise<void> {
    if (!isPlatformSuper.value) return
    const { data } = await fetchTenantList({ from: 0, to: 999 })
    tenantOptions.value = (data ?? [])
      .filter((tenant) => tenant.id)
      .map((tenant) => ({
        label: `${tenant.tenantName}（${tenant.tenantCode}）`,
        value: String(tenant.id)
      }))
  }

  onMounted(() => {
    void Promise.allSettled([
      userStore.ensureDictLoaded('tmsWaybillCostType'),
      userStore.ensureDictLoaded('commonBoolean')
    ])
    void loadTenantOptions()
  })
</script>

<style scoped lang="scss">
  :deep(.expense-item-identity) {
    display: inline-block;
    max-width: calc(100% - 24px);
    padding-block: 4px;
    vertical-align: middle;
  }

  :deep(.expense-item-tenant) {
    min-width: 0;

    strong,
    small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    small {
      margin-top: 3px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }
</style>
