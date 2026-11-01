<template>
  <div class="w-full min-w-0 space-y-3">
    <ArtTable
      ref="tableRef"
      :data="rows"
      :columns="columns"
      :pagination="false"
      :height="rows.length > 5 ? 300 : undefined"
    >
      <template #name="{ row }"
        ><ElInput
          v-model="row.name"
          aria-label="项目名称"
          maxlength="60"
          placeholder="例如：基本工资、提成、违章扣款"
      /></template>
      <template #amount="{ row }"
        ><ElInputNumber
          v-model="row.amount"
          aria-label="金额"
          :min="0"
          :precision="2"
          controls-position="right"
          class="w-full!"
      /></template>
      <template #operation="{ $index }"
        ><ElButton v-auth="'FinancePayroll:Calculate'" plain @click="rows.splice($index, 1)"
          >移除</ElButton
        ></template
      >
    </ArtTable>
    <ElButton
      v-auth="'FinancePayroll:Calculate'"
      plain
      @click="rows.push({ name: '', amount: null })"
      >添加项目</ElButton
    >
  </div>
</template>
<script setup lang="ts">
  import { ElButton, ElInput, ElInputNumber } from 'element-plus'
  import ArtTable, { type ArtTableExpose } from '@/components/core/tables/art-table/index.vue'
  import type { ColumnOption } from '@/types'
  import { normalizeNonNullableText } from '@/utils/form/normalize'
  import type { PayrollItemRow } from './payroll-items'
  const rows = defineModel<PayrollItemRow[]>({ required: true })
  const tableRef = ref<ArtTableExpose<PayrollItemRow>>()
  const columns: ColumnOption<PayrollItemRow>[] = [
    {
      prop: 'name',
      label: '项目名称',
      minWidth: 220,
      useSlot: true,
      required: true,
      headerTooltip: '项目名称不能为空；同一收入、扣款或企业成本列表内不能重复。',
      rules: {
        validator: ({ value }) => {
          if (typeof value !== 'string') return '请填写有效的薪酬项目名称'
          const name = normalizeNonNullableText(value)
          return rows.value.filter((row) => normalizeNonNullableText(row.name) === name).length <= 1
        },
        message: ({ row }) =>
          '薪酬项目“' +
          normalizeNonNullableText(typeof row.name === 'string' ? row.name : '') +
          '”重复，请合并后保存'
      }
    },
    {
      prop: 'amount',
      label: '金额',
      width: 170,
      useSlot: true,
      required: true,
      headerTooltip: '填写有效的非负金额，最多保留两位小数。',
      rules: {
        type: 'number',
        min: 0,
        message: ({ rowIndex }) => '第 ' + (rowIndex + 1) + ' 行请填写有效的非负金额'
      }
    },
    { prop: 'operation', label: '操作', width: 78, useSlot: true }
  ]
  const validate: ArtTableExpose<PayrollItemRow>['validate'] = async (options) =>
    (await tableRef.value?.validate(options)) ?? { valid: false, errors: [] }
  defineExpose({ validate })
</script>
