<template>
  <ArtPermissionGuard permission="FinancePayeeInformation:View">
    <div class="business-workspace-page art-full-height flex min-w-0 flex-col gap-4">
      <MasterDeleteProcessingNotice :table="tableRef" />
      <BusinessWorkspaceHeader
        density="compact"
        eyebrow="PAYEE ACCOUNTS"
        title="收款信息"
        description="按组织维护员工与代报销收款账户，报销前核对银行、账号和授权使用范围。"
        icon="ri:bank-card-line"
      >
        <template #actions><BusinessTableWorkspaceActions :table="tableRef" /></template>
      </BusinessWorkspaceHeader>
      <div class="payee-information-page__workspace min-h-0 min-w-0 flex-1">
        <ArtWorkspaceSplitter :breakpoint="1200" narrow-mode="hide">
          <template #primary>
            <OrganizationScopeFilter
              v-if="isDesktop"
              scope-type="employee"
              :data="organizationTree"
              :loading="organizationLoading"
              :selected-key="selectedOrganizationKey"
              :include-descendants="includeDescendants"
              :global-scope="isAllTenants"
              @select="selectOrganization"
              @refresh="loadOrganizations"
              @update:include-descendants="setIncludeDescendants"
            />
          </template>
          <div class="flex min-h-0 min-w-0 flex-col gap-3">
            <div v-if="!isDesktop" class="art-card-xs flex items-center justify-between gap-3 p-3">
              <span class="min-w-0 truncate">组织范围：{{ selectedOrganizationLabel }}</span>
              <ElButton type="primary" plain @click="openOrganizationDrawer">选择组织</ElButton>
            </div>
            <ArtTableQuery
              ref="tableRef"
              v-model="search"
              :search-items="searchItems"
              :api-fn="fetchTableData"
              :columns-factory="columnsFactory"
              :header-actions="headerActions"
              header-actions-placement="workspace"
              :search-bar-props="{ span: 8, labelWidth: 86 }"
              :table-props="{
                rowKey: 'id',
                tableLayout: 'fixed',
                emptyText: '暂无收款信息',
                emptyDescription: '可从员工花名册选择人员，再补齐银行与账号。'
              }"
              focusable
              focus-scope-selector=".payee-information-page__workspace"
            />
          </div>
        </ArtWorkspaceSplitter>
      </div>
      <ArtDrawer ref="organizationDrawerRef">
        <OrganizationScopeFilter
          scope-type="employee"
          :data="organizationTree"
          :loading="organizationLoading"
          :selected-key="selectedOrganizationKey"
          :include-descendants="includeDescendants"
          :global-scope="isAllTenants"
          @select="selectOrganization"
          @refresh="loadOrganizations"
          @update:include-descendants="setIncludeDescendants"
        />
      </ArtDrawer>
      <PayeeInformationDialog ref="dialogRef" @success="refreshTable" />
      <MasterDataDeleteGuard ref="deleteGuardRef" />
    </div>
  </ArtPermissionGuard>
</template>

