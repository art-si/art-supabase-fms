import type { MasterDataDeleteResource } from '@/components/business/master-data-delete-guard/index.vue'
import { financePaths, getExpenseReimbursementDetailPath } from '@/router/business-paths'
import {
  fetchExpenseReimbursementDetail,
  fetchTravelApplicationDetail,
  fetchTravelLoanDetail,
  fetchTravelRepaymentDetail
} from '@fms/api'

type ExpenseDocumentKind = 'application' | 'loan' | 'repayment' | 'reimbursement'

export function canDeleteExpenseDocument(
  kind: ExpenseDocumentKind,
  document: { status?: unknown; sourceType?: unknown }
): boolean {
  return kind === 'reimbursement'
    ? document.sourceType === 'travel' &&
        (document.status === 'draft' || document.status === 'rejected')
    : document.status === 'draft'
}

/** Re-read document state for deletion checks and retries; backend deletion remains authoritative. */
export async function resolveExpenseDeleteResources(
  kind: ExpenseDocumentKind,
  ids: string[]
): Promise<MasterDataDeleteResource[]> {
  return Promise.all(
    ids.map(async (id): Promise<MasterDataDeleteResource> => {
      switch (kind) {
        case 'application': {
          const { data } = await fetchTravelApplicationDetail(id)
          if (!data) throw new Error('出差申请已变化，请重新查询后重试')
          return {
            id,
            label: data.applicationNo,
            status: data.status,
            statusDictCode: 'fmsExpenseDocumentStatus',
            blockReason: canDeleteExpenseDocument(kind, data)
              ? undefined
              : '仅草稿可删除，已提交的申请需保留业务历史。',
            to: { path: financePaths.travelApplication, query: { applicationId: id } }
          }
        }
        case 'loan': {
          const { data } = await fetchTravelLoanDetail(id)
          if (!data) throw new Error('借款单已变化，请重新查询后重试')
          return {
            id,
            label: data.loanNo,
            status: data.status,
            statusDictCode: 'fmsExpenseDocumentStatus',
            blockReason: canDeleteExpenseDocument(kind, data)
              ? undefined
              : '仅草稿可删除，已提交或已结算的借款需保留业务历史。',
            to: { path: financePaths.loanApplication, query: { loanId: id } }
          }
        }
        case 'repayment': {
          const { data } = await fetchTravelRepaymentDetail(id)
          if (!data) throw new Error('还款单已变化，请重新查询后重试')
          return {
            id,
            label: data.repaymentNo,
            status: data.status,
            statusDictCode: 'fmsRepaymentStatus',
            blockReason: canDeleteExpenseDocument(kind, data)
              ? undefined
              : '仅草稿可删除，已提交或已收款的还款单需保留业务历史。',
            to: { path: financePaths.repayment, query: { openRepayment: id } }
          }
        }
        case 'reimbursement': {
          const { data } = await fetchExpenseReimbursementDetail(id)
          if (!data) throw new Error('报销单已变化，请重新查询后重试')
          return {
            id,
            label: data.reimbursementNo,
            status: data.status,
            statusDictCode: 'tmsReimbursementApprovalStatus',
            blockReason:
              data.sourceType !== 'travel'
                ? '运单费用报销需在原业务中处理，不能从人人费用删除。'
                : canDeleteExpenseDocument(kind, data)
                  ? undefined
                  : '仅草稿或已驳回的差旅报销单可删除，审批及付款历史需保留。',
            to: getExpenseReimbursementDetailPath(id)
          }
        }
      }
    })
  )
}
