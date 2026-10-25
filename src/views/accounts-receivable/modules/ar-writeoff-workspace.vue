<template>
  <ArtPermissionGuard permission="FinanceReceiptWriteoff:View" resource-name="收款核销工作台">
    <div class="business-workspace-page min-w-0">
      <BusinessWorkspaceHeader
        title="收款核销工作台"
        description="按组织查验双方余额，支持手工核销、特殊核销与完整核销追溯。"
        icon="ri:checkbox-circle-line"
        density="compact"
        :metrics="metrics"
      >
        <template #actions
          ><ElButton v-auth="'FinanceReceiptWriteoff:Scheme'" @click="openScheme"
            ><ArtSvgIcon icon="ri:settings-3-line" aria-hidden="true" />核销方案</ElButton
          ><ElButton v-auth="'FinanceReceiptWriteoff:View'" @click="historyDialog?.handleOpen()"
            ><ArtSvgIcon icon="ri:history-line" />核销记录</ElButton
          ></template
        >
      </BusinessWorkspaceHeader>
      <ArtSectionCard
        title="核销条件"
        description="仅选择已结束初始化的组织；双方始终属于同一租户和组织。"
      >
        <ArtForm
          :key="schemeVersion"
          v-model="form"
          :disabled="loading || busy || checking"
          :items="filterItems"
          :show-submit="false"
          :show-reset="false"
          :span="6"
          label-position="top"
        />
        <div class="flex flex-wrap items-center gap-2">
          <ElButton type="primary" :loading="loading" :disabled="busy || checking" @click="load"
            ><ArtSvgIcon icon="ri:search-line" aria-hidden="true" />查询待核销单据</ElButton
          >
          <ElButton
            v-auth="'FinanceReceiptWriteoff:Check'"
            :loading="checking"
            :disabled="!selectedCount || busy || loading || !!loadError"
            @click="check"
            ><ArtSvgIcon icon="ri:shield-check-line" aria-hidden="true" />单据查验</ElButton
          >
          <ElButton
            v-auth="'FinanceReceiptWriteoff:Writeoff'"
            :loading="busy"
            :disabled="
              !primarySelection.length ||
              !secondarySelection.length ||
              loading ||
              checking ||
              !!loadError
            "
            @click="execute(false)"
            ><ArtSvgIcon icon="ri:checkbox-circle-line" aria-hidden="true" />核销</ElButton
          >
          <ElButton
            v-auth="'FinanceReceiptWriteoff:Special'"
            :disabled="!primarySelection.length || busy || loading || checking || !!loadError"
            @click="execute(true)"
            ><ArtSvgIcon icon="ri:magic-line" aria-hidden="true" />特殊核销</ElButton
          >
          <span class="ml-auto text-sm tabular-nums"
            >主方 {{ primaryTotal }} · 辅方 {{ secondaryTotal }}（原币）</span
          >
        </div>
      </ArtSectionCard>
      <div class="mt-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <ArtSectionCard
          :title="primaryTitle"
          :loading="loading"
          :error="loadError"
          :empty="!loading && !loadError && (!loaded || !primaryRows.length)"
          :empty-title="loaded ? '暂无可核销主方单据' : '先选择结算组织'"
          empty-description="选择已完成本年期初余额确认的组织，查询后勾选单据。"
          @retry="load"
        >
          <ArtTable
            ref="primaryTable"
            :data="primaryRows"
            :columns="candidateColumns"
            row-key="id"
            :pagination="false"
            :height="410"
            @selection-change="primaryChanged"
          />
        </ArtSectionCard>
        <ArtSectionCard
          :title="secondaryTitle"
          :loading="loading"
          :error="loadError"
          :empty="!loading && !loadError && (!loaded || !secondaryRows.length)"
          :empty-title="loaded ? '暂无可核销辅方单据' : '等待查询核销单据'"
          empty-description="可先确认收款或处理退款，刷新后再匹配。"
          @retry="load"
        >
          <ArtTable
            ref="secondaryTable"
            :data="secondaryRows"
            :columns="candidateColumns"
            row-key="id"
            :pagination="false"
            :height="410"
            @selection-change="secondaryChanged"
          />
        </ArtSectionCard>
      </div>
      <ArtDialog
        ref="reasonDialog"
        :title="special ? '特殊核销确认' : '核销确认'"
        size="md"
        confirm-text="执行核销"
      >
        <ElAlert
          :title="
            special
              ? '仅生成主方核销，请填写业务原因。'
              : '执行时重新校验状态、余额、汇率和核销方案。'
          "
          type="warning"
          :closable="false"
          class="mb-4"
        />
        <ArtDescriptions
          class="mb-4"
          :data="confirmationSummary"
          :items="confirmationItems"
          :columns="2"
        />
        <ArtForm
          v-model="reasonForm"
          :items="reasonItems"
          :show-submit="false"
          :show-reset="false"
          label-position="top"
        />
      </ArtDialog>
      <ArtDialog ref="checkDialog" title="单据查验结果" size="lg" :show-footer="false"
        ><ArtTable :data="checkResults" :columns="checkColumns" :pagination="false"
      /></ArtDialog>
      <ArtDialog ref="historyDialog" title="核销记录" size="full" :show-footer="false">
        <ArtTableQuery
          ref="historyTable"
          :api-fn="historyRows"
          :columns-factory="historyColumns"
          :header-actions="historyActions"
        />
      </ArtDialog>
      <ArtDialog ref="recordDialog" title="核销双侧分录" size="xl" :show-footer="false">
        <ArtDescriptions v-if="currentRecord" :data="currentRecord" :items="recordItems" /><ArtTable
          class="mt-4"
          :data="currentRecord?.sides || []"
          :columns="sideColumns"
          :pagination="false"
        />
      </ArtDialog>
      <ArtDialog ref="reverseDialog" title="反核销" size="md" confirm-text="确认反核销"
        ><ArtForm
          v-model="reverseForm"
          :items="reasonItems"
          :show-submit="false"
          :show-reset="false"
          label-position="top"
      /></ArtDialog>
      <ArtDialog ref="schemeDialog" title="新增核销方案" size="md" confirm-text="保存核销方案">
        <ArtForm
          v-model="schemeForm"
          :items="schemeItems"
          :show-submit="false"
          :show-reset="false"
          :span="12"
          label-position="top"
        />
      </ArtDialog>
    </div>
  </ArtPermissionGuard>
