<template>
  <PurchasePayableWorkspace
    kind="estimated"
    :permissions="{
      View: 'FinanceEstimatedPayable:View',
      Add: 'FinanceEstimatedPayable:Add',
      Edit: 'FinanceEstimatedPayable:Edit',
      Submit: 'FinanceEstimatedPayable:Submit',
      Approve: 'FinanceEstimatedPayable:Approve',
      Delete: 'FinanceEstimatedPayable:Delete',
      Import: 'FinanceEstimatedPayable:Import',
      Push: 'FinanceEstimatedPayable:Push',
      Voucher: 'FinanceEstimatedPayable:Voucher',
      Print: 'FinanceEstimatedPayable:Print',
      Export: 'FinanceEstimatedPayable:Export',
      Accrual: 'FinanceEstimatedPayable:Accrual',
      AccrualDelete: 'FinanceEstimatedPayable:AccrualDelete',
      AccrualExecute: 'FinanceEstimatedPayable:AccrualExecute'
    }"
  />
</template>
<script setup lang="ts">
  import PurchasePayableWorkspace from '@/components/business/purchase-payable-workspace/index.vue'
  defineOptions({ name: 'FinanceEstimatedPayable' })
</script>
