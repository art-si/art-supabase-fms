<template>
  <div class="w-full min-w-0 space-y-3">
    <div v-for="(row, index) in rows" :key="index" class="flex min-w-0 items-start gap-2">
      <ArtForm
        class="min-w-0 flex-1"
        root-class="p-0!"
        :model-value="row"
        :items="items"
        :span="12"
        :gutter="12"
        label-position="top"
        :show-reset="false"
        :show-submit="false"
        @update:model-value="updateRow(row, $event)"
      />
      <ElButton
        v-auth="'FinancePayroll:Calculate'"
        class="self-end mb-3"
        plain
        @click="rows.splice(index, 1)"
      >
        移除
      </ElButton>
    </div>
    <ElButton
      v-auth="'FinancePayroll:Calculate'"
      plain
      @click="rows.push({ name: '', amount: null })"
      >添加项目</ElButton
    >
  </div>
</template>
<script setup lang="ts">
  import ArtForm, { type FormItem } from '@/components/core/forms/art-form/index.vue'
  import type { PayrollItemRow } from './payroll-items'
  const rows = defineModel<PayrollItemRow[]>({ required: true })
  function updateRow(row: PayrollItemRow, value: Record<string, unknown>) {
    if (typeof value.name === 'string') row.name = value.name
    if (typeof value.amount === 'number' || value.amount === null) row.amount = value.amount
  }
  const items: FormItem[] = [
    {
      label: '项目名称',
      key: 'name',
      type: 'input',
      props: { maxlength: 60, placeholder: '例如：基本工资、提成、违章扣款' }
    },
    {
      label: '金额',
      key: 'amount',
      type: 'number',
      props: { min: 0, precision: 2, controlsPosition: 'right', class: '!w-full' }
    }
  ]
</script>
