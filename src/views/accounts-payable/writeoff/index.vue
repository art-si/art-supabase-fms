<template>
  <ArtPermissionGuard permission="FinancePayableWriteoff:View" resource-name="应付核销工作台">
    <div class="payable-writeoff-page business-workspace-page min-w-0">
      <BusinessWorkspaceHeader
        title="应付核销工作台"
        description="核对已审核应付与应收、已确认付款及实际到账退款，按方案核销，保留核销记录与需记账核销单。"
        icon="ri:checkbox-circle-line"
        density="compact"
        :metrics="metrics"
        refreshable
        refresh-label="刷新"
        :refresh-loading="loading"
        :refresh-disabled="busy"
        @refresh="load"
      >
        <template #actions>
          <ElButton v-auth="'FinancePayableWriteoff:View'" @click="automationManager?.handleOpen()"
            ><ArtSvgIcon icon="ri:time-line" />后台核销</ElButton
          >
          <ElButton v-auth="'FinancePayableWriteoff:Scheme'" @click="schemeDialog?.handleOpen()"
            ><ArtSvgIcon icon="ri:settings-3-line" />核销方案</ElButton
          >
        </template>
      </BusinessWorkspaceHeader>
      <div class="payable-writeoff-page__query art-card-xs">
        <ArtForm
          v-model="filter"
          root-class="p-0! md:p-0!"
          :items="filterItems"
          :span="6"
          label-position="right"
          :label-width="70"
          :show-submit="false"
          :show-reset="false"
        />
        <div class="flex flex-wrap items-center gap-3">
          <ElButton type="primary" :disabled="loading || busy" @click="load()"
            ><ArtSvgIcon icon="ri:search-line" />查询</ElButton
          >
          <ElSwitch v-model="onlyAvailable" aria-label="仅显示可核销数据" /><span
            class="text-sm text-g-600"
            title="只显示主方、辅方都有可核销单据的往来单位"
            >仅显示可核销数据</span
          >
          <label
            v-if="
              isRedBlueRelation ||
              (isReceivableRelation && hasAuth('FinanceReceiptWriteoff:CrossCustomer'))
            "
            class="art-icon-label text-sm text-g-600"
            title="仍须符合所选方案；不按客户、供应商的名称自动认定同一往来单位"
            ><ElSwitch
              v-model="allowCrossParty"
              aria-label="允许跨往来单位核销"
            />允许跨往来单位</label
          >
          <span class="ml-auto text-xs text-g-600"
            >{{ isRedBlueRelation ? '金额按原币分别显示' : '人民币' }} · 每侧最多 200 条 ·
            不发起银行转账</span
          >
        </div>
      </div>
      <ElAlert
        v-if="loaded && loadError"
        :title="loadError"
        type="error"
        :closable="false"
        show-icon
      >
        <template #default
          >当前保留上次查询结果，核销操作已停用。<ElButton
            link
            type="primary"
            :disabled="loading"
            @click="load()"
            >重新加载</ElButton
          ></template
        >
      </ElAlert>
      <div class="payable-writeoff-page__workspace">
        <ArtSectionCard
          title="往来单位"
          :subtitle="
            loadError ? '暂不可读取往来单位' : `${partyNodes[0].children.length} 家往来单位`
          "
          :loading="loading && !loaded && !loadError"
          @retry="load"
        >
          <ElInput
            v-model="partyKeyword"
            placeholder="搜索往来单位"
            clearable
            :disabled="!!loadError"
            aria-label="搜索往来单位"
            ><template #prefix><ArtSvgIcon icon="ri:search-line" /></template
          ></ElInput>
          <ElScrollbar class="mt-3" max-height="570px"
            ><ElTree
              :data="partyNodes"
              node-key="id"
              :props="{ label: 'label' }"
              highlight-current
              default-expand-all
              :current-node-key="selectedParty"
              :expand-on-click-node="false"
              @node-click="(node) => (selectedParty = node.id)"
              ><template #default="{ data }"
                ><span class="art-icon-label min-w-0"
                  ><ArtSvgIcon
                    :icon="
                      data.id === 'all' || isReceivableRelation
                        ? 'ri:building-line'
                        : 'ri:truck-line'
                    "
                  /><span class="truncate" :title="data.label">{{ data.label }}</span></span
                ></template
              ></ElTree
            ></ElScrollbar
          >
        </ArtSectionCard>
        <ArtSectionCard
          :title="relationTitle"
          :subtitle="
            isRedBlueRelation
              ? '红字按正数余量核销；同币按账套分别等额，异币请逐对明确双方原币金额。'
              : '选择双方明细并填写本次金额；主辅方合计必须相等。'
          "
          :loading="loading && !loaded && !loadError"
          :error="loaded ? '' : loadError"
          @retry="load"
        >
          <template #actions>
            <ElSegmented
              v-model="filter.relation"
              :options="relationOptions"
              aria-label="核销关系"
              :disabled="loading || busy"
            />
          </template>
          <ElTabs v-model="activeTab">
            <ElTabPane label="待核销单据" name="candidates">
              <div class="mb-4 flex flex-wrap items-center gap-3">
                <ElButton
                  v-auth="'FinancePayableWriteoff:Writeoff'"
                  type="primary"
                  :loading="busy"
                  :disabled="
                    loading ||
                    !!loadError ||
                    !primarySelection.length ||
                    !secondarySelection.length ||
                    (isReceivableRelation && !hasAuth('FinanceReceiptWriteoff:Writeoff'))
                  "
                  @click="execute"
                  ><ArtSvgIcon icon="ri:checkbox-circle-line" />核销</ElButton
                >
                <ElButton
                  v-auth="'FinancePayableWriteoff:AutoWriteoff'"
                  :disabled="
                    busy ||
                    loading ||
                    !!loadError ||
                    (isReceivableRelation && !hasAuth('FinanceReceiptWriteoff:Writeoff'))
                  "
                  @click="openAutomatic"
                  ><ArtSvgIcon icon="ri:magic-line" />按方案自动核销</ElButton
                >
                <span class="text-sm text-g-600"
                  >主方 {{ primarySelectedSummary }} · 辅方 {{ secondarySelectedSummary }}</span
                >
              </div>
              <ArtSectionCard
                class="payable-writeoff-page__document-section"
                :aria-label="primaryTitle"
                :title="`${primaryTitle}（${primaryRows.length}）`"
                :empty="!primaryRows.length"
                :empty-title="isRefundRelation ? '暂无可核销付款' : '暂无待核销应付'"
                :empty-description="
                  isRefundRelation
                    ? '请选择其他往来单位，或先确认实际付款。'
                    : '请选择其他往来单位，或先审核财务应付单。'
                "
                :show-scrollbar="false"
                :min-height="120"
                :empty-visual-size="56"
              >
                <ArtTable
                  ref="primaryTable"
                  :data="primaryRows"
                  :columns="candidateColumns"
                  row-key="id"
                  :pagination="false"
                  :max-height="230"
                  @selection-change="(rows: PayableWriteoffCandidate[]) => (primarySelection = rows)"
                />
              </ArtSectionCard>
              <ArtSectionCard
                class="payable-writeoff-page__document-section mt-4"
                :aria-label="secondaryTitle"
                :title="`${secondaryTitle}（${secondaryRows.length}）`"
                :empty="!secondaryRows.length"
                :empty-title="
                  isRedBlueRelation
                    ? '暂无可核销红字'
                    : isReceivableRelation
                      ? '暂无可抵销应收'
                      : isRefundRelation
                        ? '暂无可核销退款'
                        : '暂无可核销付款'
                "
                :empty-description="
                  isRedBlueRelation
                    ? '请先审核手工红字财务应付；来源须在同一账套内且未冻结。'
                    : isReceivableRelation
                      ? '请核对正向财务应收的审核状态、组织期初、账套及主数据统一往来单位。'
                      : isRefundRelation
                        ? '先登记退款实际到账；未兑现折扣不作为可核销现金。'
                        : '先确认付款，或关闭“仅显示可核销数据”查看其他往来单位。'
                "
                :show-scrollbar="false"
                :min-height="120"
                :empty-visual-size="56"
              >
                <ArtTable
                  ref="secondaryTable"
                  :data="secondaryRows"
                  :columns="candidateColumns"
                  row-key="id"
                  :pagination="false"
                  :max-height="230"
                  @selection-change="(rows: PayableWriteoffCandidate[]) => (secondarySelection = rows)"
                />
              </ArtSectionCard>
            </ElTabPane>
            <ElTabPane :label="`核销记录（${historyRows.length}）`" name="history"
              ><ArtTable
                :data="historyRows"
                :columns="historyColumns"
                :pagination="false"
                :max-height="560"
                row-key="id"
            /></ElTabPane>
            <ElTabPane :label="`核销单（${voucherRows.length}）`" name="documents"
              ><ArtTable
                :data="voucherRows"
                :columns="historyColumns"
                :pagination="false"
                :max-height="560"
                row-key="id"
                empty-text="暂无需要记账的核销单"
                empty-description="应收应付抵销、跨往来单位及预付款等需要调整会计科目的核销生成核销单。"
            /></ElTabPane>
          </ElTabs>
        </ArtSectionCard>
      </div>
      <ArtDialog ref="schemeDialog" title="应付核销方案" size="xl" :show-footer="false">
        <div class="mb-4"
          ><ElButton
            v-auth="'FinancePayableWriteoff:Scheme'"
            type="primary"
            @click="schemeEditor?.open()"
            ><ArtSvgIcon icon="ri:add-line" />新增方案</ElButton
          ></div
        >
        <ArtTable :data="workspace.schemes" :columns="schemeColumns" :pagination="false" />
      </ArtDialog>
      <ReferenceEditor ref="schemeEditor" kind="scheme" @success="load" />
      <AutomationDialog ref="automationManager" />
      <PayableAutomaticWriteoff ref="automaticDialog" @success="load" @refresh="load" />
      <ArtDialog ref="recordDialog" title="应付核销单" size="lg" :show-footer="false"
        ><ArtDescriptions
          v-if="currentRecord"
          :data="currentRecord"
          :items="recordItems"
          :columns="2"
          :label-width="144"
        />
        <ArtSectionCard
          v-if="currentRecord?.matchSnapshot?.rules?.length"
          class="mt-4"
          title="匹配依据"
          :subtitle="`${currentRecord.matchSnapshot.schemeName} · ${currentRecord.matchSnapshot.schemeCode}；保存核销当时的条件，不随方案修改。`"
        >
          <ArtTable
            :data="currentRecord.matchSnapshot.rules"
            :columns="matchingColumns"
            :pagination="false"
            :max-height="230"
          />
        </ArtSectionCard>
      </ArtDialog>
      <FinanceVoucherPreview ref="previewRef" :result="voucherResult" />
    </div>
  </ArtPermissionGuard>
