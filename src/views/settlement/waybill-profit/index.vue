<template>
  <div class="business-workspace-page art-full-height">
    <BusinessWorkspaceHeader
      density="compact"
      eyebrow="WAYBILL PROFITABILITY"
      title="运单利润"
      description="对比运输收入、直接成本与毛利表现，定位低毛利线路和经营改善机会。"
      icon="ri:line-chart-line"
      :tags="[
        { label: '单票经营', type: 'primary' },
        { label: '毛利洞察', type: 'success' }
      ]"
    >
      <template #actions>
        <BusinessTableWorkspaceActions :table="tableQueryRef" />
      </template>
    </BusinessWorkspaceHeader>

    <ArtTableQuery
      ref="tableQueryRef"
      v-model="searchQuery"
      :search-items="searchItems"
      :api-fn="fetchTableData"
      :columns-factory="columnsFactory"
      :header-actions="headerActions"
      header-actions-placement="workspace"
      :search-bar-props="{ span: 6, labelWidth: 80, isExpand: true, showExpand: false }"
      :table-props="{
        rowKey: 'id',
        tableLayout: 'fixed',
        emptyText: '暂无运单利润数据',
        emptyDescription: '可调整客户、承运商、利润区间、线路和日期范围后重新查询。'
      }"
      focusable
    />
    <WaybillProfitAnalysisDrawer ref="profitAnalysisDrawerRef" />
  </div>
</template>

