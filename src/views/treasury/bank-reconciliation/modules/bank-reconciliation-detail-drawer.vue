<template>
  <ArtDrawer
    header-icon="ri:bank-line"
    :loading="loading"
    ref="drawerRef"
    @open="
      () => {
        activeDetailTab = 'overview'
      }
    "
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
              @click="handleAutoMatch"
            >
              <ArtSvgIcon icon="ri:magic-line" />
              自动匹配
            </ElButton>
            <ElButton
              v-auth="'FinanceBankReconciliation:Complete'"
              type="success"
              @click="handleComplete"
            >
              <ArtSvgIcon icon="ri:checkbox-circle-line" />
              完成对账
            </ElButton>
            <ElButton
              v-auth="'FinanceBankReconciliation:Void'"
              type="danger"
              plain
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
  import { useAuth } from '@/hooks/core/useAuth'
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
  const drawerRef = ref<ArtDrawerExpose<Batch>>()
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
  let detailRequestVersion = 0
  let matchRequestVersion = 0
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
              onClick={() => void matchDialogRef.value?.handleOpen(row)}
            />
          ) : null}
          {row.status === 'unmatched' ? (
            <ArtButtonTable
              type="delete"
              permission="FinanceBankReconciliation:Ignore"
              label="忽略流水"
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
    matchRequestVersion += 1
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
      if (batchResult.error) throw batchResult.error
      if (lineResult.error) throw lineResult.error
      const nextLines = lineResult.data ?? []
      const nextSelectedLine =
        nextLines.find((item) => item.id === selectedLine.value?.id) ?? nextLines[0]
      let nextMatches: Match[] = []
      if (batchResult.data && nextSelectedLine) {
        const matchResult = await fetchBankStatementMatches(nextSelectedLine.id, {
          showErrorMessage: false
        })
        if (matchResult.error) throw matchResult.error
        nextMatches = matchResult.data ?? []
      }
      if (version !== detailRequestVersion) return
      detail.value = batchResult.data ?? undefined
      lines.value = batchResult.data ? nextLines : []
      selectedLine.value = batchResult.data ? nextSelectedLine : undefined
      matches.value = batchResult.data ? nextMatches : []
    } catch (cause) {
      if (version !== detailRequestVersion) return
      detail.value = undefined
      lines.value = []
      selectedLine.value = undefined
      matches.value = []
      loadError.value = new Error('银行对账详情加载失败，请重试或返回列表重新选择。', {
        cause
      })
    } finally {
      if (version === detailRequestVersion) loading.value = false
    }
  }

  async function loadMatches(row: Line): Promise<void> {
    const version = ++matchRequestVersion
    selectedLine.value = row
    matches.value = []
    matchesLoading.value = true
    matchesError.value = null
    try {
      const result = await fetchBankStatementMatches(row.id, { showErrorMessage: false })
      if (result.error) throw result.error
      if (version === matchRequestVersion) matches.value = result.data ?? []
    } catch (cause) {
      if (version !== matchRequestVersion) return
      matchesError.value = new Error('匹配记录加载失败，请重试。', { cause })
    } finally {
      if (version === matchRequestVersion) matchesLoading.value = false
    }
  }

  function retryMatches(): void {
    if (selectedLine.value) void loadMatches(selectedLine.value)
  }

  function retryLoad(): void {
    void loadDetail()
  }

  const autoMatching = ref(false)
  async function handleAutoMatch(): Promise<void> {
    if (!detail.value || autoMatching.value) return
    autoMatching.value = true
    try {
      await autoMatchBankReconciliation(detail.value.id)
      await loadDetail()
      emit('changed')
    } catch (error) {
      notifyFriendlyError(error, '自动匹配失败，请刷新银行流水后重试。')
    } finally {
      autoMatching.value = false
    }
  }

  async function handleComplete(): Promise<void> {
    if (!detail.value) return
    try {
      await confirmAction(
        '完成后批次与匹配关系将锁定，请确认所有未匹配项已处理且期末余额差为 0。',
        '完成银行对账',
        { type: 'success', confirmButtonText: '确认完成' }
      )
      const { data } = await transitionBankReconciliation(detail.value.id, 'complete', {
        version: detail.value.version
      })
      if (data) detail.value = { ...detail.value, ...data, status: 'reconciled' }
      emit('changed')
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      notifyFriendlyError(error, '完成对账失败，请刷新批次并检查未匹配项和余额差。')
    }
  }

  async function handleVoid(): Promise<void> {
    if (!detail.value) return
    try {
      const reason = await promptReason(
        '作废将撤销本批次全部匹配关系，但保留导入记录供审计。',
        '作废对账批次',
        {
          emptyMessage: '请填写作废原因',
          placeholder: '说明作废原因及后续处理安排'
        }
      )
      const { data } = await transitionBankReconciliation(detail.value.id, 'void', {
        reason,
        version: detail.value.version
      })
      if (data) detail.value = { ...detail.value, ...data, status: 'voided' }
      await loadDetail()
      emit('changed')
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      notifyFriendlyError(error, '作废对账批次失败，请刷新批次状态后重试。')
    }
  }

  async function handleIgnore(row: Line): Promise<void> {
    try {
      const reason = await promptReason(
        '忽略项不会参与资金流水匹配，但仍参与银行余额计算。',
        '忽略银行流水',
        {
          emptyMessage: '请填写忽略原因',
          placeholder: '例如 银行利息待补录资金流水'
        }
      )
      await ignoreBankStatementLine(row.id, reason)
      await loadDetail()
      emit('changed')
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      notifyFriendlyError(error, '忽略银行流水失败，请刷新流水状态后重试。')
    }
  }

  async function handleUnmatch(row: Match): Promise<void> {
    try {
      await confirmAction('确定撤销该匹配关系吗？', '撤销银行流水匹配', {
        type: 'warning',
        confirmButtonText: '确认撤销'
      })
      await unmatchBankStatementLine(row.id)
      await loadDetail()
      emit('changed')
    } catch (error) {
      if (error === 'cancel' || error === 'close') return
      notifyFriendlyError(error, '撤销匹配失败，请刷新匹配记录后重试。')
    }
  }

  async function handleMatchChanged(): Promise<void> {
    await loadDetail()
    emit('changed')
  }

  async function handleOpen(row: Batch): Promise<void> {
    detailRequestVersion += 1
    matchRequestVersion += 1
    activeBatchId.value = row.id
    detail.value = row
    lines.value = []
    selectedLine.value = undefined
    matches.value = []
    matchesLoading.value = false
    matchesError.value = null
    await drawerRef.value?.handleOpen(row, {
      title: '银行对账',
      subtitle: `${row.batchNo} · 银行流水与资金记录`,
      size: 'xl',
      onOpen: loadDetail,
      drawerProps: { appendToBody: true, resizable: false, closeOnClickModal: true }
    })
  }

  onDeactivated(() => {
    detailRequestVersion += 1
    matchRequestVersion += 1
  })

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
