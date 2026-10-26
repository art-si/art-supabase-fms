<template>
  <PurchasePayableWorkspace
    kind="financial"
    :permissions="{
      View: 'FinancePurchasePayable:View',
      Add: 'FinancePurchasePayable:Add',
      Edit: 'FinancePurchasePayable:Edit',
      Submit: 'FinancePurchasePayable:Submit',
      Approve: 'FinancePurchasePayable:Approve',
      Delete: 'FinancePurchasePayable:Delete',
      Import: 'FinancePurchasePayable:Import',
      Push: 'FinancePurchasePayable:Push',
      Voucher: 'FinancePurchasePayable:Voucher',
      Print: 'FinancePurchasePayable:Print',
      Export: 'FinancePurchasePayable:Export',
      Freeze: 'FinancePurchasePayable:Freeze',
      CostMatch: 'FinancePurchasePayable:CostMatch'
    }"
  />
</template>
<script setup lang="ts">
  import PurchasePayableWorkspace from '@/components/business/purchase-payable-workspace/index.vue'
  defineOptions({ name: 'FinancePurchasePayable' })
</script>
