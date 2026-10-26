<template>
  <ArtPermissionGuard permission="FinancePayableReport:View" resource-name="应付汇总与账龄">
    <div class="business-workspace-page art-full-height min-w-0">
      <BusinessWorkspaceHeader
        title="应付汇总与账龄"
        description="按截止日期核对应付发生额与余额；账龄仅统计财务应付，组织筛选仅包含所选组织。"
        icon="ri:bar-chart-box-line"
        density="compact"
      >
        <template #actions><BusinessTableWorkspaceActions :table="tableRef" /></template>
      </BusinessWorkspaceHeader>
      <ArtTableQuery
        ref="tableRef"
        :model-value="search"
        @update:model-value="replaceReactiveModel(search, $event)"
        :api-fn="loadReport"
        :search-items="searchItems"
        :columns-factory="columns"
        :columns-context-key="appliedQuery?.mode"
        :table-props="{
          emptyText: '当前条件下暂无应付记录',
          emptyDescription: '请核对截止日期与筛选条件，并确认来源应付已审核。'
        }"
        :header-actions="[
          {
            type: 'export',
            permission: 'FinancePayableReport:Export',
            exportFilename: '应付汇总与账龄',
            exportMaxRows: 10000,
            disabled: !appliedQuery,
            exportApi: exportReport
          },
          {
            key: 'print',
            label: '打印',
            icon: 'ri:printer-line',
            permission: 'FinancePayableReport:Print',
            disabled: !appliedQuery || printing,
            onClick: printReport
          }
        ]"
        header-actions-placement="workspace"
        focusable
      />
    </div>
  </ArtPermissionGuard>
</template>

