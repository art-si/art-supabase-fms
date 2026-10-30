import { useSupabase } from '@/hooks/core/useSupabase'
import { withRequestOptions } from '@/api/providers/supabase/query'
import type { ApiRequestOptions } from '@/types/api/request'
import { buildOrIlikeFilter } from '@/utils/supabase/search'
import { normalizeNullableText, normalizeNonNullableText } from '@/utils/form/normalize'

export interface PayeeInformation {
  id: string
  tenantId: string
  isEmployee: boolean
  employeeId: string | null
  payeeName: string
  payeeEmployeeNo: string | null
  organizationId: string | null
  organizationName: string | null
  accountName: string | null
  bankName: string
  bankAccount: string
  currencyCode: string
  costCompanyId: string | null
  costCompanyName: string | null
  authorizedUse: boolean
  userEmployeeId: string | null
  userEmployeeName: string | null
  isDefault: boolean
  remark: string | null
  createTime: string
}

export interface PayeeInformationInput {
  tenantId: string
  isEmployee: boolean
  employeeId: string | null
  payeeName: string
  organizationId: string | null
  accountName: string | null
  bankName: string
  bankAccount: string
  currencyCode: string
  costCompanyId: string | null
  authorizedUse: boolean
  userEmployeeId: string | null
  isDefault: boolean
  remark: string | null
}

export interface PayeeInformationSearch {
  payeeName?: string
  employeeNo?: string
  keyword?: string
  organizationIds?: string[]
  tenantId?: string | null
  from?: number
  to?: number
}

const { supabase, keysToSnakeDeep, responseHandle } = useSupabase()

export async function fetchPayeeInformationList(
  params: PayeeInformationSearch = {},
  options?: ApiRequestOptions
) {
  let query = supabase
    .from('fms_payee_information')
    .select('*', { count: 'exact' })
    .order('update_time', { ascending: false })
    .range(params.from ?? 0, params.to ?? 9)
  if (params.tenantId) query = query.eq('tenant_id', params.tenantId)
  if (params.organizationIds?.length) query = query.in('organization_id', params.organizationIds)
  if (params.payeeName?.trim()) query = query.ilike('payee_name', `%${params.payeeName.trim()}%`)
  if (params.employeeNo?.trim())
    query = query.ilike('payee_employee_no', `%${params.employeeNo.trim()}%`)
  if (params.keyword?.trim())
    query = query.or(buildOrIlikeFilter(['payee_name', 'payee_employee_no'], params.keyword))
  return await responseHandle<PayeeInformation[]>(() => withRequestOptions(query, options), {
    breakReturn: true,
    showErrorMessage: false,
    errorMessage: '收款信息加载失败，请检查网络后重试'
  })
}

export async function savePayeeInformation(input: PayeeInformationInput, id?: string) {
  const payload = keysToSnakeDeep({
    ...input,
    employeeId: input.isEmployee ? normalizeNullableText(input.employeeId) : null,
    organizationId: normalizeNullableText(input.organizationId),
    costCompanyId: normalizeNullableText(input.costCompanyId),
    userEmployeeId: input.authorizedUse ? normalizeNullableText(input.userEmployeeId) : null,
    payeeName: normalizeNonNullableText(input.payeeName),
    accountName: normalizeNullableText(input.accountName),
    bankName: normalizeNonNullableText(input.bankName),
    bankAccount: normalizeNonNullableText(input.bankAccount),
    currencyCode: normalizeNonNullableText(input.currencyCode),
    remark: normalizeNullableText(input.remark)
  })
  if (id) {
    return await responseHandle<PayeeInformation>(
      () =>
        supabase
          .from('fms_payee_information')
          .update(payload, { count: 'exact' })
          .eq('id', id)
          .select('*')
          .single(),
      {
        breakReturn: true,
        showErrorMessage: false,
        requireAffected: true,
        noAffectedMessage: '收款信息未更新，请刷新后重试',
        errorMessage: '收款信息保存失败，请检查填写内容后重试'
      }
    )
  }
  return await responseHandle<PayeeInformation>(
    () => supabase.from('fms_payee_information').insert(payload).select('*').single(),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '收款信息保存失败，请检查填写内容后重试'
    }
  )
}

export async function deletePayeeInformation(ids: string[]) {
  return await responseHandle<PayeeInformation[]>(
    () =>
      supabase.from('fms_payee_information').delete({ count: 'exact' }).in('id', ids).select('id'),
    {
      breakReturn: true,
      showErrorMessage: false,
      requireAffected: true,
      noAffectedMessage: '收款信息未删除，请刷新后重试',
      errorMessage: '收款信息删除失败，请检查关联记录后重试'
    }
  )
}
