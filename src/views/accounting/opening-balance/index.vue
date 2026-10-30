<template>
  <FinanceAccountingWorkspaceShell
    class="opening-balance-page"
    :class="{ 'is-focus-mode': focusMode }"
  >
    <BusinessWorkspaceHeader
      v-show="!focusMode"
      density="compact"
      eyebrow="财务基础 · 期初初始化"
      title="期初余额"
      description="按账套、会计年度、末级科目及辅助维度录入期初数据，通过借贷平衡校验后统一确认锁定。"
      icon="ri:scales-3-line"
      :tags="[
        { label: '借贷平衡', type: 'primary' },
        { label: '确认锁定', type: 'success' },
        { label: '反确认留痕', type: 'info' }
      ]"
      :metrics="metrics"
    >
      <template #actions>
        <BusinessWorkspaceFocusToggle v-model="focusMode" />
      </template>
    </BusinessWorkspaceHeader>

    <ArtSectionCard
      v-show="!focusMode"
      title="初始化范围"
      subtitle="期初数据按账套与会计年度分别管控"
      class="opening-balance-page__scope-section accounting-workspace-scope-section"
    >
      <div class="opening-balance-page__scope">
        <label>
          <span>账套</span>
          <ElSelect
            v-model="scope.accountSetId"
            aria-label="账套"
            filterable
            :loading="scope.loading"
            :disabled="workspace.statusChanging"
            placeholder="请选择账套"
            @change="handleAccountSetChange"
          >
            <ElOption
              v-for="item in scope.options"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </ElSelect>
        </label>
        <label>
          <span>会计年度</span>
          <ElSelect
            v-model="scope.fiscalYear"
            aria-label="会计年度"
            placeholder="请选择年度"
            :disabled="workspace.statusChanging"
            @change="loadBalances"
          >
            <ElOption
              v-for="year in scope.fiscalYears"
              :key="year"
              :label="`${year} 年`"
              :value="year"
            />
          </ElSelect>
        </label>
      </div>
      <AccountingSetupGuide
        :loading="scope.loading"
        :has-account-set="scope.options.length > 0"
        :can-configure="hasAuth('FinanceAccountSet:Add')"
        @configure="goToAccountSet"
      />
    </ArtSectionCard>

    <ArtSectionCard
      title="期初余额明细"
      :subtitle="
        summary.status === 'confirmed'
          ? '已确认锁定，反确认后方可调整'
          : '草稿状态，可继续录入和校验'
      "
      class="opening-balance-page__detail accounting-workspace-fill-section"
    >
      <template #actions>
        <BusinessWorkspaceFocusToggle v-show="focusMode" v-model="focusMode" />
        <ElButton
          v-if="hasAuth('FinanceOpeningBalance:Add') && summary.status === 'draft'"
          type="primary"
          :disabled="workspace.loading || Boolean(workspace.error)"
          @click="openDialog()"
        >
          <ArtSvgIcon icon="ri:add-line" />录入余额
        </ElButton>
        <ArtTooltip
          v-if="hasAuth('FinanceOpeningBalance:Confirm') && summary.status === 'draft'"
          :disabled="canConfirmOpeningBalance"
          :content="confirmOpeningBalanceHint"
          placement="bottom"
        >
          <span class="opening-balance-page__confirm-action">
            <ElButton
              type="success"
              plain
              :disabled="!canConfirmOpeningBalance"
              :loading="workspace.statusChanging"
              @click="confirmOpeningBalance"
            >
              <ArtSvgIcon icon="ri:lock-line" />
              确认并锁定
            </ElButton>
          </span>
        </ArtTooltip>
        <ElButton
          v-if="hasAuth('FinanceOpeningBalance:Reopen') && summary.status === 'confirmed'"
          plain
          :disabled="workspace.loading || Boolean(workspace.error)"
          :loading="workspace.statusChanging"
          @click="reopenOpeningBalance"
        >
          <ArtSvgIcon icon="ri:lock-unlock-line" />
          反确认
        </ElButton>
      </template>

      <div
        class="opening-balance-page__validation-strip"
        :class="
          !workspace.balances.length
            ? 'is-pending'
            : summary.isBalanced
              ? 'is-balanced'
              : 'is-unbalanced'
        "
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span class="opening-balance-page__validation-icon" aria-hidden="true">
          <ArtSvgIcon
            :icon="
              !workspace.balances.length
                ? 'ri:file-add-line'
                : summary.isBalanced
                  ? 'ri:checkbox-circle-line'
                  : 'ri:error-warning-line'
            "
          />
        </span>
        <div class="opening-balance-page__validation-copy">
          <div>
            <strong>{{ balanceValidationTitle }}</strong>
            <ElTag
              class="opening-balance-page__status-tag"
              :type="summary.status === 'confirmed' ? 'success' : 'warning'"
              size="small"
              effect="plain"
              round
            >
              {{ summary.status === 'confirmed' ? '已确认' : '草稿' }}
            </ElTag>
          </div>
          <span>{{ balanceValidationDescription }}</span>
        </div>
      </div>

      <ArtSearchBar
        v-model="balanceFilterForm"
        class="opening-balance-page__filter-search"
        :items="balanceSearchItems"
        :span="8"
        :gutter="12"
        label-position="left"
        label-width="76px"
        :show-expand="false"
        :button-left-limit="0"
        @search="applyBalanceFilters"
        @reset="resetBalanceFilters"
      />

      <ArtAsyncState
        class="accounting-workspace-content-state"
        :class="{
          'is-empty': !workspace.loading && !workspace.error && filteredBalances.length === 0
        }"
        :loading="workspace.loading"
        :empty-image-size="56"
        :min-height="120"
        :error="workspace.error"
        :empty="!workspace.loading && !workspace.error && filteredBalances.length === 0"
        empty-text="暂无期初余额"
        empty-description="按末级科目录入期初借贷余额；借贷合计平衡后方可确认。"
        @retry="scope.accountSetId ? loadFoundation() : loadAccountSets()"
      >
        <ArtTable
          :border="false"
          v-if="!isCompact && !workspace.loading && !workspace.error"
          :data="filteredBalances"
          :columns="columns"
          :pagination="false"
          table-layout="fixed"
          empty-text="暂无期初余额"
        />
        <div v-else-if="isCompact && !workspace.loading && !workspace.error" class="grid gap-3">
          <article
            v-for="row in filteredBalances"
            :key="row.id"
            class="rounded-lg border border-g-200 p-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <strong class="block break-words">{{ row.subject?.subjectName ?? '—' }}</strong>
                <span class="text-sm text-g-600">{{ row.subject?.subjectCode }}</span>
              </div>
              <BalanceActions :row="row" />
            </div>
            <ElTag
              class="mt-2"
              :type="row.subject?.balanceDirection === 'debit' ? 'success' : 'warning'"
            >
              {{ row.subject?.balanceDirection === 'debit' ? '借方' : '贷方' }}
            </ElTag>
            <dl v-if="canViewRowField(row, 'balanceAmounts')" class="mt-3 grid grid-cols-2 gap-3">
              <div
                ><dt class="text-sm text-g-600">期初借方</dt
                ><dd>{{ formatMoney(row.openingDebit) }}</dd></div
              >
              <div
                ><dt class="text-sm text-g-600">期初贷方</dt
                ><dd>{{ formatMoney(row.openingCredit) }}</dd></div
              >
            </dl>
            <p
              v-if="
                canViewRowField(row, 'auxiliaryDetails') &&
                Object.keys(row.auxiliaryValues ?? {}).length
              "
              class="mt-3 break-words text-sm"
            >
              辅助核算：{{ formatAuxiliaryValues(row.auxiliaryValues) }}
            </p>
            <p v-if="canViewRowField(row, 'auxiliaryDetails') && row.currency" class="mt-3 text-sm">
              {{ row.currency.currencyCode
              }}<template v-if="canViewRowField(row, 'balanceAmounts')">
                · 原币金额
                {{
                  formatSensitiveNumberWithAffix(row.originalCurrencyAmount, {
                    emptyText: '—',
                    numberFormat: {}
                  })
                }}</template
              >
            </p>
          </article>
        </div>
      </ArtAsyncState>
    </ArtSectionCard>

    <OpeningBalanceDialog ref="dialogRef" @success="loadBalances" />
    <MasterDataDeleteGuard ref="deleteGuardRef" />
  </FinanceAccountingWorkspaceShell>
