<template>
  <FinanceAccountingWorkspaceShell class="auto-posting-page">
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="ACCOUNTING AUTOMATION"
      title="自动入账"
      description="以可审计的业务事件和制证规则连接结算、收付、发票、报销与总账，异常事件可追踪、可修复、可重试。"
      icon="ri:git-merge-line"
      :tags="[
        { label: '业务财务一体化', type: 'primary' },
        { label: '幂等制证', type: 'success' },
        { label: '职责分离', type: 'info' }
      ]"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="activeTableRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ElTabs v-model="activeTab" class="auto-posting-page__tabs accounting-workspace-tabs">
      <ElTabPane name="rules">
        <template #label>
          <span class="auto-posting-page__tab-label accounting-workspace-tab-label">
            <ArtSvgIcon icon="ri:flow-chart" />
            <span>
              <strong>制证规则</strong>
              <small>配置业务事件、会计科目与核算维度</small>
            </span>
          </span>
        </template>

        <ArtTableQuery
          ref="ruleTableRef"
          class="auto-posting-page__table"
          v-model="ruleTable.search"
          :search-items="ruleTable.searchItems"
          :api-fn="fetchRuleTableData"
          :columns-factory="ruleColumnsFactory"
          :header-actions="ruleTable.headerActions"
          header-actions-placement="section"
          section-title="制证规则"
          section-subtitle="配置业务事件、会计科目与核算维度；规则变更将保留完整审计记录。"
          :search-bar-props="{ span: 6, labelWidth: 86, isExpand: true, showExpand: false }"
          :table-props="{
            rowKey: 'id',
            tableLayout: 'fixed',
            emptyText: '暂无自动入账规则',
            emptyDescription: '当前筛选范围内没有规则。可调整筛选条件，或新增规则。'
          }"
          focusable
        />
      </ElTabPane>

      <ElTabPane name="events">
        <template #label>
          <span class="auto-posting-page__tab-label accounting-workspace-tab-label">
            <ArtSvgIcon icon="ri:pulse-line" />
            <span>
              <strong>事件监控</strong>
              <small>跟踪凭证生成、待配置与失败重试</small>
            </span>
          </span>
        </template>

        <ArtTableQuery
          ref="eventTableRef"
          class="auto-posting-page__table"
          v-model="eventTable.search"
          :search-items="eventTable.searchItems"
          :api-fn="fetchEventTableData"
          :columns-factory="eventColumnsFactory"
          :header-actions="eventTable.headerActions"
          header-actions-placement="section"
          section-title="事件监控"
          section-subtitle="跟踪凭证生成、待配置与失败重试，快速定位需要处理的业务事件。"
          :search-bar-props="{ span: 6, labelWidth: 86, isExpand: true, showExpand: false }"
          :table-props="{
            rowKey: 'id',
            tableLayout: 'fixed',
            emptyText: '暂无自动入账事件',
            emptyDescription: '业务单据达到触发状态后，系统会在这里记录制证处理结果。'
          }"
          focusable
        />
      </ElTabPane>
    </ElTabs>

    <PostingRuleDialog ref="ruleDialogRef" @success="handleRuleSaved" />
    <PostingEventDetailDrawer ref="eventDetailRef" @view-voucher="openVoucherById" />
    <VoucherDetailDrawer ref="voucherDetailRef" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import '../../modules/accounting-workspace-tabs.scss'

  import { ElButton, ElMessage } from 'element-plus'
  import type { ComputedRef, UnwrapNestedRefs } from 'vue'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import type { ColumnOption } from '@/types'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useFinanceAccountSetPrerequisite } from '../../modules/use-finance-account-set-prerequisite'
  import { useUserStore } from '@/store/modules/user'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useAuth } from '@/hooks/core/useAuth'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import { normalizeNullableNumber } from '@/utils/form/normalize'
  import { formatWithDayjs } from '@/utils/time'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import {
    isReadableFieldAccess,
    canEditField,
    canViewField,
    formatSensitiveNumber,
    getFieldAccess,
    isMaskedValue,
    mergeFieldAccessMaps
  } from '@/utils/field-permission'
  import {
    deletePostingRule,
    fetchAccountSetOptions,
    fetchAuxiliaryTypeList,
    fetchPostingEventList,
    fetchPostingRuleList,
    fetchSubjectList,
    processPendingPostingEvents,
    retryPostingEvent
  } from '@fms/api'
  import PostingRuleDialog from './modules/posting-rule-dialog.vue'
  import PostingEventDetailDrawer from './modules/posting-event-detail-drawer.vue'
  import VoucherDetailDrawer from '@fms/views/accounting/voucher-center/modules/voucher-detail-drawer.vue'
  import { formatVoucherSummary } from '../../modules/voucher-summary'

  defineOptions({ name: 'FinanceAutoPosting' })

  type Rule = Api.Fms.SecurePostingRuleRecord
  type Event = Api.Fms.SecurePostingEventRecord
  type RuleParams = Api.Fms.PostingRuleSearchParams &
    Pick<Api.Common.PaginationParams, 'current' | 'size'>
  type EventParams = Api.Fms.PostingEventSearchParams &
    Pick<Api.Common.PaginationParams, 'current' | 'size'>

  interface RuleDialogContext {
    accountSet: Api.Fms.AccountSetOption
    subjects: Api.Fms.SubjectRecord[]
    auxiliaryTypes: Api.Fms.AuxiliaryTypeRecord[]
  }

  interface RuleDialogExpose {
    handleOpen: (
      context: RuleDialogContext,
      row?: Rule,
      loadContext?: () => Promise<RuleDialogContext | undefined>
    ) => Promise<void>
  }

  interface EventDetailExpose {
    handleOpen: (row: Event | string) => Promise<void>
  }

  interface VoucherDetailExpose {
    handleOpen: (row: Api.Fms.SecureVoucherRecord | string) => Promise<void>
  }

  interface RuleTableGroup {
    search: Api.Fms.PostingRuleSearchParams
    searchItems: ComputedRef<SearchFormItem[]>
    headerActions: ComputedRef<ArtTableQueryHeaderAction[]>
  }

  interface EventTableGroup {
    search: Api.Fms.PostingEventSearchParams
    searchItems: ComputedRef<SearchFormItem[]>
    headerActions: ComputedRef<ArtTableQueryHeaderAction[]>
  }

  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const { hasAuth } = useAuth()
  const { confirm } = useArtFeedback()
  const { ensureAccountSet } = useFinanceAccountSetPrerequisite()
  const route = useRoute()
  const postingEventStatuses = new Set<Api.Fms.PostingEventStatus>([
    'pending',
    'processing',
    'generated',
    'pending_configuration',
    'failed',
    'reversed',
    'ignored'
  ])
  const parsePostingEventStatus = (value: unknown): Api.Fms.PostingEventStatus | '' =>
    typeof value === 'string' && postingEventStatuses.has(value as Api.Fms.PostingEventStatus)
      ? (value as Api.Fms.PostingEventStatus)
      : ''
  const activeTab = ref<'rules' | 'events'>(route.query.tab === 'events' ? 'events' : 'rules')
  const accountSetOptions = ref<Api.Fms.AccountSetOption[]>([])
  const ruleTableRef = ref<ArtTableQueryExpose>()
  const eventTableRef = ref<ArtTableQueryExpose>()
  const activeTableRef = computed(() =>
    activeTab.value === 'rules' ? ruleTableRef.value : eventTableRef.value
  )
  const ruleDialogRef = ref<RuleDialogExpose>()
  const { deleteGuardRef, deleteRecord } = useRecordDeleteGuard(
    'fms_posting_rule',
    '自动入账规则',
    {
      fms_posting_event: {
        label: '自动入账事件',
        routeName: 'FinanceAutoPosting',
        routeQuery: { tab: 'events' }
      }
    }
  )
  const eventDetailRef = ref<EventDetailExpose>()
  const voucherDetailRef = ref<VoucherDetailExpose>()
  const ruleContext = shallowRef<RuleDialogContext>()
  const ruleRows = ref<Rule[]>([])
  const eventRows = ref<Event[]>([])
  const retryingEventId = ref('')
  const processingEvents = ref(false)
  const ruleFieldAccess = ref<Api.Fms.AutoPostingFieldAccessMap>({})
  const eventFieldAccess = ref<Api.Fms.AutoPostingFieldAccessMap>({})
  const effectiveRuleFieldAccess = computed(() =>
    mergeFieldAccessMaps(ruleFieldAccess.value, ...ruleRows.value.map((row) => row.fieldAccess))
  )
  const effectiveEventFieldAccess = computed(() =>
    mergeFieldAccessMaps(eventFieldAccess.value, ...eventRows.value.map((row) => row.fieldAccess))
  )
  const canSearchEventSource = computed(() =>
    isReadableFieldAccess(getFieldAccess(eventFieldAccess.value, 'eventSourceReferences'))
  )
  const canSearchDiagnostics = computed(() =>
    isReadableFieldAccess(getFieldAccess(eventFieldAccess.value, 'processingDiagnostics'))
  )

  const commonAccountSetSearchItem = (onChange?: () => void): SearchFormItem => ({
    label: '账套',
    key: 'accountSetId',
    span: 12,
    type: 'select',
    props: {
      options: accountSetOptions.value,
      filterable: true,
      clearable: true,
      placeholder: '全部可查看账套',
      onChange
    }
  })

  const ruleTable: UnwrapNestedRefs<RuleTableGroup> = reactive<RuleTableGroup>({
    search: { accountSetId: '', sourceEvent: '', isEnabled: '', keyword: '' },
    searchItems: computed<SearchFormItem[]>(() => [
      commonAccountSetSearchItem(() => {
        ruleContext.value = undefined
      }),
      {
        label: '业务事件',
        key: 'sourceEvent',
        type: 'select',
        props: {
          options: getDictMap.value.fmsPostingSourceEvent ?? [],
          clearable: true,
          filterable: true
        }
      },
      {
        label: '启用状态',
        key: 'isEnabled',
        type: 'select',
        props: {
          options: (getDictMap.value.commonBoolean ?? []).map((item) => ({
            ...item,
            value: item.value === 'true'
          })),
          clearable: true
        }
      },
      {
        label: '关键词',
        key: 'keyword',
        type: 'input',
        span: 12,
        props: { clearable: true, placeholder: '规则编码或名称' }
      }
    ]),
    headerActions: computed<ArtTableQueryHeaderAction[]>(() =>
      canEditField(ruleFieldAccess.value, 'ruleConfiguration')
        ? [
            {
              permission: 'FinanceAutoPosting:Add',
              type: 'add',
              label: '新增规则',
              onClick: () => void openRuleDialog()
            }
          ]
        : []
    )
  })

  const eventTable: UnwrapNestedRefs<EventTableGroup> = reactive<EventTableGroup>({
    search: {
      accountSetId: '',
      sourceEvent: '',
      status: parsePostingEventStatus(route.query.status),
      eventDateRange: [],
      keyword: ''
    },
    searchItems: computed<SearchFormItem[]>(() => [
      commonAccountSetSearchItem(),
      {
        label: '处理状态',
        key: 'status',
        type: 'select',
        props: { options: getDictMap.value.fmsPostingEventStatus ?? [], clearable: true }
      },
      {
        label: '业务事件',
        key: 'sourceEvent',
        type: 'select',
        props: {
          options: getDictMap.value.fmsPostingSourceEvent ?? [],
          clearable: true,
          filterable: true
        }
      },
      {
        label: '业务日期',
        key: 'eventDateRange',
        span: 12,
        type: 'date',
        props: {
          type: 'daterange',
          valueFormat: 'YYYY-MM-DD',
          rangeSeparator: '至',
          startPlaceholder: '开始日期',
          endPlaceholder: '结束日期',
          clearable: true
        }
      },
      ...(canSearchEventSource.value || canSearchDiagnostics.value
        ? [
            {
              label: '关键词',
              key: 'keyword',
              type: 'input' as const,
              props: {
                clearable: true,
                placeholder: [
                  canSearchEventSource.value ? '来源单号、摘要' : '',
                  canSearchDiagnostics.value ? '异常信息' : ''
                ]
                  .filter(Boolean)
                  .join('或')
              }
            }
          ]
        : [])
    ]),
    headerActions: computed<ArtTableQueryHeaderAction[]>(() =>
      canEditField(eventFieldAccess.value, 'processingDiagnostics')
        ? [
            {
              permission: 'FinanceAutoPosting:ProcessPending',
              key: 'process-pending',
              label: '批量处理待办',
              icon: 'ri:refresh-line',
              buttonProps: {
                type: 'primary',
                plain: true,
                loading: processingEvents.value,
                disabled: Boolean(retryingEventId.value)
              },
              onClick: () => void handleBatchProcess()
            }
          ]
        : []
    )
  })

  async function fetchRuleTableData(params: RuleParams) {
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    const result = await fetchPostingRuleList({ ...params, from, to })
    ruleFieldAccess.value = result.fieldAccess
    ruleRows.value = result.data ?? []
    return result
  }

  async function fetchEventTableData(params: EventParams) {
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    const result = await fetchPostingEventList({ ...params, from, to })
    eventFieldAccess.value = result.fieldAccess
    eventRows.value = result.data ?? []
    return result
  }

  const ruleColumnsFactory = (): ColumnOption<Rule>[] => [
    { type: 'globalIndex', label: '序号', width: 72 },
    {
      prop: 'ruleCode',
      label: '制证规则',
      minWidth: 280,
      formatter: (row) => (
        <BusinessTableIdentityCell primary={row.ruleName} secondary={row.ruleCode} />
      )
    },
    {
      prop: 'sourceEvent',
      label: '业务事件',
      minWidth: 180,
      dict: { code: 'fmsPostingSourceEvent', display: 'tag' }
    },
    ...(canViewField(effectiveRuleFieldAccess.value, 'ruleConfiguration')
      ? [
          {
            prop: 'voucherType',
            label: '凭证类型',
            width: 112,
            dict: { code: 'fmsVoucherType', display: 'text' as const }
          },
          {
            prop: 'submissionMode',
            label: '生成状态',
            width: 140,
            dict: { code: 'fmsPostingSubmissionMode', display: 'tag' as const }
          }
        ]
      : []),
    { prop: 'priority', label: '优先级', width: 88, align: 'center' },
    {
      prop: 'effectiveFrom',
      label: '有效期',
      width: 172,
      formatter: (row) => `${row.effectiveFrom || '即时'} 至 ${row.effectiveTo || '长期'}`
    },
    {
      prop: 'isEnabled',
      label: '状态',
      width: 88,
      dict: {
        code: 'commonEnabledStatus',
        display: 'tag',
        value: (row) => (row.isEnabled ? 'enabled' : 'disabled')
      }
    },
    {
      prop: 'operation',
      label: '操作',
      width: 112,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          {hasAuth('FinanceAutoPosting:Edit') &&
          canEditField(row.fieldAccess, 'ruleConfiguration') ? (
            <ArtButtonTable
              type="edit"
              permission="FinanceAutoPosting:Edit"
              onClick={() => void openRuleDialog(row)}
            />
          ) : null}
          {hasAuth('FinanceAutoPosting:Delete') &&
          canEditField(row.fieldAccess, 'ruleConfiguration') ? (
            <ArtButtonTable
              type="delete"
              permission="FinanceAutoPosting:Delete"
              onClick={() => void handleDeleteRule(row)}
            />
          ) : null}
        </BusinessTableRowActions>
      )
    }
  ]

  const eventColumnsFactory = (): ColumnOption<Event>[] => [
    { type: 'globalIndex', label: '序号', width: 72 },
    ...(canViewField(effectiveEventFieldAccess.value, 'eventSourceReferences')
      ? [
          {
            prop: 'sourceNo',
            label: '来源单号',
            minWidth: 190,
            formatter: (row: Event) =>
              hasAuth('FinanceAutoPosting:View') &&
              isReadableFieldAccess(getFieldAccess(row.fieldAccess, 'eventSourceReferences')) ? (
                <ElButton
                  link
                  type="primary"
                  onClick={() => void eventDetailRef.value?.handleOpen(row)}
                >
                  {row.sourceType === 'tax' ? (
                    <ArtDictDisplay dictCode="fmsTaxType" value={row.sourceNo} display="text" />
                  ) : (
                    row.sourceNo || '查看事件'
                  )}
                </ElButton>
              ) : row.sourceType === 'tax' ? (
                <ArtDictDisplay dictCode="fmsTaxType" value={row.sourceNo} display="text" />
              ) : (
                row.sourceNo || '—'
              )
          }
        ]
      : []),
    {
      prop: 'sourceEvent',
      label: '业务事件',
      minWidth: 180,
      dict: { code: 'fmsPostingSourceEvent', display: 'tag' }
    },
    ...(canViewField(effectiveEventFieldAccess.value, 'eventSourceReferences')
      ? [
          {
            prop: 'summary',
            label: '事件摘要',
            minWidth: 250,
            showOverflowTooltip: true,
            formatter: (row: Event) =>
              formatVoucherSummary(
                row.summary,
                row.sourceType === 'waybill_cost' ? getDictMap.value.fmsPostingWaybillCostType : [],
                {
                  sourceType: row.sourceType,
                  billEvents: getDictMap.value.fmsBillEventType,
                  taxTypes: getDictMap.value.fmsTaxType
                }
              )
          }
        ]
      : []),
    {
      prop: 'eventDate',
      label: '业务日期',
      width: 112,
      formatter: (row) => formatWithDayjs(row.eventDate, 'YYYY-MM-DD') ?? '—'
    },
    {
      prop: 'status',
      label: '处理状态',
      width: 124,
      dict: { code: 'fmsPostingEventStatus', display: 'tag' }
    },
    ...(canViewField(effectiveEventFieldAccess.value, 'eventSourceReferences')
      ? [
          {
            prop: 'rule',
            label: '命中规则',
            minWidth: 180,
            showOverflowTooltip: true,
            formatter: (row: Event) => row.rule?.ruleName || '—'
          },
          {
            prop: 'voucher',
            label: '生成凭证',
            minWidth: 150,
            formatter: (row: Event) => row.voucher?.voucherNo || '—',
            link: {
              permission: 'FinanceAutoPosting:View',
              disabled: (row: Event) =>
                !row.voucherId ||
                !isReadableFieldAccess(getFieldAccess(row.fieldAccess, 'eventSourceReferences')),
              onClick: (row: Event) => {
                if (row.voucherId) void openVoucherById(row.voucherId)
              }
            }
          }
        ]
      : []),
    ...(canViewField(effectiveEventFieldAccess.value, 'eventAmounts')
      ? [
          {
            prop: 'amount',
            label: '业务金额',
            width: 130,
            align: 'right' as const,
            formatter: (row: Event) =>
              formatSensitiveCurrencyValue(
                isMaskedValue(row.payload.grossAmount)
                  ? '***'
                  : normalizeNullableNumber(row.payload.grossAmount)
              )
          }
        ]
      : []),
    ...(canViewField(effectiveEventFieldAccess.value, 'processingDiagnostics')
      ? [
          {
            prop: 'attemptCount',
            label: '处理次数',
            width: 92,
            align: 'center' as const,
            formatter: (row: Event) =>
              formatSensitiveNumber(row.attemptCount, { maximumFractionDigits: 0 })
          }
        ]
      : []),
    {
      prop: 'operation',
      label: '操作',
      width: 112,
      fixed: 'right',
      formatter: (row) =>
        h(BusinessTableRowActions, null, {
          default: () => (
            <>
              {hasAuth('FinanceAutoPosting:View') ? (
                <ArtButtonTable
                  type="view"
                  permission="FinanceAutoPosting:View"
                  onClick={() => void eventDetailRef.value?.handleOpen(row)}
                />
              ) : null}
              {hasAuth('FinanceAutoPosting:Retry') &&
              canEditField(row.fieldAccess, 'processingDiagnostics') &&
              canRetry(row) ? (
                <ArtButtonTable
                  type="sign"
                  icon="ri:restart-line"
                  label="重试制证"
                  permission="FinanceAutoPosting:Retry"
                  loading={retryingEventId.value === row.id}
                  disabled={Boolean(retryingEventId.value) || processingEvents.value}
                  onClick={() => void handleRetryEvent(row)}
                />
              ) : null}
            </>
          )
        })
    }
  ]

  async function loadRuleContext(): Promise<RuleDialogContext | undefined> {
    const accountSet = accountSetOptions.value.find(
      (item) => item.value === ruleTable.search.accountSetId
    )
    if (!accountSet) return undefined
    if (ruleContext.value?.accountSet.value === accountSet.value) return ruleContext.value
    const [subjectResult, auxiliaryTypeResult] = await Promise.all([
      fetchSubjectList(accountSet.value),
      fetchAuxiliaryTypeList(accountSet.value)
    ])
    if (subjectResult.error) throw subjectResult.error
    if (auxiliaryTypeResult.error) throw auxiliaryTypeResult.error
    ruleContext.value = {
      accountSet,
      subjects: subjectResult.data ?? [],
      auxiliaryTypes: auxiliaryTypeResult.data ?? []
    }
    return ruleContext.value
  }

  async function openRuleDialog(row?: Rule): Promise<void> {
    if (!canEditField(row?.fieldAccess ?? ruleFieldAccess.value, 'ruleConfiguration')) return
    if (
      !(await ensureAccountSet({
        actionLabel: row ? '编辑自动入账规则' : '新增自动入账规则',
        activeRequired: true,
        available: Boolean(row?.accountSetId || ruleTable.search.accountSetId)
      }))
    )
      return
    if (!accountSetOptions.value.length) {
      try {
        await loadAccountSets()
      } catch (error) {
        notifyFriendlyError(error, '账套加载失败，请重试')
        return
      }
    }
    if (row?.accountSetId && ruleTable.search.accountSetId !== row.accountSetId) {
      ruleTable.search.accountSetId = row.accountSetId
      ruleContext.value = undefined
    }
    const accountSet = accountSetOptions.value.find(
      (item) => item.value === ruleTable.search.accountSetId
    )
    if (!accountSet) {
      ElMessage.warning('当前账套不可用，请重新选择账套')
      return
    }
    const context =
      ruleContext.value?.accountSet.value === accountSet.value
        ? ruleContext.value
        : { accountSet, subjects: [], auxiliaryTypes: [] }
    await ruleDialogRef.value?.handleOpen(context, row, loadRuleContext)
  }

  async function handleDeleteRule(row: Rule): Promise<void> {
    if (!canEditField(row.fieldAccess, 'ruleConfiguration')) return
    await deleteRecord({
      resource: { id: row.id, label: `${row.ruleCode} · ${row.ruleName}` },
      permission: 'FinanceAutoPosting:Delete',
      confirmMessage: `确定删除规则 ${row.ruleCode} · ${row.ruleName} 吗？已产生事件的规则只能停用。`,
      remove: () => deletePostingRule(row.id),
      onDeleted: async () => {
        await ruleTableRef.value?.refreshRemove()
      },
      failureMessage: '制证规则删除失败，请刷新列表后重试'
    })
  }

  function handleRuleSaved(): void {
    ruleContext.value = undefined
    void ruleTableRef.value?.refreshUpdate()
  }

  function canRetry(row: Event): boolean {
    return ['pending', 'pending_configuration', 'failed'].includes(row.status)
  }

  async function handleRetryEvent(row: Event): Promise<void> {
    if (
      retryingEventId.value ||
      processingEvents.value ||
      !canEditField(row.fieldAccess, 'processingDiagnostics')
    )
      return
    retryingEventId.value = row.id
    try {
      const { data } = await retryPostingEvent(row.id)
      if (data?.status === 'generated') {
        ElMessage.success('会计凭证已生成，请在凭证中心核对')
      } else if (data?.status === 'ignored') {
        ElMessage.info('该事件无需生成会计凭证')
      } else {
        ElMessage.warning(
          getFriendlySupabaseErrorMessage(data?.lastError, '制证尚未完成，请查看事件详情并核对配置')
        )
      }
      await eventTableRef.value?.refreshUpdate()
    } catch (error) {
      notifyFriendlyError(error, '重试制证失败，请稍后重试')
    } finally {
      retryingEventId.value = ''
    }
  }

  async function handleBatchProcess(): Promise<void> {
    if (
      processingEvents.value ||
      retryingEventId.value ||
      !canEditField(eventFieldAccess.value, 'processingDiagnostics')
    )
      return
    processingEvents.value = true
    try {
      await confirm(
        '系统将处理当前账号有权访问的最多 50 条待处理、待配置或失败事件，当前列表的账套、日期和关键词筛选不限定处理范围。是否开始处理？',
        {
          title: '批量处理确认',
          confirmButtonText: '开始处理'
        }
      )
      const { data } = await processPendingPostingEvents(50)
      const results = data ?? []
      const generated = results.filter((item) => item.status === 'generated').length
      const incomplete = results.filter(
        (item) => !['generated', 'ignored', 'reversed'].includes(item.status)
      ).length
      const message = `处理 ${results.length} 条事件，生成凭证 ${generated} 条${incomplete ? `，未完成 ${incomplete} 条，请查看事件详情` : ''}`
      if (incomplete) ElMessage.warning(message)
      else ElMessage.success(message)
      await eventTableRef.value?.refreshUpdate()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '批量制证失败，请稍后重试')
      }
    } finally {
      processingEvents.value = false
    }
  }

  async function openVoucherById(voucherId: string): Promise<void> {
    await voucherDetailRef.value?.handleOpen(voucherId)
  }

  async function loadAccountSets(): Promise<void> {
    const { data } = await fetchAccountSetOptions({ status: 'active', from: 0, to: 999 })
    accountSetOptions.value = data ?? []
    const defaultId = accountSetOptions.value[0]?.value ?? ''
    if (!ruleTable.search.accountSetId) ruleTable.search.accountSetId = defaultId
    if (!eventTable.search.accountSetId) eventTable.search.accountSetId = defaultId
    await nextTick()
    await Promise.all([ruleTableRef.value?.getData(), eventTableRef.value?.getData()])
  }

  onMounted(async () => {
    await Promise.allSettled([
      userStore.ensureDictLoaded('fmsPostingEventStatus'),
      userStore.ensureDictLoaded('fmsPostingSourceEvent'),
      userStore.ensureDictLoaded('fmsPostingSubmissionMode'),
      userStore.ensureDictLoaded('fmsVoucherType'),
      userStore.ensureDictLoaded('fmsPostingWaybillCostType'),
      userStore.ensureDictLoaded('fmsBillEventType'),
      userStore.ensureDictLoaded('fmsTaxType')
    ])
    await loadAccountSets()
    await openReferencedEvent()
  })

  async function openReferencedEvent(): Promise<void> {
    const recordId = route.query.recordId
    if (
      !(
        route.query.fromException === '1' ||
        (route.query.fromMasterDelete === '1' && route.query.dependencyCode === 'fms_posting_event')
      ) ||
      typeof recordId !== 'string' ||
      !recordId ||
      !hasAuth('FinanceAutoPosting:View')
    )
      return
    activeTab.value = 'events'
    await nextTick()
    await eventDetailRef.value?.handleOpen(recordId)
  }

  watch(
    () => [
      route.query.recordId,
      route.query.dependencyCode,
      route.query.fromMasterDelete,
      route.query.fromException
    ],
    () => void openReferencedEvent()
  )

  watch(
    () => [route.query.tab, route.query.status] as const,
    ([tab, status]) => {
      let changed = false
      const nextStatus = parsePostingEventStatus(status)
      if (tab === 'events' && activeTab.value !== 'events') {
        activeTab.value = 'events'
        changed = true
      }
      if (eventTable.search.status !== nextStatus) {
        eventTable.search.status = nextStatus
        changed = true
      }
      if (changed && activeTab.value === 'events') void eventTableRef.value?.getData()
    }
  )
</script>

<style scoped lang="scss">
  .auto-posting-page {
    &__tabs {
      min-height: 480px;
    }

    :deep(.art-table-query.auto-posting-page__table) {
      min-height: 400px;
    }

    &__code {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--el-color-primary);
    }

    @media (width <= 640px) {
      &__tabs {
        min-height: 760px;
      }

      &__tab-label > span small {
        display: none;
      }
    }
  }
</style>
