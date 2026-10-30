import { useSupabase } from '@/hooks/core/useSupabase'
import { withRequestOptions } from '@/api/providers/supabase/query'
import type { ApiRequestOptions } from '@/types/api/request'
import { buildOrIlikeFilter } from '@/utils/supabase/search'
import { normalizeNullableText } from '@/utils/form/normalize'
import type { TravelLoan, TravelLoanItem } from './travel-loan'

export interface TravelRepaymentItem {
  id: string
  tenantId: string
  repaymentId: string
  loanItemId: string
  lineNo: number
  expenseItemId: string
  expenseItemName: string
  loanPurpose: string
  currencyCode: string
  exchangeRate: number
  amount: number
  baseAmount: number
  remark: string | null
}

export interface TravelRepaymentReceipt {
  id: string
  isDemo: boolean
  amount: number
  receiptDate: string
  bankReference: string | null
  remark: string | null
  createTime: string
}

export interface TravelRepayment {
  id: string
  tenantId: string
  repaymentNo: string
  loanId: string
  applicantEmployeeId: string
  applicantName: string
  applicantAvatarUrl: string | null
  positionName: string | null
  applicantCompanyName: string
  expenseDepartmentName: string
  expenseCompanyName: string
  repaymentDate: string
  reason: string
  amount: number
  approvedAmount: number | null
  receivedAmount: number
  status: string
  isDemo: boolean
  currentHandler: string | null
  receiptDate: string | null
  rejectionOpinion: string | null
  payerName: string | null
  payerBank: string | null
  bankAccount: string | null
  remark: string | null
  attachmentUrls: string[]
  createTime: string
  loan?: Pick<
    TravelLoan,
    'loanNo' | 'loanAmount' | 'paidAmount' | 'reimbursedAmount' | 'remainingBalance' | 'paymentDate'
  >
  items?: TravelRepaymentItem[]
  receipts?: TravelRepaymentReceipt[]
}

export interface TravelRepaymentLine extends TravelRepaymentItem {
  repayment: TravelRepayment
}

export interface TravelRepaymentSearch {
  repaymentDateRange?: [string, string] | []
  applicantEmployeeId?: string
  status?: string
  keyword?: string
  tenantId?: string | null
  from?: number
  to?: number
}

export interface TravelRepaymentInput {
  id?: string
  tenantId: string
  loanId: string
  repaymentDate: string
  reason: string
  payerName: string | null
  payerBank: string | null
  bankAccount: string | null
  remark: string | null
  attachmentUrls: string[]
}

export type TravelRepaymentItemInput = Pick<
  TravelRepaymentItem,
  'loanItemId' | 'amount' | 'remark'
> & { id?: string }

export interface RepayableLoan extends TravelLoan {
  items: TravelLoanItem[]
}

const { supabase, keysToSnakeDeep, responseHandle } = useSupabase()

export async function fetchTravelRepaymentList(
  params: TravelRepaymentSearch = {},
  options?: ApiRequestOptions
) {
  let query = supabase
    .from('fms_travel_repayment')
    .select(
      '*,loan:fms_travel_loan(loan_no,loan_amount,paid_amount,reimbursed_amount,remaining_balance,payment_date)',
      {
        count: 'exact'
      }
    )
    .order('repayment_date', { ascending: false })
    .order('create_time', { ascending: false })
    .range(params.from ?? 0, params.to ?? 9)
  if (params.tenantId) query = query.eq('tenant_id', params.tenantId)
  if (params.repaymentDateRange?.[0])
    query = query.gte('repayment_date', params.repaymentDateRange[0])
  if (params.repaymentDateRange?.[1])
    query = query.lte('repayment_date', params.repaymentDateRange[1])
  if (params.applicantEmployeeId)
    query = query.eq('applicant_employee_id', params.applicantEmployeeId)
  if (params.status) query = query.eq('status', params.status)
  if (params.keyword?.trim())
    query = query.or(
      buildOrIlikeFilter(['repayment_no', 'applicant_name', 'reason'], params.keyword)
    )
  return responseHandle<TravelRepayment[]>(() => withRequestOptions(query, options), {
    breakReturn: true,
    showErrorMessage: false,
    errorMessage: '还款单加载失败，请检查网络后重试'
  })
}