</template>

<script setup lang="tsx">
  import { uniq } from 'lodash-es'
  import FinanceAccountingWorkspaceShell from '@fms/views/modules/finance-accounting-workspace-shell/index.vue'
  import { getFriendlySupabaseErrorMessage } from '@/utils/supabase'
  import { ElButton, ElTag } from 'element-plus'
  import { storeToRefs } from 'pinia'
  import { useMediaQuery } from '@vueuse/core'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import BusinessWorkspaceFocusToggle from '@/components/business/business-workspace-focus-toggle/index.vue'
  import { useWorkspaceFocus } from '@/hooks/core/useWorkspaceFocus'
  import AccountingSetupGuide from '../../modules/accounting-setup-guide.vue'
  import { useFinanceAccountSetPrerequisite } from '../../modules/use-finance-account-set-prerequisite'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtAsyncState from '@/components/core/feedback/art-async-state/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import ArtSearchBar, {
    type SearchFormItem
  } from '@/components/core/forms/art-search-bar/index.vue'
  import type { ColumnOption } from '@/types'
  import { formatCurrencyValue } from '@/utils/ui/format'
  import {
    canEditField,
    canViewField,
    getFieldAccess,
    formatSensitiveNumberWithAffix,
    isMaskedValue,
    mergeFieldAccessMaps
  } from '@/utils/field-permission'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import MasterDataDeleteGuard from '@/components/business/master-data-delete-guard/index.vue'
  import { useRecordDeleteGuard } from '@/hooks/core/useRecordDeleteGuard'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useUserStore } from '@/store/modules/user'
  import {
    deleteOpeningBalance,
    fetchAccountingPeriodList,
    fetchAccountSetOptions,
    fetchAuxiliaryItemList,
    fetchAuxiliaryTypeList,
    fetchCurrencyList,
    fetchOpeningBalanceList,
    fetchOpeningBalanceSummary,
    fetchSubjectList,
    setOpeningBalanceStatus
  } from '@fms/api'
  import OpeningBalanceDialog from './modules/opening-balance-dialog.vue'

  defineOptions({ name: 'FinanceOpeningBalance' })

  type OpeningBalance = Api.Fms.OpeningBalanceRecord
  type OpeningBalanceFieldKey = Api.Fms.OpeningBalanceFieldKey

  interface BalanceFilter extends Record<string, unknown> {
    keyword: string
    direction?: Api.Fms.BalanceDirection
  }

  const { confirmAction, promptReason } = useArtFeedback()
  const { deleteGuardRef, deleteRecord, deleteBusy } = useRecordDeleteGuard(
    'fms_opening_balance',
    '期初余额'
  )
  const { focusMode } = useWorkspaceFocus()
  const { ensureAccountSet, ensureLeafSubjects, goToAccountSet } =
    useFinanceAccountSetPrerequisite()
  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  const { hasAuth } = useAuth()
  const dialogRef = ref<{
    handleOpen: (
      accountSet: Api.Fms.AccountSetOption,
      fiscalYear: number,
      context: {
        subjects: Api.Fms.SubjectRecord[]
        currencies: Api.Fms.CurrencyRecord[]
        auxiliaryTypes: Api.Fms.AuxiliaryTypeRecord[]
        auxiliaryItems: Api.Fms.AuxiliaryItemRecord[]
      },
      row?: OpeningBalance
    ) => Promise<void>
  }>()
  const scope = reactive({
    accountSetId: '',
    fiscalYear: new Date().getFullYear(),
    fiscalYears: [] as number[],
    loading: true,
    options: [] as Api.Fms.AccountSetOption[]
  })
  const workspace = reactive({
    loading: false,
    error: '',
    statusChanging: false,
    balances: [] as OpeningBalance[],
    fieldAccess: {} as Api.Fms.OpeningBalanceFieldAccessMap,
    leafSubjects: [] as Api.Fms.SubjectRecord[],
    currencies: [] as Api.Fms.CurrencyRecord[],
    auxiliaryTypes: [] as Api.Fms.AuxiliaryTypeRecord[],
    auxiliaryItems: [] as Api.Fms.AuxiliaryItemRecord[]
  })
  const balanceFilterForm = ref<BalanceFilter>(createDefaultBalanceFilter())
  const appliedBalanceFilter = reactive<BalanceFilter>(createDefaultBalanceFilter())
  const summary = reactive<Api.Fms.OpeningBalanceSummary>({
    accountSetId: '',
    fiscalYear: scope.fiscalYear,
    status: 'draft',
    entryCount: 0,
    fieldAccess: {},
    isBalanced: true
  })

  const currentAccountSet = computed(() =>
    scope.options.find((item) => item.value === scope.accountSetId)
  )
  const baseCurrency = computed(() => workspace.currencies.find((item) => item.isBase))
  const effectiveFieldAccess = computed(() =>
    mergeFieldAccessMaps(workspace.fieldAccess, ...workspace.balances.map((row) => row.fieldAccess))
  )
  const canViewListField = (field: OpeningBalanceFieldKey): boolean =>
    canViewField(effectiveFieldAccess.value, field)
  const canViewRowField = (row: OpeningBalance, field: OpeningBalanceFieldKey): boolean =>
    canViewField(row.fieldAccess, field)
  const canEditRow = (row: OpeningBalance): boolean =>
    canEditField(row.fieldAccess, 'balanceAmounts') ||
    canEditField(row.fieldAccess, 'auxiliaryDetails')
  const summaryAmountAccess = computed(() => getFieldAccess(summary.fieldAccess, 'balanceAmounts'))
  const canConfirmOpeningBalance = computed(
    () =>
      !workspace.loading &&
      !workspace.error &&
      !workspace.statusChanging &&
      !deleteBusy.value &&
      summary.entryCount > 0 &&
      summary.isBalanced &&
      summary.status === 'draft'
  )
  const confirmOpeningBalanceHint = computed(() =>
    summary.entryCount === 0 ? '请先录入至少一条期初余额' : '借贷合计平衡后才能确认锁定'
  )
  const balanceValidationTitle = computed(() => {
    if (summary.status === 'confirmed') return '期初余额已确认锁定'
    if (!summary.entryCount) return '等待录入期初余额'
    return summary.isBalanced ? '借贷校验已通过' : '借贷差额待调整'
  })
  const balanceValidationDescription = computed(() => {
    if (summary.status === 'confirmed') return '需要修改时请先反确认，操作原因会写入审计记录。'
    if (!summary.entryCount) return '录入至少一条末级科目余额后，系统会自动计算借贷差额。'
    if (!summary.isBalanced && summaryAmountAccess.value === 'hidden')
      return '金额明细受字段权限保护；系统仍会在后端完成借贷平衡校验。'
    if (!summary.isBalanced)
      return `当前差额 ${formatMoney(summary.difference)}，调整至借贷平衡后可确认并锁定。`
    return '当前借贷合计平衡，可以执行确认并锁定。'
  })
  const directionOptions = computed(() => getDictMap.value.fmsBalanceDirection ?? [])
  const balanceSearchItems = computed<SearchFormItem[]>(() => [
    {
      label: '会计科目',
      key: 'keyword',
      type: 'input',
      props: { clearable: true, placeholder: '搜索科目编码或名称' }
    },
    {
      label: '余额方向',
      key: 'direction',
      type: 'select',
      props: { clearable: true, placeholder: '全部方向', options: directionOptions.value }
    }
  ])
  const filteredBalances = computed(() => {
    const keyword = appliedBalanceFilter.keyword.trim().toLowerCase()
    return workspace.balances.filter((item) => {
      const subject = item.subject
      const matchesKeyword =
        !keyword ||
        subject?.subjectCode.toLowerCase().includes(keyword) ||
        subject?.subjectName.toLowerCase().includes(keyword)
      return (
        Boolean(matchesKeyword) &&
        (!appliedBalanceFilter.direction ||
          subject?.balanceDirection === appliedBalanceFilter.direction)
      )
    })
  })
  const metrics = computed<BusinessWorkspaceMetric[]>(() => [
    {
      key: 'entries',
      label: '余额记录',
      value: summary.entryCount,
      description: `${scope.fiscalYear} 年期初`,
      icon: 'ri:file-list-3-line'
    },
    ...(summaryAmountAccess.value !== 'hidden'
      ? [
          {
            key: 'debit',
            label: '借方合计',
            value: formatMoney(summary.openingDebit),
            description: baseCurrency.value?.currencyCode ?? '本位币',
            icon: 'ri:arrow-left-down-line',
            tone: 'success' as const
          },
          {
            key: 'credit',
            label: '贷方合计',
            value: formatMoney(summary.openingCredit),
            description: baseCurrency.value?.currencyCode ?? '本位币',
            icon: 'ri:arrow-right-up-line',
            tone: 'warning' as const
          }
        ]
      : []),
    {
      key: 'status',
      label: '平衡状态',
      value: !summary.entryCount ? '待录入' : summary.isBalanced ? '已平衡' : '待调整',
      description: summary.status === 'confirmed' ? '已确认锁定' : '草稿可编辑',
      icon: !summary.entryCount
        ? 'ri:file-add-line'
        : summary.isBalanced
          ? 'ri:scales-3-line'
          : 'ri:error-warning-line',
      tone: !summary.entryCount ? 'info' : summary.isBalanced ? 'primary' : 'danger'
    }
  ])

  const isCompact = useMediaQuery('(max-width: 640px)')
  const BalanceActions = ({ row }: { row: OpeningBalance }) =>
    summary.status === 'draft' ? (
      <BusinessTableRowActions>
        {canEditRow(row) ? (
          <ArtButtonTable
            type="edit"
            permission="FinanceOpeningBalance:Edit"
            disabled={deleteBusy.value || workspace.statusChanging}
            onClick={() => openDialog(row)}
          />
        ) : null}
        <ArtButtonTable
          type="delete"
          permission="FinanceOpeningBalance:Delete"
          disabled={deleteBusy.value || workspace.statusChanging}
          onClick={() => removeBalance(row)}
        />
      </BusinessTableRowActions>
    ) : (
      <span class="opening-balance-page__locked">已锁定</span>
    )

  const columns = computed<ColumnOption<OpeningBalance>[]>(() => [
    {
      prop: 'subject',
      label: '会计科目',
      minWidth: 210,
      fixed: 'left',
      formatter: (row) => (
        <div class="opening-balance-page__subject">
          <strong title={row.subject?.subjectName ?? '—'}>{row.subject?.subjectName ?? '—'}</strong>
          <small title={row.subject?.subjectCode ?? '—'}>{row.subject?.subjectCode ?? '—'}</small>
        </div>
      )
    },
    {
      prop: 'balanceDirection',
      label: '方向',
      width: 76,
      dict: {
        code: 'fmsBalanceDirection',
        display: 'tag',
        value: (row) => row.subject?.balanceDirection
      }
    },
    ...(canViewListField('balanceAmounts')
      ? [
          {
            prop: 'openingDebit',
            label: '期初借方',
            minWidth: 126,
            align: 'right' as const,
            formatter: (row: OpeningBalance) =>
              canViewRowField(row, 'balanceAmounts') ? formatMoney(row.openingDebit) : '—'
          },
          {
            prop: 'openingCredit',
            label: '期初贷方',
            minWidth: 126,
            align: 'right' as const,
            formatter: (row: OpeningBalance) =>
              canViewRowField(row, 'balanceAmounts') ? formatMoney(row.openingCredit) : '—'
          }
        ]
      : []),
    ...(canViewListField('auxiliaryDetails')
      ? [
          {
            prop: 'auxiliaryValues',
            label: '辅助核算',
            minWidth: 180,
            showOverflowTooltip: true,
            formatter: (row: OpeningBalance) =>
              canViewRowField(row, 'auxiliaryDetails')
                ? formatAuxiliaryValues(row.auxiliaryValues)
                : '—'
          },
          {
            prop: 'currency',
            label: '外币',
            width: 72,
            formatter: (row: OpeningBalance) =>
              canViewRowField(row, 'auxiliaryDetails') ? (row.currency?.currencyCode ?? '—') : '—'
          }
        ]
      : []),
    ...(canViewListField('balanceAmounts') && canViewListField('auxiliaryDetails')
      ? [
          {
            prop: 'originalCurrencyAmount',
            label: '原币金额',
            minWidth: 126,
            align: 'right' as const,
            formatter: (row: OpeningBalance) =>
              canViewRowField(row, 'balanceAmounts') &&
              canViewRowField(row, 'auxiliaryDetails') &&
              row.currency
                ? formatSensitiveNumberWithAffix(row.originalCurrencyAmount, {
                    emptyText: '—',
                    numberFormat: {}
                  })
                : '—'
          }
        ]
      : []),
    ...(hasAuth('FinanceOpeningBalance:Edit') || hasAuth('FinanceOpeningBalance:Delete')
      ? [
          {
            prop: 'operation',
            label: '操作',
            width: 104,
            fixed: 'right' as const,
            formatter: (row: OpeningBalance) => <BalanceActions row={row} />
          } satisfies ColumnOption<OpeningBalance>
        ]
      : [])
  ])

  function createDefaultBalanceFilter(): BalanceFilter {
    return { keyword: '', direction: undefined }
  }

  function applyBalanceFilters(params: Record<string, unknown>): void {
    appliedBalanceFilter.keyword = typeof params.keyword === 'string' ? params.keyword : ''
    appliedBalanceFilter.direction =
      typeof params.direction === 'string'
        ? (params.direction as Api.Fms.BalanceDirection)
        : undefined
  }

  function resetBalanceFilters(): void {
    balanceFilterForm.value = createDefaultBalanceFilter()
    Object.assign(appliedBalanceFilter, createDefaultBalanceFilter())
  }

  function formatMoney(value: number | string | null | undefined): string {
    if (value === null || value === undefined) return '—'
    if (isMaskedValue(value)) return '***'
    const numericValue = Number(value)
    return Number.isFinite(numericValue)
      ? formatCurrencyValue(numericValue, baseCurrency.value?.currencyCode ?? 'CNY')
      : '—'
  }

  function formatAuxiliaryValues(values?: Record<string, string>): string {
    if (!values) return '—'
    const labels = Object.entries(values).map(([typeId, itemId]) => {
      const type = workspace.auxiliaryTypes.find((item) => item.id === typeId)
      if (isMaskedValue(itemId)) return `${type?.typeName ?? '维度'}：***`
      const item = workspace.auxiliaryItems.find((candidate) => candidate.id === itemId)
      return `${type?.typeName ?? '维度'}：${item?.itemName ?? itemId}`
    })
    return labels.join('；') || '—'
  }

  let balanceRequestId = 0
  let foundationRequestId = 0

  async function loadBalances(): Promise<void> {
    const requestId = ++balanceRequestId
    const accountSetId = scope.accountSetId
    const fiscalYear = scope.fiscalYear
    const isCurrent = () =>
      requestId === balanceRequestId &&
      accountSetId === scope.accountSetId &&
      fiscalYear === scope.fiscalYear
    if (!accountSetId || !fiscalYear) return
    workspace.loading = true
    workspace.error = ''
    try {
      const [balanceResult, summaryResult] = await Promise.all([
        fetchOpeningBalanceList(accountSetId, fiscalYear),
        fetchOpeningBalanceSummary(accountSetId, fiscalYear)
      ])
      if (!isCurrent()) return
      if (balanceResult.error) throw balanceResult.error
      if (summaryResult.error) throw summaryResult.error
      workspace.balances = balanceResult.data ?? []
      workspace.fieldAccess = balanceResult.fieldAccess ?? {}
      delete summary.openingDebit
      delete summary.openingCredit
      delete summary.difference
      if (summaryResult.data) Object.assign(summary, summaryResult.data)
    } catch (error) {
      if (!isCurrent()) return
      workspace.error = getFriendlySupabaseErrorMessage(error, '期初余额加载失败')
    } finally {
      if (isCurrent()) workspace.loading = false
    }
  }

  async function loadFoundation(): Promise<void> {
    const requestId = ++foundationRequestId
    ++balanceRequestId
    const accountSetId = scope.accountSetId
    const isCurrent = () => requestId === foundationRequestId && accountSetId === scope.accountSetId
    if (!accountSetId) return
    let balancesStarted = false
    workspace.loading = true
    workspace.error = ''
    try {
      const [periodResult, subjectResult, currencyResult, typeResult, itemResult] =
        await Promise.all([
          fetchAccountingPeriodList(accountSetId),
          fetchSubjectList(accountSetId),
          fetchCurrencyList(accountSetId),
          fetchAuxiliaryTypeList(accountSetId),
          fetchAuxiliaryItemList(accountSetId)
        ])
      if (!isCurrent()) return
      for (const result of [periodResult, subjectResult, currencyResult, typeResult, itemResult]) {
        if (result.error) throw result.error
      }
      const periods = periodResult.data ?? []
      scope.fiscalYears = uniq(periods.map((item) => item.fiscalYear)).sort(
        (left, right) => right - left
      )
      if (!scope.fiscalYears.length) scope.fiscalYears = [new Date().getFullYear()]
      if (!scope.fiscalYears.includes(scope.fiscalYear)) scope.fiscalYear = scope.fiscalYears[0]

      const subjects = subjectResult.data ?? []
      const parentIds = new Set(subjects.map((item) => item.parentId).filter(Boolean))
      workspace.leafSubjects = subjects.filter((item) => item.isEnabled && !parentIds.has(item.id))
      workspace.currencies = currencyResult.data ?? []
      workspace.auxiliaryTypes = typeResult.data ?? []
      workspace.auxiliaryItems = itemResult.data ?? []
      balancesStarted = true
      await loadBalances()
    } catch (error) {
      if (!isCurrent()) return
      workspace.error = getFriendlySupabaseErrorMessage(error, '期初基础数据加载失败')
    } finally {
      if (isCurrent() && !balancesStarted) workspace.loading = false
    }
  }

  function handleAccountSetChange(): void {
    workspace.balances = []
    workspace.fieldAccess = {}
    resetBalanceFilters()
    void loadFoundation()
  }

  async function openDialog(row?: OpeningBalance): Promise<void> {
    if (deleteBusy.value || workspace.statusChanging) return
    if (workspace.loading || workspace.error) return
    if (summary.status !== 'draft') return
    if (row && !canEditRow(row)) return
    if (
      !(await ensureAccountSet({
        actionLabel: row ? '编辑期初余额' : '录入期初余额',
        available: Boolean(currentAccountSet.value)
      }))
    )
      return
    if (!(await ensureLeafSubjects(workspace.leafSubjects.length > 0, '录入期初余额'))) return
    await dialogRef.value?.handleOpen(
      currentAccountSet.value!,
      scope.fiscalYear,
      {
        subjects: workspace.leafSubjects,
        currencies: workspace.currencies,
        auxiliaryTypes: workspace.auxiliaryTypes,
        auxiliaryItems: workspace.auxiliaryItems
      },
      row
    )
  }

  async function removeBalance(row: OpeningBalance): Promise<void> {
    if (workspace.statusChanging || summary.status !== 'draft') return
    const label =
      [row.subject?.subjectCode, row.subject?.subjectName].filter(Boolean).join(' ') || '期初余额'
    await deleteRecord({
      resource: { id: row.id, label },
      permission: 'FinanceOpeningBalance:Delete',
      confirmMessage: `确定删除“${label}”的期初余额吗？`,
      remove: () => {
        if (workspace.statusChanging || summary.status !== 'draft')
          throw new Error('期初余额状态已变化，请刷新页面后重试')
        return deleteOpeningBalance(row.id)
      },
      onDeleted: loadBalances,
      failureMessage: '期初余额删除失败，请刷新余额状态后重试'
    })
  }

  async function confirmOpeningBalance(): Promise<void> {
    if (!canConfirmOpeningBalance.value) return
    const accountSetId = scope.accountSetId
    const fiscalYear = scope.fiscalYear
    workspace.statusChanging = true
    try {
      await confirmAction(
        `确认 ${fiscalYear} 年期初余额后将锁定全部记录，确定继续吗？`,
        '确认期初余额',
        { type: 'success', confirmButtonText: '确认并锁定' }
      )
      await setOpeningBalanceStatus(accountSetId, fiscalYear, 'confirmed')
      await loadBalances()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '期初余额确认失败，请刷新状态后重试')
      }
    } finally {
      workspace.statusChanging = false
    }
  }

  async function reopenOpeningBalance(): Promise<void> {
    if (deleteBusy.value || workspace.statusChanging || workspace.loading || workspace.error) return
    const accountSetId = scope.accountSetId
    const fiscalYear = scope.fiscalYear
    workspace.statusChanging = true
    try {
      const reason = await promptReason(
        '反确认后可重新调整期初余额，操作原因将写入审计记录。',
        '反确认期初余额',
        {
          confirmButtonText: '确认反确认',
          emptyMessage: '请填写反确认原因',
          placeholder: '请说明差错原因和调整安排'
        }
      )
      await setOpeningBalanceStatus(accountSetId, fiscalYear, 'draft', reason)
      await loadBalances()
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        notifyFriendlyError(error, '期初余额反确认失败，请刷新状态后重试')
      }
    } finally {
      workspace.statusChanging = false
    }
  }

  async function loadAccountSets(): Promise<void> {
    scope.loading = true
    workspace.loading = true
    workspace.error = ''
    try {
      const result = await fetchAccountSetOptions({ from: 0, to: 999 })
      if (result.error) throw result.error
      scope.options = result.data ?? []
      if (!scope.accountSetId && scope.options.length) {
        scope.accountSetId = scope.options[0].value
        await loadFoundation()
      }
    } catch (error) {
      workspace.error = getFriendlySupabaseErrorMessage(error, '账套加载失败，请重试')
    } finally {
      scope.loading = false
      workspace.loading = false
    }
  }

  onMounted(() => {
    void userStore.ensureDictLoaded('fmsBalanceDirection').catch(() => undefined)
    void loadAccountSets()
  })

  onActivated(() => {
    if (scope.accountSetId && !scope.loading) void loadFoundation()
  })
