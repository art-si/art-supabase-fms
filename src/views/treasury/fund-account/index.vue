<template>
  <FinanceAccountingWorkspaceShell class="fund-account-page">
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="TREASURY FOUNDATION"
      title="资金账户"
      description="统一管理银行账户、现金账户与数字钱包，以受控账户主数据承接收付款、资金调拨、日记账和银行对账。"
      icon="ri:bank-card-line"
      :tags="[
        { label: '账号脱敏', type: 'primary' },
        { label: '多币种隔离', type: 'success' },
        { label: '余额可追溯', type: 'info' }
      ]"
      :metrics="metrics"
      @metric-click="handleMetricClick"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ElAlert v-if="overviewError" type="warning" :closable="false" show-icon>
      资金账户概览加载失败，当前指标暂不可用。
      <ElButton link type="primary" :loading="overviewLoading" @click="loadOverview">
        重新加载概览
      </ElButton>
    </ElAlert>

    <ElAlert v-if="accountSetsError" type="warning" :closable="false" show-icon>
      账套选项加载失败，请重试后选择账套或新建账户。
      <ElButton link type="primary" :loading="accountSetsLoading" @click="loadAccountSets">
        重新加载账套
      </ElButton>
    </ElAlert>

    <ArtTableQuery
      :key="tableContextKey"
      ref="tableRef"
      v-model="table.search"
      class="fund-account-page__table"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :response-adapter="responseAdapter"
      :on-success="acceptTableResult"
      :on-error="handleTableError"
      :columns-context-key="columnsContextKey"
      :columns-factory="columnsFactory"
      :header-actions="headerActions"
      header-actions-placement="workspace"
      :search-bar-props="{ span: 6, labelWidth: 86, isExpand: true, showExpand: false }"
      :table-props="{
        rowKey: 'id',
        tableLayout: 'fixed',
        emptyText: '暂无资金账户',
        emptyDescription: '创建首个资金账户后，收付款、资金调拨与银行对账即可关联实际账户。'
      }"
      focusable
    />

    <FundAccountDialog ref="dialogRef" @success="handleSaved" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
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
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import type { TableRequestOptions } from '@/hooks/core/useTable'
  import { defaultResponseAdapter } from '@/utils/table/table-utils'
  import type { ApiResponse } from '@/utils/table/table-cache'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { financeRouteNames } from '@/router/business-paths'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import { useFinanceAccountSetPrerequisite } from '../../modules/use-finance-account-set-prerequisite'
  import type { ColumnOption } from '@/types'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'
  import {
    isReadableFieldAccess,
    canViewField,
    getFieldAccess,
    mergeFieldAccessMaps
  } from '@/utils/field-permission'
  import { useUserStore } from '@/store/modules/user'
  import {
    deleteFundAccount,
    fetchAccountSetOptions,
    fetchFundAccountList,
    fetchFundAccountOverview
  } from '@fms/api'
  import FundAccountDialog from './modules/fund-account-dialog.vue'

  defineOptions({ name: 'FinanceFundAccount' })

  type Account = Api.Fms.FundAccountRecord
  type SearchParams = Api.Fms.FundAccountSearchParams
  type TableParams = SearchParams & { current: number; size: number }
  type TableResponse = ApiResponse<Account> & {
    fieldAccess: Api.Fms.FundAccountFieldAccessMap
  }

  interface DialogExpose {
    handleOpen: (row?: Account) => Promise<void>
  }

  const { runWithAccountSet } = useFinanceAccountSetPrerequisite()
  const userStore = useUserStore()
  const tenantScope = useTenantScopeStore()
  const route = useRoute()
  const readScopeKey = computed(() =>
    [tenantScope.effectiveTenantId, tenantScope.revision, userStore.getUserInfo.userId].join(':')
  )
  const tableScopeKey = ref(readScopeKey.value)
  let active = true
  let needsResume = false
  let resettingScope = false
  const captureOperation = useTenantOperationGuard()
  const { getDictMap } = storeToRefs(userStore)
  const tableRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<DialogExpose>()
  const { hasAuth } = useAuth()
  const { deleteGuardRef, deleteRecord } = useRecordDeleteGuard('fms_fund_account', '资金账户', {
    fms_bank_statement_line: {
      routeName: financeRouteNames.bankReconciliation,
      canNavigate: () => hasAuth('FinanceBankReconciliation:View')
    },
    fms_commercial_bill_event: {
      routeName: financeRouteNames.commercialBill,
      canNavigate: () => hasAuth('FinanceCommercialBill:View')
    },
    tms_expense_payment: {
      routeName: financeRouteNames.expenseReimbursement,
      canNavigate: () => hasAuth('FinanceWaybillCost:View')
    }
  })
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const accountSetsLoading = ref(false)
  const accountSetsError = ref(false)
  const overview = ref<Api.Fms.FundAccountOverview>()
  const overviewLoading = ref(true)
  const overviewReady = ref(false)
  const overviewError = ref(false)
  // ArtTableQuery exposes object rows; this page's typed adapter owns their DTO boundary.
  const currentRows = computed(
    () => (tableRef.value?.dataState.rows.value as readonly Account[] | undefined) ?? []
  )
  const listFieldAccess = ref<Api.Fms.FundAccountFieldAccessMap>({})
  let overviewRequestId = 0
  let accountSetsRequestId = 0
  let overviewController: AbortController | undefined
  let accountSetsController: AbortController | undefined
  const effectiveFieldAccess = computed(() =>
    mergeFieldAccessMaps(listFieldAccess.value, ...currentRows.value.map((row) => row.fieldAccess))
  )
  const columnsContextKey = computed(() => JSON.stringify(effectiveFieldAccess.value))
  const canViewListField = (field: Api.Fms.FundAccountFieldKey): boolean =>
    canViewField(effectiveFieldAccess.value, field)
  const canViewRowField = (row: Account, field: Api.Fms.FundAccountFieldKey): boolean =>
    canViewField(row.fieldAccess, field)
  const table = reactive<{ search: SearchParams }>({
    search: { keyword: '', accountSetId: undefined, accountType: undefined, status: undefined }
  })
  const tableContextKey = computed(
    () => `${tableScopeKey.value}:${table.search.accountSetId ?? ''}`
  )

  const searchItems = computed<SearchFormItem[]>(() => [
    {
      label: '所属账套',
      key: 'accountSetId',
      type: 'select',
      props: {
        options: accountSetOptions.value,
        clearable: true,
        filterable: true,
        loading: accountSetsLoading.value,
        placeholder: '全部账套'
      }
    },
    {
      label: '账户类型',
      key: 'accountType',
      type: 'select',
      props: {
        options: getDictMap.value.fmsFundAccountType ?? [],
        clearable: true,
        placeholder: '全部类型'
      }
    },
    {
      label: '账户状态',
      key: 'status',
      type: 'select',
      props: {
        options: getDictMap.value.fmsFundAccountStatus ?? [],
        clearable: true,
        placeholder: '全部状态'
      }
    },
    {
      label: '关键字',
      key: 'keyword',
      type: 'input',
      props: {
        clearable: true,
        placeholder: isReadableFieldAccess(getFieldAccess(listFieldAccess.value, 'accountDetails'))
          ? '账户编码、名称、开户行或账号尾号'
          : '账户编码或名称'
      }
    }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceFundAccount:Add',
      type: 'add',
      label: '新建资金账户',
      disabled: accountSetsLoading.value || accountSetsError.value,
      onClick: () =>
        void runWithAccountSet(
          {
            actionLabel: '新建资金账户',
            activeRequired: true,
            available: accountSetOptions.value.length > 0
          },
          () => dialogRef.value?.handleOpen()
        )
    }
  ])

  const metrics = computed<BusinessWorkspaceMetric[]>(() => {
    const value = overview.value
    const items: BusinessWorkspaceMetric[] = [
      {
        key: 'all',
        label: '资金账户',
        value: overviewReady.value ? (value?.accountCount ?? 0) : '--',
        loading: overviewLoading.value,
        description: '当前可见账户总数',
        icon: 'ri:bank-card-line',
        tone: 'primary',
        interactive: true,
        selected: !table.search.status
      },
      {
        key: 'active',
        label: '正常账户',
        value: overviewReady.value ? (value?.activeAccountCount ?? 0) : '--',
        loading: overviewLoading.value,
        description: '可承接日常资金业务',
        icon: 'ri:checkbox-circle-line',
        tone: 'success',
        interactive: true,
        selected: table.search.status === 'active'
      }
    ]
    if (canViewField(value?.fieldAccess, 'accountBalances')) {
      items.push(
        {
          key: 'balance',
          label: '本位币余额',
          value: formatSensitiveCurrencyValue(value?.baseCurrencyCurrentBalance),
          description: '不跨币种直接相加',
          icon: 'ri:money-cny-circle-line',
          tone: 'primary'
        },
        {
          key: 'available',
          label: '本位币可用',
          value: formatSensitiveCurrencyValue(value?.baseCurrencyAvailableBalance),
          description: `外币账户 ${value?.foreignCurrencyAccountCount ?? 0} 个`,
          icon: 'ri:safe-2-line',
          tone: 'warning'
        }
      )
    }
    return items
  })

  function columnsFactory(): ColumnOption<Account>[] {
    return [
      {
        prop: 'accountName',
        label: '资金账户 / 账套',
        minWidth: 250,
        fixed: 'left',
        formatter: (row) => (
          <div class="fund-account-identity">
            <div>
              <strong title={row.accountName}>{row.accountName}</strong>
              {row.isDefault ? <ElTag size="small">默认</ElTag> : null}
            </div>
            <small translate="no">
              {row.accountCode}
              {canViewRowField(row, 'accountDetails') && row.accountNoMasked
                ? ` · ${row.accountNoMasked}`
                : ''}
            </small>
            <small title={row.accountSet?.accountSetName || '--'}>
              {row.accountSet?.accountSetName || '--'}
            </small>
          </div>
        )
      },
      {
        prop: 'accountType',
        label: '类型',
        width: 100,
        dict: { code: 'fmsFundAccountType', display: 'tag' }
      },
      ...(canViewListField('accountDetails')
        ? [
            {
              prop: 'bankName',
              label: '开户机构',
              minWidth: 145,
              showOverflowTooltip: true,
              formatter: (row: Account) =>
                row.bankName || (row.accountType === 'cash' ? '企业现金' : '--')
            } as ColumnOption<Account>
          ]
        : []),
      {
        prop: 'currency',
        label: '币种',
        width: 70,
        align: 'center',
        formatter: (row) => row.currency?.currencyCode || '--'
      },
      ...(canViewListField('accountBalances')
        ? ([
            {
              prop: 'currentBalance',
              label: '当前 / 可用余额',
              minWidth: 220,
              align: 'right',
              formatter: (row: Account) => (
                <div class="fund-account-balance">
                  <strong>
                    {formatSensitiveCurrencyValue(row.currentBalance, row.currency?.currencyCode)}
                  </strong>
                  <small>
                    可用{' '}
                    {formatSensitiveCurrencyValue(row.availableBalance, row.currency?.currencyCode)}
                    {row.latestBalanceDate
                      ? ` · ${formatWithDayjs(row.latestBalanceDate, 'YYYY-MM-DD')}`
                      : ''}
                  </small>
                </div>
              )
            }
          ] as ColumnOption<Account>[])
        : []),
      {
        prop: 'ledgerEntryCount',
        label: '流水数',
        width: 75,
        align: 'right'
      },
      {
        prop: 'status',
        label: '状态',
        width: 80,
        dict: { code: 'fmsFundAccountStatus', display: 'tag' }
      },
      {
        prop: 'operation',
        label: '操作',
        width: 104,
        fixed: 'right',
        formatter: (row) => (
          <BusinessTableRowActions>
            <ArtButtonTable
              type="edit"
              permission="FinanceFundAccount:Edit"
              onClick={() => void dialogRef.value?.handleOpen(row)}
            />
            <ArtButtonTable
              type="delete"
              permission="FinanceFundAccount:Delete"
              onClick={() => void handleDelete(row)}
            />
          </BusinessTableRowActions>
        )
      }
    ]
  }

  function responseAdapter(
    response: Awaited<ReturnType<typeof fetchFundAccountList>>
  ): TableResponse {
    return {
      ...defaultResponseAdapter<Account>(response),
      fieldAccess: mergeFieldAccessMaps(response.fieldAccess)
    }
  }

  function acceptTableResult(_rows: Account[], response: TableResponse): void {
    listFieldAccess.value = response.fieldAccess
  }

  function handleTableError(): void {
    listFieldAccess.value = {}
  }

  async function fetchTableData(params: TableParams, options?: TableRequestOptions) {
    const isCurrent = captureOperation()
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    const result = await fetchFundAccountList(
      { ...params, from, to },
      { ...options, showErrorMessage: false }
    )
    if (!isCurrent()) throw new DOMException('查询范围已变化', 'AbortError')
    return result
  }

  async function loadOverview(): Promise<void> {
    const requestId = ++overviewRequestId
    overviewController?.abort()
    const controller = new AbortController()
    overviewController = controller
    const isCurrentOperation = captureOperation()
    const accountSetId = table.search.accountSetId || undefined
    const isCurrent = () =>
      requestId === overviewRequestId &&
      !controller.signal.aborted &&
      isCurrentOperation() &&
      accountSetId === (table.search.accountSetId || undefined)
    overview.value = undefined
    overviewReady.value = false
    overviewError.value = false
    overviewLoading.value = true
    try {
      const result = await fetchFundAccountOverview(accountSetId, {
        signal: controller.signal,
        showErrorMessage: false
      })
      if (!isCurrent()) return
      if (result.error || !result.data) {
        overviewError.value = true
        return
      }
      overview.value = result.data
      overviewReady.value = true
    } catch {
      if (isCurrent()) {
        overview.value = undefined
        overviewError.value = true
      }
    } finally {
      if (requestId === overviewRequestId) overviewLoading.value = false
    }
  }

  async function loadAccountSets(): Promise<void> {
    const requestId = ++accountSetsRequestId
    accountSetsController?.abort()
    const controller = new AbortController()
    accountSetsController = controller
    const isCurrentOperation = captureOperation()
    const isCurrent = () =>
      requestId === accountSetsRequestId && !controller.signal.aborted && isCurrentOperation()
    accountSetOptions.value = []
    accountSetsError.value = false
    accountSetsLoading.value = true
    try {
      const { data, error } = await fetchAccountSetOptions(
        { status: 'active', from: 0, to: 999 },
        { signal: controller.signal, showErrorMessage: false }
      )
      if (!isCurrent()) return
      if (error) throw error
      accountSetOptions.value = data
    } catch {
      if (isCurrent()) accountSetsError.value = true
    } finally {
      if (requestId === accountSetsRequestId) accountSetsLoading.value = false
    }
  }

  function handleMetricClick(metric: BusinessWorkspaceMetric): void {
    if (metric.key !== 'all' && metric.key !== 'active') return
    table.search.status = metric.key === 'active' ? 'active' : undefined
    void Promise.all([tableRef.value?.getData(), loadOverview()])
  }

  async function handleDelete(row: Account): Promise<void> {
    await deleteRecord({
      resource: { id: row.id, label: row.accountName },
      permission: 'FinanceFundAccount:Delete',
      confirmMessage: `确定删除资金账户“${row.accountName}”吗？已有业务或流水的账户不能删除，应改为关闭。`,
      remove: () => deleteFundAccount(row.id),
      onDeleted: async () => {
        await Promise.all([tableRef.value?.refreshRemove(), loadOverview()])
      },
      failureMessage: '资金账户删除失败，请刷新列表后重试'
    })
  }

  async function handleSaved(type: 'add' | 'edit'): Promise<void> {
    await Promise.all([
      type === 'add' ? tableRef.value?.refreshCreate() : tableRef.value?.refreshUpdate(),
      loadOverview()
    ])
  }

  watch(
    () => [route.path, route.fullPath] as const,
    ([path], [previousPath]) => {
      tableRef.value?.cancelRequest()
      overviewController?.abort()
      accountSetsController?.abort()
      if (!active || path !== previousPath) return
      void tableRef.value?.refreshUpdate()
      void loadOverview()
      if (accountSetsLoading.value) void loadAccountSets()
    },
    { flush: 'sync' }
  )

  watch(
    () => table.search.accountSetId,
    () => {
      if (!active || resettingScope) return
      tableRef.value?.cancelRequest()
      listFieldAccess.value = {}
      void loadOverview()
    },
    { flush: 'sync' }
  )

  function resetReadScope(): void {
    tableRef.value?.cancelRequest()
    listFieldAccess.value = {}
    resettingScope = true
    table.search.accountSetId = undefined
    resettingScope = false
    tableScopeKey.value = readScopeKey.value
    void loadOverview()
    void loadAccountSets()
  }

  watch(
    readScopeKey,
    () => {
      if (active) resetReadScope()
    },
    { flush: 'sync' }
  )

  onDeactivated(() => {
    active = false
    needsResume = true
    tableRef.value?.cancelRequest()
    overviewController?.abort()
    accountSetsController?.abort()
    overviewReady.value = false
    overviewLoading.value = false
    accountSetsLoading.value = false
    overview.value = undefined
  })

  onActivated(() => {
    active = true
    if (!needsResume) return
    needsResume = false
    if (tableScopeKey.value !== readScopeKey.value) resetReadScope()
    else {
      void tableRef.value?.refreshUpdate()
      void loadOverview()
      void loadAccountSets()
    }
  })

  onBeforeUnmount(() => {
    overviewController?.abort()
    accountSetsController?.abort()
  })

  onMounted(async () => {
    void loadOverview()
    void loadAccountSets()
    await Promise.allSettled([
      userStore.ensureDictLoaded('fmsFundAccountType'),
      userStore.ensureDictLoaded('fmsFundAccountStatus')
    ])
  })
</script>

<style scoped lang="scss">
  .fund-account-page {
    :deep(.art-table-query.fund-account-page__table) {
      min-height: 420px;
    }
  }

  :deep(.fund-account-identity) {
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

    small {
      margin-top: 3px;
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }
  }

  :deep(.fund-account-balance) {
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