</template>
<script setup lang="tsx">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import dayjs from 'dayjs'
  import { ElInputNumber, ElMessage, ElButton } from 'element-plus'
  import { uniq, uniqBy } from 'lodash-es'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { formatTenantLabel } from '@/utils/tenant-display'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTable from '@/components/core/tables/art-table/index.vue'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import AutomationDialog from './modules/automation-dialog.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import FinanceVoucherPreview from '@/components/business/finance-voucher-preview/index.vue'
  import ReferenceEditor from '@/components/business/payable-reference-workspace/modules/reference-editor.vue'
  import PayableAutomaticWriteoff from '@/components/business/payable-automatic-writeoff/index.vue'
  import {
    fetchPayableWriteoffWorkspace,
    executePayableWriteoff,
    reversePayableWriteoff,
    payableSettlementVoucher,
    type PayableWriteoffCandidate,
    type PayableWriteoffRecord,
    type PayableWriteoffWorkspace,
    type PayableWriteoffRelation,
    type PayableManualWriteoffItem,
    type PayableVoucherResult
  } from '@/api/payable-writeoff'
  import type { PayableReference, PayableMatchRule } from '@/api/payable-reference'
  import { payableMatchFields, payableMatchOperators } from '@/utils/finance/payable-match'
  import {
    allocateWriteoffAmounts,
    preferredPayableWriteoffScheme,
    allocatePayableRedBlueAmounts,
    formatPayableCurrencyTotals,
    formatPayableExchangeDifference
  } from '@/utils/finance/payable-writeoff'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { formatCurrencyValue } from '@/utils/ui/format'
  import { notifyFriendlyError, useArtFeedback } from '@/hooks/core/useArtFeedback'
  import { getFriendlySupabaseErrorMessage, isSupabaseAccessFailure } from '@/utils/supabase'
  import { useAuth } from '@/hooks/core/useAuth'
  import { financePaths } from '@/router/business-paths'
  import type { ColumnOption } from '@/types'

  defineOptions({ name: 'FinancePayableWriteoff' })
  const filter = ref<{
    keyword: string
    organizationId: string
    schemeId: string
    writeoffDate: string
    relation: PayableWriteoffRelation
  }>({
    keyword: '',
    organizationId: '',
    schemeId: '',
    writeoffDate: dayjs().format('YYYY-MM-DD'),
    relation: 'payable_payment'
  })
  const dictionaryRelations = useDictionaryOptions<PayableWriteoffRelation>(
    'fmsPayableWriteoffRelation'
  )
  const relationOptions = computed(() =>
    workspace.value.relations?.length ? workspace.value.relations : dictionaryRelations
  )
  const isRefundRelation = computed(() => filter.value.relation === 'payment_refund')
  const isReceivableRelation = computed(() => filter.value.relation === 'payable_receivable')
  const isRedBlueRelation = computed(() => filter.value.relation === 'payable_red_blue')
  const allowCrossParty = ref(false)
  const relationTitle = computed(
    () =>
      relationOptions.value.find((option) => option.value === filter.value.relation)?.label ||
      (isRefundRelation.value ? '付款冲退款' : '应付付款核销')
  )
  const primaryTitle = computed(() =>
    isRedBlueRelation.value ? '蓝字财务应付单' : isRefundRelation.value ? '付款单' : '财务应付单'
  )
  const secondaryTitle = computed(() =>
    isRedBlueRelation.value
      ? '红字财务应付单'
      : isReceivableRelation.value
        ? '财务应收单'
        : isRefundRelation.value
          ? '付款退款单'
          : '付款单'
  )
  const tenantScope = useTenantScopeStore()
  const onlyAvailable = ref(false)
  const partyKeyword = ref('')
  const selectedParty = ref('all')
  const activeTab = ref('candidates')
  const loading = ref(false)
  const loaded = ref(false)
  const loadError = ref('')
  const busy = ref(false)
  const automaticDialog = ref<InstanceType<typeof PayableAutomaticWriteoff>>()
  let version = 0
  const workspace = ref<PayableWriteoffWorkspace>({
    primary: [],
    secondary: [],
    history: [],
    schemes: []
  })
  const primarySelection = ref<PayableWriteoffCandidate[]>([])
  const secondarySelection = ref<PayableWriteoffCandidate[]>([])
  const primaryTable = ref<InstanceType<typeof ArtTable>>()
  const secondaryTable = ref<InstanceType<typeof ArtTable>>()
  const schemeDialog = ref<ArtDialogExpose>()
  const automationManager = ref<InstanceType<typeof AutomationDialog>>()
  const schemeEditor = ref<InstanceType<typeof ReferenceEditor>>()
  const recordDialog = ref<ArtDialogExpose>()
  const currentRecord = ref<PayableWriteoffRecord>()
  const previewRef = ref<InstanceType<typeof FinanceVoucherPreview>>()
  const voucherResult = ref<PayableVoucherResult>()
  const { confirm, promptReason } = useArtFeedback()
  const { hasAuth } = useAuth()
  const router = useRouter()
  const partyKey = (row: { tenantId: string; supplierId: string; counterpartyKey?: string }) =>
    `${row.tenantId}:${row.counterpartyKey || row.supplierId}`
  const availableParties = computed(() => {
    const both = workspace.value.primary.filter((main) =>
      workspace.value.secondary.some((side) => partyKey(side) === partyKey(main))
    )
    return onlyAvailable.value
      ? both
      : [...workspace.value.primary, ...workspace.value.secondary, ...workspace.value.history]
  })
  const partyNodes = computed(() => [
    {
      id: 'all',
      label: '全部往来单位',
      children: uniqBy(availableParties.value, partyKey)
        .filter((row) => !partyKeyword.value || row.supplierName.includes(partyKeyword.value))
        .map((row) => ({ id: partyKey(row), label: row.supplierName }))
    }
  ])
  const partyMatches = (row: { tenantId: string; supplierId: string; counterpartyKey?: string }) =>
    selectedParty.value === 'all' || partyKey(row) === selectedParty.value
  const primaryRows = computed(() =>
    workspace.value.primary.filter(
      (row) =>
        partyMatches(row) &&
        (!onlyAvailable.value ||
          availableParties.value.some((party) => partyKey(party) === partyKey(row)))
    )
  )
  const secondaryRows = computed(() =>
    workspace.value.secondary.filter(
      (row) =>
        ((allowCrossParty.value && (isRedBlueRelation.value || isReceivableRelation.value)) ||
          partyMatches(row)) &&
        (!onlyAvailable.value ||
          availableParties.value.some((party) => partyKey(party) === partyKey(row)))
    )
  )
  const historyRows = computed(() =>
    workspace.value.history.filter((row) => selectedParty.value === 'all' || partyMatches(row))
  )
  const voucherRows = computed(() =>
    historyRows.value.filter((row) => row.needsVoucher && row.status === 'active' && row.documentNo)
  )
  const total = (rows: PayableWriteoffCandidate[]) =>
    rows.reduce((sum, row) => sum + Number(row.writeoffAmount ?? row.availableAmount), 0)
  const primaryTotal = computed(() => total(primarySelection.value))
  const primarySelectedSummary = computed(() =>
    formatPayableCurrencyTotals(
      primarySelection.value,
      (row) => row.writeoffAmount ?? row.availableAmount
    )
  )
  const secondarySelectedSummary = computed(() =>
    formatPayableCurrencyTotals(
      secondarySelection.value,
      (row) => row.writeoffAmount ?? row.availableAmount
    )
  )
  const metrics = computed(() => [
    {
      key: 'payable',
      icon: 'ri:bill-line',
      description: isRedBlueRelation.value
        ? '扣除付款申请、付款预占后的蓝字余量，按原币显示'
        : isReceivableRelation.value
          ? '当前查询范围内未被付款申请、付款占用的应付余额'
          : isRefundRelation.value
            ? '当前查询范围内允许核销的已确认付款现金本金'
            : '当前查询范围内的应付未核销余额',
      label: isRedBlueRelation.value
        ? '当前可核销蓝字'
        : isReceivableRelation.value
          ? '当前可抵销应付'
          : isRefundRelation.value
            ? '当前可核销付款'
            : '当前待核销应付',
      value: loaded.value
        ? formatPayableCurrencyTotals(workspace.value.primary, (row) => row.availableAmount)
        : '—'
    },
    {
      key: 'payment',
      icon: isReceivableRelation.value ? 'ri:bill-line' : 'ri:secure-payment-line',
      description: isRedBlueRelation.value
        ? '红字未核销绝对余量；冻结或无有效账套的来源不参与'
        : isReceivableRelation.value
          ? '当前查询范围内未被收款或其他业务占用的应收余额'
          : isRefundRelation.value
            ? '当前查询范围内已实际到账且未核销的退款现金本金'
            : '当前查询范围内的已确认付款余额',
      label: isRedBlueRelation.value
        ? '当前可核销红字'
        : isReceivableRelation.value
          ? '当前可抵销应收'
          : isRefundRelation.value
            ? '当前可核销退款'
            : '当前可核销付款',
      value: loaded.value
        ? formatPayableCurrencyTotals(workspace.value.secondary, (row) => row.availableAmount)
        : '—'
    },
    {
      key: 'written',
      icon: 'ri:checkbox-circle-line',
      description: '当前查询的有效核销记录合计',
      label: '查询内已核销',
      value: loaded.value
        ? formatPayableCurrencyTotals(
            workspace.value.history.filter((row) => row.status === 'active'),
            (row) => row.amount
          )
        : '—'
    }
  ])
  const filterItems = computed<FormItem[]>(() => [
    {
      key: 'organizationId',
      label: '结算组织',
      type: 'treeSelect',
      props: {
        clearable: true,
        filterable: true,
        checkStrictly: true,
        nodeKey: 'id',
        props: { label: 'name', children: 'children' },
        data: workspace.value.organizations || []
      }
    },
    {
      key: 'keyword',
      label: '查询条件',
      type: 'input',
      props: { placeholder: '往来单位或单据编号', clearable: true }
    },
    {
      key: 'schemeId',
      label: '核销方案',
      type: 'select',
      props: {
        options: workspace.value.schemes
          .filter((row) => row.enabled)
          .map((row) => ({
            value: row.id,
            label: tenantScope.isAllTenants ? `${row.name} · ${formatTenantLabel(row)}` : row.name
          }))
      }
    },
    { key: 'writeoffDate', label: '核销日期', type: 'date', props: { valueFormat: 'YYYY-MM-DD' } }
  ])
  const candidateColumns = computed<ColumnOption<PayableWriteoffCandidate>[]>(() => [
    {
      type: 'selection',
      width: 44,
      selectable: () => !loading.value && !busy.value && !loadError.value
    },
    { prop: 'documentNo', label: '单据编号', minWidth: 190 },
    ...(isReceivableRelation.value ? [{ prop: 'lineNo', label: '行号', width: 85 }] : []),
    { prop: 'supplierName', label: '往来单位', minWidth: 200 },
    { prop: 'businessDate', label: '业务日期', width: 125 },
    { prop: 'documentTypeName', label: '单据类型', minWidth: 150 },
    { prop: 'purposeName', label: '业务用途', minWidth: 130 },
    { prop: 'currencyCode', label: '币种', width: 95 },
    ...(isRedBlueRelation.value
      ? [
          { prop: 'accountSetName', label: '核算账套', minWidth: 170 },
          { prop: 'exchangeRate', label: '原单记账汇率', width: 145 }
        ]
      : []),
    { prop: 'projectName', label: '项目名称', minWidth: 170 },
    { prop: 'sourceDocumentNo', label: '源单据号', minWidth: 190 },
    {
      prop: 'amount',
      label: isRedBlueRelation.value ? '单据金额(原币)' : '单据金额(元)',
      width: 150,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.amount, row.currencyCode || 'CNY')
    },
    {
      prop: 'availableAmount',
      label: isRedBlueRelation.value ? '允许核销金额(原币)' : '允许核销金额(元)',
      width: 170,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.availableAmount, row.currencyCode || 'CNY')
    },
    {
      prop: 'writeoffAmount',
      label: isRedBlueRelation.value ? '本次核销金额(原币)' : '本次核销金额(元)',
      width: 170,
      fixed: 'right',
      formatter: (row) => (
        <ElInputNumber
          v-model={row.writeoffAmount}
          min={0}
          max={row.availableAmount}
          precision={2}
          controls={false}
          disabled={loading.value || busy.value || !!loadError.value}
          aria-label="本次核销金额"
          class="w-full!"
        />
      )
    }
  ])
  const historyColumns = computed<ColumnOption<PayableWriteoffRecord>[]>(() => [
    {
      prop: 'recordNo',
      label: '核销记录号',
      minWidth: 245,
      formatter: (row) => (
        <BusinessTableIdentityCell primary={row.recordNo} secondary={row.supplierName} />
      )
    },
    {
      prop: 'amount',
      label: isRedBlueRelation.value ? '主方核销金额(原币)' : '核销金额(元)',
      width: 150,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.amount, row.currencyCode || 'CNY')
    },
    {
      prop: 'status',
      label: '状态',
      width: 100,
      formatter: (row) => (row.status === 'active' ? '已核销' : '已反核销')
    },
    { prop: 'writeoffDate', label: '核销日期', width: 130 },
    { prop: 'supplierName', label: '往来单位', minWidth: 170 },
    ...(isReceivableRelation.value || isRedBlueRelation.value
      ? [{ prop: 'counterpartyName', label: '辅方往来单位', minWidth: 180 }]
      : []),
    { prop: 'payableNo', label: primaryTitle.value, minWidth: 210 },
    { prop: 'paymentNo', label: secondaryTitle.value, minWidth: 210 },
    {
      prop: 'documentNo',
      label: '核销单',
      minWidth: 240,
      formatter: (row) =>
        row.documentNo ? (
          <ElButton link type="primary" onClick={() => showRecord(row)}>
            {row.documentNo}
          </ElButton>
        ) : row.status === 'reversed' ? (
          '已撤销'
        ) : (
          '无需记账'
        )
    },
    {
      prop: isRedBlueRelation.value
        ? 'creditAmount'
        : isReceivableRelation.value
          ? 'receivableAmount'
          : 'paymentAmount',
      label: isRedBlueRelation.value
        ? '辅方核销金额(原币)'
        : isReceivableRelation.value
          ? '应收抵销金额(元)'
          : isRefundRelation.value
            ? '核销现金本金(元)'
            : '实付分摊金额(元)',
      width: 175,
      align: 'right',
      formatter: (row) =>
        formatCurrencyValue(
          isRedBlueRelation.value
            ? (row.creditAmount ?? row.amount)
            : isReceivableRelation.value
              ? (row.receivableAmount ?? row.amount)
              : (row.paymentAmount ?? row.amount),
          row.secondaryCurrencyCode || row.currencyCode || 'CNY'
        )
    },
    {
      prop: 'cashDiscountAmount',
      label: '现金折扣金额(元)',
      width: 175,
      align: 'right',
      formatter: (row) => formatCurrencyValue(row.cashDiscountAmount ?? 0)
    },
    ...(isRedBlueRelation.value
      ? [
          {
            prop: 'payableBaseAmount',
            label: '主方本位币金额',
            width: 180,
            align: 'right' as const,
            formatter: (row: PayableWriteoffRecord) =>
              formatCurrencyValue(row.payableBaseAmount ?? 0, row.baseCurrencyCode || 'CNY')
          },
          {
            prop: 'creditBaseAmount',
            label: '辅方本位币金额',
            width: 180,
            align: 'right' as const,
            formatter: (row: PayableWriteoffRecord) =>
              formatCurrencyValue(row.creditBaseAmount ?? 0, row.baseCurrencyCode || 'CNY')
          },
          {
            prop: 'exchangeDifference',
            label: '汇兑差额(本位币)',
            width: 195,
            align: 'right' as const,
            formatter: (row: PayableWriteoffRecord) =>
              formatPayableExchangeDifference(row.exchangeDifference, row.baseCurrencyCode || 'CNY')
          }
        ]
      : []),
    {
      prop: 'voucherNo',
      label: '凭证号',
      minWidth: 190,
      formatter: (row) =>
        row.voucherId && row.voucherNo && hasAuth('FinanceVoucherCenter:View') ? (
          <ElButton
            link
            type="primary"
            onClick={() =>
              router.push({
                path: financePaths.voucherCenter,
                query: { recordId: row.voucherId }
              })
            }
          >
            {row.voucherNo}
          </ElButton>
        ) : (
          row.voucherNo || '—'
        )
    },
    {
      prop: 'operation',
      label: '操作',
      width: historyRows.value.some((row) => row.needsVoucher && row.status === 'active')
        ? 145
        : 80,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          {row.needsVoucher && row.status === 'active' && (
            <>
              <ArtButtonTable
                icon="ri:file-search-line"
                label="预览凭证"
                disabled={loading.value || busy.value || !!loadError.value}
                permission="FinancePayableWriteoff:Voucher"
                onClick={() => voucher(row, true)}
              />
              <ArtButtonTable
                icon="ri:file-add-line"
                label="生成凭证"
                disabled={loading.value || busy.value || !!loadError.value}
                permission="FinancePayableWriteoff:Voucher"
                onClick={() => voucher(row, false)}
              />
            </>
          )}
          {row.status === 'active' && (
            <ArtButtonTable
              icon="ri:arrow-go-back-line"
              label="反核销"
              disabled={
                loading.value ||
                busy.value ||
                !!loadError.value ||
                (isReceivableRelation.value && !hasAuth('FinanceReceiptWriteoff:Reverse'))
              }
              permission="FinancePayableWriteoff:Reverse"
              onClick={() => reverse(row)}
            />
          )}
        </BusinessTableRowActions>
      )
    }
  ])
  const matchingColumns: ColumnOption<PayableMatchRule>[] = [
    {
      prop: 'primaryField',
      label: '主方单据字段',
      minWidth: 180,
      formatter: (row) =>
        payableMatchFields.find((item) => item.value === row.primaryField)?.label || '未识别字段'
    },
    {
      prop: 'operator',
      label: '匹配关系',
      width: 125,
      formatter: (row) =>
        payableMatchOperators.find((item) => item.value === row.operator)?.label || '未识别关系'
    },
    {
      prop: 'secondaryField',
      label: '辅方单据字段',
      minWidth: 180,
      formatter: (row) =>
        payableMatchFields.find((item) => item.value === row.secondaryField)?.label || '未识别字段'
    },
    {
      prop: 'emptyMatches',
      label: '任一为空时匹配',
      width: 165,
      formatter: (row) => (row.emptyMatches ? '是' : '否')
    }
  ]
  const schemeColumns: ColumnOption<PayableReference>[] = [
    ...(tenantScope.isAllTenants
      ? [
          {
            prop: 'tenant',
            label: '所属租户',
            minWidth: 180,
            formatter: (row: PayableReference) => formatTenantLabel(row)
          }
        ]
      : []),
    { prop: 'code', label: '方案编码', minWidth: 180 },
    { prop: 'name', label: '方案名称', minWidth: 220 },
    {
      prop: 'automatic',
      label: '自动核销',
      width: 110,
      formatter: (row) => (row.automatic ? '启用' : '关闭')
    },
    {
      prop: 'enabled',
      label: '状态',
      width: 100,
      formatter: (row) => (row.enabled ? '启用' : '停用')
    },
    { prop: 'remark', label: '备注', minWidth: 180 },
    {
      prop: 'operation',
      label: '操作',
      width: 85,
      formatter: (row) => (
        <ArtButtonTable
          type="edit"
          label="编辑方案"
          permission="FinancePayableWriteoff:Scheme"
          onClick={() => schemeEditor.value?.open(row)}
        />
      )
    }
  ]
  const recordItems = computed(() => [
    { key: 'documentNo', field: 'documentNo', label: '核销单号' },
    { key: 'writeoffDate', field: 'writeoffDate', label: '核销日期' },
    { key: 'payableNo', field: 'payableNo', label: `主方${primaryTitle.value}` },
    { key: 'paymentNo', field: 'paymentNo', label: `辅方${secondaryTitle.value}` },
    { key: 'supplierName', field: 'supplierName', label: '往来单位' },
    ...(isReceivableRelation.value || isRedBlueRelation.value
      ? [{ key: 'counterpartyName', field: 'counterpartyName', label: '辅方往来单位' }]
      : []),
    {
      key: 'amount',
      label: '核销金额(元)',
      value: (row: PayableWriteoffRecord) =>
        formatCurrencyValue(row.amount, row.currencyCode || 'CNY')
    },
    {
      key: isRedBlueRelation.value
        ? 'creditAmount'
        : isReceivableRelation.value
          ? 'receivableAmount'
          : 'paymentAmount',
      label: isRedBlueRelation.value
        ? '辅方原币金额'
        : isReceivableRelation.value
          ? '应收抵销金额(元)'
          : isRefundRelation.value
            ? '核销现金本金(元)'
            : '实付分摊金额(元)',
      value: (row: PayableWriteoffRecord) =>
        formatCurrencyValue(
          isRedBlueRelation.value
            ? (row.creditAmount ?? row.amount)
            : isReceivableRelation.value
              ? (row.receivableAmount ?? row.amount)
              : (row.paymentAmount ?? row.amount),
          row.secondaryCurrencyCode || row.currencyCode || 'CNY'
        )
    },
    {
      key: 'cashDiscountAmount',
      label: '现金折扣金额(元)',
      value: (row: PayableWriteoffRecord) => formatCurrencyValue(row.cashDiscountAmount ?? 0)
    },
    ...(isRedBlueRelation.value
      ? [
          {
            key: 'currencyCode',
            label: '主方/辅方币种',
            value: (row: PayableWriteoffRecord) =>
              `${row.currencyCode || 'CNY'} / ${row.secondaryCurrencyCode || 'CNY'}`
          },
          { key: 'primaryExchangeRate', label: '主方原记账汇率', field: 'primaryExchangeRate' },
          { key: 'secondaryExchangeRate', label: '辅方原记账汇率', field: 'secondaryExchangeRate' },
          {
            key: 'exchangeDifference',
            label: '汇兑差额(本位币)',
            value: (row: PayableWriteoffRecord) =>
              formatPayableExchangeDifference(row.exchangeDifference, row.baseCurrencyCode || 'CNY')
          }
        ]
      : []),
    { key: 'voucherNo', field: 'voucherNo', label: '凭证号' },
    { key: 'remark', field: 'remark', label: '备注' }
  ])
  async function showRecord(row: PayableWriteoffRecord): Promise<void> {
    currentRecord.value = row
    await recordDialog.value?.handleOpen()
  }
  async function load(): Promise<void> {
    const current = ++version
    loading.value = true
    try {
      const response = await fetchPayableWriteoffWorkspace({
        relation: filter.value.relation,
        keyword: filter.value.keyword,
        organizationId: filter.value.organizationId,
        asOfDate: isRedBlueRelation.value ? filter.value.writeoffDate : undefined
      })
      if (current !== version) return
      loadError.value = ''
      response.primary.forEach((row) => (row.writeoffAmount = row.availableAmount))
      response.secondary.forEach((row) => (row.writeoffAmount = row.availableAmount))
      workspace.value = response
      loaded.value = true
      primarySelection.value = []
      secondarySelection.value = []
      if (!partyNodes.value[0].children.some((row) => row.id === selectedParty.value))
        selectedParty.value = 'all'
      if (!response.schemes.some((row) => row.id === filter.value.schemeId && row.enabled))
        filter.value.schemeId = preferredPayableWriteoffScheme(
          response.schemes,
          filter.value.relation
        )
    } catch (error) {
      if (current === version) {
        loadError.value =
          isReceivableRelation.value && isSupabaseAccessFailure(error)
            ? '此关系需要应收核销与应收金额查看权限，请联系管理员核对授权。'
            : getFriendlySupabaseErrorMessage(error, '核销资料加载失败，请重新加载')
        notifyFriendlyError(error, loadError.value)
      }
    } finally {
      if (current === version) loading.value = false
    }
  }
  async function openAutomatic(): Promise<void> {
    if (loading.value || busy.value || loadError.value) return
    const scheme = workspace.value.schemes.find((row) => row.id === filter.value.schemeId)
    if (!scheme?.enabled || !scheme.automatic || !filter.value.writeoffDate) {
      ElMessage.warning('请选择已启用自动核销的方案和核销日期')
      return
    }
    await automaticDialog.value?.open({
      schemeId: scheme.id || '',
      date: filter.value.writeoffDate,
      query: {
        relation: filter.value.relation,
        keyword: filter.value.keyword,
        organizationId: filter.value.organizationId,
        supplierId: isReceivableRelation.value
          ? undefined
          : availableParties.value.find((row) => partyKey(row) === selectedParty.value)?.supplierId,
        counterpartyKey: isReceivableRelation.value
          ? availableParties.value.find((row) => partyKey(row) === selectedParty.value)
              ?.counterpartyKey
          : undefined,
        allowCrossParty:
          (isReceivableRelation.value || isRedBlueRelation.value) && allowCrossParty.value
      }
    })
  }
  async function execute(): Promise<void> {
    if (busy.value || loading.value || loadError.value) return
    if (
      uniq([...primarySelection.value, ...secondarySelection.value].map((row) => row.tenantId))
        .length > 1
    ) {
      ElMessage.warning('单次核销不能跨租户，请按同一租户选择双方单据')
      return
    }
    if (!filter.value.schemeId || !filter.value.writeoffDate) {
      ElMessage.warning('请选择核销方案和日期')
      return
    }
    let items: PayableManualWriteoffItem[]
    try {
      const pairs = isRedBlueRelation.value
        ? []
        : allocateWriteoffAmounts(primarySelection.value, secondarySelection.value)
      items = isRedBlueRelation.value
        ? allocatePayableRedBlueAmounts(primarySelection.value, secondarySelection.value).map(
            (pair) => ({
              relation: 'payable_red_blue',
              payableId: pair.primaryId,
              creditPayableId: pair.secondaryId,
              amount: pair.amount,
              creditAmount: pair.creditAmount,
              allowCrossParty: allowCrossParty.value
            })
          )
        : isReceivableRelation.value
          ? pairs.map((pair) => ({
              relation: 'payable_receivable',
              payableId: pair.primaryId,
              receivableLineId: pair.secondaryId,
              amount: pair.amount,
              allowCrossParty: allowCrossParty.value
            }))
          : isRefundRelation.value
            ? pairs.map((pair) => ({
                relation: 'payment_refund',
                paymentLineId: pair.primaryId,
                refundLineId: pair.secondaryId,
                amount: pair.amount
              }))
            : pairs.map((pair) => ({
                payableId: pair.primaryId,
                paymentLineId: pair.secondaryId,
                amount: pair.amount
              }))
    } catch (error) {
      notifyFriendlyError(error, '双方金额不正确，请调整后重试')
      return
    }
    try {
      await confirm(
        isRedBlueRelation.value
          ? `主方 ${primarySelectedSummary.value}，辅方 ${secondarySelectedSummary.value}。按双方原记账汇率核销，汇兑差额计入损益，执行后扣减双方余额。`
          : `本次核销 ${formatCurrencyValue(primaryTotal.value)}，执行后扣减双方未核销余额。`,
        { title: '核销确认', confirmButtonText: '执行核销' }
      )
    } catch {
      return
    }
    busy.value = true
    try {
      await executePayableWriteoff(
        items,
        filter.value.schemeId,
        filter.value.writeoffDate,
        `手工${relationTitle.value}`
      )
      ElMessage.success(`${relationTitle.value}已完成`)
      await load()
    } catch (error) {
      notifyFriendlyError(error, '核销未完成，请重新查询核对余额')
    } finally {
      busy.value = false
    }
  }
  async function reverse(row: PayableWriteoffRecord): Promise<void> {
    if (busy.value || loading.value || loadError.value) return
    let reason: string
    try {
      reason = await promptReason(
        '反核销将恢复双方余额；已生成凭证的核销单不能反核销。',
        '反核销原因'
      )
    } catch {
      return
    }
    busy.value = true
    try {
      await reversePayableWriteoff(row.id, reason)
      ElMessage.success('已反核销，未制证核销单已移除')
      await load()
    } catch (error) {
      notifyFriendlyError(error, '反核销未完成，请先核对凭证状态')
    } finally {
      busy.value = false
    }
  }
  async function voucher(row: PayableWriteoffRecord, preview: boolean): Promise<void> {
    if (busy.value || loading.value || loadError.value) return
    busy.value = true
    try {
      voucherResult.value = await payableSettlementVoucher(row.id, 'writeoff', preview)
      if (preview) await previewRef.value?.handleOpen()
      else {
        if (voucherResult.value.status === 'generated')
          ElMessage.success(voucherResult.value.message)
        else ElMessage.warning(voucherResult.value.message)
        await load()
      }
    } catch (error) {
      notifyFriendlyError(error, '凭证处理未完成，请核对规则后重试')
    } finally {
      busy.value = false
    }
  }
  watch([selectedParty, onlyAvailable, allowCrossParty], () => {
    primarySelection.value = []
    secondarySelection.value = []
    primaryTable.value?.elTableRef?.clearSelection()
    secondaryTable.value?.elTableRef?.clearSelection()
  })
  watch(
    () => filter.value.relation,
    () => {
      version += 1
      loaded.value = false
      loadError.value = ''
      workspace.value = { ...workspace.value, primary: [], secondary: [], history: [] }
      primarySelection.value = []
      secondarySelection.value = []
      selectedParty.value = 'all'
      filter.value.schemeId = ''
      allowCrossParty.value = false
      activeTab.value = 'candidates'
      currentRecord.value = undefined
      void recordDialog.value?.handleClose()
      void load()
    }
  )
  watch(
    () => primarySelection.value[0]?.tenantId || secondarySelection.value[0]?.tenantId,
    (tenant) => {
      const current = workspace.value.schemes.find((row) => row.id === filter.value.schemeId)
      if (tenant && current?.tenantId && current.tenantId !== tenant)
        filter.value.schemeId = preferredPayableWriteoffScheme(
          workspace.value.schemes,
          filter.value.relation,
          tenant
        )
    }
  )
  watch(
    () => tenantScope.revision,
    () => {
      workspace.value = { primary: [], secondary: [], history: [], schemes: [] }
      loaded.value = false
      loadError.value = ''
      selectedParty.value = 'all'
      filter.value.schemeId = ''
      void load()
    }
  )
  onMounted(load)
  onBeforeUnmount(() => {
    version += 1
  })
</script>

<style scoped lang="scss">
  .payable-writeoff-page {
    &__query {
      padding: 16px;
    }

    &__document-section {
      --art-section-padding: var(--art-space-3);
    }

    &__workspace {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 16px;
      align-items: start;
      min-width: 0;
    }

    @media (width <= 900px) {
      &__workspace {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  }
</style>
