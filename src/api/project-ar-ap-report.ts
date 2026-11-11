import { useSupabase } from '@/hooks/core/useSupabase'

export interface ProjectArApReportQuery {
  current?: number
  size?: number
  keyword?: string
}

export interface ProjectArApReportRow {
  id: string
  projectName: string
  projectCode: string
  customerName: string
  ownerName: string
  salespersonName: string
  quotationDate: string | null
  quotationNo: string | null
  quotationAmount: number | null
  quotationTaxAmount: number | null
  contractSignedDate: string | null
  contractName: string | null
  contractNo: string | null
  paperContractNo: string | null
  contractType: string | null
  contractAmount: number | null
  contractTaxAmount: number | null
  salesAmount: number
  shippedAmount: number
  receivableAmount: number
  invoicedReceivableAmount: number
  uninvoicedReceivableAmount: number
  receivedAmount: number
  inboundAmount: number
  payableAmount: number
  invoicedPayableAmount: number
  uninvoicedPayableAmount: number
  paidAmount: number
}

const { supabase, responseHandle, keysToSnakeDeep } = useSupabase()

export async function fetchProjectArApReport(query: ProjectArApReportQuery) {
  const result = await responseHandle<{ records: ProjectArApReportRow[]; total: number }>(
    () =>
      supabase.rpc('fms_project_ar_ap_report_secure', {
        p_query: keysToSnakeDeep({
          current: query.current ?? 1,
          size: query.size ?? 20,
          keyword: query.keyword || null
        })
      }),
    { breakReturn: true, showErrorMessage: false, errorMessage: '项目应收应付报表加载失败，请重试' }
  )
  if (!result.data || !Array.isArray(result.data.records))
    throw new Error('项目应收应付数据不完整，请重试')
  return result.data
}
