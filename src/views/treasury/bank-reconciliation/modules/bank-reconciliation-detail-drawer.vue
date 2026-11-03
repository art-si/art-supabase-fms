<template>
  <ArtDrawer
    header-icon="ri:bank-line"
    :loading="loading || actionBusy"
    loading-text="正在处理银行对账，请稍候…"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
    @close="invalidateDetailContext"
    :show-footer="false"
  >
    <ArtAsyncState
      :error="loadError?.message"
      :empty="!loading && !detail"
      empty-text="暂无银行对账详情"
      empty-description="请返回对账列表重新选择记录，或刷新后重试。"
      @retry="retryLoad"
    >
      <template #empty-action>
        <ElButton type="primary" plain @click="retryLoad">重新加载</ElButton>
      </template>
      <div v-if="detail" class="bank-reconciliation-detail">
        <div class="bank-reconciliation-detail__toolbar">
          <div>
            <ElTag v-if="canViewDetailField('statementAmounts')" :type="balanceDifference.type">
              {{ balanceDifference.text }}
            </ElTag>
            <span>已匹配 {{ detail.matchedCount }}/{{ detail.lineCount }} 行</span>
          </div>
          <div v-if="canAdjustMatches">
            <ElButton
              v-auth="'FinanceBankReconciliation:AutoMatch'"
              :loading="autoMatching"
              :disabled="actionBusy"
              @click="handleAutoMatch"
            >
              <ArtSvgIcon icon="ri:magic-line" />
              自动匹配
            </ElButton>
            <ElButton
              v-auth="'FinanceBankReconciliation:Complete'"
              type="success"
              :disabled="actionBusy"
              @click="handleComplete"
            >
              <ArtSvgIcon icon="ri:checkbox-circle-line" />
              完成对账
            </ElButton>
            <ElButton
              v-auth="'FinanceBankReconciliation:Void'"
              type="danger"
              plain
              :disabled="actionBusy"
              @click="handleVoid"
              >作废批次</ElButton
            >
          </div>
        </div>

        <ElTabs v-model="activeDetailTab"
          ><ElTabPane name="overview" label="批次信息"
            ><div class="space-y-4"
              ><ArtSectionCard title="批次信息" preserve-content-structure>
                <ArtDescriptions
                  :data="detail"
                  :items="descriptionItems"
                  :columns="2"
                  label-width="104px"
                /> </ArtSectionCard></div
          ></ElTabPane>
          <ElTabPane name="lines" label="流水与匹配"
            ><div class="space-y-4"
              ><ArtSectionCard
                class="bank-reconciliation-detail__section"
                title="银行流水"
                :empty="!lines.length"
                empty-title="暂无银行流水"
                empty-description="导入流水后可在此查看匹配与处理状态。"
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
              >
                <ArtTable
                  v-if="!isCompact"
                  :border="false"
                  :data="lines"
                  :columns="lineColumns"
                  :pagination="false"
                  height="auto"
                  :show-table-header="false"
                  table-layout="fixed"
                  empty-height="220px"
                  max-height="430px"
                  empty-text="暂无银行流水"
                />
                <div v-else class="grid gap-3">
                  <article
                    v-for="line in lines"
                    :key="line.id"
                    class="grid gap-3 rounded border border-g-200 p-3"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <strong class="block text-g-900"
                          >第 {{ line.lineNo }} 行 · {{ line.transactionDate }}</strong
                        >
                        <span
                          v-if="canViewDetailField('accountDetails')"
                          class="block break-words text-sm text-g-600"
                          >{{ line.counterpartyName || '未填写对方名称' }}</span
                        >
                      </div>
                      <LineActions :row="line" />
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <ArtDictDisplay
                        dict-code="fmsFundLedgerDirection"
                        :value="line.direction"
                        display="tag"
                      />
                      <ArtDictDisplay
                        dict-code="fmsBankStatementLineStatus"
                        :value="line.status"
                        display="tag"
                      />
                    </div>
                    <dl
                      v-if="canViewDetailField('statementAmounts')"
                      class="grid grid-cols-2 gap-3 text-sm"
                    >
                      <div
                        ><dt class="text-g-600">银行金额</dt
                        ><dd class="m-0 font-medium text-g-900">{{
                          formatSensitiveCurrencyValue(line.amount, detail?.currencyCode)
                        }}</dd></div
                      >
                      <div
                        ><dt class="text-g-600">已匹配金额</dt
                        ><dd class="m-0 font-medium text-g-900">{{
                          formatSensitiveCurrencyValue(line.matchedAmount, detail?.currencyCode)
                        }}</dd></div
                      >
                    </dl>
                    <p
                      v-if="canViewDetailField('bankReferences')"
                      class="m-0 break-words text-xs text-g-600"
                      >银行参考号：{{ line.bankReference || '--' }}</p
                    >
                  </article>
                </div>
              </ArtSectionCard>

              <ArtSectionCard
                v-if="selectedLine"
                class="bank-reconciliation-detail__section"
                :title="`匹配记录 · 第 ${selectedLine.lineNo} 行`"
                :empty="!matches.length"
                :loading="matchesLoading"
                :error="matchesError?.message"
                empty-title="该银行流水暂无匹配记录"
                :empty-description="
                  selectedLine.status === 'ignored'
                    ? '该流水已忽略，无需关联资金流水。'
                    : '完成自动或手动匹配后，关联资金流水会显示在这里。'
                "
                :empty-visual-size="64"
                :min-height="148"
                preserve-content-structure
                @retry="retryMatches"
              >
                <ArtTable
                  v-if="!isCompact"
                  :border="false"
                  :data="matches"
                  :columns="matchColumns"
                  :pagination="false"
                  height="auto"
                  :show-table-header="false"
                  table-layout="fixed"
                  empty-height="150px"
                  max-height="260px"
                  empty-text="该银行流水暂无匹配记录"
                />
                <div v-else class="grid gap-3">
                  <article
                    v-for="match in matches"
                    :key="match.id"
                    class="grid gap-3 rounded border border-g-200 p-3"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <strong class="block text-sm text-g-900">{{
                          formatWithDayjs(match.matchedAt, 'YYYY-MM-DD HH:mm') || '--'
                        }}</strong>
                        <span class="block break-words text-sm text-g-600">{{
                          match.ledgerEntry
                            ? `${match.ledgerEntry.entryDate} · ${match.ledgerEntry.summary}`
                            : '暂无关联资金流水'
                        }}</span>
                      </div>
                      <ArtButtonTable
                        v-if="canAdjustMatches && hasAuth('FinanceBankReconciliation:Unmatch')"
                        type="delete"
                        permission="FinanceBankReconciliation:Unmatch"
                        label="撤销匹配"
                        :disabled="actionBusy"
                        @click="handleUnmatch(match)"
                      />
                    </div>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <ArtDictDisplay
                        dict-code="fmsBankMatchType"
                        :value="match.matchType"
                        display="tag"
                      />
                      <strong
                        v-if="canViewDetailField('statementAmounts')"
                        class="text-sm text-g-900"
                        >{{
                          formatSensitiveCurrencyValue(match.matchedAmount, detail?.currencyCode)
                        }}</strong
                      >
                    </div>
                    <p class="m-0 break-words text-xs text-g-600"
                      >操作人：{{ match.matchedBy || '--' }}</p
                    >
                  </article>
                </div>
              </ArtSectionCard></div
            ></ElTabPane
          ></ElTabs
        >

        <BankLineMatchDialog ref="matchDialogRef" @success="handleMatchChanged" />
      </div>
    </ArtAsyncState>
  </ArtDrawer>
