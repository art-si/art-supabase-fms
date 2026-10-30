<template>
  <FinanceAccountingWorkspaceShell class="fund-journal-page" :location-ready="linkedRecordFound">
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="TREASURY LEDGER"
      title="资金日记账"
      description="集中呈现客户收款、承运商付款、费用付款与内部调拨形成的实际资金流动，原流水与冲销流水均完整保留。"
      icon="ri:book-2-line"
      :tags="[
        { label: '业务自动登记', type: 'primary' },
        { label: '原始单据可追溯', type: 'success' },
        { label: '冲销不删记录', type: 'info' }
      ]"
      :metrics="metrics"
      @metric-click="handleMetricClick"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ElAlert
      type="info"
      :closable="false"
      show-icon
      title="资金日记账由已实现的业务收付款与资金调拨自动生成，不允许在列表中直接修改，以保证业务单、资金流水和会计凭证链路一致。"
    />

    <ElAlert v-if="overviewError" type="warning" :closable="false" show-icon>
      资金流水概览加载失败，当前指标暂不可用。
      <ElButton link type="primary" :loading="overviewLoading" @click="tableRef?.getData()">
        重新加载概览
      </ElButton>
    </ElAlert>
    <ElAlert
      v-else-if="overviewReady && !overviewComplete"
      type="info"
      :closable="false"
      show-icon
      title="当前范围超过概览读取上限，总数按完整范围显示；收支金额、笔数及冲销指标暂不可用，请缩小筛选范围。"
    />
    <ElAlert
      v-if="accountSetsError || accountOptionsError"
      type="warning"
      :closable="false"
      show-icon
    >
      {{ accountSetsError ? '账套选项加载失败。' : '资金账户选项加载失败。' }}
      <ElButton
        link
        type="primary"
        :loading="accountSetsLoading || accountOptionsLoading"
        @click="accountSetsError ? loadAccountSets() : loadAccountOptions()"
      >
        重新加载选项
      </ElButton>
    </ElAlert>

    <ArtTableQuery
      :key="tableContextKey"
      class="fund-journal-page__table"
      ref="tableRef"
      v-model="table.search"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :response-adapter="responseAdapter"
      :on-success="acceptTableResult"
      :on-error="handleTableError"
      :columns-context-key="columnsContextKey"
      :columns-factory="columnsFactory"
      :search-bar-props="{ span: 8, labelWidth: 86, isExpand: true, showExpand: false }"
      :table-props="{
        rowKey: 'id',
        tableLayout: 'fixed',
        emptyText: '暂无资金流水',
        emptyDescription: '收款、付款或资金调拨执行后，系统会在此生成可审计资金流水。'
      }"
      focusable
    />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
  import { normalizeNullableNumber } from '@/utils/form/normalize'
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import type { TableRequestOptions } from '@/hooks/core/useTable'
  import { defaultResponseAdapter } from '@/utils/table/table-utils'
  import type { ApiResponse } from '@/utils/table/table-cache'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type { ArtTableQueryExpose } from '@/components/core/tables/art-table-query/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import type { ColumnOption } from '@/types'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { formatSensitiveCurrencyValue, formatCurrencyValue } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'
  import {
    isReadableFieldAccess,
    canViewField,
    getFieldAccess,
    mergeFieldAccessMaps
  } from '@/utils/field-permission'
  import { useUserStore } from '@/store/modules/user'
  import { fetchAccountSetOptions, fetchFundAccountOptions, fetchFundLedgerList } from '@fms/api'

  defineOptions({ name: 'FinanceFundJournal' })

  type Ledger = Api.Fms.FundLedgerRecord
  type SearchParams = Api.Fms.FundLedgerSearchParams
  type TableParams = SearchParams & { current: number; size: number }
  type LedgerResult = Awaited<ReturnType<typeof fetchFundLedgerList>>
  type LedgerTableResult = LedgerResult & {
    overviewResult: Promise<LedgerResult | undefined>
    requestId: number
    direction: SearchParams['direction']
  }
  type TableResponse = ApiResponse<Ledger> & {
    fieldAccess: Api.Fms.FundLedgerFieldAccessMap
    overviewResult: Promise<LedgerResult | undefined>
    requestId: number
    direction: SearchParams['direction']
  }

  const userStore = useUserStore()
  const tenantScope = useTenantScopeStore()
  const captureOperation = useTenantOperationGuard()
  const readScopeKey = computed(() =>
    [tenantScope.effectiveTenantId, tenantScope.revision, userStore.getUserInfo.userId].join(':')
  )
  const tableScopeKey = ref(readScopeKey.value)
  let active = true
  let needsResume = false
  let resettingScope = false
  const directionOptions = useDictionaryOptions('fmsFundLedgerDirection')
  const sourceTypeOptions = useDictionaryOptions('fmsFundLedgerSourceType')
  const tableRef = ref<ArtTableQueryExpose>()
  const route = useRoute()
  const linkedRecordNo = computed(() =>
    route.name === 'FinanceFundJournal' &&
    route.query.fromMasterDelete === '1' &&
    typeof route.query.recordNo === 'string'
      ? route.query.recordNo
      : ''
  )
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const accountOptions = ref<Api.Fms.FundAccountOption[]>([])
  const accountSetsLoading = ref(false)
  const accountSetsError = ref(false)
  const accountOptionsLoading = ref(false)
  const accountOptionsError = ref(false)
  const overviewRows = ref<Ledger[]>([])
  const overviewTotal = ref(0)
  const overviewFieldAccess = ref<Api.Fms.FundLedgerFieldAccessMap>({})
  const overviewLoading = ref(true)
  const overviewReady = ref(false)
  const overviewError = ref(false)
  const overviewComplete = computed(
    () => overviewReady.value && overviewRows.value.length === overviewTotal.value
  )
  const appliedDirection = ref<SearchParams['direction']>()
  let ledgerRequestId = 0
  let ledgerController: AbortController | undefined
  let accountOptionsRequestId = 0
  let accountSetsRequestId = 0
  let accountOptionsController: AbortController | undefined
  let accountSetsController: AbortController | undefined
  // The adapter below owns the typed records accepted by this table.
  const currentRows = computed(
    () => (tableRef.value?.dataState.rows.value as readonly Ledger[] | undefined) ?? []
  )
  const linkedRecordFound = computed(
    () =>
      !tableRef.value?.dataState.loading.value &&
      !tableRef.value?.dataState.error.value &&
      currentRows.value.some((row) => row.id === route.query.recordId)
  )
  const listFieldAccess = ref<Api.Fms.FundLedgerFieldAccessMap>({})
  const effectiveFieldAccess = computed(() =>
    mergeFieldAccessMaps(listFieldAccess.value, ...currentRows.value.map((row) => row.fieldAccess))
  )
  const columnsContextKey = computed(() => JSON.stringify(effectiveFieldAccess.value))
  const canViewListField = (field: Api.Fms.FundLedgerFieldKey): boolean =>
    canViewField(effectiveFieldAccess.value, field)
  const canFilterAccount = computed(() =>
    isReadableFieldAccess(getFieldAccess(listFieldAccess.value, 'accountDetails'))
  )
  const table = reactive<{ search: SearchParams }>({
    search: {
      keyword: linkedRecordNo.value,
      accountSetId: undefined,
      fundAccountId: undefined,
      direction: undefined,
      sourceType: undefined,
      status: undefined
    }
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
        loading: accountSetsLoading.value,
        placeholder: '全部账套'
      }
    },
    ...(canFilterAccount.value
      ? [
          {
            label: '资金账户',
            key: 'fundAccountId',
            type: 'select' as const,
            props: {
              options: accountOptions.value,
              clearable: true,
              filterable: true,
              loading: accountOptionsLoading.value,
              placeholder: '全部账户'
            }
          }
        ]
      : []),
    {
      label: '收支方向',
      key: 'direction',
      type: 'select',
      props: {
        options: directionOptions,
        clearable: true,
        placeholder: '全部方向'
      }
    },
    {
      label: '业务来源',
      key: 'sourceType',
      type: 'select',
      props: {
        options: sourceTypeOptions,
        clearable: true,
        placeholder: '全部来源'
      }
    },
    {
      label: '入账日期',
      key: 'entryDateRange',
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
          '资金流水号',
          canFilterAccount.value ? '账户名称' : '',
          isReadableFieldAccess(getFieldAccess(listFieldAccess.value, 'transactionDetails'))
            ? '业务单号、摘要、对方或银行参考号'
            : ''
        ]
          .filter(Boolean)
          .join('、')
      }
    }
  ])

  const metrics = computed<BusinessWorkspaceMetric[]>(() => {
    const rows = overviewRows.value
    const amountAccess = getFieldAccess(overviewFieldAccess.value, 'ledgerAmounts')
    const summarizeAmount = (direction: Api.Fms.FundLedgerDirection) => {
      const directionRows = rows.filter((row) => row.direction === direction)
      if (!directionRows.length) return { value: '0 笔', description: '当前范围无该方向流水' }
      const values = directionRows.map((row) => normalizeNullableNumber(row.amount) ?? undefined)
      const currencyCode = directionRows[0]?.currencyCode || 'CNY'
      const sameCurrency = directionRows.every((row) => row.currencyCode === currencyCode)
      const readable =
        isReadableFieldAccess(amountAccess) &&
        directionRows.every((row) =>
          isReadableFieldAccess(getFieldAccess(row.fieldAccess, 'ledgerAmounts', amountAccess))
        ) &&
        sameCurrency &&
        values.every((value): value is number => value !== undefined)
      return {
        value: readable
          ? formatCurrencyValue(
              values.reduce((sum, value) => sum + value, 0),
              currencyCode
            )
          : amountAccess === 'masked'
            ? '***'
            : '--',
        description: sameCurrency ? `${directionRows.length} 笔` : '币种不一致或不完整，金额不合并'
      }
    }
    const inflow = summarizeAmount('inflow')
    const outflow = summarizeAmount('outflow')
    const reversalCount = rows.filter((row) => row.reversalOfId || row.status === 'reversed').length
    return [
      {
        key: 'all',
        label: '资金流水',
        value: overviewReady.value ? overviewTotal.value : '--',
        loading: overviewLoading.value,
        description: '当前筛选范围记录',
        icon: 'ri:list-check-3',
        tone: 'primary',
        interactive: true,
        selected: !appliedDirection.value
      },
      {
        key: 'inflow',
        label: '资金流入',
        value: overviewComplete.value ? inflow.value : '--',
        loading: overviewLoading.value,
        description: overviewComplete.value ? inflow.description : '当前查询范围',
        icon: 'ri:arrow-left-down-line',
        tone: 'success',
        interactive: true,
        selected: appliedDirection.value === 'inflow'
      },
      {
        key: 'outflow',
        label: '资金流出',
        value: overviewComplete.value ? outflow.value : '--',
        loading: overviewLoading.value,
        description: overviewComplete.value ? outflow.description : '当前查询范围',
        icon: 'ri:arrow-right-up-line',
        tone: 'warning',
        interactive: true,
        selected: appliedDirection.value === 'outflow'
      },
      {
        key: 'reversal',
        label: '冲销关联',
        value: overviewComplete.value ? reversalCount : '--',
        loading: overviewLoading.value,
        description: '原流水与反向流水均保留',
        icon: 'ri:arrow-go-back-line',
        tone: reversalCount ? 'warning' : 'info'
      }
    ]
  })

  function columnsFactory(): ColumnOption<Ledger>[] {
    return [
      {
        prop: 'entryNo',
        label: '资金流水号',
        minWidth: 170,
        fixed: 'left',
        formatter: (row) => (
          <div class="fund-ledger-identity">
            <strong translate="no" title={row.entryNo}>
              {row.entryNo}
            </strong>
            <small>{row.entryDate}</small>
          </div>
        )
      },
      ...(canViewListField('accountDetails')
        ? [
            {
              prop: 'fundAccount',
              label: '资金账户',
              minWidth: 170,
              formatter: (row: Ledger) => (
                <div class="fund-ledger-identity">
                  <strong title={row.fundAccount?.accountName || '--'}>
                    {row.fundAccount?.accountName || '--'}
                  </strong>
                  <small>{row.fundAccount?.accountNoMasked || '--'}</small>
                </div>
              )
            }
          ]
        : []),
      {
        prop: 'direction',
        label: '方向',
        width: 75,
        dict: { code: 'fmsFundLedgerDirection', display: 'tag' }
      },
      ...(canViewListField('ledgerAmounts')
        ? [
            {
              prop: 'amount',
              label: '发生金额',
              width: 115,
              align: 'right' as const,
              formatter: (row: Ledger) => formatSensitiveCurrencyValue(row.amount, row.currencyCode)
            }
          ]
        : []),
      {
        prop: 'sourceType',
        label: '业务来源',
        width: 110,
        dict: { code: 'fmsFundLedgerSourceType', display: 'text' }
      },
      ...(canViewListField('transactionDetails')
        ? [
            {
              prop: 'summary',
              label: '业务摘要',
              minWidth: 235,
              formatter: (row: Ledger) => (
                <div class="fund-ledger-identity">
                  <strong title={row.summary || '--'}>{row.summary || '--'}</strong>
                  <small title={row.sourceNo || '--'} translate="no">
                    {row.sourceNo || '--'}
                  </small>
                  {row.counterpartyName || row.bankReference ? (
                    <small
                      title={[row.counterpartyName, row.bankReference].filter(Boolean).join(' · ')}
                    >
                      {[row.counterpartyName, row.bankReference].filter(Boolean).join(' · ')}
                    </small>
                  ) : null}
                </div>
              )
            }
          ]
        : []),
      {
        prop: 'status',
        label: '状态',
        width: 80,
        formatter: (row) =>
          row.status === 'reversed' ? '已被冲销' : row.reversalOfId ? '冲销流水' : '已入账'
      },
      {
        prop: 'postedAt',
        label: '登记时间',
        width: 135,
        formatter: (row) => formatWithDayjs(row.postedAt, 'YYYY-MM-DD HH:mm') || '--'
      }
    ]
  }

  function responseAdapter(response: LedgerTableResult): TableResponse {
    return {
      ...defaultResponseAdapter<Ledger>(response),
      fieldAccess: mergeFieldAccessMaps(response.fieldAccess),
      overviewResult: response.overviewResult,
      requestId: response.requestId,
      direction: response.direction
    }
  }

  function acceptTableResult(_rows: Ledger[], response: TableResponse): void {
    listFieldAccess.value = response.fieldAccess
    appliedDirection.value = response.direction
    void acceptOverview(response)
  }

  async function acceptOverview(response: TableResponse): Promise<void> {
    const summary = await response.overviewResult
    if (response.requestId !== ledgerRequestId || ledgerController?.signal.aborted) return
    overviewLoading.value = false
    if (!summary) return
    overviewError.value = Boolean(summary.error)
    overviewReady.value = !summary.error
    overviewRows.value = summary.error ? [] : summary.data
    overviewTotal.value = summary.error ? 0 : summary.total
    overviewFieldAccess.value = summary.error ? {} : mergeFieldAccessMaps(summary.fieldAccess)
  }

  function handleTableError(): void {
    ledgerController?.abort()
    listFieldAccess.value = {}
    overviewFieldAccess.value = {}
    overviewRows.value = []
    overviewReady.value = false
    overviewError.value = true
    overviewLoading.value = false
  }

  async function fetchTableData(params: TableParams, options?: TableRequestOptions) {
    const requestId = ++ledgerRequestId
    ledgerController?.abort()
    const controller = new AbortController()
    ledgerController = controller
    const cancel = () => controller.abort()
    if (options?.signal?.aborted) controller.abort()
    else options?.signal?.addEventListener('abort', cancel, { once: true })
    const isCurrentOperation = captureOperation()
    overviewLoading.value = true
    overviewReady.value = false
    overviewError.value = false
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    const requestOptions = { signal: controller.signal, showErrorMessage: false }
    const listRequest = fetchFundLedgerList({ ...params, from, to }, requestOptions)
    const overviewResult = fetchFundLedgerList(
      { ...params, from: 0, to: 999 },
      requestOptions
    ).then(
      (result) => (isCurrentOperation() ? result : undefined),
      (error) => (isCurrentOperation() ? { data: [], total: 0, fieldAccess: {}, error } : undefined)
    )
    // The table may finish first; keep its cancellation signal linked until both reads settle.
    void Promise.allSettled([listRequest, overviewResult]).then(() =>
      options?.signal?.removeEventListener('abort', cancel)
    )
    try {
      const result = await listRequest
      if (!isCurrentOperation()) throw new DOMException('查询范围已变化', 'AbortError')
      return {
        ...result,
        overviewResult,
        requestId,
        direction: params.direction
      }
    } catch (error) {
      controller.abort()
      throw error
    }
  }

  async function loadAccountOptions(): Promise<void> {
    const requestId = ++accountOptionsRequestId
    accountOptionsController?.abort()
    const controller = new AbortController()
    accountOptionsController = controller
    const isCurrentOperation = captureOperation()
    const accountSetId = table.search.accountSetId
    const isCurrent = () =>
      requestId === accountOptionsRequestId &&
      !controller.signal.aborted &&
      isCurrentOperation() &&
      accountSetId === table.search.accountSetId &&
      canFilterAccount.value
    accountOptions.value = []
    accountOptionsError.value = false
    accountOptionsLoading.value = false
    if (!accountSetId || !canFilterAccount.value) {
      return
    }
    accountOptionsLoading.value = true
    try {
      const { data, error } = await fetchFundAccountOptions(
        { accountSetId },
        { signal: controller.signal, showErrorMessage: false }
      )
      if (!isCurrent()) return
      if (error) throw error
      accountOptions.value = data
    } catch {
      if (isCurrent()) accountOptionsError.value = true
    } finally {
      if (requestId === accountOptionsRequestId) accountOptionsLoading.value = false
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
    if (!['all', 'inflow', 'outflow'].includes(String(metric.key))) return
    table.search.direction =
      metric.key === 'all' ? undefined : (metric.key as Api.Fms.FundLedgerDirection)
    void tableRef.value?.getData()
  }

  watch(canFilterAccount, (allowed) => {
    if (!active) return
    if (!allowed) {
      table.search.fundAccountId = undefined
    }
    void loadAccountOptions()
  })

  watch(
    () => [route.path, route.fullPath, linkedRecordNo.value] as const,
    ([path, , recordNo], [previousPath, , previousRecordNo]) => {
      tableRef.value?.cancelRequest()
      ledgerController?.abort()
      accountOptionsController?.abort()
      accountSetsController?.abort()
      if (!active || path !== previousPath) return
      if (recordNo === previousRecordNo) void tableRef.value?.refreshUpdate()
      if (accountOptionsLoading.value) void loadAccountOptions()
      if (accountSetsLoading.value) void loadAccountSets()
    },
    { flush: 'sync' }
  )

  watch(
    () => table.search.accountSetId,
    () => {
      if (!active || resettingScope) return
      tableRef.value?.cancelRequest()
      ledgerController?.abort()
      table.search.fundAccountId = undefined
      void loadAccountOptions()
    },
    { flush: 'sync' }
  )

  function resetReadScope(): void {
    tableRef.value?.cancelRequest()
    ledgerController?.abort()
    ++ledgerRequestId
    listFieldAccess.value = {}
    overviewFieldAccess.value = {}
    overviewRows.value = []
    overviewReady.value = false
    overviewError.value = false
    overviewLoading.value = true
    resettingScope = true
    table.search.accountSetId = undefined
    table.search.fundAccountId = undefined
    resettingScope = false
    tableScopeKey.value = readScopeKey.value
    void loadAccountOptions()
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
    ledgerController?.abort()
    accountOptionsController?.abort()
    accountSetsController?.abort()
    overviewReady.value = false
    overviewLoading.value = false
    accountOptionsLoading.value = false
    accountSetsLoading.value = false
  })

  onActivated(() => {
    active = true
    if (!needsResume) return
    needsResume = false
    if (tableScopeKey.value !== readScopeKey.value) resetReadScope()
    else {
      void tableRef.value?.refreshUpdate()
      void loadAccountOptions()
      void loadAccountSets()
    }
  })

  onBeforeUnmount(() => {
    ledgerController?.abort()
    accountOptionsController?.abort()
    accountSetsController?.abort()
  })

  onMounted(async () => {
    void loadAccountSets()
    watch(linkedRecordNo, (recordNo, previousRecordNo) => {
      if (route.name !== 'FinanceFundJournal' || (!recordNo && !previousRecordNo)) return
      table.search.keyword = recordNo
      void tableRef.value?.getData()
    })
    await Promise.all([
      userStore.ensureDictLoaded('fmsFundLedgerDirection'),
      userStore.ensureDictLoaded('fmsFundLedgerSourceType')
    ])
  })
</script>

<style scoped lang="scss">
  .fund-journal-page {
    :deep(.art-table-query.fund-journal-page__table) {
      min-height: 440px;
    }
  }

  :deep(.fund-ledger-identity) {
    display: grid;
    gap: 3px;
    min-width: 0;

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
</style>
