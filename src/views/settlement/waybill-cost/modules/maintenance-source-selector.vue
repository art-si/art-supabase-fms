<template>
  <ArtTableSingleSelect
    v-model="selectedId"
    v-model:selected-data="selection.rows"
    :api-fn="fetchRows"
    :columns="columns"
    :disabled="!waybillId"
    row-key="id"
    label-key="maintenanceNo"
    description-key="plateNo"
    title="选择维修来源"
    subtitle="仅列出该运单车辆已完成、金额可查看且尚未归集的维修记录。"
    placeholder="可选：关联已完成的维修记录"
    search-placeholder="维修单号"
    empty-text="暂无可归集维修记录"
    empty-description="请核对车辆、维修结束时间与费用查看权限，已归集记录不再列出。"
    show-pagination
    :page-size="10"
    @confirm="confirm"
    @clear="emit('clear')"
  />
</template>
<script setup lang="ts">
  import ArtTableSingleSelect from '@/components/core/forms/art-data-select/table-single.vue'
  import type {
    DataSelectFetchParams,
    DataSelectColumn,
    DataSelectModelValue
  } from '@/components/core/forms/art-data-select/types'
  import { buildSupabasePageRange } from '@/utils/supabase/pagination'
  import { isPlainObjectRecord } from '@/utils/type-guards'
  import { formatWithDayjs } from '@/utils/time'
  import {
    fetchMaintenanceCostSources,
    type MaintenanceCostSource
  } from '@fms/api/modules/transport/maintenance-cost-sources'

  const props = defineProps<{ waybillId: string }>()
  const selection = reactive<{ id: DataSelectModelValue; rows: MaintenanceCostSource[] }>({
    id: undefined,
    rows: []
  })
  const selectedId = computed({
    get: () => (Array.isArray(selection.id) ? selection.id[0] : selection.id),
    set: (value: DataSelectModelValue) => {
      selection.id = Array.isArray(value) ? value[0] : value
    }
  })
  const emit = defineEmits<{ select: [source: { id: string; amount: number }]; clear: [] }>()
  const columns: DataSelectColumn<MaintenanceCostSource>[] = [
    { prop: 'maintenanceNo', label: '维修单号', minWidth: 170 },
    { prop: 'plateNo', label: '车牌', minWidth: 130 },
    { prop: 'costAmount', label: '维修金额（元）', minWidth: 140, align: 'right' },
    {
      prop: 'endTime',
      label: '完成时间',
      minWidth: 190,
      formatter: (row) => formatWithDayjs(row.endTime) ?? '—'
    },
    { prop: 'workshop', label: '维修厂', minWidth: 160 }
  ]
  function fetchRows(params: DataSelectFetchParams) {
    if (!props.waybillId) return { data: [], total: 0 }
    const { from, to } = buildSupabasePageRange({ current: params.page, size: params.pageSize })
    return fetchMaintenanceCostSources({
      waybillId: props.waybillId,
      keyword: params.keyword,
      offset: from,
      limit: to - from + 1
    })
  }
  function confirm(_key: unknown, rows: unknown[]): void {
    const row = rows[0]
    if (
      !isPlainObjectRecord(row) ||
      typeof row.id !== 'string' ||
      typeof row.costAmount !== 'number' ||
      !Number.isFinite(row.costAmount)
    )
      return
    emit('select', { id: row.id, amount: row.costAmount })
  }
</script>
