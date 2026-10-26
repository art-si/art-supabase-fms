<template>
  <PayableSettlementWorkspace
    kind="payment"
    :permissions="{
      View: 'FinancePayablePayment:View',
      Add: 'FinancePayablePayment:Add',
      Edit: 'FinancePayablePayment:Edit',
      Submit: 'FinancePayablePayment:Submit',
      Approve: 'FinancePayablePayment:Approve',
      Delete: 'FinancePayablePayment:Delete',
      Push: 'FinancePayablePayment:Push',
      GuaranteeConvert: 'FinancePayablePayment:GuaranteeConvert',
      Confirm: 'FinancePayablePayment:Confirm',
      Voucher: 'FinancePayablePayment:Voucher',
      Void: 'FinancePayablePayment:Void',
      Print: 'FinancePayablePayment:Print',
      Export: 'FinancePayablePayment:Export'
    }"
  />
</template>
<script setup lang="ts">
  import PayableSettlementWorkspace from '@/components/business/payable-settlement-workspace/index.vue'
  defineOptions({ name: 'FinancePayablePayment' })
</script>
