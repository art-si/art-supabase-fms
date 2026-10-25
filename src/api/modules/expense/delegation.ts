import { useSupabase } from '@/hooks/core/useSupabase'

export type ExpenseDelegationScope = 'travel_application' | 'travel_loan' | 'expense_reimbursement'

export interface ExpenseDelegation {
  id: string
  tenantId: string
  principalEmployeeId: string
  delegateUserId: string
  scopes: ExpenseDelegationScope[]
  validFrom: string
  validTo: string
  isActive: boolean
  delegate: { userName: string; nickName: string | null } | null
}

export interface ExpenseDelegationInput {
  id?: string
  delegateUserId: string
  scopes: ExpenseDelegationScope[]
  validFrom: string
  validTo: string
}

const { supabase, responseHandle } = useSupabase()
const options = {
  breakReturn: true,
  showErrorMessage: false,
  errorMessage: '费用委托操作失败，请重试'
}

/** The principal is the signed-in employee, including when a platform administrator changes read scope. */
export async function fetchExpenseDelegations(
  employeeId: string,
  tenantId: string
): Promise<ExpenseDelegation[]> {
  if (!employeeId || !tenantId) throw new Error('请先为当前账号绑定员工档案后管理委托')
  const { data } = await responseHandle<ExpenseDelegation[]>(
    () =>
      supabase
        .from('fms_expense_delegation')
        .select(
          'id,tenant_id,principal_employee_id,delegate_user_id,scopes,valid_from,valid_to,is_active,delegate:sys_user!fms_expense_delegation_delegate_user_id_fkey(user_name,nick_name)'
        )
        .eq('tenant_id', tenantId)
        .eq('principal_employee_id', employeeId)
        .order('create_time', { ascending: false }),
    options
  )
  if (!Array.isArray(data)) throw new Error('费用委托记录不完整，请重新加载')
  return data
}

export async function saveExpenseDelegation(input: ExpenseDelegationInput): Promise<string> {
  const { data } = await responseHandle<string>(
    () =>
      supabase.rpc('save_fms_expense_delegation_secure', {
        p_id: input.id || null,
        p_delegate_user_id: input.delegateUserId,
        p_scopes: input.scopes,
        p_valid_from: input.validFrom,
        p_valid_to: input.validTo
      }),
    options
  )
  if (typeof data !== 'string' || !data) throw new Error('费用委托未保存，请重试')
  return data
}

export async function revokeExpenseDelegation(id: string): Promise<void> {
  await responseHandle(
    () => supabase.rpc('revoke_fms_expense_delegation_secure', { p_id: id }),
    options
  )
}