export async function fetchTravelRepaymentLineList(
  params: TravelRepaymentSearch = {},
  options?: ApiRequestOptions
) {
  let query = supabase
    .from('fms_travel_repayment_item')
    .select('*,repayment:fms_travel_repayment!inner(*)', { count: 'exact' })
    .order('create_time', { ascending: false })
    .order('line_no', { ascending: true })
    .range(params.from ?? 0, params.to ?? 9)
  if (params.tenantId) query = query.eq('tenant_id', params.tenantId)
  if (params.repaymentDateRange?.[0])
    query = query.gte('repayment.repayment_date', params.repaymentDateRange[0])
  if (params.repaymentDateRange?.[1])
    query = query.lte('repayment.repayment_date', params.repaymentDateRange[1])
  if (params.applicantEmployeeId)
    query = query.eq('repayment.applicant_employee_id', params.applicantEmployeeId)
  if (params.status) query = query.eq('repayment.status', params.status)
  if (params.keyword?.trim())
    query = query.or(
      buildOrIlikeFilter(['repayment_no', 'applicant_name', 'reason'], params.keyword),
      { referencedTable: 'repayment' }
    )
  return responseHandle<TravelRepaymentLine[]>(() => withRequestOptions(query, options), {
    breakReturn: true,
    showErrorMessage: false,
    errorMessage: '还款明细加载失败，请检查网络后重试'
  })
}

export async function fetchTravelRepaymentDetail(id: string) {
  return responseHandle<TravelRepayment>(
    () =>
      supabase
        .from('fms_travel_repayment')
        .select(
          '*,items:fms_travel_repayment_item(*),receipts:fms_travel_repayment_receipt(*),loan:fms_travel_loan(loan_no,loan_amount,paid_amount,reimbursed_amount,remaining_balance,payment_date)'
        )
        .eq('id', id)
        .single(),
    { breakReturn: true, showErrorMessage: false, errorMessage: '还款单详情加载失败，请重试' }
  )
}

export async function fetchRepayableLoans(tenantId: string) {
  return responseHandle<RepayableLoan[]>(
    () => supabase.rpc('fms_list_repayable_loans_secure', { p_tenant_id: tenantId }),
    { showErrorMessage: false, errorMessage: '可还款借款单加载失败，请重试' }
  )
}

export async function saveTravelRepaymentDraft(
  input: TravelRepaymentInput,
  items: TravelRepaymentItemInput[]
) {
  return responseHandle<{ id: string; repaymentNo: string; status: string; amount: number }>(
    () =>
      supabase.rpc('save_fms_travel_repayment_draft_entry_secure', {
        p_payload: keysToSnakeDeep({
          ...input,
          reason: input.reason.trim(),
          remark: normalizeNullableText(input.remark)
        }),
        p_items: keysToSnakeDeep(items)
      }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '还款单保存失败，请核对明细后重试' }
  )
}

export async function submitTravelRepayment(id: string) {
  return responseHandle<{ id: string; status: string }>(
    () => supabase.rpc('submit_fms_travel_repayment_secure', { p_id: id }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '还款单提交失败，请刷新后重试' }
  )
}

export async function deleteTravelRepayments(ids: string[]) {
  return responseHandle<number>(
    () => supabase.rpc('delete_fms_travel_repayments_secure', { p_ids: ids }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '还款单删除失败，请重试' }
  )
}

export async function recordTravelRepaymentCollection(input: {
  repaymentId: string
  idempotencyKey: string
  amount: number
  receiptDate: string
  bankReference: string | null
  remark: string | null
}) {
  return responseHandle<{ id: string; receivedAmount: number; status: string }>(
    () =>
      supabase.rpc('record_fms_travel_repayment_collection_secure', {
        p_repayment_id: input.repaymentId,
        p_idempotency_key: input.idempotencyKey,
        p_amount: input.amount,
        p_receipt_date: input.receiptDate,
        p_bank_reference: normalizeNullableText(input.bankReference),
        p_remark: normalizeNullableText(input.remark)
      }),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '还款收款登记失败，请核对金额后重试'
    }
  )
}
