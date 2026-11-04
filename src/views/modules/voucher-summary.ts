interface CostTypeOption {
  value: string | number
  label?: string
  name?: string
  status?: string
}

const supportedVoucherSources = new Set<string>([
  'estimated_payable',
  'financial_payable',
  'manual',
  'customer_statement',
  'carrier_statement',
  'customer_receipt',
  'carrier_payment',
  'invoice',
  'expense_reimbursement',
  'waybill_cost',
  'system',
  'commercial_bill',
  'fixed_asset',
  'asset_depreciation',
  'payroll',
  'tax',
  'period_close',
  'reversal'
])

export function voucherSourceOptions(configured: CostTypeOption[] = []) {
  return configured
    .filter(
      (item) =>
        (!item.status || item.status === '1') &&
        typeof item.value === 'string' &&
        supportedVoucherSources.has(item.value)
    )
    .map((item) => ({ value: String(item.value), label: item.label || item.name || '未命名来源' }))
}

export function voucherSourceLabel(value: unknown, configured: CostTypeOption[] = []): string {
  if (value === null || value === undefined || value === '') return '--'
  const option = configured.find((item) => String(item.value) === String(value))
  return option?.label || option?.name || '历史来源（待核对）'
}

export function formatVoucherSummary(
  summary: string | null | undefined,
  costTypes: CostTypeOption[] = [],
  context?: {
    sourceType: Api.Fms.VoucherSourceType
    billEvents?: CostTypeOption[]
    taxTypes?: CostTypeOption[]
  }
): string {
  const text = summary ?? ''
  if (context?.sourceType === 'tax') {
    return text
      .split(/(\s+)/)
      .map((segment) => {
        const option = context.taxTypes?.find((item) => String(item.value) === segment)
        return option?.label ?? option?.name ?? segment
      })
      .join('')
  }
  const segments = text.split(' · ')
  const lastSegment = segments.at(-1)
  const options = context?.sourceType === 'commercial_bill' ? (context.billEvents ?? []) : costTypes
  const costType = options.find((item) => String(item.value) === lastSegment)
  const label = costType?.label ?? costType?.name
  return label ? [...segments.slice(0, -1), label].join(' · ') : text
}
