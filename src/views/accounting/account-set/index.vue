<template>
  <FinanceAccountingWorkspaceShell class="account-set-page">
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="财务基础 · 核算主体"
      title="账套管理"
      description="以法人主体为边界统一会计准则、本位币和期间治理，为凭证、账簿、报表及业务自动记账提供核算底座。"
      icon="ri:book-2-line"
      :tags="[
        { label: '多账套隔离', type: 'primary' },
        { label: '期间强管控', type: 'success' },
        { label: '全链路审计', type: 'info' }
      ]"
      :metrics="overviewMetrics"
      @metric-click="handleMetricClick"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ElAlert v-if="overview.error" type="warning" :closable="false" show-icon>
      账套概览加载失败，当前指标暂不可用。
      <ElButton link type="primary" :loading="overview.loading" @click="loadOverview">
        重新加载概览
      </ElButton>
    </ElAlert>

    <ArtTableQuery
      :key="effectiveTenantId || 'all-tenants'"
      ref="tableRef"
      v-model="table.search"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :columns-factory="columnsFactory"
      :header-actions="headerActions"
      header-actions-placement="workspace"
      :search-bar-props="{
        span: 8,
        gutter: 16,
        labelPosition: 'left',
        labelWidth: '76px',
        isExpand: true,
        showExpand: false,
        buttonLeftLimit: 0
      }"
      :table-props="{
        rowKey: 'id',
        tableLayout: 'fixed',
        emptyText: '暂无账套',
        emptyDescription:
          '创建首个企业账套后，系统会自动生成本位币、辅助核算类型和首个会计年度期间。'
      }"
      focusable
    />

    <AccountSetDialog ref="dialogRef" @success="handleSaved" />
    <AccountingPeriodDrawer ref="periodDrawerRef" />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import { ElAlert, ElButton, ElTag } from 'element-plus'
  import { storeToRefs } from 'pinia'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import type { ColumnOption } from '@/types'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { formatWithDayjs } from '@/utils/time'
  import {
    isReadableFieldAccess,
    canViewField,
    getFieldAccess,
    isMaskedValue,
    mergeFieldAccessMaps
  } from '@/utils/field-permission'
  import { useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useUserStore } from '@/store/modules/user'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import {
    fetchAccountSetList,
    fetchAccountSetOverview,
    initializeAccountingDefaults,
    setAccountSetStatus
  } from '@fms/api'
  import AccountSetDialog from './modules/account-set-dialog.vue'
  import AccountingPeriodDrawer from './modules/accounting-period-drawer.vue'

  defineOptions({ name: 'FinanceAccountSet' })

  type AccountSet = Api.Fms.AccountSetRecord
  type SearchParams = Api.Fms.AccountSetSearchParams
  type TableParams = SearchParams & { current: number; size: number }

  const accountSetStatusOptions = useDictionaryOptions('fmsAccountSetStatus')

  interface AccountSetDialogExpose {
    handleOpen: (row?: AccountSet) => Promise<void>
  }

  interface PeriodDrawerExpose {
    handleOpen: (row: AccountSet) => Promise<void>
  }

  interface TableGroup {
    search: SearchParams
  }

  interface OverviewGroup {
    loading: boolean
    error: boolean
    data?: Api.Fms.AccountSetOverview
  }

  const { confirmAction, promptReason } = useArtFeedback()
  const userStore = useUserStore()
  const { isPlatformSuper } = storeToRefs(userStore)
  const { effectiveTenantId } = storeToRefs(useTenantScopeStore())
  const dialogRef = ref<AccountSetDialogExpose>()
  const periodDrawerRef = ref<PeriodDrawerExpose>()
  const tableRef = ref<ArtTableQueryExpose>()
  const currentRows = ref<AccountSet[]>([])
  const listFieldAccess = ref<Api.Fms.AccountSetFieldAccessMap>({})
  const effectiveFieldAccess = computed(() =>
    mergeFieldAccessMaps(listFieldAccess.value, ...currentRows.value.map((row) => row.fieldAccess))
  )
  const canViewListField = (field: Api.Fms.AccountSetFieldKey): boolean =>
    canViewField(effectiveFieldAccess.value, field)
  const table = reactive<TableGroup>({
    search: { keyword: '', status: undefined }
  })
  const overview = reactive<OverviewGroup>({ loading: true, error: false })
  let listRequestId = 0
  let overviewRequestId = 0
  const overviewMetrics = computed<BusinessWorkspaceMetric[]>(() => {
    const values = overview.data
    const selectedStatus = table.search.status
    return [
      {
        key: 'all',
        label: '全部账套',
        value: values?.totalCount ?? '--',
        description: '当前可见核算主体',
        icon: 'ri:book-2-line',
        tone: 'primary',
        interactive: Boolean(values),
        selected: !selectedStatus,
        loading: overview.loading
      },
      {
        key: 'active',
        label: '启用账套',
        value: values?.activeCount ?? '--',
        description: '允许进入日常核算',
        icon: 'ri:checkbox-circle-line',
        tone: 'success',
        interactive: Boolean(values),
        selected: selectedStatus === 'active',
        loading: overview.loading
      },
      {
        key: 'draft',
        label: '待配置',
        value: values?.draftCount ?? '--',
        description: '需要完成核算初始化',
        icon: 'ri:draft-line',
        tone: 'warning',
        interactive: Boolean(values),
        selected: selectedStatus === 'draft',
        loading: overview.loading
      },
      {
        key: 'suspended',
        label: '已停用',
        value: values?.suspendedCount ?? '--',
        description: '保留数据但暂停使用',
        icon: 'ri:pause-circle-line',
        tone: 'danger',
        interactive: Boolean(values),
        selected: selectedStatus === 'suspended',
        loading: overview.loading
      }
    ]
  })

  const searchItems = computed<SearchFormItem[]>(() => [
    {
      label: '账套状态',
      key: 'status',
      type: 'select',
      props: {
        clearable: true,
        options: accountSetStatusOptions,
        placeholder: '全部状态'
      }
    },
    {
      label: '关键字',
      key: 'keyword',
      type: 'input',
      props: {
        clearable: true,
        placeholder: isReadableFieldAccess(getFieldAccess(listFieldAccess.value, 'taxRegistration'))
          ? '编码、名称、主体或信用代码'
          : '编码、名称或主体'
      }
    }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceAccountSet:Add',
      type: 'add',
      label: '新建企业账套',
      onClick: () => void dialogRef.value?.handleOpen()
    }
  ])

  function columnsFactory(): ColumnOption<AccountSet>[] {
    return [
      {
        prop: 'accountSetName',
        label: '账套',
        minWidth: 230,
        fixed: 'left',
        link: {
          permission: 'FinanceAccountSet:View',
          onClick: (row) => void periodDrawerRef.value?.handleOpen(row)
        },
        formatter: (row) => (
          <div class="account-set-identity">
            <div>
              <strong title={row.accountSetName}>{row.accountSetName}</strong>
              {row.isDefault ? (
                <ElTag size="small" type="primary">
                  默认
                </ElTag>
              ) : null}
            </div>
            <small title={row.accountSetCode} translate="no">
              {row.accountSetCode}
            </small>
          </div>
        )
      },
      ...(isPlatformSuper.value
        ? [
            {
              prop: 'tenant',
              label: '所属租户',
              minWidth: 190,
              formatter: (row: AccountSet) => (
                <div class="account-set-tenant">
                  <strong title={row.tenant?.tenantName || '未识别租户'}>
                    {row.tenant?.tenantName || '未识别租户'}
                  </strong>
                  <small title={row.tenant?.tenantCode || row.tenantId} translate="no">
                    {row.tenant?.tenantCode || row.tenantId}
                  </small>
                </div>
              )
            } satisfies ColumnOption<AccountSet>
          ]
        : []),
      {
        prop: 'legalEntityName',
        label: '法人主体',
        minWidth: 210,
        showOverflowTooltip: true
      },
      ...(canViewListField('accountingPolicy')
        ? ([
            {
              prop: 'accountingStandard',
              label: '会计准则',
              minWidth: 190,
              dict: { code: 'fmsAccountingStandard', display: 'text' }
            },
            {
              prop: 'baseCurrencyCode',
              label: '本位币',
              width: 90,
              align: 'center'
            },
            {
              prop: 'enabledOn',
              label: '启用日期',
              width: 120,
              formatter: (row: AccountSet) =>
                isMaskedValue(row.enabledOn)
                  ? row.enabledOn
                  : formatWithDayjs(row.enabledOn, 'YYYY-MM-DD') || '--'
            }
          ] as ColumnOption<AccountSet>[])
        : []),
      ...(canViewListField('taxRegistration')
        ? ([
            {
              prop: 'vatTaxpayerType',
              label: '纳税人类型',
              width: 135,
              dict: { code: 'fmsVatTaxpayerType', display: 'tag' }
            }
          ] as ColumnOption<AccountSet>[])
        : []),
      {
        prop: 'status',
        label: '状态',
        width: 105,
        dict: { code: 'fmsAccountSetStatus', display: 'tag' }
      },
      ...(canViewListField('administrativeAudit')
        ? ([
            {
              prop: 'updateTime',
              label: '最近更新',
              width: 165,
              formatter: (row: AccountSet) =>
                isMaskedValue(row.updateTime)
                  ? row.updateTime
                  : formatWithDayjs(row.updateTime, 'YYYY-MM-DD HH:mm') || '--'
            }
          ] as ColumnOption<AccountSet>[])
        : []),
      {
        prop: 'operation',
        label: '操作',
        width: 160,
        fixed: 'right',
        formatter: (row) => (
          <BusinessTableRowActions>
            <ArtButtonTable
              type="view"
              permission="FinanceAccountSet:View"
              label="查看会计期间"
              onClick={() => void periodDrawerRef.value?.handleOpen(row)}
            />
            <ArtButtonTable
              type="edit"
              permission="FinanceAccountSet:Edit"
              label="编辑账套"
              disabled={row.status === 'archived'}
              onClick={() => void dialogRef.value?.handleOpen(row)}
            />
            {getStatusActions(row).length ? (
              <ArtButtonMore
                trigger="click"
                list={getStatusActions(row)}
                onClick={(item: ButtonMoreItem) => void handleStatusAction(item, row)}
              />
            ) : null}
          </BusinessTableRowActions>
        )
      }
    ]
  }

  function getStatusActions(row: AccountSet): ButtonMoreItem[] {
    if (row.status === 'archived') return []
    if (row.status === 'draft') {
      return [
        {
          auth: 'FinanceAccountSet:Active',
          key: 'active',
          label: '启用账套',
          icon: 'ri:play-circle-line'
        },
        {
          auth: 'FinanceAccountSet:Archived',
          key: 'archived',
          label: '归档账套',
          icon: 'ri:archive-line',
          color: 'var(--el-color-danger)'
        }
      ]
    }
    if (row.status === 'active') {
      return [
        {
          auth: 'FinanceAccountSet:Suspended',
          key: 'suspended',
          label: '停用账套',
          icon: 'ri:pause-circle-line'
        },
        {
          auth: 'FinanceAccountSet:Archived',
          key: 'archived',
          label: '归档账套',
          icon: 'ri:archive-line',
          color: 'var(--el-color-danger)'
        }
      ]
    }
    return [
      {
        auth: 'FinanceAccountSet:Active',
        key: 'active',
        label: '恢复启用',
        icon: 'ri:restart-line'
      },
      {
        auth: 'FinanceAccountSet:Archived',
        key: 'archived',
        label: '归档账套',
        icon: 'ri:archive-line',
        color: 'var(--el-color-danger)'
      }
    ]
  }

  async function fetchTableData(params: TableParams) {
    const requestId = ++listRequestId
    const tenantId = effectiveTenantId.value || undefined
    const isCurrent = () =>
      requestId === listRequestId && tenantId === (effectiveTenantId.value || undefined)
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    try {
      const result = await fetchAccountSetList(
        { ...params, tenantId, from, to },
        { showErrorMessage: false }
      )
      if (!isCurrent()) return { ...result, data: [], total: 0, fieldAccess: {} }
      if (result.error) throw result.error
      listFieldAccess.value = result.fieldAccess
      currentRows.value = result.data ?? []
      return result
    } catch (error) {
      if (!isCurrent()) return { data: [], total: 0, fieldAccess: {} }
      listFieldAccess.value = {}
      currentRows.value = []
      throw error
    }
  }

  async function loadOverview(): Promise<void> {
    const requestId = ++overviewRequestId
    const tenantId = effectiveTenantId.value || undefined
    const isCurrent = () =>
      requestId === overviewRequestId && tenantId === (effectiveTenantId.value || undefined)
    overview.data = undefined
    overview.error = false
    overview.loading = true
    try {
      const result = await fetchAccountSetOverview(tenantId, { showErrorMessage: false })
      if (!isCurrent()) return
      overview.data = result.error ? undefined : (result.data ?? undefined)
      overview.error = Boolean(result.error || !result.data)
    } catch {
      if (isCurrent()) {
        overview.data = undefined
        overview.error = true
      }
    } finally {
      if (isCurrent()) overview.loading = false
    }
  }

  function handleMetricClick(metric: BusinessWorkspaceMetric): void {
    table.search.status =
      metric.key === 'active' || metric.key === 'draft' || metric.key === 'suspended'
        ? metric.key
        : undefined
    void tableRef.value?.getData()
  }

  async function handleStatusAction(item: ButtonMoreItem, row: AccountSet): Promise<void> {
    const status = item.key as Api.Fms.AccountSetStatus
    try {
      let reason: string | undefined
      if (status === 'suspended' || status === 'archived') {
        reason = await promptReason(
          status === 'archived'
            ? '归档后账套不可恢复，但历史财务数据仍保留可查。'
            : '停用后账套暂停新增核算业务，历史数据仍保留可查。',
          status === 'archived' ? '归档账套' : '停用账套',
          {
            confirmButtonText: status === 'archived' ? '确认归档' : '确认停用',
            emptyMessage: '请填写状态变更原因',
            placeholder: '请说明原因和后续处理安排'
          }
        )
      } else {
        await confirmAction(
          `启用“${row.accountSetName}”时会同步补齐缺失的核心科目、默认制证规则和财务报表映射；已有配置不会被覆盖。`,
          '初始化并启用账套',
          {
            type: 'success',
            confirmButtonText: '初始化并启用',
            cancelButtonText: '取消'
          }
        )
        await initializeAccountingDefaults(row.id)
      }
      await setAccountSetStatus(row.id, status, reason)
      await Promise.all([tableRef.value?.refreshUpdate(), loadOverview()])
    } catch {
      // 用户取消或数据库业务约束阻止时，不重复提示。
    }
  }

  async function handleSaved(type: 'add' | 'edit'): Promise<void> {
    await Promise.all([
      type === 'add' ? tableRef.value?.refreshCreate() : tableRef.value?.refreshUpdate(),
      loadOverview()
    ])
  }

  watch(
    effectiveTenantId,
    () => {
      ++listRequestId
      currentRows.value = []
      listFieldAccess.value = {}
      void loadOverview()
    },
    { flush: 'sync' }
  )

  onMounted(() => {
    void Promise.allSettled([
      userStore.ensureDictLoaded('fmsAccountSetStatus'),
      userStore.ensureDictLoaded('fmsAccountingStandard'),
      userStore.ensureDictLoaded('fmsVatTaxpayerType')
    ])
    void loadOverview()
  })
</script>

<style scoped lang="scss">
  .account-set-page {
    &__permission {
      flex: 0 0 auto;
    }
  }

  :deep(.account-set-identity),
  :deep(.account-set-tenant) {
    min-width: 0;

    > div {
      display: flex;
      gap: 8px;
      align-items: center;
      min-width: 0;
    }

    strong,
    small {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    strong {
      min-width: 0;
      color: var(--el-text-color-primary);
    }

    small {
      margin-top: 3px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }
</style>
