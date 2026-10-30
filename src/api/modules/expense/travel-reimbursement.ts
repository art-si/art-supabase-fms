import { useSupabase } from '@/hooks/core/useSupabase'
import { withRequestOptions } from '@/api/providers/supabase/query'
import type { ApiRequestOptions } from '@/types/api/request'
import { normalizeNullableText } from '@/utils/form/normalize'
import { buildSupabaseRpcRange } from '@/utils/supabase/pagination'
import type { LoanPayeeOption } from './travel-loan'

export interface ReimbursementLoanOption {
  id: string
  tenantId: string
  loanNo: string
  applicantEmployeeId: string
  applicantName: string
  reason: string
  assignmentId: string | null
  expenseDepartmentId: string
  isDemo: boolean
  availableAmount: number
  paidAmount: number
  repaidAmount: number
  reimbursedAmount: number
  remainingBalance: number
}

export async function fetchReimbursementLoanOptions(
  tenantId: string,
  employeeId: string,
  reimbursementId?: string
) {
  return responseHandle<ReimbursementLoanOption[]>(
    () =>
      supabase.rpc('fms_list_reimbursement_loan_options_secure', {
        p_tenant_id: tenantId,
        p_applicant_employee_id: employeeId,
        p_reimbursement_id: reimbursementId ?? null
      }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '可抵扣借款加载失败，请重试' }
  )
}

export interface ReimbursementWorkspaceSearch {
  from?: number
  to?: number
  keyword?: string
  status?: string
  sourceType?: 'waybill' | 'travel'
  applicantEmployeeId?: string
  applicantName?: string
  reimbursementDateRange?: [string, string] | []
}

export interface ReimbursementWorkspaceLine {
  id: string
  reimbursementId: string
  lineNo: number
  sourceType: 'waybill' | 'travel'
  expenseItemName: string
  projectName: string | null
  occurredOn: string
  grossAmount?: Api.Fms.SensitiveNumber
  taxRate: number
  taxAmount?: Api.Fms.SensitiveNumber
  netAmount?: Api.Fms.SensitiveNumber
  approvedAmount?: Api.Fms.SensitiveNumber
  invoiceNo?: string | null
  reimburseeName?: string | null
  waybillNo?: string | null
  reimbursement: Api.Fms.ExpenseReimbursementRecord
}

export interface TravelReimbursementDraftInput {
  id?: string
  tenantId: string
  applicantEmployeeId: string
  assignmentId: string | null
  reimbursementDate: string
  expenseDepartmentId: string | null
  travelApplicationId: string | null
  travelLoanId: string | null
  loanOffsetAmount: number
  multipleReimbursees: boolean
  isProjectExpense: boolean
  projectId: string | null
  plannedPaymentDate: string
  reason: string
  remark: string | null
  attachmentUrls: string[]
}

export interface TravelReimbursementLineInput {
  id?: string
  expenseItemId: string
  projectId: string | null
  occurredOn: string
  grossAmount: number
  taxRate: number
  taxAmount: number
  invoiceNo: string | null
  reimburseeEmployeeId: string | null
  remark: string | null
}

export interface TravelReimbursementPayeeInput {
  id?: string
  settlementMethod: string
  payeeType: 'person'
  payeeInformationId: string
  bankAccount: string
  accountName: string | null
  bankName: string
  amount: number
  remark: string | null
}

export interface TravelReimbursementPaymentInput {
  reimbursementId: string
  payeeId: string
  fundAccountId: string
  amount: number
  paymentDate: string
  bankReference: string
  demo: boolean
  voucherUrls?: string[]
  idempotencyKey: string
  remark: string | null
}

interface SecureListPayload {
  records: Api.Fms.ExpenseReimbursementRecord[]
  total: number
  fieldAccess?: Api.Fms.ExpenseReimbursementFieldAccessMap
}

interface SecureLineListPayload {
  records: ReimbursementWorkspaceLine[]
  total: number
  fieldAccess?: Api.Fms.ExpenseReimbursementFieldAccessMap
}

const { supabase, keysToSnakeDeep, responseHandle } = useSupabase()