<script setup lang="ts">
  import { computed, reactive, ref, watch } from 'vue'
  import dayjs from 'dayjs'
  import { escape, get } from 'lodash-es'
  import {
    fetchPayableReport,
    fetchPayableReportOptions,
    type PayableReportQuery,
    type PayableReportRow
  } from '@/api/payable-report'
  import { useDictionaryOptions } from '@/hooks/core/useDictionaryOptions'
  import { useRouteOperationGuard } from '@/hooks/core/useRouteTableContext'
  import { useTenantScopeStore } from '@/store/modules/tenant-scope'
  import { printHtmlDocument } from '@/utils/file/print-document'
  import { replaceReactiveModel } from '@/utils/form/model'
  import { formatSensitiveCurrencyValue as money } from '@/utils/ui/format'
  import ArtTableQuery from '@/components/core/tables/art-table-query/index.vue'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type { ColumnOption } from '@/types'

  defineOptions({ name: 'FinancePayableReport' })
  const tableRef = ref<InstanceType<typeof ArtTableQuery>>()
  const appliedQuery = ref<PayableReportQuery>()
  const printing = ref(false)
  const captureRoute = useRouteOperationGuard()
  const tenantScope = useTenantScopeStore()
  const search = reactive<PayableReportQuery>({
    current: 1,
    size: 20,
    mode: 'detail',
    asOfDate: dayjs().format('YYYY-MM-DD'),
    agingBasis: 'due',
    allocationMode: 'oldest_due',
    organizationId: '',
    accountSetId: '',
    keyword: ''
  })
  const modes = useDictionaryOptions('apReportMode')
  const agingBases = useDictionaryOptions('apReportAgingBasis')
  const allocations = useDictionaryOptions('apReportAllocation')
  const kinds = useDictionaryOptions('apReportKind')
  const partyTypes = useDictionaryOptions('apReportPartyType')
  const balanceStates = useDictionaryOptions('apReportBalanceState')
  const searchItems = computed<SearchFormItem[]>(() => [
    {
      key: 'mode',
      label: '报表范围',
      type: 'radioGroup',
      span: 12,
      props: { options: modes, optionType: 'button' }
    },
    {
      key: 'asOfDate',
      label: '截止日期',
      type: 'date',
      props: {
        valueFormat: 'YYYY-MM-DD',
        disabledDate: (date: Date) => dayjs(date).isAfter(dayjs(), 'day')
      }
    },
    { key: 'agingBasis', label: '账龄依据', type: 'select', props: { options: agingBases } },
    { key: 'allocationMode', label: '余额分配', type: 'select', props: { options: allocations } },
    {
      key: 'kind',
      label: '单据类别',
      type: 'select',
      props: { options: kinds, clearable: true, disabled: search.mode === 'aging' }
    },
    {
      key: 'partyType',
      label: '往来类型',
      type: 'select',
      props: { options: partyTypes, clearable: true }
    },
    {
      key: 'accountSetId',
      label: '账套',
      type: 'select',
      api: async () => (await fetchPayableReportOptions()).books,
      labelField: 'name',
      valueField: 'id',
      props: { filterable: true, clearable: true }
    },
    {
      key: 'organizationId',
      label: '结算组织',
      type: 'treeSelect',
      api: async () => (await fetchPayableReportOptions()).organizations,
      labelField: 'name',
      valueField: 'id',
      childrenField: 'children',
      props: { filterable: true, clearable: true, checkStrictly: true }
    },
    {
      key: 'keyword',
      label: '关键词',
      type: 'input',
      props: { placeholder: '单据编号、往来单位或来源单据', clearable: true }
    }
  ])

  let queryVersion = 0
  watch(
    () => tenantScope.effectiveTenantId,
    () => {
      queryVersion++
      appliedQuery.value = undefined
    },
    { flush: 'sync' }
  )
  async function loadReport(query: Partial<PayableReportQuery>) {
    const version = ++queryVersion
    const isCurrentRoute = captureRoute()
    const params = { ...search, ...query, action: 'view' as const }
    if (params.mode === 'aging') params.kind = 'financial'
    const result = await fetchPayableReport(params)
    if (version === queryVersion && isCurrentRoute()) appliedQuery.value = params
    return result
  }

  async function exportReport() {
    if (!appliedQuery.value) throw new Error('请先查询报表后再导出')
    const version = queryVersion
    const isCurrentRoute = captureRoute()
    const result = await fetchPayableReport({
      ...appliedQuery.value,
      current: 1,
      size: 10000,
      action: 'export'
    })
    if (version !== queryVersion || !isCurrentRoute())
      throw new Error('查询范围已变化，请重新查询后导出')
    return result
  }

  async function printReport() {
    if (!appliedQuery.value || printing.value) return
    printing.value = true
    const query = { ...appliedQuery.value }
    const printColumns = columns()
    const isCurrentRoute = captureRoute()
    const tenant = tenantScope.effectiveTenantId
    const version = queryVersion
    const isCurrent = () =>
      isCurrentRoute() && tenantScope.effectiveTenantId === tenant && version === queryVersion
    try {
      const rows: PayableReportRow[] = []
      let expectedTotal: number | undefined
      for (let current = 1; ; current++) {
        const result = await fetchPayableReport({ ...query, action: 'print', current, size: 200 })
        if (!isCurrent()) return
        expectedTotal ??= result.total
        if (expectedTotal > 10000) throw new Error('打印记录超过一万条，请缩小筛选范围后重试')
        if (result.total !== expectedTotal) throw new Error('报表数据已变化，请重新查询后打印')
        rows.push(...result.data)
        if (rows.length >= expectedTotal) break
        if (!result.data.length) throw new Error('报表数据不完整，请重新查询后打印')
      }
      if (!rows.length) throw new Error('当前查询没有可打印的应付记录')
      const body = rows
        .map(
          (row) =>
            `<tr>${printColumns
              .map((column) => {
                const key = String(column.prop)
                const value: unknown = get(row, key)
                const dictionary =
                  key === 'kind'
                    ? kinds
                    : key === 'partyType'
                      ? partyTypes
                      : key === 'balanceState'
                        ? balanceStates
                        : undefined
                const text = dictionary
                  ? (dictionary.find((item) => item.value === value)?.label ?? '—')
                  : typeof value === 'number' && key !== 'documentCount'
                    ? row.amountReadable
                      ? money(
                          value,
                          key === 'baseBalanceAmount' ? row.baseCurrencyCode : row.currencyCode
                        )
                      : '—'
                    : value == null
                      ? '—'
                      : String(value)
                return `<td>${escape(text)}</td>`
              })
              .join('')}</tr>`
        )
        .join('')
      printHtmlDocument(
        `<html><head><title>应付汇总与账龄</title><style>@page{size:A3 landscape;margin:12mm}body{font:11px sans-serif;color:#222}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}h1{font-size:18px}</style></head><body><h1>应付汇总与账龄</h1><p>截止日期：${escape(query.asOfDate)} · ${escape(modes.find((item) => item.value === query.mode)?.label ?? '')} · ${rows.length}条</p><table><thead><tr>${printColumns.map((column) => `<th>${escape(String(column.label))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`
      )
    } finally {
      printing.value = false
    }
  }

  type AmountKey =
    | 'occurrenceAmount'
    | 'reductionAmount'
    | 'balanceAmount'
    | 'baseBalanceAmount'
    | 'currentAmount'
    | 'age1To30'
    | 'age31To60'
    | 'age61To90'
    | 'age91To180'
    | 'ageOver180'
    | 'creditBalance'
  const amountColumn = (key: AmountKey, label: string): ColumnOption<PayableReportRow> => ({
    prop: key,
    label,
    width: 160,
    align: 'right',
    formatter: (row) =>
      !row.amountReadable || row[key] == null
        ? '—'
        : money(row[key], key === 'baseBalanceAmount' ? row.baseCurrencyCode : row.currencyCode)
  })
  const columns = (): ColumnOption<PayableReportRow>[] => [
    { prop: 'partyName', label: '往来单位', minWidth: 200 },
    { prop: 'kind', label: '单据类别', width: 130, dict: { code: 'apReportKind' } },
    { prop: 'partyType', label: '往来类型', width: 130, dict: { code: 'apReportPartyType' } },
    { prop: 'tenantName', label: '租户', minWidth: 150 },
    { prop: 'accountSetName', label: '账套', minWidth: 150 },
    { prop: 'organizationName', label: '结算组织', minWidth: 170 },
    { prop: 'currencyCode', label: '原币', width: 90 },
    { prop: 'balanceState', label: '余额状态', width: 150, dict: { code: 'apReportBalanceState' } },
    ...(appliedQuery.value?.mode === 'detail'
      ? [
          { prop: 'documentNo', label: '单据编号', minWidth: 210 },
          { prop: 'sourceDocumentNo', label: '来源单据', minWidth: 200 },
          { prop: 'businessDate', label: '业务日期', width: 125 },
          { prop: 'dueDate', label: '计划到期日', width: 125 }
        ]
      : [{ prop: 'documentCount', label: '单据数', width: 100 }]),
    amountColumn('occurrenceAmount', '发生额（原币）'),
    amountColumn('reductionAmount', '冲减额（原币）'),
    amountColumn('balanceAmount', '余额（原币）'),
    { prop: 'baseCurrencyCode', label: '本位币', width: 100 },
    amountColumn('baseBalanceAmount', '余额（本位币）'),
    ...(appliedQuery.value?.mode === 'aging'
      ? [
          amountColumn('currentAmount', '未到期'),
          amountColumn('age1To30', '逾期1—30天'),
          amountColumn('age31To60', '逾期31—60天'),
          amountColumn('age61To90', '逾期61—90天'),
          amountColumn('age91To180', '逾期91—180天'),
          amountColumn('ageOver180', '逾期180天以上'),
          amountColumn('creditBalance', '贷方余额')
        ]
      : [])
  ]
</script>
