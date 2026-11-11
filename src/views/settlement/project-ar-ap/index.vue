<template>
  <ArtPermissionGuard permission="FinanceProjectArApReport:View" resource-name="项目应收应付">
    <div class="business-workspace-page art-full-height min-w-0">
      <BusinessWorkspaceHeader
        eyebrow="PROJECT SETTLEMENT"
        title="项目应收应付"
        description="以项目为主线，汇总报价、合同、销售履约、应收与应付，快速识别项目结算缺口。"
        icon="ri:bar-chart-grouped-line"
        density="compact"
        :metrics="metrics"
      >
        <template #actions><BusinessTableWorkspaceActions :table="tableRef" /></template>
      </BusinessWorkspaceHeader>
      <ArtTableQuery
        ref="tableRef"
        v-model="search"
        :api-fn="fetchTable"
        :search-items="searchItems"
        :columns-factory="columns"
        :table-props="{
          emptyText: '暂无项目结算数据',
          emptyDescription: '请先建立项目报价、合同或履约单据。',
          tableLayout: 'fixed'
        }"
        :header-actions="headerActions"
        header-actions-placement="workspace"
        focusable
      />
    </div>
  </ArtPermissionGuard>
</template>

<script setup lang="ts">
  import { computed, ref } from 'vue'
  import ArtPermissionGuard from '@/components/core/feedback/art-permission-guard/index.vue'
  import ArtTableQuery, {
    type ArtTableQueryExpose,
    type ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import BusinessWorkspaceHeader, {
    type BusinessWorkspaceMetric
  } from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type { ColumnOption } from '@/types'
  import { formatSensitiveCurrencyValue as money } from '@/utils/ui/format'
  import { useAuth } from '@/hooks/core/useAuth'
  import {
    fetchProjectArApReport,
    type ProjectArApReportQuery,
    type ProjectArApReportRow
  } from '@fms/api/project-ar-ap-report'

  defineOptions({ name: 'FinanceProjectArApReport' })
  const tableRef = ref<ArtTableQueryExpose>()
  const search = ref<ProjectArApReportQuery>({ keyword: '' })
  const applied = ref<ProjectArApReportRow[]>([])
  const { hasAuth } = useAuth()
  const moneyValue = (value: number | null | undefined) => (value == null ? '—' : money(value))
  const metrics = computed<BusinessWorkspaceMetric[]>(() => [
    {
      label: '项目数',
      value: applied.value.length,
      description: '当前查询结果',
      icon: 'ri:briefcase-4-line'
    },
    {
      label: '应收余额',
      value: moneyValue(
        applied.value.reduce((sum, row) => sum + row.uninvoicedReceivableAmount, 0)
      ),
      description: '未开票应收',
      icon: 'ri:arrow-down-circle-line',
      tone: 'warning'
    },
    {
      label: '应付余额',
      value: moneyValue(applied.value.reduce((sum, row) => sum + row.uninvoicedPayableAmount, 0)),
      description: '未开票应付',
      icon: 'ri:arrow-up-circle-line',
      tone: 'danger'
    }
  ])
  const searchItems = computed<SearchFormItem[]>(() => [
    {
      key: 'keyword',
      label: '项目关键词',
      type: 'input',
      props: { placeholder: '项目名称、编号或客户名称' }
    }
  ])
  const fetchTable = async (query: ProjectArApReportQuery) => {
    const result = await fetchProjectArApReport({ ...search.value, ...query })
    applied.value = result.records
    return { data: result.records, total: result.total }
  }
  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      type: 'export',
      permission: 'FinanceProjectArApReport:Export',
      exportFilename: '项目应收应付',
      exportMaxRows: 10000,
      disabled: !hasAuth('FinanceProjectArApReport:Export'),
      exportApi: async () => {
        const result = await fetchProjectArApReport({ ...search.value, current: 1, size: 10000 })
        return { data: result.records, total: result.total }
      }
    }
  ])
  const amount = (
    key: keyof ProjectArApReportRow,
    label: string
  ): ColumnOption<ProjectArApReportRow> => ({
    prop: key,
    label,
    width: 140,
    align: 'right',
    formatter: (row) => moneyValue(row[key] as number)
  })
  const columns = (): ColumnOption<ProjectArApReportRow>[] => {
    const result: ColumnOption<ProjectArApReportRow>[] = [
      { prop: 'projectName', label: '项目名称 / 编号', minWidth: 190, fixed: 'left' },
      { prop: 'customerName', label: '客户', minWidth: 160 },
      { prop: 'ownerName', label: '负责人', width: 110 },
      { prop: 'salespersonName', label: '销售员', width: 110 },
      {
        label: '报价',
        children: [
          { prop: 'quotationNo', label: '报价单号', minWidth: 150 },
          { prop: 'quotationDate', label: '项目报价时间', width: 130 },
          amount('quotationAmount', '不含税(元)'),
          amount('quotationTaxAmount', '含税(元)')
        ]
      },
      {
        label: '合同',
        children: [
          { prop: 'contractName', label: '合同名称', minWidth: 180 },
          { prop: 'contractNo', label: '合同号', minWidth: 150 },
          { prop: 'paperContractNo', label: '纸质合同号', minWidth: 140 },
          { prop: 'contractType', label: '合同类型', width: 120 },
          { prop: 'contractSignedDate', label: '签订时间', width: 130 },
          amount('contractAmount', '不含税(元)'),
          amount('contractTaxAmount', '含税(元)')
        ]
      },
      {
        label: '应收',
        children: [
          amount('salesAmount', '销售金额(元)'),
          amount('shippedAmount', '发货金额(元)'),
          amount('receivableAmount', '应收金额(元)'),
          amount('invoicedReceivableAmount', '已开票(元)'),
          amount('uninvoicedReceivableAmount', '未开票(元)'),
          amount('receivedAmount', '已收款(元)')
        ]
      },
      {
        label: '应付',
        children: [
          amount('inboundAmount', '入库金额(元)'),
          amount('payableAmount', '应付金额(元)'),
          amount('invoicedPayableAmount', '已开票(元)'),
          amount('uninvoicedPayableAmount', '未开票(元)'),
          amount('paidAmount', '已付款(元)')
        ]
      }
    ]
    return result
  }
</script>