<script setup lang="tsx">
  import { ElTag } from 'element-plus'
  import ArtTooltip from '@/components/core/feedback/art-tooltip/index.vue'
  import type { SearchFormItem } from '@/components/core/forms/art-search-bar/index.vue'
  import type {
    ArtTableQueryExcelColumn,
    ArtTableQueryExpose,
    ArtTableQueryHeaderAction
  } from '@/components/core/tables/art-table-query/index.vue'
  import type { ColumnOption } from '@/types'
  import WaybillProfitAnalysisDrawer from './modules/waybill-profit-analysis-drawer.vue'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { formatWithDayjs } from '@/utils/time'
  import { useUserStore } from '@/store/modules/user'
  import { exportWaybillProfitList, fetchWaybillProfitList } from '@fms/api'
  import BusinessWorkspaceHeader from '@/components/business/business-workspace-header/index.vue'
  import BusinessTableWorkspaceActions from '@/components/business/business-table-workspace-actions/index.vue'
  import {
    canViewField,
    isMaskedValue,
    mergeFieldAccessMaps,
    formatSensitiveNumberWithAffix
  } from '@/utils/field-permission'

  defineOptions({ name: 'FinanceWaybillProfit' })

  type WaybillProfit = Api.Fms.WaybillProfitRecord
  type SearchParams = Api.Fms.WaybillProfitSearchParams
  type TableParams = SearchParams & Pick<Api.Common.PaginationParams, 'current' | 'size'>

  interface ProfitAnalysisDrawerExpose {
    handleOpen: () => Promise<void>
  }

  const userStore = useUserStore()
  const { getDictMap } = storeToRefs(userStore)
  onMounted(() => void userStore.ensureDictLoaded('tmsWaybillStatus').catch(() => undefined))
  const tableQueryRef = ref<ArtTableQueryExpose>()
  const profitAnalysisDrawerRef = ref<ProfitAnalysisDrawerExpose>()
  const profitFieldAccess = ref<Api.Fms.WaybillProfitFieldAccessMap>({})

  const searchQuery = ref<SearchParams>({
    keyword: '',
    waybillStatus: '',
    completedAtRange: []
  })

  const searchItems = computed<SearchFormItem[]>(() => [
    {
      label: '运单状态',
      key: 'waybillStatus',
      type: 'select',
      span: 5,
      props: {
        options: getDictMap.value.tmsWaybillStatus ?? [],
        placeholder: '全部状态',
        clearable: true
      }
    },
    {
      label: '完成日期',
      key: 'completedAtRange',
      type: 'date',
      span: 8,
      props: {
        type: 'daterange',
        valueFormat: 'YYYY-MM-DD',
        startPlaceholder: '开始日期',
        endPlaceholder: '结束日期',
        rangeSeparator: '至',
        class: '!w-full'
      }
    },
    {
      label: '关键词',
      key: 'keyword',
      type: 'input',
      span: 6,
      props: {
        clearable: true,
        placeholder: '运单号 / 客户'
      }
    }
  ])

  const columnsFactory = (): ColumnOption<WaybillProfit>[] => [
    { type: 'selection', width: 48, fixed: 'left', reserveSelection: true },
    {
      prop: 'waybillNo',
      label: '运单 / 线路',
      minWidth: 220,
      fixed: 'left',
      formatter: (row) => {
        const route = [row.originStation, row.destinationStation].filter(Boolean).join(' → ')
        return (
          <div class="flex min-w-0 flex-col gap-1">
            <strong
              class="truncate font-semibold text-[var(--el-text-color-primary)]"
              title={row.waybillNo}
            >
              {row.waybillNo || '未编号运单'}
            </strong>
            <small class="truncate text-[var(--el-text-color-secondary)]" title={route}>
              {route || '线路待补充'}
            </small>
          </div>
        )
      }
    },
    {
      prop: 'customerName',
      label: '客户 / 承运商',
      minWidth: 200,
      formatter: (row) => {
        const carrier = [row.carrierName, row.plateNo].filter(Boolean).join(' · ')
        return (
          <div class="flex min-w-0 flex-col gap-1">
            <strong
              class="truncate font-medium text-[var(--el-text-color-primary)]"
              title={row.customerName || ''}
            >
              {row.customerName || '未关联客户'}
            </strong>
            <small class="truncate text-[var(--el-text-color-secondary)]" title={carrier}>
              {carrier || '未关联承运商'}
            </small>
          </div>
        )
      }
    },
    {
      prop: 'waybillStatus',
      label: '状态',
      width: 104,
      dict: { code: 'tmsWaybillStatus', display: 'tag' }
    },
    {
      prop: 'completedAt',
      label: '完成日期',
      width: 112,
      formatter: (row) =>
        row.completedAt ? formatWithDayjs(row.completedAt, 'YYYY-MM-DD') : '未完成'
    },
    ...(canViewField(profitFieldAccess.value, 'receivableAmounts')
      ? [
          {
            prop: 'receivableAmount',
            label: '订单应收',
            width: 120,
            align: 'right' as const,
            formatter: (row: WaybillProfit) => (
              <strong class="tabular-nums font-medium">
                {formatSensitiveNumberWithAffix(row.receivableAmount, { prefix: '¥' })}
              </strong>
            )
          }
        ]
      : []),
    ...(canViewField(profitFieldAccess.value, 'costAmounts')
      ? [
          {
            prop: 'totalCostAmount',
            label: '已核成本',
            width: 128,
            align: 'right' as const,
            formatter: (row: WaybillProfit) => {
              const masked = isMaskedValue(row.totalCostAmount)
              const audited = !masked && Number(row.totalCostAmount) > 0
              const detail = masked
                ? '成本金额已脱敏'
                : `承运运费 ${formatSensitiveNumberWithAffix(row.carrierPayableAmount, { prefix: '¥' })} · 附加成本 ${formatSensitiveNumberWithAffix(row.otherCostAmount, { prefix: '¥' })}`
              return (
                <ArtTooltip content={detail} placement="top">
                  <div class="flex flex-col items-end gap-1">
                    <strong class="tabular-nums font-medium">
                      {formatSensitiveNumberWithAffix(row.totalCostAmount, { prefix: '¥' })}
                    </strong>
                    <ElTag size="small" type={masked ? 'info' : audited ? 'success' : 'warning'}>
                      {masked ? '已脱敏' : audited ? '已核成本' : '未核成本'}
                    </ElTag>
                  </div>
                </ArtTooltip>
              )
            }
          }
        ]
      : []),
    ...(canViewField(profitFieldAccess.value, 'profitAmounts')
      ? [
          {
            prop: 'grossProfit',
            label: '毛利 / 毛利率',
            width: 145,
            align: 'right' as const,
            formatter: (row: WaybillProfit) => {
              const margin = Number(row.grossMargin)
              const masked = isMaskedValue(row.grossMargin)
              const calculated = Number(row.totalCostAmount) > 0 && Number.isFinite(margin)
              const type = margin < 15 ? 'danger' : margin < 25 ? 'warning' : 'success'
              return (
                <div class="flex flex-col items-end gap-1">
                  <strong class="tabular-nums font-semibold text-[var(--el-text-color-primary)]">
                    {formatSensitiveNumberWithAffix(row.grossProfit, { prefix: '¥' })}
                  </strong>
                  <ElTag size="small" type={masked ? 'info' : calculated ? type : 'warning'}>
                    {masked ? '已脱敏' : calculated ? `${margin.toFixed(2)}%` : '待核算'}
                  </ElTag>
                </div>
              )
            }
          }
        ]
      : [])
  ]

  const excelColumns = computed<ArtTableQueryExcelColumn[]>(() => [
    { key: 'waybillNo', title: '运单号' },
    { key: 'originStation', title: '起始站' },
    { key: 'destinationStation', title: '目的站' },
    { key: 'customerName', title: '客户' },
    { key: 'carrierName', title: '承运商' },
    { key: 'plateNo', title: '车牌号' },
    { key: 'waybillStatus', title: '运单状态' },
    ...(canViewField(profitFieldAccess.value, 'receivableAmounts')
      ? [{ key: 'receivableAmount', title: '订单应收' }]
      : []),
    ...(canViewField(profitFieldAccess.value, 'costAmounts')
      ? [
          { key: 'carrierPayableAmount', title: '承运运费' },
          { key: 'otherCostAmount', title: '附加成本' },
          { key: 'totalCostAmount', title: '总成本' }
        ]
      : []),
    ...(canViewField(profitFieldAccess.value, 'profitAmounts')
      ? [
          { key: 'grossProfit', title: '毛利额' },
          { key: 'grossMargin', title: '毛利率(%)' }
        ]
      : []),
    { key: 'completedAt', title: '完成时间' }
  ])

  const headerActions = computed<ArtTableQueryHeaderAction[]>(() => [
    {
      permission: 'FinanceWaybillProfit:AiProfitAnalysis',
      key: 'ai-profit-analysis',
      label: 'AI 利润诊断',
      icon: 'ri:sparkling-2-line',
      buttonProps: { type: 'primary' },
      onClick: () => void profitAnalysisDrawerRef.value?.handleOpen()
    },
    {
      permission: 'FinanceWaybillProfit:Export',
      type: 'export',
      label: '导出利润明细',
      exportFilename: 'TMS运单利润明细',
      exportSheetName: '运单利润',
      exportColumns: excelColumns.value,
      exportApi: ({ selectedIds, searchParams, maxRows }) =>
        exportWaybillProfitList({
          ...(searchParams as SearchParams),
          ids: selectedIds.map(String),
          maxRows
        })
    }
  ])

  const fetchTableData = async (params: TableParams) => {
    const { from, to } = buildSupabasePageRange({ current: params.current, size: params.size })
    const result = await fetchWaybillProfitList({ ...params, from, to })
    profitFieldAccess.value = mergeFieldAccessMaps(
      result.fieldAccess,
      ...(result.data ?? []).map((row) => row.fieldAccess)
    )
    return result
  }
</script>
