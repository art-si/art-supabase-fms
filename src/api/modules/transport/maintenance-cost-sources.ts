import { useSupabase } from '@/hooks/core/useSupabase'

export interface MaintenanceCostSource {
  id: string
  maintenanceNo: string
  plateNo: string
  costAmount: number
  endTime: string
  workshop: string | null
}

export async function fetchMaintenanceCostSources(params: {
  waybillId: string
  keyword?: string
  offset: number
  limit: number
}) {
  const { supabase, responseHandle } = useSupabase()
  const result = await responseHandle<{ records: MaintenanceCostSource[]; total: number }>(
    () =>
      supabase.rpc('tms_list_maintenance_cost_sources_secure', {
        p_waybill_id: params.waybillId,
        p_keyword: params.keyword ?? null,
        p_offset: params.offset,
        p_limit: params.limit
      }),
    { showErrorMessage: false, breakReturn: true }
  )
  return { data: result.data?.records ?? [], total: result.data?.total ?? 0 }
}