<script setup lang="tsx">
  import { useMediaQuery } from '@vueuse/core'
  import { storeToRefs } from 'pinia'
  import type { ColumnOption } from '@/types'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtPermissionGuard from '@/components/core/feedback/art-permission-guard/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import MasterDeleteProcessingNotice from '@/components/business/master-delete-processing-notice/index.vue'
  import ArtWorkspaceSplitter from '@/components/core/layouts/art-workspace-splitter/index.vue'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import ArtTableQuery from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import OrganizationScopeFilter from '@/views/system/shared/organization-scope-filter.vue'
  import { fetchOrganizationOptionsTree } from '@/api/system-manage'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import type { TableRequestOptions } from '@/hooks/core/useTable'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import TreeUtils from '@/utils/tree'
  import {
    fetchPayeeInformationList,
    deletePayeeInformation,
    type PayeeInformation,
    type PayeeInformationSearch
  } from '@fms/api'
  import PayeeInformationDialog from './modules/payee-information-dialog.vue'

  defineOptions({ name: 'FinancePayeeInformation' })
  interface DialogExpose {
    handleOpen: (data?: {
      row?: PayeeInformation
      copy?: boolean
      getEmployee?: boolean
    }) => Promise<void>
  }
  type Organization = Api.SystemManage.OrganizationScopeFilterItem
  const ALL_ORGANIZATIONS = '__all_organizations__'
  const tableRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<DialogExpose>()
  const organizationDrawerRef = ref<ArtDrawerExpose<Record<string, never>>>()
  const isDesktop = useMediaQuery('(min-width: 1201px)')
  const { effectiveTenantId, isAllTenants } = storeToRefs(useTenantScopeStore())
  const { hasAuth } = useAuth()
  const { deleteGuardRef, deleteRecord, deleteRecords, deleteBusy } = useRecordDeleteGuard(
    'fms_payee_information',
    '收款信息'
  )
  const treeUtils = new TreeUtils({ idKey: 'id', parentKey: 'parentId', childrenKey: 'children' })
  const organizationTree = ref<Organization[]>([])
  const organizationLoading = ref(false)
  const selectedOrganizationKey = ref(ALL_ORGANIZATIONS)
  const includeDescendants = ref(true)
  const search = ref<PayeeInformationSearch>({ payeeName: '', employeeNo: '' })
  const selectedOrganization = computed(() =>
    selectedOrganizationKey.value === ALL_ORGANIZATIONS
      ? null
      : treeUtils.findNode(organizationTree.value, selectedOrganizationKey.value)
  )
  const selectedOrganizationLabel = computed(
    () => selectedOrganization.value?.organizationName ?? '全部组织'
  )
  const organizationIds = computed(() => {
    const selected = selectedOrganization.value
    if (!selected?.id) return undefined
    return includeDescendants.value
      ? treeUtils
          .getDescendants(organizationTree.value, selected.id, true)
          .map((item) => item.id)
          .filter((id): id is string => Boolean(id))
      : [selected.id]
  })
  const searchItems: SearchFormItem[] = [
    {
      label: '收款人',
      key: 'payeeName',
      type: 'input',
      props: { clearable: true, placeholder: '输入收款人' }
    },
    {
      label: '收款人工号',
      key: 'employeeNo',
      type: 'input',
      props: { clearable: true, placeholder: '输入工号' }
    }
  ]
  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      type: 'add',
      permission: 'FinancePayeeInformation:Add',
      label: '新增',
      onClick: () => dialogRef.value?.handleOpen()
    },
    {
      key: 'getEmployee',
      permission: 'FinancePayeeInformation:Get',
      label: '一键获取员工',
      disabled: !hasAuth('FinancePayeeInformation:Add'),
      onClick: () => dialogRef.value?.handleOpen({ getEmployee: true })
    },
    {
      key: 'deleteSelected',
      permission: 'FinancePayeeInformation:Delete',
      label: '批量删除',
      icon: 'ri:delete-bin-line',
      selectionRequired: true,
      disabled: deleteBusy.value,
      onClick: ({ selectedRows }) => deleteSelected(selectedRows as PayeeInformation[])
    }
  ])

  async function fetchTableData(
    params: PayeeInformationSearch & { current: number; size: number },
    options?: TableRequestOptions
  ) {
    const range = buildSupabasePageRange(params)
    const result = await fetchPayeeInformationList(
      {
        ...params,
        ...range,
        organizationIds: organizationIds.value,
        tenantId: effectiveTenantId.value
      },
      options
    )
    return { ...result, total: result.total ?? 0 }
  }
  const columnsFactory = (): ColumnOption<PayeeInformation>[] => [
    { type: 'selection', width: 50, fixed: 'left', reserveSelection: true },
    { prop: 'payeeName', label: '收款人', minWidth: 130, fixed: 'left', showOverflowTooltip: true },
    { prop: 'payeeEmployeeNo', label: '收款人工号', minWidth: 125, showOverflowTooltip: true },
    { prop: 'organizationName', label: '所属部门', minWidth: 140, showOverflowTooltip: true },
    {
      prop: 'isEmployee',
      label: '是否职员',
      width: 95,
      dict: { code: 'commonBoolean', display: 'text', value: (row) => String(row.isEmployee) }
    },
    { prop: 'accountName', label: '账户名称', minWidth: 140, showOverflowTooltip: true },
    { prop: 'bankName', label: '收款银行', minWidth: 170, showOverflowTooltip: true },
    { prop: 'bankAccount', label: '银行账号', minWidth: 190, showOverflowTooltip: true },
    {
      prop: 'currencyCode',
      label: '币种',
      width: 95,
      dict: { code: 'mdmCurrency', display: 'text' }
    },
    { prop: 'costCompanyName', label: '费用承担公司', minWidth: 160, showOverflowTooltip: true },
    {
      prop: 'authorizedUse',
      label: '授权使用',
      width: 95,
      dict: { code: 'commonBoolean', display: 'text', value: (row) => String(row.authorizedUse) }
    },
    { prop: 'userEmployeeName', label: '使用人', minWidth: 125, showOverflowTooltip: true },
    {
      prop: 'isDefault',
      label: '默认收款信息',
      width: 125,
      dict: { code: 'commonBoolean', display: 'text', value: (row) => String(row.isDefault) }
    },
    { prop: 'remark', label: '备注', minWidth: 170, showOverflowTooltip: true },
    {
      prop: 'operation',
      label: '操作',
      width: 116,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          <ArtButtonTable
            type="edit"
            permission="FinancePayeeInformation:Edit"
            onClick={() => dialogRef.value?.handleOpen({ row })}
          />
          <ArtButtonMore
            trigger="click"
            list={moreActions(row)}
            onClick={(item: ButtonMoreItem) => handleMoreAction(item, row)}
          />
        </BusinessTableRowActions>
      )
    }
  ]
  function moreActions(row: PayeeInformation): ButtonMoreItem[] {
    return [
      {
        key: 'copy',
        label: '复制',
        icon: 'ri:file-copy-line',
        auth: 'FinancePayeeInformation:Copy',
        disabled: !hasAuth('FinancePayeeInformation:Add')
      },
      {
        key: 'delete',
        label: '删除',
        icon: 'ri:delete-bin-line',
        auth: 'FinancePayeeInformation:Delete',
        color: 'var(--el-color-danger)',
        disabled: deleteBusy.value || !row.id
      }
    ]
  }
  function handleMoreAction(item: ButtonMoreItem, row: PayeeInformation): void {
    if (item.key === 'copy') void dialogRef.value?.handleOpen({ row, copy: true })
    if (item.key === 'delete') void deleteOne(row)
  }
  async function deleteOne(row: PayeeInformation): Promise<void> {
    await deleteRecord({
      resource: { id: row.id, label: `${row.payeeName} · ${row.bankName}` },
      successMessage: '收款信息已删除',
      permission: 'FinancePayeeInformation:Delete',
      remove: () => deletePayeeInformation([row.id]),
      onDeleted: refreshTable
    })
  }
  async function deleteSelected(rows: PayeeInformation[]): Promise<void> {
    if (!rows.length) return
    await deleteRecords({
      resources: rows.map((row) => ({ id: row.id, label: `${row.payeeName} · ${row.bankName}` })),
      successMessage: '所选收款信息已删除',
      permission: 'FinancePayeeInformation:Delete',
      remove: () => deletePayeeInformation(rows.map((row) => row.id)),
      onDeleted: refreshTable
    })
  }
  function refreshTable(): Promise<unknown> {
    return tableRef.value?.refreshData() ?? Promise.resolve()
  }
  function selectOrganization(key: string): void {
    selectedOrganizationKey.value = key
    void refreshTable()
  }
  function setIncludeDescendants(value: boolean): void {
    includeDescendants.value = value
    void refreshTable()
  }
  function openOrganizationDrawer(): void {
    void organizationDrawerRef.value?.handleOpen({}, { title: '选择组织范围' })
  }
  async function loadOrganizations(): Promise<void> {
    organizationLoading.value = true
    try {
      const result = await fetchOrganizationOptionsTree({
        tenantId: effectiveTenantId.value ?? undefined,
        status: '1'
      })
      organizationTree.value = result.data ?? []
      if (
        selectedOrganizationKey.value !== ALL_ORGANIZATIONS &&
        !treeUtils.findNode(organizationTree.value, selectedOrganizationKey.value)
      )
        selectedOrganizationKey.value = ALL_ORGANIZATIONS
    } finally {
      organizationLoading.value = false
    }
  }
  watch(effectiveTenantId, () => {
    selectedOrganizationKey.value = ALL_ORGANIZATIONS
    void Promise.all([loadOrganizations(), refreshTable()])
  })
  onMounted(() => void loadOrganizations())
</script>
