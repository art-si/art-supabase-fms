<template>
  <FinanceAccountingWorkspaceShell
    class="bank-reconciliation-page"
    :location-ready="Boolean(locatedBatchId)"
  >
    <ArtAsyncState
      v-if="linkedBatchLoading || linkedBatchError"
      :loading="linkedBatchLoading"
      :error="linkedBatchError ? '关联银行对账批次加载失败，请重新加载。' : null"
      min-height="160px"
      size="compact"
      @retry="retryLinkedBatch"
    />
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="BANK RECONCILIATION"
      title="银行对账"
      description="将银行外部流水与系统资金日记账进行自动或手工匹配，在余额闭合后锁定批次并保留完整对账证据。"
      icon="ri:file-search-line"
      :tags="[
        { label: '外部事实不改业务单', type: 'primary' },
        { label: '支持分摊匹配', type: 'success' },
        { label: '余额闭环', type: 'info' }
      ]"
      :metrics="metrics"
      @metric-click="handleMetricClick"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ElAlert v-if="overviewError" type="warning" :closable="false" show-icon>
      {{ overviewError }}
      <ElButton link type="primary" :loading="overviewLoading" @click="loadOverview">
        重新加载概览
      </ElButton>
    </ElAlert>
    <ElAlert v-if="accountOptionsError" type="warning" :closable="false" show-icon>
      {{ accountOptionsError }}
      <ElButton
        link
        type="primary"
        :loading="accountOptionsLoading"
        @click="loadAccountOptions(table.search.accountSetId, false)"
      >
        重新加载账户
      </ElButton>
    </ElAlert>
    <ElAlert v-if="accountSetOptionsError" type="warning" :closable="false" show-icon>
      {{ accountSetOptionsError }}
      <ElButton
        link
        type="primary"
        :loading="accountSetOptionsLoading"
        @click="loadAccountSetOptions"
      >
        重新加载账套
      </ElButton>
    </ElAlert>
    <ElAlert v-if="overviewPartial" type="info" :closable="false" show-icon>
      概览超过 1000 条；分类和待处理流水指标暂不可用，请缩小账套或账户范围。
    </ElAlert>

    <ArtTableQuery
      :key="tableContextKey"
      class="bank-reconciliation-page__table"
      ref="tableRef"
      v-model="table.search"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :response-adapter="adaptTableResponse"
      :on-success="acceptTableResponse"
      :on-cache-hit="acceptTableResponse"
      :on-error="clearListAccess"
      :columns-factory="columnsFactory"
      :columns-context-key="columnsContextKey"
      :header-actions="headerActions"
      header-actions-placement="workspace"
      :search-bar-props="{ span: 6, labelWidth: 86, isExpand: true, showExpand: false }"
      :table-props="{
        rowKey: 'id',
        tableLayout: 'fixed',
        emptyText: '暂无银行对账批次',
        emptyDescription: '导入银行流水后，系统将按账户、方向、金额、日期和参考号执行自动匹配。'
      }"
      focusable
    />

    <BankReconciliationImportDialog ref="importDialogRef" @success="handleImported" />
    <BankReconciliationDetailDrawer ref="drawerRef" @changed="handleChanged" />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
  import { ElAlert, ElButton } from 'element-plus'
  import { defaultResponseAdapter } from '@/utils/table/table-utils'
  import type { TableRequestOptions } from '@/hooks/core/useTable'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import { useRouteDocumentDrawer } from '@/hooks/core/useRouteDocumentDrawer'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction,
    ArtTableQueryProps
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import {
    useFinanceAccountSetPrerequisite,
    type FinancePrerequisiteOverlay
  } from '../../modules/use-finance-account-set-prerequisite'
  import type { ColumnOption } from '@/types'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import {
    isReadableFieldAccess,
    canViewField,
    getFieldAccess,
    mergeFieldAccessMaps
  } from '@/utils/field-permission'
  import { useUserStore } from '@/store/modules/user'
  import {
    fetchAccountSetOptions,
    fetchBankReconciliationDetail,
    fetchBankReconciliationList,
    fetchFundAccountOptions
  } from '@fms/api'
  import BankReconciliationImportDialog from './modules/bank-reconciliation-import-dialog.vue'
  import BankReconciliationDetailDrawer from './modules/bank-reconciliation-detail-drawer.vue'

  defineOptions({ name: 'FinanceBankReconciliation' })

  type Batch = Api.Fms.BankReconciliationBatchRecord
  type SearchParams = Api.Fms.BankReconciliationSearchParams
  type TableParams = SearchParams & { current: number; size: number }

  interface ImportDialogExpose extends FinancePrerequisiteOverlay {
    handleOpen: () => Promise<void>
  }
  interface DrawerExpose {
    handleOpen: (row: Batch) => Promise<void>
  }

  const reconciliationStatusOptions = useDictionaryOptions('fmsBankReconciliationStatus')
  const userStore = useUserStore()
  const tenantScope = useTenantScopeStore()
  const route = useRoute()
  const captureOperation = useTenantOperationGuard()
  const readScopeKey = computed(
    () =>
      `${tenantScope.revision}:${tenantScope.effectiveTenantId ?? 'all'}:${userStore.getUserInfo.userId ?? ''}`
  )
  const tableScopeKey = ref(readScopeKey.value)
  let active = true
  let needsResume = false
  const tableRef = ref<ArtTableQueryExpose>()
  const importDialogRef = ref<ImportDialogExpose>()
  const drawerRef = ref<DrawerExpose>()
  const locatedBatchId = ref('')
  const { hasAuth } = useAuth()
  const {
    loading: linkedBatchLoading,
    error: linkedBatchError,
    retry: retryLinkedBatch
  } = useRouteDocumentDrawer({
    routeName: 'FinanceBankReconciliation',
    queryKey: 'recordId',
    clearQueryOnOpen: false,
    canOpen: () => hasAuth('FinanceBankReconciliation:View'),
    fetchDocument: async (id) => {
      locatedBatchId.value = ''
      const { data, error } = await fetchBankReconciliationDetail(id, { showErrorMessage: false })
      if (error || !data) throw new Error('关联银行对账批次加载失败', { cause: error })
      return data
    },
    openDocument: async (batch) => {
      if (!drawerRef.value) throw new Error('银行对账详情尚未就绪')
      locatedBatchId.value = batch.id
      await drawerRef.value.handleOpen(batch)
    }
  })
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const accountSetOptionsLoaded = ref(false)
  const { runWithAccountSet } = useFinanceAccountSetPrerequisite()
  const accountOptions = ref<Api.Fms.FundAccountOption[]>([])
  const overviewRows = ref<Batch[]>([])
  const overviewTotal = ref(0)
  const overviewLoading = ref(false)
  const overviewReady = ref(false)
  const overviewError = ref('')
  const accountOptionsLoading = ref(false)
  const accountOptionsError = ref('')
  const accountSetOptionsLoading = ref(false)
  const accountSetOptionsError = ref('')
  let overviewRequestId = 0
  let overviewController: AbortController | undefined
  let accountOptionsRequestId = 0
  let accountOptionsController: AbortController | undefined
  let accountSetOptionsRequestId = 0
  let accountSetOptionsController: AbortController | undefined
  const currentRows = computed(
    () => (tableRef.value?.dataState.rows.value ?? []) as readonly Batch[]
  )
  const overviewPartial = computed(
    () => overviewReady.value && overviewTotal.value > overviewRows.value.length
  )
  const listFieldAccess = ref<Api.Fms.BankReconciliationFieldAccessMap>({})
  const adaptTableResponse = (
    response: Awaited<ReturnType<typeof fetchBankReconciliationList>>
  ) => ({
    ...defaultResponseAdapter<Batch>(response),
    fieldAccess: mergeFieldAccessMaps(response.fieldAccess)
  })
  const acceptTableResponse: ArtTableQueryProps['onSuccess'] = (_rows, response) => {
    const access = response.fieldAccess
    listFieldAccess.value = mergeFieldAccessMaps(
      access && typeof access === 'object' && !Array.isArray(access)
        ? (access as Api.Fms.BankReconciliationFieldAccessMap)
        : {}
    )
  }
  const clearListAccess = () => {
    listFieldAccess.value = {}
  }
  const effectiveFieldAccess = computed(() =>
    mergeFieldAccessMaps(listFieldAccess.value, ...currentRows.value.map((row) => row.fieldAccess))
  )
  const columnsContextKey = computed(() => JSON.stringify(effectiveFieldAccess.value))
  const canViewListField = (field: Api.Fms.BankReconciliationFieldKey): boolean =>
    canViewField(effectiveFieldAccess.value, field)
  const canViewRowField = (row: Batch, field: Api.Fms.BankReconciliationFieldKey): boolean =>
    canViewField(row.fieldAccess, field)
  const table = reactive<{ search: SearchParams }>({
    search: { keyword: '', accountSetId: undefined, fundAccountId: undefined, status: undefined }
  })
  const tableContextKey = computed(
    () =>
      `${tableScopeKey.value}:${table.search.accountSetId ?? ''}:${table.search.fundAccountId ?? ''}`
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
        placeholder: '全部账套'
      }
    },
    {
      label: '对账账户',
      key: 'fundAccountId',
      type: 'select',
      props: {
        options: accountOptions.value,
        clearable: true,
        filterable: true,
        placeholder: '全部账户'
      }
    },
    {
      label: '对账状态',
      key: 'status',
      type: 'select',
      props: {
        options: reconciliationStatusOptions,
        clearable: true,
        placeholder: '全部状态'
      }
    },
    {
      label: '对账期间',
      key: 'statementDateRange',
      type: 'daterange',
      props: { valueFormat: 'YYYY-MM-DD' }
    },
    {
      label: '关键字',
      key: 'keyword',
      type: 'input',
      props: {
        clearable: true,
        placeholder: [
          '批次号、账户名称',
          isReadableFieldAccess(getFieldAccess(listFieldAccess.value, 'accountDetails'))
            ? '账号尾号'
            : '',
          isReadableFieldAccess(getFieldAccess(listFieldAccess.value, 'bankReferences'))
            ? '文件名'
            : ''
        ]
          .filter(Boolean)
          .join('、')
      }
    }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceBankReconciliation:Add',
      type: 'add',
      label: '导入银行流水',
      disabled:
        !accountSetOptionsLoaded.value ||
        accountSetOptionsLoading.value ||
        !!accountSetOptionsError.value,
      onClick: async () => {
        if (!accountSetOptionsLoaded.value) await loadAccountSetOptions()
        if (!accountSetOptionsLoaded.value) return
        await runWithAccountSet(
          {
            actionLabel: '导入银行流水',
            activeRequired: true,
            accountSetId: table.search.accountSetId,
            foundationRequired: true,
            fundAccountRequired: true,
            available: accountSetOptions.value.length > 0
          },
          () => importDialogRef.value?.handleOpen(),
          importDialogRef.value
        )
      }
    }
  ])

  const metrics = computed<BusinessWorkspaceMetric[]>(() => {
    const selected = table.search.status
    const breakdownReady = overviewReady.value && !overviewPartial.value
    const count = (status: Api.Fms.BankReconciliationStatus) =>
      overviewRows.value.filter((row) => row.status === status).length
    const unmatched = overviewRows.value
      .filter((row) => row.status === 'reconciling')
      .reduce((sum, row) => sum + row.unmatchedCount + row.partialCount, 0)
    return [
      {
        key: 'all',
        label: '对账批次',
        value: overviewReady.value ? overviewTotal.value : '--',
        description: '当前可见批次',
        icon: 'ri:file-search-line',
        tone: 'primary',
        interactive: true,
        selected: !selected
      },
      {
        key: 'reconciling',
        label: '对账中',
        value: breakdownReady ? count('reconciling') : '--',
        description: '仍可调整匹配关系',
        icon: 'ri:loader-2-line',
        tone: 'warning',
        interactive: true,
        selected: selected === 'reconciling'
      },
      {
        key: 'reconciled',
        label: '已完成',
        value: breakdownReady ? count('reconciled') : '--',
        description: '余额闭合并锁定',
        icon: 'ri:checkbox-circle-line',
        tone: 'success',
        interactive: true,
        selected: selected === 'reconciled'
      },
      {
        key: 'exceptions',
        label: '待处理流水',
        value: breakdownReady ? unmatched : '--',
        description: overviewPartial.value
          ? '超过 1000 条，待处理总数待核对'
          : '对账中批次的未匹配与部分匹配',
        icon: 'ri:error-warning-line',
        tone: !breakdownReady ? 'info' : unmatched ? 'danger' : 'success'
      }
    ]
  })

  function columnsFactory(): ColumnOption<Batch>[] {
    return [
      {
        prop: 'batchNo',
        label: '对账批次',
        minWidth: 180,
        fixed: 'left',
        formatter: (row) => (
          <button
            class="bank-batch-link"
            type="button"
            onClick={() => void drawerRef.value?.handleOpen(row)}
          >
            <strong translate="no">{row.batchNo}</strong>
            <small>
              {canViewRowField(row, 'bankReferences')
                ? row.importedFileName || '手工录入'
                : '受控导入批次'}
            </small>
          </button>
        )
      },
      {
        prop: 'accountName',
        label: '对账账户',
        minWidth: 180,
        formatter: (row) => (
          <div class="bank-batch-account">
            <strong title={row.accountName}>{row.accountName}</strong>
            <small>
              {canViewRowField(row, 'accountDetails') && row.accountNoMasked
                ? `${row.accountNoMasked} · `
                : ''}
              {row.currencyCode}
            </small>
          </div>
        )
      },
      {
        prop: 'statementStartDate',
        label: '对账期间',
        width: 190,
        formatter: (row) => `${row.statementStartDate} 至 ${row.statementEndDate}`
      },
      ...(canViewListField('statementAmounts')
        ? ([
            {
              prop: 'closingBalance',
              label: '期末余额',
              width: 110,
              align: 'right',
              formatter: (row: Batch) =>
                formatSensitiveCurrencyValue(row.closingBalance, row.currencyCode)
            }
          ] as ColumnOption<Batch>[])
        : []),
      {
        prop: 'matchedCount',
        label: '处理进度',
        width: 90,
        align: 'center',
        formatter: (row) => `${row.matchedCount + row.ignoredCount}/${row.lineCount}`
      },
      ...(canViewListField('statementAmounts')
        ? ([
            {
              prop: 'statementBalanceDifference',
              label: '余额差',
              width: 110,
              align: 'right',
              formatter: (row: Batch) =>
                formatSensitiveCurrencyValue(row.statementBalanceDifference, row.currencyCode)
            }
          ] as ColumnOption<Batch>[])
        : []),
      {
        prop: 'status',
        label: '状态',
        width: 110,
        dict: { code: 'fmsBankReconciliationStatus', display: 'tag' }
      },
      {
        prop: 'operation',
        label: '操作',
        width: 80,
        fixed: 'right',
        formatter: (row) => (
          <ArtButtonTable
            type="view"
            permission="FinanceBankReconciliation:View"
            label="进入对账"
            onClick={() => void drawerRef.value?.handleOpen(row)}
          />
        )
      }
    ]
  }

  async function fetchTableData(params: TableParams, options?: TableRequestOptions) {
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    return fetchBankReconciliationList(
      { ...params, from, to },
      {
        ...options,
        showErrorMessage: false
      }
    )
  }

  async function loadOverview(): Promise<void> {
    if (!active) return
    overviewController?.abort()
    const controller = new AbortController()
    overviewController = controller
    const requestId = ++overviewRequestId
    const accountSetId = table.search.accountSetId
    const fundAccountId = table.search.fundAccountId
    const operationCurrent = captureOperation()
    const isCurrent = () =>
      requestId === overviewRequestId &&
      !controller.signal.aborted &&
      operationCurrent() &&
      accountSetId === table.search.accountSetId &&
      fundAccountId === table.search.fundAccountId
    overviewRows.value = []
    overviewTotal.value = 0
    overviewReady.value = false
    overviewError.value = ''
    overviewLoading.value = true
    try {
      const result = await fetchBankReconciliationList(
        { accountSetId, fundAccountId, from: 0, to: 999 },
        { signal: controller.signal, showErrorMessage: false }
      )
      if (!isCurrent()) return
      if (result.error) throw result.error
      overviewRows.value = result.data ?? []
      overviewTotal.value = result.total
      overviewReady.value = true
    } catch {
      if (isCurrent()) overviewError.value = '银行对账概览加载失败，当前指标暂不可用。'
    } finally {
      if (requestId === overviewRequestId) overviewLoading.value = false
    }
  }

  async function loadAccountOptions(accountSetId?: string, clearSelection = true): Promise<void> {
    if (!active) return
    accountOptionsController?.abort()
    const controller = new AbortController()
    accountOptionsController = controller
    const requestId = ++accountOptionsRequestId
    const operationCurrent = captureOperation()
    const isCurrent = () =>
      requestId === accountOptionsRequestId &&
      !controller.signal.aborted &&
      operationCurrent() &&
      accountSetId === table.search.accountSetId
    if (clearSelection) table.search.fundAccountId = undefined
    accountOptionsError.value = ''
    if (!accountSetId) {
      accountOptions.value = []
      accountOptionsLoading.value = false
      return
    }
    accountOptions.value = []
    accountOptionsLoading.value = true
    try {
      const { data, error } = await fetchFundAccountOptions(
        { accountSetId, status: 'active' },
        { signal: controller.signal, showErrorMessage: false }
      )
      if (!isCurrent()) return
      if (error) throw error
      accountOptions.value = (data ?? []).filter((item) => item.accountType !== 'cash')
    } catch {
      if (isCurrent()) accountOptionsError.value = '对账账户加载失败，请重试。'
    } finally {
      if (requestId === accountOptionsRequestId) accountOptionsLoading.value = false
    }
  }

  function handleMetricClick(metric: BusinessWorkspaceMetric): void {
    if (!['all', 'reconciling', 'reconciled'].includes(String(metric.key))) return
    table.search.status =
      metric.key === 'all' ? undefined : (metric.key as Api.Fms.BankReconciliationStatus)
    void tableRef.value?.getData()
  }

  async function refreshAll(mode: 'create' | 'update'): Promise<void> {
    await Promise.all([
      mode === 'create' ? tableRef.value?.refreshCreate() : tableRef.value?.refreshUpdate(),
      loadOverview()
    ])
  }

  async function handleImported(): Promise<void> {
    await refreshAll('create')
  }

  async function handleChanged(): Promise<void> {
    await refreshAll('update')
  }

  let resettingScope = false
  const cancelPendingReads = (): void => {
    overviewRequestId++
    overviewController?.abort()
    accountOptionsRequestId++
    accountOptionsController?.abort()
    accountSetOptionsRequestId++
    accountSetOptionsController?.abort()
  }
  const clearReadState = (): void => {
    listFieldAccess.value = {}
    overviewRows.value = []
    overviewTotal.value = 0
    overviewReady.value = false
    overviewLoading.value = false
    overviewError.value = ''
    accountOptions.value = []
    accountOptionsLoading.value = false
    accountOptionsError.value = ''
    accountSetOptions.value = []
    accountSetOptionsLoaded.value = false
    accountSetOptionsLoading.value = false
    accountSetOptionsError.value = ''
  }
  const resetScope = (): void => {
    resettingScope = true
    table.search = {
      keyword: '',
      accountSetId: undefined,
      fundAccountId: undefined,
      status: undefined
    }
    void nextTick(() => {
      resettingScope = false
    })
    clearReadState()
  }
  watch(
    readScopeKey,
    () => {
      tableRef.value?.cancelRequest()
      cancelPendingReads()
      if (!active) return
      resetScope()
      tableScopeKey.value = readScopeKey.value
      if (route.name && route.name !== 'FinanceBankReconciliation') return
      void loadAccountSetOptions()
      void loadOverview()
    },
    { flush: 'sync' }
  )
  watch(
    () => table.search.accountSetId,
    (accountSetId) => {
      if (resettingScope) return
      table.search.fundAccountId = undefined
      void loadAccountOptions(accountSetId, false)
    },
    { flush: 'sync' }
  )
  watch(
    () => [table.search.accountSetId, table.search.fundAccountId],
    () => {
      if (!resettingScope) void loadOverview()
    },
    { flush: 'post' }
  )
  watch(
    () => [route.path, route.fullPath] as const,
    ([path], [previousPath]) => {
      if (
        !active ||
        path !== previousPath ||
        (route.name && route.name !== 'FinanceBankReconciliation')
      )
        return
      void loadOverview()
      if (accountOptionsLoading.value) void loadAccountOptions(table.search.accountSetId, false)
      if (accountSetOptionsLoading.value) void loadAccountSetOptions()
    },
    { flush: 'post' }
  )
  watch(
    () => route.path,
    () => {
      tableRef.value?.cancelRequest()
      cancelPendingReads()
    },
    { flush: 'sync' }
  )

  async function loadAccountSetOptions(): Promise<void> {
    if (!active) return
    accountSetOptionsController?.abort()
    const controller = new AbortController()
    accountSetOptionsController = controller
    const requestId = ++accountSetOptionsRequestId
    const operationCurrent = captureOperation()
    const isCurrent = () =>
      requestId === accountSetOptionsRequestId && !controller.signal.aborted && operationCurrent()
    accountSetOptions.value = []
    accountSetOptionsLoaded.value = false
    accountSetOptionsError.value = ''
    accountSetOptionsLoading.value = true
    try {
      const { data, error } = await fetchAccountSetOptions(
        { status: 'active', from: 0, to: 999 },
        { signal: controller.signal, showErrorMessage: false }
      )
      if (!isCurrent()) return
      if (error) throw error
      accountSetOptions.value = data ?? []
      accountSetOptionsLoaded.value = true
    } catch {
      if (isCurrent()) accountSetOptionsError.value = '账套选项加载失败，请重试。'
    } finally {
      if (requestId === accountSetOptionsRequestId) accountSetOptionsLoading.value = false
    }
  }

  onMounted(async () => {
    const operationCurrent = captureOperation()
    await userStore.ensureDictLoaded('fmsBankReconciliationStatus')
    if (!operationCurrent()) return
    await Promise.all([loadAccountSetOptions(), loadOverview()])
  })
  onDeactivated(() => {
    active = false
    needsResume = true
    tableRef.value?.cancelRequest()
    cancelPendingReads()
    clearReadState()
  })
  onActivated(() => {
    if (!needsResume) return
    needsResume = false
    active = true
    if (tableScopeKey.value !== readScopeKey.value) {
      resetScope()
      tableScopeKey.value = readScopeKey.value
    } else {
      void tableRef.value?.refreshUpdate()
    }
    void loadAccountSetOptions()
    void loadOverview()
    if (table.search.accountSetId) void loadAccountOptions(table.search.accountSetId, false)
  })
  onScopeDispose(cancelPendingReads)
</script>

<style scoped lang="scss">
  .bank-reconciliation-page {
    :deep(.art-table-query.bank-reconciliation-page__table) {
      min-height: 420px;
    }
  }

  :deep(.bank-batch-link),
  :deep(.bank-batch-account) {
    display: grid;
    gap: 3px;
    min-width: 0;
    text-align: left;

    strong,
    small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    small {
      color: var(--el-text-color-secondary);
    }
  }

  :deep(.bank-batch-link) {
    max-width: 100%;
    padding: 0;
    color: var(--el-color-primary);
    cursor: pointer;
    background: none;
    border: 0;
  }
</style>
