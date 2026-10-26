import type { MasterDataDeleteDependencyMeta } from '@/components/business/master-data-delete-guard/index.vue'
import { financePaths } from '@/router/business-paths'

type ArDeleteKind = 'estimate' | 'financial' | 'receipt' | 'refund' | 'revenue' | 'payment_request'

/** Parent and line removal share the same protected business-reference navigation. */
export function createArDeleteMetadata(
  kind: ArDeleteKind,
  hasAuth: (permission: string) => boolean
): Record<string, MasterDataDeleteDependencyMeta> {
  const routes = {
    estimate: {
      path: financePaths.estimatedReceivable,
      permission: 'FinanceEstimatedReceivable:View',
      label: '暂估应收'
    },
    financial: {
      path: financePaths.financialReceivable,
      permission: 'FinanceFinancialReceivable:View',
      label: '财务应收'
    },
    receipt: { path: financePaths.receipt, permission: 'FinanceReceipt:View', label: '收款单' },
    refund: {
      path: financePaths.receiptRefund,
      permission: 'FinanceReceiptRefund:View',
      label: '退款单'
    },
    revenue: {
      path: financePaths.revenueCost,
      permission: 'FinanceRevenueCost:View',
      label: '收入成本确认'
    },
    payment_request: {
      path: financePaths.receivablePaymentRequest,
      permission: 'FinanceReceivablePaymentRequest:View',
      label: '付款申请'
    },
    payable_application: {
      path: financePaths.payableApplication,
      permission: 'FinancePayableApplication:View',
      label: '销售退款付款申请'
    },
    payable_payment: {
      path: financePaths.payablePayment,
      permission: 'FinancePayablePayment:View',
      label: '销售退款付款'
    },
    payable_refund: {
      path: financePaths.payableRefund,
      permission: 'FinancePayableRefund:View',
      label: '付款退款'
    }
  }
  const metadata: Record<string, MasterDataDeleteDependencyMeta> = {}
  for (const [code, route] of Object.entries(routes)) {
    metadata[code] = {
      label: route.label,
      unit: '张',
      description: '请先核对关联单据，业务历史需保留。',
      actionLabel: '查看单据',
      routePath: route.path,
      routeQuery: (row) => ({ recordId: row.targetId }),
      canNavigate: () => hasAuth(route.permission),
      order: 1
    }
  }
  metadata.document_state = {
    ...metadata[kind],
    label: '单据状态限制',
    description: '仅草稿可删除，已提交、审核、收付款及冲回记录须保留业务历史。',
    order: 0
  }
  metadata.adjustment = {
    label: '应收调整',
    unit: '张',
    description: '请先核对应收调整记录。',
    actionLabel: '查看调整',
    routeName: 'FinanceFinancialReceivable',
    routeQuery: (row) => ({ recordId: '', adjustmentId: row.targetId }),
    canNavigate: () => hasAuth('FinanceFinancialReceivable:View'),
    order: 2
  }
  return metadata
}
