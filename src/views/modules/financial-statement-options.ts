export type FinancialStatementOptionCode =
  | 'fmsFinancialStatementType'
  | 'fmsStatementDisplayStyle'
  | 'fmsStatementCalculationMethod'
  | 'fmsCashFlowDirection'
  | 'fmsStatementMappingDirection'

export function statementDictionaryOptions(
  configured?: Api.DataCenter.DictListItem[]
): { value: string; label: string }[] {
  return (configured ?? [])
    .filter((item) => !item.status || item.status === '1')
    .map((item) => ({ value: item.value, label: item.label || item.name }))
}

export function statementOptionLabel(
  _code: FinancialStatementOptionCode,
  value: unknown,
  configured?: Api.DataCenter.DictListItem[]
): string {
  if (value === null || value === undefined || value === '') return ''
  return (
    statementDictionaryOptions(configured).find((item) => item.value === String(value))?.label ??
    String(value)
  )
}