</script>

<style scoped lang="scss">
  .opening-balance-page {
    &.is-focus-mode {
      gap: 0;
    }

    &__scope,
    &__validation-strip,
    &__validation-copy > div {
      display: flex;
      align-items: center;
    }

    &__scope {
      display: grid;
      grid-template-columns: minmax(320px, 520px) 220px;
      gap: 16px;
      align-items: center;
      margin-top: var(--art-space-4);

      label {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        min-width: 0;

        > span {
          flex: none;
          font-size: 12px;
          font-weight: 600;
          line-height: 18px;
          color: var(--el-text-color-regular);
        }
      }

      :deep(.el-select) {
        width: 100%;
      }

      label:last-child :deep(.el-select) {
        width: 100%;
      }
    }

    &__scope-section {
      :deep(.art-section-card__header) {
        align-items: center;
      }
    }

    &__detail {
      :deep(.art-section-card__header) {
        flex: none;
        align-items: center;
        margin-bottom: 10px;
      }
    }

    &__scope-section.art-section-card.art-card-xs {
      flex: none;
    }

    &__detail.art-section-card.art-card-xs {
      flex: 1 0 auto;
      min-height: min-content;
      overflow: hidden;

      :deep(.art-section-card__body) {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: min-content;
        overflow: hidden;
      }

      :deep(.accounting-workspace-content-state),
      :deep(.accounting-workspace-content-state.is-empty > .art-async-state__empty) {
        min-height: 120px !important;
      }

      :deep(.accounting-workspace-content-state .art-empty-state) {
        padding-block: 6px;
      }
    }

    &__filter-search {
      flex: none;
      margin-bottom: var(--art-space-2);
    }

    :deep(.opening-balance-page__filter-search.art-form.art-search-bar) {
      padding: var(--art-space-3) var(--art-space-3) 0;

      .el-form-item {
        margin-bottom: var(--art-space-3);
      }
    }

    &__confirm-action {
      display: inline-flex;
    }

    &__status-tag {
      height: 22px;
      padding-inline: 7px;
      font-size: 11px;
      font-weight: 600;
    }

    &__validation-strip {
      flex: none;
      gap: 10px;
      min-height: 48px;
      padding: 8px 12px;
      margin-bottom: var(--art-space-3);
      border-radius: var(--el-border-radius-base);

      &.is-pending {
        background: var(--art-gray-100);
        border: 1px solid var(--el-border-color-lighter);
      }

      &.is-balanced {
        background: color-mix(in srgb, var(--el-color-success) 7%, var(--default-box-color));
        border: 1px solid color-mix(in srgb, var(--el-color-success) 18%, var(--el-border-color));
      }

      &.is-unbalanced {
        background: color-mix(in srgb, var(--el-color-warning) 7%, var(--default-box-color));
        border: 1px solid color-mix(in srgb, var(--el-color-warning) 20%, var(--el-border-color));
      }
    }

    &__validation-icon {
      display: grid;
      flex: none;
      place-items: center;
      width: 32px;
      height: 32px;
      font-size: 18px;
      color: var(--el-color-success-dark-2);
      background: color-mix(in srgb, var(--el-color-success) 13%, transparent);
      border-radius: var(--el-border-radius-base);
    }

    &__validation-strip.is-unbalanced &__validation-icon {
      color: var(--el-color-warning-dark-2);
      background: color-mix(in srgb, var(--el-color-warning) 14%, transparent);
    }

    &__validation-strip.is-pending &__validation-icon {
      color: var(--el-text-color-secondary);
      background: var(--art-gray-200);
    }

    &__validation-copy {
      min-width: 0;

      > div {
        gap: 8px;
      }

      strong {
        font-size: 13px;
        color: var(--el-text-color-primary);
      }

      > span {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        line-height: 18px;
        color: var(--el-text-color-secondary);
      }
    }

    &__locked {
      color: var(--el-text-color-secondary);
    }
  }

  :deep(.opening-balance-page__subject) {
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
      color: var(--el-text-color-secondary);
    }
  }

  @media only screen and (width <= 720px) {
    .opening-balance-page {
      &__scope {
        grid-template-columns: 1fr;
      }

      &__scope label {
        grid-template-columns: 72px minmax(0, 1fr);
      }

      &__scope :deep(.el-select),
      &__scope label:last-child :deep(.el-select) {
        width: 100%;
      }

      &__validation-strip {
        align-items: flex-start;
      }
    }
  }
</style>
