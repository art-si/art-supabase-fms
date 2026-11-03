<template>
  <Teleport to="body">
    <div class="fms-reimbursement-print-batch" aria-hidden="true">
      <article v-for="record in records" :key="record.id" class="fms-reimbursement-print-sheet">
        <header>
          <h1>费用报销单</h1>
          <strong>{{ record.reimbursementNo }}</strong>
        </header>
        <dl class="fms-reimbursement-print-sheet__meta">
          <div
            ><dt>报销来源</dt
            ><dd>{{ record.sourceType === 'travel' ? '差旅费用' : '运单费用' }}</dd></div
          >
          <div
            ><dt>报销人</dt><dd>{{ record.applicantNameSnapshot || '—' }}</dd></div
          >
          <div
            ><dt>报销日期</dt><dd>{{ record.reimbursementDate || '—' }}</dd></div
          >
          <div
            ><dt>单据状态</dt><dd>{{ statusLabel(record.status) }}</dd></div
          >
          <div
            ><dt>费用承担部门</dt><dd>{{ record.expenseDepartmentNameSnapshot || '—' }}</dd></div
          >
          <div
            ><dt>计划付款日</dt><dd>{{ record.plannedPaymentDate || '—' }}</dd></div
          >
        </dl>
        <p v-if="record.reason" class="fms-reimbursement-print-sheet__reason"
          >事由：{{ record.reason }}</p
        >

        <table>
          <thead>
            <tr>
              <th>费用项目</th><th>项目 / 运单</th><th>费用日期</th><th>报销金额</th><th>税额</th
              ><th>核定金额</th>
            </tr>
          </thead>
          <tbody v-if="record.sourceType === 'travel'">
            <tr v-for="line in record.travelLines ?? []" :key="line.id">
              <td>{{ line.expenseItemNameSnapshot || '—' }}</td>
              <td>{{ line.projectNameSnapshot || '—' }}</td>
              <td>{{ line.occurredOn || '—' }}</td>
              <td class="fms-reimbursement-print-sheet__money">{{ money(line.grossAmount) }}</td>
              <td class="fms-reimbursement-print-sheet__money">{{ money(line.taxAmount) }}</td>
              <td class="fms-reimbursement-print-sheet__money">{{ money(line.approvedAmount) }}</td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="line in record.items ?? []" :key="line.id">
              <td>{{ line.expenseItemNameSnapshot || '—' }}</td>
              <td>{{ line.waybillNoSnapshot || '—' }}</td>
              <td>{{ line.occurredOnSnapshot || '—' }}</td>
              <td class="fms-reimbursement-print-sheet__money">{{ money(line.amountSnapshot) }}</td>
              <td class="fms-reimbursement-print-sheet__money">—</td>
              <td class="fms-reimbursement-print-sheet__money">—</td>
            </tr>
          </tbody>
        </table>

        <div class="fms-reimbursement-print-sheet__totals">
          <span
            >报销金额：<strong>{{ money(record.totalAmount) }}</strong></span
          >
          <span
            >核定金额：<strong>{{ money(record.approvedAmount) }}</strong></span
          >
          <span v-if="record.sourceType === 'travel'"
            >借款抵扣：<strong>{{ money(record.loanOffsetAmount) }}</strong></span
          >
          <span
            >付现金额：<strong>{{ money(record.cashPayableAmount) }}</strong></span
          >
        </div>
        <section v-if="record.sourceType === 'travel' && record.payees?.length">
          <h2>收款信息</h2>
          <table>
            <thead
              ><tr><th>收款人</th><th>开户银行</th><th>银行账号</th><th>收款金额</th></tr></thead
            >
            <tbody>
              <tr v-for="payee in record.payees" :key="payee.id">
                <td>{{ payee.payeeNameSnapshot || '—' }}</td>
                <td>{{ payee.bankNameSnapshot || '—' }}</td>
                <td>{{ payee.bankAccountSnapshot || '—' }}</td>
                <td class="fms-reimbursement-print-sheet__money">{{ money(payee.amount) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <footer>
          <span>申请人：{{ record.applicantNameSnapshot || '—' }}</span>
          <span>审批人：{{ record.reviewedBy || '—' }}</span>
          <span>付款人：{{ record.paidBy || '—' }}</span>
        </footer>
      </article>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
  import { usePrintSheet } from '@/hooks/core/usePrintSheet'
  import { formatCurrencyValue } from '@/utils/ui'

  type Reimbursement = Api.Fms.ExpenseReimbursementRecord
  const records = ref<Reimbursement[]>([])
  const { print: printSheet } = usePrintSheet('is-fms-reimbursement-printing', () => {
    records.value = []
  })
  const statusLabels: Record<string, string> = {
    draft: '草稿',
    pending_review: '待审核',
    approved: '已审核，等待付款',
    rejected: '已驳回',
    partially_paid: '部分付款',
    paid: '已付款',
    cancelled: '已作废'
  }
  const statusLabel = (status: string): string => statusLabels[status] ?? '未知状态'
  const money = (value: Api.Fms.SensitiveNumber | undefined): string =>
    typeof value === 'number' ? formatCurrencyValue(value) : value === '***' ? '***' : '—'

  async function print(rows: Reimbursement[]): Promise<void> {
    records.value = rows
    await printSheet()
  }
  defineExpose({ print })
</script>

<style lang="scss">
  .fms-reimbursement-print-batch {
    display: none;
  }

  @media print {
    body.is-fms-reimbursement-printing {
      background: #fff;

      > *:not(.fms-reimbursement-print-batch) {
        display: none !important;
      }

      > .fms-reimbursement-print-batch {
        display: block !important;
      }
    }

    .fms-reimbursement-print-sheet {
      padding: 12mm;
      font: 10pt/1.45 sans-serif;
      color: #111827;
      break-after: page;

      header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        padding-bottom: 6mm;
        border-bottom: 2px solid #111827;
      }

      h1 {
        margin: 0;
        font-size: 18pt;
      }

      h2 {
        margin: 7mm 0 2mm;
        font-size: 11pt;
      }

      table {
        width: 100%;
        margin-top: 5mm;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 2mm;
        vertical-align: top;
        text-align: left;
        border: 1px solid #d1d5db;
      }

      th {
        background: #f3f4f6;
      }

      footer {
        display: flex;
        gap: 6mm;
        justify-content: space-between;
        margin-top: 10mm;
      }
    }

    .fms-reimbursement-print-sheet:last-child {
      break-after: auto;
    }

    .fms-reimbursement-print-sheet__meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2mm 6mm;
      margin: 5mm 0;

      div {
        display: flex;
        gap: 2mm;
      }

      dt {
        color: #4b5563;
      }

      dd {
        margin: 0;
      }
    }

    .fms-reimbursement-print-sheet__reason {
      margin: 4mm 0;
    }

    .fms-reimbursement-print-sheet__money {
      text-align: right;
      white-space: nowrap;
    }

    .fms-reimbursement-print-sheet__totals {
      display: flex;
      flex-wrap: wrap;
      gap: 7mm;
      justify-content: flex-end;
      margin-top: 5mm;
    }
  }
</style>