export async function fetchReimbursementWorkspaceList(
  params: ReimbursementWorkspaceSearch = {},
  options?: ApiRequestOptions
) {
  const result = await responseHandle<SecureListPayload>(
    () =>
      withRequestOptions(
        supabase.rpc('fms_list_expense_reimbursements_secure', {
          ...buildSupabaseRpcRange(params.from ?? 0, params.to ?? 9),
          p_keyword: normalizeNullableText(params.keyword),
          p_status: params.status || null,
          p_source_type: params.sourceType || null,
          p_applicant_employee_id: params.applicantEmployeeId || null,
          p_applicant_name: normalizeNullableText(params.applicantName),
          p_reimbursement_date_start: params.reimbursementDateRange?.[0] || null,
          p_reimbursement_date_end: params.reimbursementDateRange?.[1] || null
        }),
        options
      ),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '费用报销单加载失败，请检查网络后重试'
    }
  )
  return {
    data: result.data?.records ?? [],
    total: result.data?.total ?? 0,
    error: result.error,
    fieldAccess: result.data?.fieldAccess ?? {}
  }
}

export async function fetchReimbursementWorkspaceLines(
  params: ReimbursementWorkspaceSearch = {},
  options?: ApiRequestOptions
) {
  const result = await responseHandle<SecureLineListPayload>(
    () =>
      withRequestOptions(
        supabase.rpc('fms_list_expense_reimbursement_lines_secure', {
          ...buildSupabaseRpcRange(params.from ?? 0, params.to ?? 9),
          p_keyword: normalizeNullableText(params.keyword),
          p_status: params.status || null,
          p_source_type: params.sourceType || null,
          p_applicant_name: normalizeNullableText(params.applicantName),
          p_reimbursement_date_start: params.reimbursementDateRange?.[0] || null,
          p_reimbursement_date_end: params.reimbursementDateRange?.[1] || null
        }),
        options
      ),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '报销明细加载失败，请检查网络后重试'
    }
  )
  return {
    data: result.data?.records ?? [],
    total: result.data?.total ?? 0,
    error: result.error,
    fieldAccess: result.data?.fieldAccess ?? {}
  }
}

export async function fetchTravelReimbursementDetail(id: string) {
  const detail = await responseHandle<Api.Fms.ExpenseReimbursementRecord | null>(
    () => supabase.rpc('tms_get_expense_reimbursement_secure', { p_id: id }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '费用报销详情加载失败，请重试' }
  )
  if (!detail.data) return detail
  if (!detail.data.tenantId) throw new Error('报销单租户信息加载失败，请重试')
  return detail
}

export async function saveTravelReimbursementDraft(
  input: TravelReimbursementDraftInput,
  lines: TravelReimbursementLineInput[],
  payees: TravelReimbursementPayeeInput[]
) {
  return await responseHandle<{
    id: string
    reimbursementNo: string
    status: string
    totalAmount: number
    payeeAmount: number
    loanOffsetAmount: number
  }>(
    () =>
      supabase.rpc('fms_save_travel_reimbursement_draft_secure', {
        p_payload: keysToSnakeDeep(input),
        p_lines: keysToSnakeDeep(lines),
        p_payees: keysToSnakeDeep(payees)
      }),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '差旅报销保存失败，请核对费用明细和收款信息后重试'
    }
  )
}

export async function deleteTravelReimbursements(ids: string[]) {
  return await responseHandle<number>(
    () => supabase.rpc('fms_delete_travel_reimbursements_secure', { p_ids: ids }),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '差旅报销删除失败，请检查关联记录后重试'
    }
  )
}

export async function recordTravelReimbursementPayment(input: TravelReimbursementPaymentInput) {
  return await responseHandle<{
    id: string
    paymentNo: string
    status: string
    isDemo: boolean
    paidAmount: number
  }>(
    () =>
      supabase.rpc('record_fms_travel_reimbursement_payment_secure', {
        p_reimbursement_id: input.reimbursementId,
        p_payee_id: input.payeeId,
        p_fund_account_id: input.fundAccountId,
        p_amount: input.amount,
        p_payment_date: input.paymentDate,
        p_bank_reference: input.bankReference,
        p_idempotency_key: input.idempotencyKey,
        p_demo: input.demo,
        p_voucher_urls: input.voucherUrls ?? [],
        p_remark: normalizeNullableText(input.remark)
      }),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '报销付款登记失败，请核对收款明细、金额与流水后重试'
    }
  )
}

export async function fetchReimbursementPayeeOptions(
  tenantId: string,
  applicantEmployeeId: string
) {
  return await responseHandle<LoanPayeeOption[]>(
    () =>
      supabase.rpc('fms_list_reimbursement_payee_options_secure', {
        p_tenant_id: tenantId,
        p_applicant_employee_id: applicantEmployeeId,
        p_keyword: null
      }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '报销收款账户加载失败，请重试' }
  )
}
