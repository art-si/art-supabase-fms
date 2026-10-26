<template>
  <ArtPermissionGuard permission="FinanceReceivableReport:View" resource-name="应收汇总与账龄">
    <div class="business-workspace-page art-full-height min-w-0">
      <BusinessWorkspaceHeader
        title="应收汇总与账龄"
        description="按截止日期统计已审核应收发生额和余额；暂估扣除已冲回金额，财务应收扣除已确认核销。"
        icon="ri:bar-chart-box-line"
        density="compact"
      >
        <template #actions><BusinessTableWorkspaceActions :table="tableRef" /></template>
      </BusinessWorkspaceHeader>
      <ArtTableQuery
        :table-props="{
          emptyText: '当前条件下暂无应收记录',
          emptyDescription: '请核对截止日期与筛选条件，并确认来源应收已审核。'
        }"
        ref="tableRef"
        :model-value="search"
        @update:model-value="replaceReactiveModel(search, $event)"
        :api-fn="loadReport"
        :search-items="searchItems"
        :columns-factory="columns"
        :columns-context-key="appliedQuery?.mode"
        :header-actions="[
          {
            type: 'export',
            permission: 'FinanceReceivableReport:Export',
            exportFilename: '应收汇总与账龄',
            disabled: !appliedQuery,
            exportMaxRows: 10000,
            exportApi: exportReport
          }
        ]"
        header-actions-placement="workspace"
        focusable
      />
    </div>
  </ArtPermissionGuard>
</template>
<script setup lang="ts">
  import { replaceReactiveModel } from '@/utils/form/model'
  import { ref, reactive, computed, watch } from 'vue'
  import dayjs from 'dayjs'
  import { fetchArOrganizationTree } from '@/api/receivables'
  import { fetchArReport, fetchArOptions, type ArReportRow } from '@/api/receivables'
  import { formatSensitiveCurrencyValue as money } from '@/utils/ui/format'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useRouteOperationGuard } from '@/hooks/core/useRouteTableContext'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { useAuth } from '@/hooks/core/useAuth'
  import ArtTableQuery from '@/components/core/tables/art-table-query/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import type { ColumnOption } from '@/types'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  defineOptions({ name: 'FinanceReceivableReport' })
  const tableRef = ref<InstanceType<typeof ArtTableQuery>>()
  type ReportQuery = Parameters<typeof fetchArReport>[0]
  const appliedQuery = ref<ReportQuery>()
  const captureRoute = useRouteOperationGuard()
  const tenantScope = useTenantScopeStore()
  const { hasAuth } = useAuth()
  let queryVersion = 0
  watch(
    () => tenantScope.effectiveTenantId,
    () => {
      queryVersion++
      appliedQuery.value = undefined
    },
    { flush: 'sync' }
  )
  async function loadReport(query: ReportQuery) {
    const version = ++queryVersion
    const isCurrentRoute = captureRoute()
    const params = { ...search, ...query }
    const result = await fetchArReport(params)
    if (version === queryVersion && isCurrentRoute()) appliedQuery.value = params
    return result
  }
  async function exportReport() {
    if (!hasAuth('FinanceReceivableReport:Export') || !hasAuth('FinanceReceivableReport:View'))
      throw new Error('当前账号无权导出应收报表')
    if (!appliedQuery.value) throw new Error('请先查询报表后再导出')
    const version = queryVersion
    const isCurrentRoute = captureRoute()
    const result = await fetchArReport({ ...appliedQuery.value, current: 1, size: 10000 })
    if (version !== queryVersion || !isCurrentRoute())
      throw new Error('查询范围已变化，请重新查询后导出')
    if (result.total > 10000) throw new Error('导出记录超过一万条，请缩小筛选范围后重试')
    if (result.data.length !== result.total) throw new Error('报表数据不完整，请重新查询后导出')
    return result
  }
  const search = reactive({
    mode: 'detail',
    asOfDate: dayjs().format('YYYY-MM-DD'),
    agingBasis: 'due',
    organizationId: '',
    customerId: '',
    kind: ''
  })
  const reportModes = useDictionaryOptions('arReportMode')
  const agingOptions = useDictionaryOptions('arAgingBasis')
  const kinds = useDictionaryOptions('arDocumentKind')
  const searchItems = computed<SearchFormItem[]>(() => [
    {
      key: 'mode',
      label: '报表范围',
      type: 'radioGroup',
      span: 12,
      props: { options: reportModes, optionType: 'button' }
    },
    { key: 'asOfDate', label: '截止日期', type: 'date', props: { valueFormat: 'YYYY-MM-DD' } },
    { key: 'agingBasis', label: '账龄依据', type: 'select', props: { options: agingOptions } },
    { key: 'kind', label: '单据类别', type: 'select', props: { options: kinds, clearable: true } },
    {
      key: 'organizationId',
      label: '结算组织',
      type: 'treeSelect',
      api: () => fetchArOrganizationTree('organization'),
      labelField: 'name',
      valueField: 'id',
      childrenField: 'children',
      props: { filterable: true, clearable: true, checkStrictly: true }
    },
    {
      key: 'customerId',
      label: '往来单位',
      type: 'select',
      api: () => fetchArOptions('customer'),
      labelField: 'name',
      valueField: 'id',
      props: { filterable: true, clearable: true }
    }
  ])
  const amountColumn = (
    key:
      'occurrenceAmount' | 'balanceAmount' | 'age0To30' | 'age31To60' | 'age61To90' | 'ageOver90',
    label: string
  ): ColumnOption<ArReportRow> => ({
    prop: key,
    label,
    width: 160,
    align: 'right',
    formatter: (row) =>
      row[key] === null || row[key] === undefined ? '—' : money(row[key], row.currencyCode)
  })
  const columns = (): ColumnOption<ArReportRow>[] => [
    { prop: 'customerName', label: '往来单位', minWidth: 200 },
    { prop: 'kind', label: '单据类别', width: 130, dict: { code: 'arDocumentKind' } },
    { prop: 'currencyCode', label: '币种', width: 90 },
    ...((appliedQuery.value?.mode ?? 'detail') === 'detail'
      ? [
          { prop: 'documentNo', label: '单据编号', minWidth: 210 },
          { prop: 'organizationName', label: '结算组织', minWidth: 160 },
          { prop: 'projectName', label: '项目', minWidth: 160 },
          { prop: 'businessDate', label: '业务日期', width: 125 },
          { prop: 'dueDate', label: '计划到期日', width: 125 },
          { prop: 'ageDays', label: '账龄天数', width: 110 }
        ]
      : []),
    amountColumn('occurrenceAmount', '发生额(原币)'),
    amountColumn('balanceAmount', '余额(原币)'),
    ...(appliedQuery.value?.mode === 'summary'
      ? [
          amountColumn('age0To30', '0—30天'),
          amountColumn('age31To60', '31—60天'),
          amountColumn('age61To90', '61—90天'),
          amountColumn('ageOver90', '90天以上')
        ]
      : [])
  ]
</script>
