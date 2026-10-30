import { useSupabase } from '@/hooks/core/useSupabase'
import { withRequestOptions } from '@/api/providers/supabase/query'
import type { ApiRequestOptions } from '@/types/api/request'
import { buildOrIlikeFilter } from '@/utils/supabase/search'
import { normalizeNullableText } from '@/utils/form/normalize'

export interface TravelItinerary {
  id: string
  tenantId: string
  applicationId: string
  lineNo: number
  departureRegionPath: string[]
  departurePlace: string
  destinationRegionPath: string[]
  destinationPlace: string
  startDate: string
  endDate: string
  transportModes: string[]
  travelerEmployeeIds: string[]
  expenseItemId: string
  projectId: string | null
  requestedAmount: number
  remark: string | null
}

export interface TravelApplication {
  id: string
  tenantId: string
  applicationNo: string
  applicantEmployeeId: string
  applicantName: string
  applicantEmployeeNo: string
  applicantAvatarUrl: string | null
  applicantOrganizationId: string
  applicantOrganizationName: string
  applicantCompanyId: string
  applicantCompanyName: string
  assignmentId: string | null
  positionName: string | null
  applicationDate: string
  expenseDepartmentId: string
  expenseDepartmentName: string
  expenseCompanyId: string
  expenseCompanyName: string
  travelType: 'general' | 'project'
  multipleTravelers: boolean
  reason: string
  requestedAmount: number
  estimatedDays: number
  loanAmount: number
  approvedAmount: number | null
  pendingCollectionAmount: number | null
  repaidAmount: number | null
  remainingBalance: number | null
  usedAmount: number | null
  paidAmount: number | null
  currentHandler: string | null
  rejectionOpinion: string | null
  status: string
  remark: string | null
  attachmentUrls: string[]
  createTime: string
  itineraries?: TravelItinerary[]
}

export interface TravelApplicationInput {
  id?: string
  copySourceId?: string
  tenantId: string
  applicantEmployeeId: string
  assignmentId: string | null
  applicationDate: string
  expenseDepartmentId: string | null
  travelType: 'general' | 'project'
  multipleTravelers: boolean
  reason: string
  remark: string | null
  attachmentUrls: string[]
}

export type TravelItineraryInput = Pick<
  TravelItinerary,
  | 'departureRegionPath'
  | 'departurePlace'
  | 'destinationRegionPath'
  | 'destinationPlace'
  | 'startDate'
  | 'endDate'
  | 'transportModes'
  | 'travelerEmployeeIds'
  | 'expenseItemId'
  | 'projectId'
  | 'requestedAmount'
  | 'remark'
> & { id?: string }

export interface TravelApplicationSearch {
  applicationDateRange?: [string, string] | []
  applicantEmployeeId?: string
  status?: string
  keyword?: string
  tenantId?: string | null
  from?: number
  to?: number
}

export interface TravelLineRecord extends TravelItinerary {
  application: TravelApplication
  expenseItem?: { itemName: string } | null
  project?: { projectName: string } | null
}

export interface TravelProjectOption {
  id: string
  projectCode: string
  projectName: string
}

export interface TravelAssignmentOption {
  id: string
  businessTitle: string | null
  primaryAssignment: boolean
}

interface TravelAssignmentRow extends TravelAssignmentOption {
  position: { positionName: string | null } | null
}

const { supabase, keysToSnakeDeep, responseHandle } = useSupabase()

export async function fetchTravelApplicationList(
  params: TravelApplicationSearch = {},
  options?: ApiRequestOptions
) {
  let query = supabase
    .from('fms_travel_application')
    .select('*', { count: 'exact' })
    .order('application_date', { ascending: false })
    .order('create_time', { ascending: false })
    .range(params.from ?? 0, params.to ?? 9)
  if (params.tenantId) query = query.eq('tenant_id', params.tenantId)
  if (params.applicationDateRange?.[0])
    query = query.gte('application_date', params.applicationDateRange[0])
  if (params.applicationDateRange?.[1])
    query = query.lte('application_date', params.applicationDateRange[1])
  if (params.applicantEmployeeId)
    query = query.eq('applicant_employee_id', params.applicantEmployeeId)
  if (params.status) query = query.eq('status', params.status)
  if (params.keyword?.trim())
    query = query.or(
      buildOrIlikeFilter(['application_no', 'applicant_name', 'reason'], params.keyword)
    )
  return await responseHandle<TravelApplication[]>(() => withRequestOptions(query, options), {
    breakReturn: true,
    showErrorMessage: false,
    errorMessage: '出差申请加载失败，请检查网络后重试'
  })
}

