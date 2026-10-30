import { buildSupabaseRpcRange } from '@/utils/supabase'
import { normalizeNullableText } from '@/utils/form/normalize'
import { useSupabase } from '@/hooks/core/useSupabase'
import { withRequestOptions } from '@/api/providers/supabase/query'
import type { ApiFeedbackOptions, ApiRequestOptions } from '@/types/api/request'

type AccountSet = Api.Fms.AccountSetRecord
type AccountSetSearchParams = Api.Fms.AccountSetSearchParams
type SaveAccountSetPayload = Api.Fms.SaveAccountSetPayload
type AccountingPeriod = Api.Fms.AccountingPeriodRecord
type AccountingPeriodStatus = Api.Fms.AccountingPeriodStatus
type AccountingFoundationSummary = Api.Fms.AccountingFoundationSummary
type AccountingReadiness = Api.Fms.AccountingReadiness

const { supabase, responseHandle } = useSupabase()

interface AccountSetListPayload {
  records?: AccountSet[]
  total?: number
  fieldAccess?: Api.Fms.AccountSetFieldAccessMap
}

interface AccountSetIdentity {
  id: string
  tenantId: string
  accountSetCode: string
  accountSetName: string
  status: Api.Fms.AccountSetStatus
}

interface AccountSetOptionListPayload {
  records?: AccountSetIdentity[]
  total?: number
}

export async function fetchAccountSetList(
  params: AccountSetSearchParams = {},
  options?: ApiFeedbackOptions
) {
  const { from = 0, to = 19, keyword, status, tenantId } = params
  const result = await responseHandle<AccountSetListPayload>(
    () =>
      supabase.rpc('fms_list_account_sets_secure', {
        ...buildSupabaseRpcRange(from, to),
        p_keyword: normalizeNullableText(keyword),
        p_status: status || null,
        p_tenant_id: tenantId || null
      }),
    { showErrorMessage: options?.showErrorMessage ?? true }
  )
  return {
    data: result.data?.records ?? [],
    total: result.data?.total ?? 0,
    error: result.error,
    fieldAccess: result.data?.fieldAccess ?? {}
  }
}

export async function fetchAccountSetOverview(tenantId?: string, options?: ApiFeedbackOptions) {
  return await responseHandle<Api.Fms.AccountSetOverview>(
    () =>
      supabase.rpc('fms_get_account_set_overview_secure', {
        p_tenant_id: tenantId || null
      }),
    { showErrorMessage: options?.showErrorMessage ?? true }
  )
}

export async function fetchAccountSetDetail(id: string) {
  return await responseHandle<AccountSet>(
    () => supabase.rpc('fms_get_account_set_secure', { p_account_set_id: id }),
    { breakReturn: true, showErrorMessage: true }
  )
}

export async function fetchAccountSetOptions(
  params: AccountSetSearchParams = {},
  options?: ApiRequestOptions & ApiFeedbackOptions
) {
  const { from = 0, to = 999, status, tenantId } = params
  const result = await responseHandle<AccountSetOptionListPayload>(
    () =>
      withRequestOptions(
        supabase.rpc('fms_list_account_set_options_secure', {
          ...buildSupabaseRpcRange(from, to),
          p_status: status || null,
          p_tenant_id: tenantId || null,
          p_ids: null
        }),
        options
      ),
    { showErrorMessage: options?.showErrorMessage ?? true }
  )
  return {
    error: result.error,
    total: result.data?.total ?? 0,
    data: (result.data?.records ?? []).map((item) => ({
      label: `${item.accountSetName}（${item.accountSetCode}）`,
      value: item.id,
      status: item.status,
      tenantId: item.tenantId
    }))
  }
}

export async function fetchAccountSetIdentities(
  ids: string[],
  options?: ApiRequestOptions & ApiFeedbackOptions
) {
  if (!ids.length) return { data: [] as AccountSetIdentity[], total: 0, error: null }
  const result = await responseHandle<AccountSetOptionListPayload>(
    () =>
      withRequestOptions(
        supabase.rpc('fms_list_account_set_options_secure', {
          ...buildSupabaseRpcRange(0, ids.length - 1),
          p_status: null,
          p_tenant_id: null,
          p_ids: ids
        }),
        options
      ),
    { showErrorMessage: options?.showErrorMessage ?? true }
  )
  return {
    data: result.data?.records ?? [],
    total: result.data?.total ?? 0,
    error: result.error
  }
}

export async function saveAccountSet(payload: SaveAccountSetPayload) {
  return await responseHandle<AccountSet>(
    () => supabase.rpc('save_fms_account_set_secure', { p_payload: payload }),
    {
      breakReturn: true,
      showMessage: true,
      message: payload.id ? '账套信息已更新' : '账套已创建'
    }
  )
}

export async function setAccountSetStatus(
  id: string,
  status: Api.Fms.AccountSetStatus,
  reason?: string | null
) {
  return await responseHandle<AccountSet>(
    () =>
      supabase.rpc('set_fms_account_set_status_secure', {
        p_account_set_id: id,
        p_status: status,
        p_reason: reason || null
      }),
    { breakReturn: true, showMessage: true, message: '账套状态已更新' }
  )
}

export async function fetchAccountingPeriodList(
  accountSetId: string,
  options?: ApiFeedbackOptions
) {
  return await responseHandle<AccountingPeriod[]>(
    () =>
      supabase
        .from('fms_accounting_period')
        .select('*')
        .eq('account_set_id', accountSetId)
        .order('start_date', { ascending: true }),
    { showErrorMessage: options?.showErrorMessage ?? true }
  )
}

export async function setAccountingPeriodStatus(
  id: string,
  status: AccountingPeriodStatus,
  reason?: string | null
) {
  return await responseHandle<AccountingPeriod>(
    () =>
      supabase.rpc('set_fms_accounting_period_status', {
        p_period_id: id,
        p_status: status,
        p_reason: reason || null
      }),
    { breakReturn: true, showMessage: true, message: '会计期间状态已更新' }
  )
}

export async function extendAccountingPeriods(accountSetId: string, fiscalYear: number) {
  return await responseHandle<Api.Fms.AccountingPeriodExtensionResult>(
    () =>
      supabase.rpc('extend_fms_accounting_periods', {
        p_account_set_id: accountSetId,
        p_fiscal_year: fiscalYear
      }),
    { breakReturn: true, showMessage: true, message: `${fiscalYear} 会计年度已生成` }
  )
}

export async function fetchAccountingFoundationSummary(
  accountSetId: string,
  options?: ApiFeedbackOptions
) {
  return await responseHandle<AccountingFoundationSummary>(
    () =>
      supabase
        .rpc('fms_accounting_foundation_summary', { p_account_set_id: accountSetId })
        .single(),
    { showErrorMessage: options?.showErrorMessage ?? true }
  )
}

export async function fetchAccountingReadiness(accountSetId: string) {
  return await responseHandle<AccountingReadiness>(
    () => supabase.rpc('fms_accounting_readiness', { p_account_set_id: accountSetId }),
    { breakReturn: true, showErrorMessage: true }
  )
}

export async function initializeAccountingDefaults(accountSetId: string) {
  return await responseHandle<AccountingReadiness>(
    () =>
      supabase.rpc('initialize_fms_accounting_defaults', {
        p_account_set_id: accountSetId
      }),
    {
      breakReturn: true,
      showMessage: true,
      message: '核算基础已补齐'
    }
  )
}
