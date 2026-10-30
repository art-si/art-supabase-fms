<template>
  <FinanceAccountingWorkspaceShell
    class="fund-transfer-page"
    :location-ready="Boolean(locatedTransferId)"
  >
    <ArtAsyncState
      v-if="linkedTransferLoading || linkedTransferError"
      :loading="linkedTransferLoading"
      :error="linkedTransferError ? '关联资金调拨加载失败，请重新加载。' : null"
      min-height="160px"
      size="compact"
      @retry="retryLinkedTransfer"
    />
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="TREASURY CONTROL"
      title="资金调拨"
      description="以审批、余额校验和双边资金流水管控企业内部账户调拨，执行与冲销均保留完整操作轨迹。"
      icon="ri:swap-2-line"
      :tags="[
        { label: '同账套同币种', type: 'primary' },
        { label: '审批后执行', type: 'success' },
        { label: '可审计冲销', type: 'info' }
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
      概览超过 1000 条；分类和金额指标暂不可用，请按账套缩小范围。
    </ElAlert>

    <ArtTableQuery
      :key="tableContextKey"
      class="fund-transfer-page__table"
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
        emptyText: '暂无资金调拨',
        emptyDescription: '创建调拨草稿，经提交、审批和执行后自动形成双边资金流水。'
      }"
      focusable
    />

    <FundTransferDialog ref="dialogRef" @success="handleSaved" />
    <FundTransferDetailDrawer ref="drawerRef" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
  import { ElAlert, ElButton } from 'element-plus'
  import { uniq } from 'lodash-es'
  import { normalizeNullableNumber } from '@/utils/form/normalize'
  import { defaultResponseAdapter } from '@/utils/table/table-utils'
  import type { TableRequestOptions } from '@/hooks/core/useTable'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import { useRouteDocumentDrawer } from '@/hooks/core/useRouteDocumentDrawer'
  import { useAuth } from '@/hooks/core/useAuth'
  import dayjs from 'dayjs'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction,
    ArtTableQueryProps
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtButtonMore, {
    type ButtonMoreItem
  } from '@/components/core/forms/art-button-more/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
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
  import { formatSensitiveCurrencyValue, formatCurrencyValue } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'
  import {
    isReadableFieldAccess,
    canViewField,
    getFieldAccess,
    mergeFieldAccessMaps
  } from '@/utils/field-permission'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useUserStore } from '@/store/modules/user'
  import {
    deleteFundTransfer,
    fetchAccountSetOptions,
    fetchFundAccountOptions,
    fetchFundTransferDetail,
    fetchFundTransferList,
    transitionFundTransfer
  } from '@fms/api'
  import FundTransferDialog from './modules/fund-transfer-dialog.vue'
  import FundTransferDetailDrawer from './modules/fund-transfer-detail-drawer.vue'

  defineOptions({ name: 'FinanceFundTransfer' })

  type Transfer = Api.Fms.FundTransferRecord
  type SearchParams = Api.Fms.FundTransferSearchParams
  type TableParams = SearchParams & { current: number; size: number }

  interface DialogExpose extends FinancePrerequisiteOverlay {
    handleOpen: (row?: Transfer) => Promise<void>
  }
  interface DrawerExpose {
    handleOpen: (row: Transfer) => Promise<void>
  }

  const { confirmAction, promptReason } = useArtFeedback()
  const { deleteGuardRef, deleteRecord, deleteBusy } = useRecordDeleteGuard(
    'fms_fund_transfer',
    '资金调拨'
  )
  const transitionBusy = ref(false)
  const { runWithAccountSet } = useFinanceAccountSetPrerequisite()
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
  const transferStatusOptions = useDictionaryOptions('fmsFundTransferStatus')
  const tableRef = ref<ArtTableQueryExpose>()
  const dialogRef = ref<DialogExpose>()
  const drawerRef = ref<DrawerExpose>()
  const locatedTransferId = ref('')
  const { hasAuth } = useAuth()
  const {
    loading: linkedTransferLoading,
    error: linkedTransferError,
    retry: retryLinkedTransfer
  } = useRouteDocumentDrawer({
    routeName: 'FinanceFundTransfer',
    queryKey: 'recordId',
    clearQueryOnOpen: false,
    canOpen: () => hasAuth('FinanceFundTransfer:View'),
    fetchDocument: async (id) => {
      locatedTransferId.value = ''
      const { data, error } = await fetchFundTransferDetail(id, { showErrorMessage: false })
      if (error || !data) throw new Error('关联资金调拨加载失败', { cause: error })
      return data
    },
    openDocument: async (transfer) => {
      if (!drawerRef.value) throw new Error('资金调拨详情尚未就绪')
      await drawerRef.value.handleOpen(transfer)
      locatedTransferId.value = transfer.id
    }
  })
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const accountSetOptionsReady = ref(false)
  const accountOptions = ref<Api.Fms.FundAccountOption[]>([])
  const overviewRows = ref<Transfer[]>([])
  const overviewTotal = ref(0)
  const overviewFieldAccess = ref<Api.Fms.FundTransferFieldAccessMap>({})
  const overviewLoading = ref(false)
  const overviewReady = ref(false)
  const overviewError = ref('')
  const accountOptionsLoading = ref(false)
  const accountOptionsError = ref('')
  const accountSetOptionsError = ref('')
  const accountSetOptionsLoading = ref(false)
  let overviewRequestId = 0
  let overviewController: AbortController | undefined
  let accountOptionsRequestId = 0
  let accountOptionsController: AbortController | undefined
  let accountSetOptionsRequestId = 0
  let accountSetOptionsController: AbortController | undefined
  const currentRows = computed(
    () => (tableRef.value?.dataState.rows.value ?? []) as readonly Transfer[]
  )
  const overviewPartial = computed(
    () => overviewReady.value && overviewTotal.value > overviewRows.value.length
  )
  const listFieldAccess = ref<Api.Fms.FundTransferFieldAccessMap>({})
  const adaptTableResponse = (response: Awaited<ReturnType<typeof fetchFundTransferList>>) => ({
    ...defaultResponseAdapter<Transfer>(response),
    fieldAccess: mergeFieldAccessMaps(response.fieldAccess)
  })
  const acceptTableResponse: ArtTableQueryProps['onSuccess'] = (_rows, response) => {
    const access = response.fieldAccess
    listFieldAccess.value = mergeFieldAccessMaps(
      access && typeof access === 'object' && !Array.isArray(access)
        ? (access as Api.Fms.FundTransferFieldAccessMap)
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
  const canViewListField = (field: Api.Fms.FundTransferFieldKey): boolean =>
    canViewField(effectiveFieldAccess.value, field)
  const canFilterAccount = computed(() =>
    isReadableFieldAccess(getFieldAccess(listFieldAccess.value, 'transferAccounts'))
  )
  const table = reactive<{ search: SearchParams }>({
    search: { keyword: '', accountSetId: undefined, status: undefined }
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
        placeholder: '全部账套'
      }
    },
    ...(canFilterAccount.value
      ? [
          {
            label: '调拨账户',
            key: 'sourceAccountId',
            type: 'select' as const,
            props: {
              options: accountOptions.value,
              clearable: true,
              filterable: true,
              placeholder: '全部转出账户'
            }
          }
        ]
      : []),
    {
      label: '调拨状态',
      key: 'status',
      type: 'select',
      props: {
        options: transferStatusOptions,
        clearable: true,
        placeholder: '全部状态'
      }
    },
    {
      label: '调拨日期',
      key: 'transferDateRange',
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
          '调拨单号、用途',
          canFilterAccount.value ? '账户名称' : '',
          isReadableFieldAccess(getFieldAccess(listFieldAccess.value, 'bankReference'))
            ? '银行参考号'
            : ''
        ]
          .filter(Boolean)
          .join('、')
      }
    }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceFundTransfer:Add',
      type: 'add',
      label: '新建资金调拨',
      disabled:
        !accountSetOptionsReady.value ||
        accountSetOptionsLoading.value ||
        !!accountSetOptionsError.value,
      onClick: () =>
        void runWithAccountSet(
          {
            actionLabel: '新建资金调拨',
            activeRequired: true,
            accountSetId: table.search.accountSetId,
            foundationRequired: true,
            fundAccountRequired: true,
            available: accountSetOptions.value.length > 0
          },
          () => dialogRef.value?.handleOpen(),
          dialogRef.value
        )
    }
  ])

  const metrics = computed<BusinessWorkspaceMetric[]>(() => {
    const selected = table.search.status
    const breakdownReady = overviewReady.value && !overviewPartial.value
    const count = (status: Api.Fms.FundTransferStatus) =>
      overviewRows.value.filter((row) => row.status === status).length
    const completedRows = overviewRows.value.filter((row) => row.status === 'completed')
    const currencies = uniq(completedRows.map((row) => row.currencyCode).filter(Boolean))
    const singleCurrency =
      completedRows.length > 0 &&
      currencies.length === 1 &&
      completedRows.every((row) => Boolean(row.currencyCode))
    const currencyCode = singleCurrency ? completedRows[0]?.currencyCode : undefined
    const amountAccess = getFieldAccess(overviewFieldAccess.value, 'transferAmounts')
    const completedAmounts = completedRows.map(
      (row) => normalizeNullableNumber(row.amount) ?? undefined
    )
    const canAggregateAmount =
      breakdownReady &&
      singleCurrency &&
      completedRows.every((row) =>
        isReadableFieldAccess(getFieldAccess(row.fieldAccess, 'transferAmounts', amountAccess))
      ) &&
      completedAmounts.every((value): value is number => value !== undefined)
    const completedAmount = canAggregateAmount
      ? completedAmounts.reduce((sum, value) => sum + value, 0)
      : undefined
    return [
      {
        key: 'all',
        label: '全部调拨',
        value: overviewReady.value ? overviewTotal.value : '--',
        description: '当前可见调拨单',
        icon: 'ri:swap-2-line',
        tone: 'primary',
        interactive: true,
        selected: !selected
      },
      {
        key: 'pending_review',
        label: '待审批',
        value: breakdownReady ? count('pending_review') : '--',
        description: '等待资金审批',
        icon: 'ri:time-line',
        tone: 'warning',
        interactive: true,
        selected: selected === 'pending_review'
      },
      {
        key: 'approved',
        label: '待执行',
        value: breakdownReady ? count('approved') : '--',
        description: '已审批未入账',
        icon: 'ri:play-circle-line',
        tone: 'primary',
        interactive: true,
        selected: selected === 'approved'
      },
      {
        key: 'completed',
        label: canAggregateAmount ? '已完成金额' : '已完成调拨',
        value: !breakdownReady
          ? '--'
          : completedAmount === undefined
            ? amountAccess === 'masked'
              ? '***'
              : count('completed')
            : formatCurrencyValue(completedAmount, currencyCode),
        description: !breakdownReady
          ? overviewPartial.value
            ? '超过 1000 条，分类和金额待核对'
            : '当前范围尚未加载'
          : canAggregateAmount
            ? `${count('completed')} 笔已入账`
            : completedRows.length && !singleCurrency
              ? currencies.length > 1
                ? '多币种金额不合计'
                : '币种缺失，金额不合计'
              : '金额受字段权限控制',
        icon: 'ri:checkbox-circle-line',
        tone: 'success',
        interactive: true,
        selected: selected === 'completed'
      }
    ]
  })

  function columnsFactory(): ColumnOption<Transfer>[] {
    return [
      {
        prop: 'transferNo',
        label: '调拨单号',
        minWidth: 165,
        fixed: 'left',
        formatter: (row) => (
          <button
            class="fund-transfer-link"
            type="button"
            onClick={() => void drawerRef.value?.handleOpen(row)}
          >
            <strong translate="no">{row.transferNo}</strong>
            <small
              title={`最近更新 ${formatWithDayjs(row.updateTime, 'YYYY-MM-DD HH:mm') || '--'}`}
            >
              {formatWithDayjs(row.transferDate, 'YYYY-MM-DD')}
            </small>
          </button>
        )
      },
      ...(canViewListField('transferAccounts')
        ? [
            {
              prop: 'sourceAccountName',
              label: '转出账户',
              minWidth: 180,
              formatter: (row: Transfer) => (
                <div class="fund-transfer-account">
                  <strong title={row.sourceAccountName || '--'}>
                    {row.sourceAccountName || '--'}
                  </strong>
                  <small>{row.sourceAccountNoMasked || '--'}</small>
                </div>
              )
            },
            {
              prop: 'targetAccountName',
              label: '转入账户',
              minWidth: 180,
              formatter: (row: Transfer) => (
                <div class="fund-transfer-account">
                  <strong title={row.targetAccountName || '--'}>
                    {row.targetAccountName || '--'}
                  </strong>
                  <small>{row.targetAccountNoMasked || '--'}</small>
                </div>
              )
            }
          ]
        : []),
      ...(canViewListField('transferAmounts')
        ? [
            {
              prop: 'amount',
              label: '调拨金额',
              minWidth: 120,
              align: 'right' as const,
              formatter: (row: Transfer) =>
                formatSensitiveCurrencyValue(row.amount, row.currencyCode)
            },
            {
              prop: 'feeAmount',
              label: '手续费',
              width: 95,
              align: 'right' as const,
              formatter: (row: Transfer) =>
                formatSensitiveCurrencyValue(row.feeAmount, row.currencyCode)
            }
          ]
        : []),
      { prop: 'purpose', label: '调拨用途', minWidth: 155, showOverflowTooltip: true },
      {
        prop: 'status',
        label: '状态',
        width: 85,
        dict: { code: 'fmsFundTransferStatus', display: 'tag' }
      },
      {
        prop: 'operation',
        label: '操作',
        width: 160,
        fixed: 'right',
        formatter: (row) => (
          <BusinessTableRowActions>
            <ArtButtonTable
              type="view"
              permission="FinanceFundTransfer:View"
              onClick={() => void drawerRef.value?.handleOpen(row)}
            />
            {['draft', 'rejected'].includes(row.status) ? (
              <ArtButtonTable
                type="edit"
                permission="FinanceFundTransfer:Edit"
                disabled={transitionBusy.value || deleteBusy.value}
                onClick={() => void dialogRef.value?.handleOpen(row)}
              />
            ) : null}
            {getActionItems(row).length ? (
              <ArtButtonMore
                trigger="click"
                list={getActionItems(row).map((item) => ({
                  ...item,
                  disabled: transitionBusy.value || deleteBusy.value
                }))}
                onClick={(item: ButtonMoreItem) => void handleAction(item, row)}
              />
            ) : null}
          </BusinessTableRowActions>
        )
      }
    ]
  }

  function getActionItems(row: Transfer): ButtonMoreItem[] {
    if (['draft', 'rejected'].includes(row.status)) {
      return [
        {
          auth: 'FinanceFundTransfer:Submit',
          key: 'submit',
          label: '提交审批',
          icon: 'ri:send-plane-line',
          color: 'var(--el-color-primary)'
        },
        {
          auth: 'FinanceFundTransfer:Delete',
          key: 'delete',
          label: '删除草稿',
          icon: 'ri:delete-bin-line',
          color: 'var(--el-color-danger)'
        }
      ]
    }
    if (row.status === 'pending_review') {
      return [
        {
          auth: 'FinanceFundTransfer:Approve',
          key: 'approve',
          label: '审批通过',
          icon: 'ri:check-line',
          color: 'var(--el-color-success)'
        },
        {
          auth: 'FinanceFundTransfer:Reject',
          key: 'reject',
          label: '驳回',
          icon: 'ri:close-line',
          color: 'var(--el-color-danger)'
        }
      ]
    }
    if (row.status === 'approved') {
      return [
        {
          auth: 'FinanceFundTransfer:Execute',
          key: 'execute',
          label: '执行入账',
          icon: 'ri:play-line',
          color: 'var(--el-color-success)'
        }
      ]
    }
    if (row.status === 'completed') {
      return [
        {
          auth: 'FinanceFundTransfer:Reverse',
          key: 'reverse',
          label: '冲销调拨',
          icon: 'ri:arrow-go-back-line',
          color: 'var(--el-color-warning)'
        }
      ]
    }
    return []
  }

  async function fetchTableData(params: TableParams, options?: TableRequestOptions) {
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    return fetchFundTransferList({ ...params, from, to }, { ...options, showErrorMessage: false })
  }

  async function loadOverview(): Promise<void> {
    if (!active) return
    overviewController?.abort()
    const controller = new AbortController()
    overviewController = controller
    const requestId = ++overviewRequestId
    const accountSetId = table.search.accountSetId
    const operationCurrent = captureOperation()
    const isCurrent = () =>
      requestId === overviewRequestId &&
      !controller.signal.aborted &&
      operationCurrent() &&
      accountSetId === table.search.accountSetId
    overviewRows.value = []
    overviewTotal.value = 0
    overviewFieldAccess.value = {}
    overviewReady.value = false
    overviewError.value = ''
    overviewLoading.value = true
    try {
      const result = await fetchFundTransferList(
        { accountSetId, from: 0, to: 999 },
        { signal: controller.signal, showErrorMessage: false }
      )
      if (!isCurrent()) return
      if (result.error) throw result.error
      overviewRows.value = result.data ?? []
      overviewTotal.value = result.total
      overviewFieldAccess.value = result.fieldAccess
      overviewReady.value = true
    } catch {
      if (isCurrent()) overviewError.value = '资金调拨概览加载失败，当前指标暂不可用。'
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
    if (clearSelection) table.search.sourceAccountId = undefined
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
      accountOptions.value = data ?? []
    } catch {
      if (isCurrent()) accountOptionsError.value = '调拨账户加载失败，请重试。'
    } finally {
      if (requestId === accountOptionsRequestId) accountOptionsLoading.value = false
    }
  }

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
    accountSetOptionsReady.value = false
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
      accountSetOptionsReady.value = true
    } catch {
      if (isCurrent()) accountSetOptionsError.value = '账套选项加载失败，请重试。'
    } finally {
      if (requestId === accountSetOptionsRequestId) accountSetOptionsLoading.value = false
    }
  }

  function handleMetricClick(metric: BusinessWorkspaceMetric): void {
    table.search.status =
      metric.key === 'all' ? undefined : (metric.key as Api.Fms.FundTransferStatus)
    void tableRef.value?.getData()
  }

  async function handleAction(item: ButtonMoreItem, row: Transfer): Promise<void> {
    if (transitionBusy.value || deleteBusy.value) return
    const action = getActionItems(row).find((candidate) => candidate.key === item.key)
    const canRunAction = () =>
      Boolean(
        action?.auth &&
        hasAuth(action.auth) &&
        getActionItems(row).some(
          (candidate) => candidate.key === action.key && candidate.auth === action.auth
        )
      )
    if (!action || !canRunAction()) {
      ElMessage.error('调拨操作权限或状态已变化，请刷新页面后重试')
      return
    }
    if (item.key === 'delete') {
      await deleteRecord({
        resource: { id: row.id, label: row.transferNo },
        permission: 'FinanceFundTransfer:Delete',
        confirmMessage: `确定删除调拨草稿“${row.transferNo}”吗？`,
        remove: () => deleteFundTransfer(row.id),
        onDeleted: () => refreshAll('delete'),
        failureMessage: '资金调拨删除失败，请刷新调拨状态后重试'
      })
      return
    }
    transitionBusy.value = true
    try {
      if (
        item.key !== 'submit' &&
        item.key !== 'approve' &&
        item.key !== 'reject' &&
        item.key !== 'execute' &&
        item.key !== 'reverse'
      )
        return
      let reason: string | undefined
      if (item.key === 'reject' || item.key === 'reverse') {
        reason = await promptReason(
          item.key === 'reject'
            ? '请说明驳回原因和修改要求。'
            : '冲销会生成反向资金流水，请说明业务原因。',
          item.key === 'reject' ? '驳回资金调拨' : '冲销资金调拨',
          { emptyMessage: '请填写原因', placeholder: '填写可审计的处理原因' }
        )
      } else {
        const messages: Record<string, string> = {
          submit: '提交后将进入资金审批流程。',
          approve: '审批通过后仍需执行入账，当前操作不会立即改变余额。',
          execute: buildExecuteConfirmMessage(row)
        }
        await confirmAction(messages[item.key] || '确定执行该操作吗？', item.label, {
          type: item.key === 'execute' ? 'warning' : 'info',
          confirmButtonText: item.label
        })
      }
      if (!canRunAction()) {
        ElMessage.error('调拨操作权限或状态已变化，请刷新页面后重试')
        return
      }
      await transitionFundTransfer(row.id, item.key, {
        reason,
        executionDate: ['execute', 'reverse'].includes(String(item.key))
          ? dayjs().format('YYYY-MM-DD')
          : null,
        version: row.version
      })
      await refreshAll('update')
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      notifyFriendlyError(error, `${item.label}失败，请刷新调拨状态后重试`)
    } finally {
      transitionBusy.value = false
    }
  }

  function buildExecuteConfirmMessage(row: Transfer): string {
    const amount = normalizeNullableNumber(row.amount) ?? undefined
    const feeAmount = normalizeNullableNumber(row.feeAmount) ?? undefined
    if (row.sourceAccountName && amount !== undefined && feeAmount !== undefined) {
      return `执行后将从“${row.sourceAccountName}”扣减 ${formatCurrencyValue(amount + feeAmount, row.currencyCode)}。`
    }
    return '执行后将生成双边资金流水并更新账户余额。'
  }

  async function refreshAll(mode: 'add' | 'edit' | 'update' | 'delete'): Promise<void> {
    const refresh =
      mode === 'add'
        ? tableRef.value?.refreshCreate()
        : mode === 'delete'
          ? tableRef.value?.refreshRemove()
          : tableRef.value?.refreshUpdate()
    await Promise.all([refresh, loadOverview()])
  }

  async function handleSaved(type: 'add' | 'edit'): Promise<void> {
    await refreshAll(type)
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
    overviewFieldAccess.value = {}
    overviewTotal.value = 0
    overviewReady.value = false
    overviewLoading.value = false
    overviewError.value = ''
    accountOptions.value = []
    accountOptionsLoading.value = false
    accountOptionsError.value = ''
    accountSetOptions.value = []
    accountSetOptionsReady.value = false
    accountSetOptionsLoading.value = false
    accountSetOptionsError.value = ''
  }
  const resetScope = (): void => {
    resettingScope = true
    table.search = { keyword: '', accountSetId: undefined, status: undefined }
    resettingScope = false
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
      if (route.name && route.name !== 'FinanceFundTransfer') return
      void loadAccountSetOptions()
      void loadOverview()
    },
    { flush: 'sync' }
  )
  watch(
    () => table.search.accountSetId,
    (accountSetId) => {
      if (resettingScope) return
      void loadAccountOptions(accountSetId)
      void loadOverview()
    },
    { flush: 'sync' }
  )
  watch(
    () => [route.path, route.fullPath] as const,
    ([path], [previousPath]) => {
      if (!active || path !== previousPath || (route.name && route.name !== 'FinanceFundTransfer'))
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

  watch(canFilterAccount, (allowed) => {
    if (!allowed) table.search.sourceAccountId = undefined
  })

  onMounted(async () => {
    const operationCurrent = captureOperation()
    await userStore.ensureDictLoaded('fmsFundTransferStatus')
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
  .fund-transfer-page {
    :deep(.art-table-query.fund-transfer-page__table) {
      min-height: 420px;
    }
  }

  :deep(.fund-transfer-link) {
    display: grid;
    gap: 3px;
    max-width: 100%;
    padding: 0;
    color: var(--el-color-primary);
    text-align: left;
    cursor: pointer;
    background: none;
    border: 0;

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

  :deep(.fund-transfer-account) {
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