export async function fetchTravelItineraryList(
  params: TravelApplicationSearch = {},
  options?: ApiRequestOptions
) {
  let query = supabase
    .from('fms_travel_itinerary')
    .select(
      '*,application:fms_travel_application!inner(*),expenseItem:tms_expense_item(item_name),project:mdm_project(project_name)',
      { count: 'exact' }
    )
    .order('create_time', { ascending: false })
    .order('line_no', { ascending: true })
    .range(params.from ?? 0, params.to ?? 9)
  if (params.tenantId) query = query.eq('tenant_id', params.tenantId)
  if (params.applicationDateRange?.[0])
    query = query.gte('application.application_date', params.applicationDateRange[0])
  if (params.applicationDateRange?.[1])
    query = query.lte('application.application_date', params.applicationDateRange[1])
  if (params.applicantEmployeeId)
    query = query.eq('application.applicant_employee_id', params.applicantEmployeeId)
  if (params.status) query = query.eq('application.status', params.status)
  if (params.keyword?.trim())
    query = query.or(
      buildOrIlikeFilter(['application_no', 'applicant_name', 'reason'], params.keyword),
      { referencedTable: 'application' }
    )
  return await responseHandle<TravelLineRecord[]>(() => withRequestOptions(query, options), {
    breakReturn: true,
    showErrorMessage: false,
    errorMessage: '行程明细加载失败，请检查网络后重试'
  })
}

export async function fetchTravelApplicationDetail(id: string) {
  return await responseHandle<TravelApplication>(
    () =>
      supabase
        .from('fms_travel_application')
        .select('*,itineraries:fms_travel_itinerary(*)')
        .eq('id', id)
        .single(),
    { breakReturn: true, showErrorMessage: false, errorMessage: '出差申请详情加载失败，请重试' }
  )
}

export async function saveTravelApplicationDraft(
  input: TravelApplicationInput,
  itineraries: TravelItineraryInput[]
) {
  const { copySourceId, ...record } = input
  const payload = keysToSnakeDeep({
    ...record,
    reason: input.reason.trim(),
    remark: normalizeNullableText(input.remark)
  })
  return await responseHandle<{
    id: string
    applicationNo: string
    status: string
    requestedAmount: number
    estimatedDays: number
  }>(
    () =>
      supabase.rpc(
        copySourceId
          ? 'copy_fms_travel_application_draft_secure'
          : 'save_fms_travel_application_draft_secure',
        {
          ...(copySourceId ? { p_source_id: copySourceId } : {}),
          p_payload: payload,
          p_lines: keysToSnakeDeep(itineraries)
        }
      ),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '出差申请保存失败，请核对行程后重试'
    }
  )
}

export async function deleteTravelApplications(ids: string[]) {
  return responseHandle<number>(
    () => supabase.rpc('delete_fms_travel_applications_secure', { p_ids: ids }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '出差申请删除失败，请刷新后重试' }
  )
}

export async function prepareTravelApplicationReimbursement(applicationId: string) {
  return responseHandle<TravelApplication>(
    () =>
      supabase.rpc('prepare_fms_travel_application_reimbursement_secure', {
        p_application_id: applicationId
      }),
    {
      breakReturn: true,
      showErrorMessage: false,
      errorMessage: '出差报销来源加载失败，请核对审批状态和权限后重试'
    }
  )
}

export async function fetchExpenseProjectOptions(tenantId: string) {
  return await responseHandle<TravelProjectOption[]>(
    () => supabase.rpc('fms_list_expense_project_options_secure', { p_tenant_id: tenantId }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '项目选项加载失败，请重试' }
  )
}

export async function fetchTravelAssignmentOptions(tenantId: string, employeeId: string) {
  const result = await responseHandle<TravelAssignmentRow[]>(
    () =>
      supabase
        .from('mdm_employee_assignment')
        .select(
          'id,business_title,primary_assignment,position:mdm_position!hr_employee_assignment_position_fkey(position_name)'
        )
        .eq('tenant_id', tenantId)
        .eq('employee_id', employeeId)
        .eq('assignment_status', 'active')
        .order('primary_assignment', { ascending: false }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '任职职位加载失败，请重试' }
  )
  return {
    ...result,
    data: (result.data ?? []).map(({ position, ...assignment }) => ({
      ...assignment,
      businessTitle: assignment.businessTitle || position?.positionName || '未设置职位名称'
    }))
  }
}