</template>

<script setup lang="tsx">
  import { useMediaQuery } from '@vueuse/core'
  import { ElMessage } from 'element-plus'
  import ArtDictDisplay from '@/components/core/base/art-dict-display/index.vue'
  import type { ColumnOption } from '@/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtSvgIcon from '@/components/core/base/art-svg-icon/index.vue'
  import ArtDrawer from '@/components/core/drawers/art-drawer/index.vue'
  import type { ArtDrawerExpose } from '@/components/core/drawers/art-drawer/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import {
    autoMatchBankReconciliation,
    fetchBankReconciliationDetail,
    fetchBankStatementLines,
    fetchBankStatementMatches,
    ignoreBankStatementLine,
    transitionBankReconciliation,
    unmatchBankStatementLine
  } from '@fms/api'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { useUserStore } from '@/store/modules/user'
  import { formatSensitiveCurrencyValue } from '@/utils/ui'
  import { formatWithDayjs } from '@/utils/time'
  import { isReadableFieldAccess, canViewField, getFieldAccess } from '@/utils/field-permission'
  import BankLineMatchDialog from './bank-line-match-dialog.vue'

  defineOptions({ name: 'FinanceBankReconciliationDetailDrawer' })

  type Batch = Api.Fms.BankReconciliationBatchRecord
  type Line = Api.Fms.BankStatementLineRecord
  type Match = Api.Fms.BankStatementMatchRecord
  const isCompact = useMediaQuery('(max-width: 640px)')

  interface MatchDialogExpose {
    handleOpen: (row: Line) => Promise<void>
  }

  const emit = defineEmits<{ changed: [] }>()
  const { confirmAction, promptReason } = useArtFeedback()
  const { hasAuth } = useAuth()
  const userStore = useUserStore()
  const tenantScopeStore = useTenantScopeStore()
  const route = useRoute()
  const captureOperation = useTenantOperationGuard()
  const drawerRef = ref<ArtDrawerExpose<Batch>>()
  const {
    version: drawerSession,
    invalidate: invalidateDrawerSession,
    isCurrent: isDrawerSessionCurrent
  } = useArtOverlaySession(() => Boolean(unref(drawerRef.value?.visible)))
  const activeDetailTab = ref('overview')
  const matchDialogRef = ref<MatchDialogExpose>()
  const detail = shallowRef<Batch>()
  const lines = shallowRef<Line[]>([])
  const selectedLine = shallowRef<Line>()
  const matches = shallowRef<Match[]>([])
  const activeBatchId = ref('')
  const loading = ref(false)
  const loadError = shallowRef<Error | null>(null)
  const matchesLoading = ref(false)
  const matchesError = shallowRef<Error | null>(null)
  const autoMatching = ref(false)
  const actionBusy = ref(false)
  const quietFeedback = { showMessage: false, showErrorMessage: false } as const
  let active = true
  let detailRequestVersion = 0
  let matchRequestVersion = 0

  function invalidateDetailContext(): void {
    invalidateDrawerSession()
    detailRequestVersion += 1
    matchRequestVersion += 1
    activeBatchId.value = ''
    detail.value = undefined
    lines.value = []
    selectedLine.value = undefined
    matches.value = []
    loadError.value = null
    matchesError.value = null
    loading.value = false
    matchesLoading.value = false
    autoMatching.value = false
    actionBusy.value = false
  }

  function captureBatchContext(batchId: string): () => boolean {
    const operationCurrent = captureOperation()
    const session = drawerSession.value
    return () =>
      active &&
      operationCurrent() &&
      isDrawerSessionCurrent(session) &&
      activeBatchId.value === batchId
  }

  function captureBatchAction(permission: string) {
    const batch = detail.value
    if (!batch || actionBusy.value || !canAdjustMatches.value || !hasAuth(permission)) return
    const { id, tenantId, version, status } = batch
    const readVersion = detailRequestVersion
    const contextCurrent = captureBatchContext(id)
    const isContextCurrent = () =>
      contextCurrent() &&
      detailRequestVersion === readVersion &&
      hasAuth(permission) &&
      detail.value?.id === id &&
      detail.value?.tenantId === tenantId
    return {
      id,
      tenantId,
      version,
      sessionCurrent: contextCurrent,
      isContextCurrent,
      canDispatch: () =>
        isContextCurrent() &&
        detail.value?.version === version &&
        detail.value?.status === status &&
        ['draft', 'reconciling'].includes(status)
    }
  }

  watch(
    () =>
      [
        route.fullPath,
        tenantScopeStore.effectiveTenantId,
        tenantScopeStore.revision,
        userStore.getUserInfo.userId
      ] as const,
    () => {
      if (!unref(drawerRef.value?.visible)) return
      invalidateDetailContext()
      void drawerRef.value?.handleClose(true)
    },
    { flush: 'sync' }
  )
  const canViewDetailField = (field: Api.Fms.BankReconciliationFieldKey): boolean =>
    canViewField(detail.value?.fieldAccess, field)
  const canUsePlainAmounts = computed(() =>
    isReadableFieldAccess(getFieldAccess(detail.value?.fieldAccess, 'statementAmounts'))
  )
  const canAdjustMatches = computed(() =>
    Boolean(detail.value && ['draft', 'reconciling'].includes(detail.value.status))
  )
  const balanceDifference = computed<{ type: 'info' | 'success' | 'danger'; text: string }>(() => {
    const value = detail.value?.statementBalanceDifference
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
      return { type: 'info', text: '余额差待核算' }
    }
    return {
      type: Number(value) === 0 ? 'success' : 'danger',
      text: `余额差 ${formatSensitiveCurrencyValue(value, detail.value?.currencyCode)}`
    }
  })

  const descriptionItems = computed<ArtDescriptionItem<Batch>[]>(() => [
    { key: 'batchNo', label: '对账批次号', field: 'batchNo', copyable: true },
    { key: 'status', label: '批次状态', field: 'status', dictCode: 'fmsBankReconciliationStatus' },
    { key: 'accountName', label: '对账账户', field: 'accountName' },
    { key: 'statementStartDate', label: '期间开始', field: 'statementStartDate', format: 'date' },
    { key: 'statementEndDate', label: '期间结束', field: 'statementEndDate', format: 'date' },
    { key: 'currencyCode', label: '币种', field: 'currencyCode' },
    ...(canViewDetailField('statementAmounts')
      ? ([
          { key: 'openingBalance', label: '期初余额', field: 'openingBalance', format: 'money' },
          { key: 'closingBalance', label: '期末余额', field: 'closingBalance', format: 'money' },
          {
            key: 'calculatedClosingBalance',
            label: '推算余额',
            field: 'calculatedClosingBalance',
            format: 'money'
          }
        ] as ArtDescriptionItem<Batch>[])
      : []),
    ...(canViewDetailField('bankReferences')
      ? ([
          { key: 'importedFileName', label: '来源文件', field: 'importedFileName', span: 2 }
        ] as ArtDescriptionItem<Batch>[])
      : []),
    { key: 'remark', label: '导入说明', field: 'remark', span: 3 },
    ...(detail.value?.voidReason
      ? [{ key: 'voidReason', label: '作废原因', field: 'voidReason', span: 3 }]
      : [])
  ])

  const LineActions = ({ row }: { row: Line }) => (
    <BusinessTableRowActions>
      <ArtButtonTable type="view" label="查看匹配" onClick={() => void loadMatches(row)} />
      {canAdjustMatches.value && ['unmatched', 'partial_matched'].includes(row.status) ? (
        <>
          {canUsePlainAmounts.value ? (
            <ArtButtonTable
              type="edit"
              permission="FinanceBankReconciliation:Match"
              label="手工匹配"
              disabled={actionBusy.value}
              onClick={() => void matchDialogRef.value?.handleOpen(row)}
            />
          ) : null}
          {row.status === 'unmatched' ? (
            <ArtButtonTable
              type="delete"
              permission="FinanceBankReconciliation:Ignore"
              label="忽略流水"
              disabled={actionBusy.value}
              onClick={() => void handleIgnore(row)}
            />
          ) : null}
        </>
      ) : null}
    </BusinessTableRowActions>
  )

  const lineColumns = computed<ColumnOption<Line>[]>(() => [
    { prop: 'lineNo', label: '#', width: 54, align: 'center' },
    {
      prop: 'transactionDate',
      label: '交易日期',
      width: 112,
      link: { onClick: (row) => void loadMatches(row) }
    },
    {
      prop: 'direction',
      label: '方向',
      width: 90,
      dict: { code: 'fmsFundLedgerDirection', display: 'tag' }
    },
    ...(canViewDetailField('statementAmounts')
      ? ([
          {
            prop: 'amount',
            label: '银行 / 已匹配',
            width: 120,
            align: 'right',
            formatter: (row: Line) => (
              <div class="grid gap-1">
                <strong class="font-medium">
                  {formatSensitiveCurrencyValue(row.amount, detail.value?.currencyCode)}
                </strong>
                <span class="text-xs text-g-600">
                  已匹配{' '}
                  {formatSensitiveCurrencyValue(row.matchedAmount, detail.value?.currencyCode)}
                </span>
              </div>
            )
          }
        ] as ColumnOption<Line>[])
      : []),
    ...(canViewDetailField('accountDetails')
      ? ([
          {
            prop: 'counterpartyName',
            label: '对方名称',
            minWidth: 150,
            showOverflowTooltip: true
          }
        ] as ColumnOption<Line>[])
      : []),
    ...(canViewDetailField('bankReferences')
      ? ([
          {
            prop: 'bankReference',
            label: '银行参考号',
            minWidth: 145,
            showOverflowTooltip: true
          }
        ] as ColumnOption<Line>[])
      : []),
    {
      prop: 'status',
      label: '状态',
      width: 100,
      dict: { code: 'fmsBankStatementLineStatus', display: 'tag' }
    },
    {
      prop: 'operation',
      label: '操作',
      width: canAdjustMatches.value ? 136 : 64,
      fixed: 'right',
      formatter: (row) => <LineActions row={row} />
    }
  ])

  const matchColumns = computed<ColumnOption<Match>[]>(() => [
    {
      prop: 'matchedAt',
      label: '匹配时间',
      width: 165,
      formatter: (row) => formatWithDayjs(row.matchedAt, 'YYYY-MM-DD HH:mm') || '--'
    },
    {
      prop: 'matchType',
      label: '方式',
      width: 100,
      dict: { code: 'fmsBankMatchType', display: 'tag' }
    },
    {
      prop: 'ledgerEntry',
      label: '资金流水',
      minWidth: 230,
      formatter: (row) =>
        row.ledgerEntry ? `${row.ledgerEntry.entryDate} · ${row.ledgerEntry.summary}` : '--'
    },
    ...(canViewDetailField('statementAmounts')
      ? [
          {
            prop: 'matchedAmount',
            label: '匹配金额',
            width: 125,
            align: 'right',
            formatter: (row: Match) =>
              formatSensitiveCurrencyValue(row.matchedAmount, detail.value?.currencyCode)
          } satisfies ColumnOption<Match>
        ]
      : []),
    { prop: 'matchedBy', label: '操作人', minWidth: 140, showOverflowTooltip: true },
    ...(hasAuth('FinanceBankReconciliation:Unmatch') && canAdjustMatches.value
      ? [
          {
            prop: 'operation',
            label: '操作',
            width: 78,
            fixed: 'right' as const,
            formatter: (row: Match) => (
              <ArtButtonTable
                type="delete"
                permission="FinanceBankReconciliation:Unmatch"
                label="撤销匹配"
                disabled={actionBusy.value}
                onClick={() => void handleUnmatch(row)}
              />
            )
          } satisfies ColumnOption<Match>
        ]
      : [])
  ])

  async function loadDetail(): Promise<void> {
    const batchId = activeBatchId.value
    if (!batchId) return
    const version = ++detailRequestVersion
    const contextCurrent = captureBatchContext(batchId)
    ++matchRequestVersion
    loading.value = true
    loadError.value = null
    matchesLoading.value = false
    matchesError.value = null
    try {
      await Promise.all([
        userStore.ensureDictLoaded('fmsBankReconciliationStatus'),
        userStore.ensureDictLoaded('fmsFundLedgerDirection'),
        userStore.ensureDictLoaded('fmsBankStatementLineStatus'),
        userStore.ensureDictLoaded('fmsBankMatchType')
      ])
      const [batchResult, lineResult] = await Promise.all([
        fetchBankReconciliationDetail(batchId, { showErrorMessage: false }),
        fetchBankStatementLines(batchId, { showErrorMessage: false })
      ])
      if (!contextCurrent() || version !== detailRequestVersion) return
      if (batchResult.error) throw batchResult.error
      if (lineResult.error) throw lineResult.error
      const nextLines = lineResult.data ?? []
      const nextSelectedLine =
        nextLines.find((item) => item.id === selectedLine.value?.id) ?? nextLines[0]
      detail.value = batchResult.data ?? undefined
      lines.value = batchResult.data ? nextLines : []
      selectedLine.value = batchResult.data ? nextSelectedLine : undefined
      matches.value = []
      if (batchResult.data && nextSelectedLine) void loadMatches(nextSelectedLine)
    } catch (cause) {
      if (!contextCurrent() || version !== detailRequestVersion) return
      detail.value = undefined
      lines.value = []
      selectedLine.value = undefined
      matches.value = []
      loadError.value = new Error('银行对账详情加载失败，请重试或返回列表重新选择。', {
        cause
      })
    } finally {
      if (contextCurrent() && version === detailRequestVersion) loading.value = false
    }
  }

  async function loadMatches(row: Line): Promise<void> {
    const batch = detail.value
    const batchId = activeBatchId.value
    const lineId = row.id
    const currentLine = lines.value.find(
      (item) => item.id === lineId && item.batchId === batchId && item.tenantId === batch?.tenantId
    )
    if (!batch || !currentLine || row.batchId !== batchId || row.tenantId !== batch.tenantId) return
    const version = ++matchRequestVersion
    const contextCurrent = captureBatchContext(batchId)
    selectedLine.value = currentLine
    matches.value = []
    matchesLoading.value = true
    matchesError.value = null
    try {
      const result = await fetchBankStatementMatches(lineId, { showErrorMessage: false })
      if (result.error) throw result.error
      if (contextCurrent() && version === matchRequestVersion && selectedLine.value?.id === lineId)
        matches.value = result.data ?? []
    } catch (cause) {
      if (!contextCurrent() || version !== matchRequestVersion || selectedLine.value?.id !== lineId)
        return
      matchesError.value = new Error('匹配记录加载失败，请重试。', { cause })
    } finally {
      if (contextCurrent() && version === matchRequestVersion) matchesLoading.value = false
    }
  }

  function retryMatches(): void {
    if (selectedLine.value) void loadMatches(selectedLine.value)
  }

  function retryLoad(): void {
    void loadDetail()
  }

  async function handleAutoMatch(): Promise<void> {
    const action = captureBatchAction('FinanceBankReconciliation:AutoMatch')
    if (!action) return
    actionBusy.value = true
    autoMatching.value = true
    try {
      if (!action.canDispatch()) return
      await autoMatchBankReconciliation(action.id, 3, quietFeedback)
      if (!action.isContextCurrent()) return
      ElMessage.success('自动匹配已完成')
      emit('changed')
      await loadDetail()
    } catch (error) {
      if (action.isContextCurrent())
        notifyFriendlyError(error, '自动匹配失败，请刷新银行流水后重试。')
    } finally {
      if (action.sessionCurrent()) {
        autoMatching.value = false
        actionBusy.value = false
      }
    }
  }

  async function handleComplete(): Promise<void> {
    const action = captureBatchAction('FinanceBankReconciliation:Complete')
    if (!action) return
    actionBusy.value = true
    try {
      await confirmAction(
        '完成后批次与匹配关系将锁定，请确认所有未匹配项已处理且期末余额差为 0。',
        '完成银行对账',
        { type: 'success', confirmButtonText: '确认完成' }
      )
      if (!action.canDispatch()) {
        if (action.sessionCurrent()) ElMessage.warning('对账状态或权限已变化，请刷新后重试。')
        return
      }
      const { data } = await transitionBankReconciliation(
        action.id,
        'complete',
        { version: action.version },
        quietFeedback
      )
      if (!action.isContextCurrent()) return
      if (data) detail.value = { ...detail.value, ...data, status: 'reconciled' }
      ElMessage.success('银行对账状态已更新')
      emit('changed')
      await loadDetail()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      if (action.isContextCurrent())
        notifyFriendlyError(error, '完成对账失败，请刷新批次并检查未匹配项和余额差。')
    } finally {
      if (action.sessionCurrent()) actionBusy.value = false
    }
  }

  async function handleVoid(): Promise<void> {
    const action = captureBatchAction('FinanceBankReconciliation:Void')
    if (!action) return
    actionBusy.value = true
    try {
      const reason = await promptReason(
        '作废将撤销本批次全部匹配关系，但保留导入记录供审计。',
        '作废对账批次',
        {
          emptyMessage: '请填写作废原因',
          placeholder: '说明作废原因及后续处理安排'
        }
      )
      if (!action.canDispatch()) {
        if (action.sessionCurrent()) ElMessage.warning('对账状态或权限已变化，请刷新后重试。')
        return
      }
      const { data } = await transitionBankReconciliation(
        action.id,
        'void',
        { reason, version: action.version },
        quietFeedback
      )
      if (!action.isContextCurrent()) return
      if (data) detail.value = { ...detail.value, ...data, status: 'voided' }
      ElMessage.success('银行对账状态已更新')
      emit('changed')
      await loadDetail()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      if (action.isContextCurrent())
        notifyFriendlyError(error, '作废对账批次失败，请刷新批次状态后重试。')
    } finally {
      if (action.sessionCurrent()) actionBusy.value = false
    }
  }

  async function handleIgnore(row: Line): Promise<void> {
    const action = captureBatchAction('FinanceBankReconciliation:Ignore')
    if (!action || row.status !== 'unmatched') return
    const lineId = row.id
    const lineBatchId = row.batchId
    const lineTenantId = row.tenantId
    const isCurrentLine = () =>
      lines.value.some(
        (item) =>
          item.id === lineId &&
          item.batchId === lineBatchId &&
          item.batchId === action.id &&
          item.tenantId === lineTenantId &&
          item.tenantId === action.tenantId &&
          item.status === 'unmatched'
      )
    if (!isCurrentLine()) return
    actionBusy.value = true
    try {
      const reason = await promptReason(
        '忽略项不会参与资金流水匹配，但仍参与银行余额计算。',
        '忽略银行流水',
        {
          emptyMessage: '请填写忽略原因',
          placeholder: '例如 银行利息待补录资金流水'
        }
      )
      if (!action.canDispatch() || !isCurrentLine()) {
        if (action.sessionCurrent()) ElMessage.warning('银行流水状态或权限已变化，请刷新后重试。')
        return
      }
      await ignoreBankStatementLine(lineId, reason, quietFeedback)
      if (!action.isContextCurrent()) return
      ElMessage.success('银行流水已忽略')
      emit('changed')
      await loadDetail()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      if (action.isContextCurrent())
        notifyFriendlyError(error, '忽略银行流水失败，请刷新流水状态后重试。')
    } finally {
      if (action.sessionCurrent()) actionBusy.value = false
    }
  }

  async function handleUnmatch(row: Match): Promise<void> {
    const action = captureBatchAction('FinanceBankReconciliation:Unmatch')
    if (!action) return
    const line = selectedLine.value
    const lineId = line?.id
    const lineStatus = line?.status
    const matchId = row.id
    const matchLineId = row.statementLineId
    const matchTenantId = row.tenantId
    const isCurrentMatch = () =>
      Boolean(
        lineId &&
        selectedLine.value?.id === lineId &&
        selectedLine.value?.status === lineStatus &&
        lines.value.some(
          (item) =>
            item.id === lineId &&
            item.status === lineStatus &&
            item.batchId === action.id &&
            item.tenantId === action.tenantId
        ) &&
        matchLineId === lineId &&
        matchTenantId === action.tenantId &&
        matches.value.some(
          (item) =>
            item.id === matchId &&
            item.statementLineId === lineId &&
            item.tenantId === action.tenantId
        )
      )
    if (!isCurrentMatch()) return
    actionBusy.value = true
    try {
      await confirmAction('确定撤销该匹配关系吗？', '撤销银行流水匹配', {
        type: 'warning',
        confirmButtonText: '确认撤销'
      })
      if (!action.canDispatch() || !isCurrentMatch()) {
        if (action.sessionCurrent()) ElMessage.warning('匹配记录或权限已变化，请刷新后重试。')
        return
      }
      await unmatchBankStatementLine(matchId, quietFeedback)
      if (!action.isContextCurrent()) return
      ElMessage.success('匹配已撤销')
      emit('changed')
      await loadDetail()
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      if (action.isContextCurrent())
        notifyFriendlyError(error, '撤销匹配失败，请刷新匹配记录后重试。')
    } finally {
      if (action.sessionCurrent()) actionBusy.value = false
    }
  }

  async function handleMatchChanged(): Promise<void> {
    const batchId = activeBatchId.value
    if (!batchId) return
    const contextCurrent = captureBatchContext(batchId)
    const nextReadVersion = detailRequestVersion + 1
    await loadDetail()
    if (contextCurrent() && detailRequestVersion === nextReadVersion) emit('changed')
  }

  async function handleOpen(row: Batch): Promise<void> {
    invalidateDetailContext()
    activeBatchId.value = row.id
    detail.value = row
    await drawerRef.value?.handleOpen(row, {
      title: '银行对账',
      subtitle: `${row.batchNo} · 银行流水与资金记录`,
      size: 'xl',
      onOpen: loadDetail,
      drawerProps: { appendToBody: true, resizable: false, closeOnClickModal: true }
    })
  }

  onDeactivated(() => {
    active = false
    invalidateDetailContext()
    void drawerRef.value?.handleClose(true)
  })
  onActivated(() => {
    active = true
  })
  onBeforeUnmount(invalidateDetailContext)

  defineExpose({ handleOpen })
</script>

<style scoped lang="scss">
  .bank-reconciliation-detail {
    min-width: 0;

    &__toolbar {
      display: flex;
      gap: 16px;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      margin-bottom: 20px;
      background: color-mix(in srgb, var(--el-color-primary) 4%, var(--default-box-color));
      border: 1px solid var(--el-border-color-lighter);
      border-radius: var(--el-border-radius-base);

      > div {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      span {
        font-size: 13px;
        color: var(--el-text-color-secondary);
      }
    }

    &__section {
      margin-top: var(--art-space-6);
    }

    @media (width <= 760px) {
      &__toolbar {
        flex-direction: column;
        align-items: stretch;
      }
    }
  }
</style>