</template>
<script setup lang="tsx">
  import { ref, computed, watch, onMounted, unref, nextTick } from 'vue'
  import { useRoute } from 'vue-router'
  import dayjs from 'dayjs'
  import { sumBy, groupBy, compact } from 'lodash-es'
  import { ElInputNumber, ElInput, ElMessage } from 'element-plus'
  import {
    fetchArOptions,
    fetchArOrganizationTree,
    fetchArWriteoffCandidates,
    fetchArWorkspace,
    executeArWriteoff,
    checkArWriteoff,
    reverseArWriteoff,
    saveArScheme,
    type WriteoffCandidate,
    type WriteoffPayload,
    type WriteoffRecord,
    type WriteoffRecordSide,
    type WriteoffCheckResult,
    type ArQuery
  } from '@/api/receivables'
  import { useAuth } from '@/hooks/core/useAuth'
  import { useTenantOperationGuard } from '@/hooks/core/useTenantOperationGuard'
  import { useArtOverlaySession } from '@/hooks/core/useArtOverlay'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { notifyFriendlyError } from '@/hooks/core/useArtFeedback'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { financePaths } from '@/router/business-paths'
  import { formatSensitiveCurrencyValue as money } from '@/utils/ui/format'
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import ArtTableQuery, {
    type ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import ArtDialog from '@/components/core/dialogs/art-dialog/index.vue'
  import type { ArtDialogExpose } from '@/components/core/dialogs/art-dialog/types'
  import ArtButtonTable from '@/components/core/forms/art-button-table/index.vue'
  import ArtDescriptions from '@/components/core/base/art-descriptions/index.vue'
  import type { ArtDescriptionItem } from '@/components/core/base/art-descriptions/types'
  import ArtSectionCard from '@/components/core/surfaces/art-section-card/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableRowActions from '@/components/business/business-table-row-actions/index.vue'
  import BusinessTableIdentityCell from '@/components/business/business-table-identity-cell/index.vue'
  import type { ColumnOption } from '@/types'
  defineOptions({ name: 'ArWriteoffWorkspace' })
  const { hasAuth } = useAuth()
  const primaryTable = ref<ArtTableExpose>()
  const secondaryTable = ref<ArtTableExpose>()
  const reasonDialog = ref<ArtDialogExpose>()
  const captureWriteoffOperation = useTenantOperationGuard('FinanceReceiptWriteoff:View')
  const writeoffSession = useArtOverlaySession(() => Boolean(unref(reasonDialog.value?.visible)))
  const checkDialog = ref<ArtDialogExpose>()
  const historyDialog = ref<ArtDialogExpose>()
  const recordDialog = ref<ArtDialogExpose>()
  const reverseDialog = ref<ArtDialogExpose>()
  const historyTable = ref<InstanceType<typeof ArtTableQuery>>()
  const schemeDialog = ref<ArtDialogExpose>()
  const schemeVersion = ref(0)
  const schemeForm = ref({
    name: '',
    sameCustomer: true,
    sameCurrency: true,
    sameProject: false,
    sameSource: false
  })
  const schemeItems: FormItem[] = [
    { key: 'name', label: '方案名称', type: 'input', span: 24, props: { maxlength: 100 } },
    { key: 'sameCustomer', label: '往来单位相同', type: 'switch' },
    { key: 'sameCurrency', label: '币种相同', type: 'switch' },
    { key: 'sameProject', label: '项目相同', type: 'switch' },
    { key: 'sameSource', label: '来源单据相同', type: 'switch' }
  ]
  const currentRecord = ref<WriteoffRecord>()
  const reverseForm = ref({ reason: '' })
  const reasonForm = ref({ reason: '' })
  const special = ref(false)
  const requestId = ref('')
  const loading = ref(false)
  const busy = ref(false)
  const checking = ref(false)
  const loadError = ref<Error>()
  const loaded = ref(false)
  let version = 0
  const form = ref({
    organizationId: '',
    customerId: '',
    counterpartyType: 'customer',
    relationKind: 'receivable_receipt',
    writeoffDate: dayjs().format('YYYY-MM-DD'),
    schemeId: '',
    crossCustomer: false,
    crossCurrency: false,
    onlyMatchable: true
  })
  const route = useRoute()
  const candidates = ref<WriteoffCandidate[]>([])
  const primarySelection = ref<WriteoffCandidate[]>([])
  const secondarySelection = ref<WriteoffCandidate[]>([])
  const summary = ref({ receivableAmount: 0, dueThisMonthAmount: 0, unallocatedReceiptAmount: 0 })
  const relations = useDictionaryOptions('arWriteoffRelation')
  const parties = useDictionaryOptions('arCounterpartyType')
  const metrics = computed(() => [
    {
      label: '应收余额',
      value: loaded.value ? money(summary.value.receivableAmount) : '—',
      description: '已审核应收未核销本位币',
      icon: 'ri:bill-line'
    },
    {
      label: '本月到期',
      value: loaded.value ? money(summary.value.dueThisMonthAmount) : '—',
      description: '本月计划到期未核销本位币',
      icon: 'ri:calendar-check-line'
    },
    {
      label: '已收款未核销',
      value: loaded.value ? money(summary.value.unallocatedReceiptAmount) : '—',
      description: '已确认收款可分配本位币',
      icon: 'ri:wallet-3-line'
    }
  ])
  const filterItems = computed<FormItem[]>(() => [
    {
      key: 'organizationId',
      label: '结算组织',
      type: 'treeSelect',
      api: () =>
        fetchArOrganizationTree(
          'initialized_organization',
          useTenantScopeStore().effectiveTenantId
        ),
      labelField: 'name',
      valueField: 'id',
      childrenField: 'children',
      props: { filterable: true, clearable: true, checkStrictly: true }
    },
    { key: 'counterpartyType', label: '往来类型', type: 'select', props: { options: parties } },
    {
      key: 'customerId',
      label: '往来单位',
      type: form.value.counterpartyType === 'person' ? 'employeeSelect' : 'select',
      api:
        form.value.counterpartyType === 'person'
          ? undefined
          : () =>
              fetchArOptions(form.value.counterpartyType, useTenantScopeStore().effectiveTenantId),
      labelField: 'name',
      valueField: 'id',
      props: { filterable: true, clearable: true, allowAllTenantRead: true }
    },
    { key: 'relationKind', label: '核销关系', type: 'select', props: { options: relations } },
    { key: 'writeoffDate', label: '核销日期', type: 'date', props: { valueFormat: 'YYYY-MM-DD' } },
    {
      key: 'schemeId',
      label: '手工核销方案',
      type: 'select',
      api: () => fetchArOptions('scheme', useTenantScopeStore().effectiveTenantId),
      labelField: 'name',
      valueField: 'id',
      props: { clearable: true }
    },
    {
      key: 'crossCustomer',
      label: '允许往来单位不同',
      type: 'switch',
      span: 4,
      props: { disabled: !hasAuth('FinanceReceiptWriteoff:CrossCustomer') }
    },
    {
      key: 'crossCurrency',
      label: '异币别核销',
      type: 'switch',
      span: 4,
      props: { disabled: !hasAuth('FinanceReceiptWriteoff:CrossCurrency') }
    },
    { key: 'onlyMatchable', label: '仅显示可核销数据', type: 'switch', span: 4 }
  ])
  const relationSources: Record<string, string[]> = {
    receivable_receipt: ['financial', 'receipt'],
    receivable_receivable: ['financial', 'financial'],
    receipt_refund: ['receipt', 'refund'],
    receivable_refund: ['financial', 'refund'],
    receivable_red_blue: ['financial', 'financial'],
    bad_debt_recovery: ['bad_debt', 'receipt']
  }
  const sourcePair = computed(
    () => relationSources[form.value.relationKind] || ['financial', 'receipt']
  )
  function eligible(row: WriteoffCandidate, side: 'primary' | 'secondary'): boolean {
    if (row.sourceType !== sourcePair.value[side === 'primary' ? 0 : 1]) return false
    if (row.sourceType !== 'financial') return true
    return ['receivable_receivable', 'receivable_red_blue'].includes(form.value.relationKind)
      ? side === 'secondary'
        ? Boolean(row.isCredit)
        : !row.isCredit
      : form.value.relationKind === 'receivable_refund'
        ? Boolean(row.isCredit)
        : !row.isCredit
  }
  const secondaryRows = computed(() => candidates.value.filter((row) => eligible(row, 'secondary')))
  const primaryRows = computed(() =>
    candidates.value.filter(
      (row) =>
        eligible(row, 'primary') &&
        (!form.value.onlyMatchable ||
          secondaryRows.value.some(
            (other) =>
              (form.value.crossCustomer || other.customerId === row.customerId) &&
              (form.value.crossCurrency || other.currencyCode === row.currencyCode)
          ))
    )
  )
  const sourceLabels: Record<string, string> = {
    financial: '财务应收',
    receipt: '收款单',
    refund: '收款退款单',
    bad_debt: '坏账损失单'
  }
  const primaryTitle = computed(() => `主方 · ${sourceLabels[sourcePair.value[0]]}`)
  const secondaryTitle = computed(() => `辅方 · ${sourceLabels[sourcePair.value[1]]}`)
  const selectedCount = computed(
    () => primarySelection.value.length + secondarySelection.value.length
  )
  const selectedTotal = (rows: WriteoffCandidate[]) =>
    Object.entries(groupBy(rows, 'currencyCode'))
      .map(([currency, records]) =>
        money(
          sumBy(records, (row) => row.writeoffAmount),
          currency
        )
      )
      .join(' / ') || '—'
  const primaryTotal = computed(() => selectedTotal(primarySelection.value))
  const secondaryTotal = computed(() => selectedTotal(secondarySelection.value))
  const confirmationSummary = computed(() => ({
    relation: special.value
      ? '特殊核销'
      : relations.find((item) => item.value === form.value.relationKind)?.label || '核销',
    date: form.value.writeoffDate,
    primaryAmount: primaryTotal.value,
    secondaryAmount: special.value ? '不使用辅方' : secondaryTotal.value,
    count: `主方 ${primarySelection.value.length} 条 / 辅方 ${special.value ? 0 : secondarySelection.value.length} 条`,
    primaryDocuments: primarySelection.value
      .map((row) => `${row.documentNo}${row.lineNo ? ` · 第${row.lineNo}行` : ''}`)
      .join('、'),
    secondaryDocuments: special.value
      ? '—'
      : secondarySelection.value.map((row) => row.documentNo).join('、')
  }))
  const confirmationItems: ArtDescriptionItem<typeof confirmationSummary.value>[] = [
    { key: 'relation', field: 'relation', label: '核销关系' },
    { key: 'date', field: 'date', label: '核销日期' },
    { key: 'primaryAmount', field: 'primaryAmount', label: '主方金额（原币）' },
    { key: 'secondaryAmount', field: 'secondaryAmount', label: '辅方金额（原币）' },
    { key: 'count', field: 'count', label: '所选条目', span: 2 },
    { key: 'primaryDocuments', field: 'primaryDocuments', label: '主方单据 / 明细', span: 2 },
    { key: 'secondaryDocuments', field: 'secondaryDocuments', label: '辅方单据', span: 2 }
  ]
  function primaryChanged(rows: WriteoffCandidate[]): void {
    primarySelection.value = rows
  }
  function secondaryChanged(rows: WriteoffCandidate[]): void {
    secondarySelection.value = rows
  }
  const candidateColumns: ColumnOption<WriteoffCandidate>[] = [
    {
      type: 'selection',
      width: 45,
      selectable: () => !loading.value && !busy.value && !checking.value && !loadError.value
    },
    {
      prop: 'documentNo',
      label: '单据编号 / 明细',
      minWidth: 200,
      fixed: 'left',
      formatter: (row) => (
        <BusinessTableIdentityCell
          primary={row.documentNo}
          secondary={compact([
            row.currencyCode,
            row.lineNo ? `第${row.lineNo}行` : undefined,
            row.description || row.customerName
          ]).join(' · ')}
        />
      )
    },
    { prop: 'customerName', label: '往来单位', minWidth: 180 },
    { prop: 'businessDate', label: '业务日期', width: 125 },
    { prop: 'currencyCode', label: '币种', width: 80 },
    { prop: 'exchangeRate', label: '账面汇率', width: 120 },
    { prop: 'dueDate', label: '计划到期日', width: 125 },
    { prop: 'sourceNo', label: '来源单号', minWidth: 180 },
    {
      prop: 'amount',
      label: '单据金额',
      width: 140,
      formatter: (row) => money(row.amount, row.currencyCode)
    },
    {
      prop: 'outstandingAmount',
      label: '未核销金额',
      width: 145,
      formatter: (row) => money(row.outstandingAmount ?? row.availableAmount, row.currencyCode)
    },
    {
      prop: 'availableAmount',
      label: '允许核销金额',
      width: 145,
      formatter: (row) => money(row.availableAmount, row.currencyCode)
    },
    {
      prop: 'writeoffAmount',
      label: '本次核销金额',
      width: 160,
      fixed: 'right',
      required: true,
      rules: {
        validator: ({ row }) => row.writeoffAmount > 0 && row.writeoffAmount <= row.availableAmount,
        message: '核销金额须在可用余额以内'
      },
      formatter: (row) => (
        <ElInputNumber
          v-model={row.writeoffAmount}
          disabled={loading.value || busy.value || checking.value}
          aria-label={`${row.documentNo} 本次核销金额`}
          min={0}
          max={row.availableAmount}
          precision={2}
          controls={false}
          class="w-full!"
        />
      )
    },
    {
      prop: 'remark',
      label: '核销备注',
      minWidth: 200,
      formatter: (row) => (
        <ElInput
          v-model={row.remark}
          disabled={loading.value || busy.value || checking.value}
          maxlength={1000}
          aria-label={`${row.documentNo} 核销备注`}
        />
      )
    }
  ]
  async function load(): Promise<void> {
    if (checking.value) return
    if (!form.value.organizationId) {
      ElMessage.warning('请先选择已结束初始化的结算组织')
      return
    }
    const batch = ++version
    loading.value = true
    loadError.value = undefined
    primarySelection.value = []
    secondarySelection.value = []
    try {
      const result = await fetchArWriteoffCandidates({
        organizationId: form.value.organizationId,
        customerId: form.value.customerId,
        counterpartyType: form.value.counterpartyType
      })
      if (batch !== version) return
      candidates.value = result.data
      summary.value = result.summary
      loaded.value = true
    } catch (error) {
      if (batch === version) {
        candidates.value = []
        loadError.value =
          error instanceof Error ? error : new Error('资料加载失败，请重试', { cause: error })
      }
    } finally {
      if (batch === version) loading.value = false
    }
  }
  function payload(isSpecial = false): WriteoffPayload {
    return {
      ...form.value,
      requestId: requestId.value,
      relationKind: isSpecial ? 'special' : form.value.relationKind,
      reason: reasonForm.value.reason,
      sides: [
        ...primarySelection.value.map((row) => ({
          id: row.id,
          sourceType: row.sourceType,
          side: 'primary' as const,
          amount: row.writeoffAmount,
          remark: row.remark
        })),
        ...(isSpecial
          ? []
          : secondarySelection.value.map((row) => ({
              id: row.id,
              sourceType: row.sourceType,
              side: 'secondary' as const,
              amount: row.writeoffAmount,
              remark: row.remark
            })))
      ]
    }
  }
  const reasonItems: FormItem[] = [
    {
      key: 'reason',
      label: '业务原因 / 核销备注',
      type: 'textarea',
      props: { maxlength: 2000, rows: 4 }
    }
  ]
  async function execute(isSpecial: boolean): Promise<void> {
    if (busy.value || checking.value || loading.value || loadError.value) return
    const permission = isSpecial
      ? 'FinanceReceiptWriteoff:Special'
      : 'FinanceReceiptWriteoff:Writeoff'
    const scopeCurrent = captureWriteoffOperation()
    const hasWriteoffPermissions = () =>
      hasAuth(permission) &&
      (!form.value.crossCustomer || hasAuth('FinanceReceiptWriteoff:CrossCustomer')) &&
      (!form.value.crossCurrency || hasAuth('FinanceReceiptWriteoff:CrossCurrency'))
    if (!scopeCurrent() || !hasWriteoffPermissions()) return
    const selected = isSpecial
      ? primarySelection.value
      : [...primarySelection.value, ...secondarySelection.value]
    if (
      selected.some(
        (row) =>
          !Number.isFinite(row.writeoffAmount) ||
          row.writeoffAmount <= 0 ||
          row.writeoffAmount > row.availableAmount
      )
    ) {
      ElMessage.warning('本次核销金额须大于零且不超过可用余额')
      return
    }
    special.value = isSpecial
    reasonForm.value.reason = ''
    requestId.value = crypto.randomUUID()
    const sessionVersion = writeoffSession.invalidate()
    const isCurrent = () =>
      scopeCurrent() && writeoffSession.isCurrent(sessionVersion) && hasWriteoffPermissions()
    await reasonDialog.value?.handleOpen(undefined, {
      title: isSpecial ? '特殊核销确认' : '核销确认',
      onClose: () => {
        writeoffSession.invalidate()
      },
      onConfirm: async () => {
        if (!isCurrent()) {
          ElMessage.warning('操作范围或权限已变化，请重新打开核销确认')
          return false
        }
        if (isSpecial && !reasonForm.value.reason.trim()) {
          ElMessage.warning('请填写特殊核销原因')
          return false
        }
        busy.value = true
        try {
          await executeArWriteoff(payload(isSpecial))
          if (!isCurrent()) return false
          ElMessage.success('核销已完成')
          await load()
          return isCurrent()
        } catch (error) {
          if (!isCurrent()) return false
          notifyFriendlyError(error, '核销未完成，请查验单据后重试')
          return false
        } finally {
          busy.value = false
        }
      }
    })
  }
  const checkResults = ref<WriteoffCheckResult[]>([])
  const checkColumns: ColumnOption<(typeof checkResults.value)[number]>[] = [
    { prop: 'documentNo', label: '单据编号', minWidth: 200 },
    { prop: 'currencyCode', label: '币种', width: 90 },
    {
      prop: 'availableAmount',
      label: '允许核销金额',
      width: 150,
      formatter: (row) => money(row.availableAmount, row.currencyCode)
    },
    { prop: 'message', label: '查验结果', minWidth: 300 }
  ]
  async function check(): Promise<void> {
    if (checking.value || busy.value || loading.value || loadError.value || !selectedCount.value)
      return
    const batch = version
    checking.value = true
    try {
      const result = await checkArWriteoff(payload())
      if (batch !== version) return
      checkResults.value = result
      await checkDialog.value?.handleOpen()
    } catch (error) {
      if (batch === version) notifyFriendlyError(error, '单据查验未完成，请重试')
    } finally {
      checking.value = false
    }
  }
  async function historyRows(query: ArQuery) {
    return fetchArWorkspace('writeoff', {
      ...query,
      sourceDocumentId:
        typeof route.query.sourceDocumentId === 'string' ? route.query.sourceDocumentId : undefined,
      tenantId: useTenantScopeStore().effectiveTenantId
    })
  }
  async function openScheme(): Promise<void> {
    schemeForm.value = {
      name: '',
      sameCustomer: true,
      sameCurrency: true,
      sameProject: false,
      sameSource: false
    }
    await schemeDialog.value?.handleOpen(undefined, {
      onConfirm: async () => {
        if (!schemeForm.value.name.trim()) {
          ElMessage.warning('请填写方案名称')
          return false
        }
        try {
          await saveArScheme(schemeForm.value)
          schemeVersion.value++
          ElMessage.success('核销方案已保存')
          return true
        } catch (error) {
          notifyFriendlyError(error, '方案未保存，请重试')
          return false
        }
      }
    })
  }
  const historyActions: ArtTableQueryHeaderAction[] = [
    { type: 'export', permission: 'FinanceReceiptWriteoff:Export', exportFilename: '应收核销记录' }
  ]
  const historyColumns = (): ColumnOption<WriteoffRecord>[] => [
    { prop: 'documentNo', label: '核销编号', minWidth: 170 },
    { prop: 'businessDate', label: '核销日期', width: 125 },
    { prop: 'relationKind', label: '核销关系', width: 180, dict: { code: 'arWriteoffRelation' } },
    { prop: 'organizationName', label: '结算组织', minWidth: 180 },
    {
      prop: 'exchangeGainLoss',
      label: '汇兑损益（正数为损失）',
      width: 150,
      formatter: (row) => (row.exchangeGainLoss === null ? '—' : money(row.exchangeGainLoss))
    },
    { prop: 'status', label: '状态', width: 120, dict: { code: 'arDocumentStatus' } },
    { prop: 'reason', label: '原因', minWidth: 220 },
    {
      prop: 'operation',
      label: '操作',
      width: 110,
      fixed: 'right',
      formatter: (row) => (
        <BusinessTableRowActions>
          <ArtButtonTable
            type="view"
            permission="FinanceReceiptWriteoff:View"
            label="查看双侧分录"
            onClick={() => {
              currentRecord.value = row
              recordDialog.value?.handleOpen()
            }}
          />
          {row.status === 'approved' &&
            !row.reversalOfId &&
            !row.autoReceiptId &&
            !row.autoRefundId &&
            !row.autoPaymentRequestId && (
              <ArtButtonTable
                icon="ri:arrow-go-back-line"
                permission="FinanceReceiptWriteoff:Reverse"
                label="反核销"
                onClick={() => reverse(row)}
              />
            )}
        </BusinessTableRowActions>
      )
    }
  ]
  const recordItems: ArtDescriptionItem<WriteoffRecord>[] = [
    { key: 'documentNo', label: '核销编号', field: 'documentNo' },
    { key: 'businessDate', label: '核销日期', field: 'businessDate' },
    { key: 'organizationName', label: '结算组织', field: 'organizationName' },
    { key: 'exchangeGainLoss', label: '汇兑损益', field: 'exchangeGainLoss', format: 'money' },
    { key: 'reason', label: '业务原因', field: 'reason', span: 2 }
  ]
  const sideColumns: ColumnOption<WriteoffRecordSide>[] = [
    {
      prop: 'side',
      label: '核销方',
      width: 90,
      formatter: (row) => (row.side === 'primary' ? '主方' : '辅方')
    },
    { prop: 'documentNo', label: '来源单据', minWidth: 200 },
    { prop: 'currencyCode', label: '原币', width: 90 },
    {
      prop: 'originalAmount',
      label: '原币金额',
      width: 150,
      formatter: (row) => (row.originalAmount === null ? '—' : money(row.originalAmount))
    },
    {
      prop: 'baseAmount',
      label: '账面本位币',
      width: 150,
      formatter: (row) => (row.baseAmount === null ? '—' : money(row.baseAmount))
    },
    { prop: 'exchangeRate', label: '核销日汇率', width: 140 },
    { prop: 'remark', label: '备注', minWidth: 180 }
  ]
  async function reverse(row: WriteoffRecord): Promise<void> {
    reverseForm.value.reason = ''
    await reverseDialog.value?.handleOpen(undefined, {
      onConfirm: async () => {
        if (!reverseForm.value.reason.trim()) {
          ElMessage.warning('请填写反核销原因')
          return false
        }
        try {
          await reverseArWriteoff(row.id, reverseForm.value.reason)
          ElMessage.success('已追加反核销记录')
          await historyTable.value?.refreshData()
          if (form.value.organizationId) await load()
          return true
        } catch (error) {
          notifyFriendlyError(error, '反核销未完成，请重试')
          return false
        }
      }
    })
  }
  watch(
    () => [form.value.relationKind, form.value.counterpartyType],
    () => {
      primarySelection.value = []
      secondarySelection.value = []
      primaryTable.value?.elTableRef?.clearSelection()
      secondaryTable.value?.elTableRef?.clearSelection()
    }
  )
  watch(
    () => form.value.counterpartyType,
    () => {
      form.value.customerId = ''
      schemeVersion.value++
    }
  )
  watch(
    () => [form.value.organizationId, form.value.customerId, form.value.counterpartyType],
    () => {
      version++
      loading.value = false
      loaded.value = false
      candidates.value = []
      loadError.value = undefined
      summary.value = { receivableAmount: 0, dueThisMonthAmount: 0, unallocatedReceiptAmount: 0 }
    }
  )
  watch(
    () => useTenantScopeStore().effectiveTenantId,
    () => {
      version++
      candidates.value = []
      loaded.value = false
      form.value.organizationId = ''
      form.value.customerId = ''
      summary.value = { receivableAmount: 0, dueThisMonthAmount: 0, unallocatedReceiptAmount: 0 }
    }
  )
  onMounted(async () => {
    if (typeof route.query.sourceDocumentId === 'string') await historyDialog.value?.handleOpen()
  })
  watch(
    () =>
      route.path === financePaths.receiptWriteoff
        ? [route.query.organizationId, route.query.customerId]
        : [],
    async ([organizationId, customerId]) => {
      version++
      loading.value = false
      if (typeof organizationId !== 'string' || typeof customerId !== 'string') return
      const isCurrent = captureWriteoffOperation()
      if (!isCurrent()) return
      form.value.organizationId = ''
      form.value.customerId = ''
      await nextTick()
      if (!isCurrent()) return
      loading.value = true
      try {
        const [organizations, customers] = await Promise.all([
          fetchArOptions('initialized_organization', useTenantScopeStore().effectiveTenantId),
          fetchArOptions('customer', useTenantScopeStore().effectiveTenantId)
        ])
        if (!isCurrent()) return
        if (
          !organizations.some((row) => row.id === organizationId) ||
          !customers.some((row) => row.id === customerId)
        ) {
          ElMessage.warning('来源组织尚未结束初始化或资料不在当前范围，请手工选择核销条件')
          return
        }
        form.value.organizationId = organizationId
        form.value.customerId = customerId
        await nextTick()
        if (isCurrent()) await load()
      } catch (error) {
        if (isCurrent())
          notifyFriendlyError(error, '来源核销条件未加载，请刷新重试或手工选择组织和往来单位')
      } finally {
        if (isCurrent()) loading.value = false
      }
    },
    { immediate: true, flush: 'post' }
  )
</script>
