import Decimal from 'decimal.js-light'
import { normalizeNonNullableText } from '@/utils/form/normalize'

export interface PayrollItemRow {
  name: string
  amount: number | null
}

export function buildPayrollItems(rows: readonly PayrollItemRow[]): {
  items: Record<string, number>
  total: number
} {
  const entries: [string, number][] = []
  let total = new Decimal(0)
  for (const row of rows) {
    const name = normalizeNonNullableText(row.name)
    if (!name) throw new Error('请填写薪酬项目名称')
    if (entries.some(([key]) => key === name))
      throw new Error(`薪酬项目“${name}”重复，请合并后保存`)
    if (row.amount == null || !Number.isFinite(row.amount) || row.amount < 0) {
      throw new Error(`请填写“${name}”的有效非负金额`)
    }
    const amount = new Decimal(row.amount).toDecimalPlaces(2)
    entries.push([name, amount.toNumber()])
    total = total.plus(amount)
  }
  return { items: Object.fromEntries(entries), total: total.toNumber() }
}

/** Preserve source names; an old total-only line remains explicitly unclassified. */
export function readPayrollItems(
  source: unknown,
  total: number,
  fallbackName: string
): PayrollItemRow[] {
  if (!Number.isFinite(total) || total < 0)
    throw new Error('薪酬总额不可读取，请刷新或检查金额权限')
  if (source != null && (typeof source !== 'object' || Array.isArray(source))) {
    throw new Error('薪酬项目不可读取，请刷新或检查金额权限')
  }
  const entries = Object.entries(source ?? {})
  if (!entries.length) return [{ name: fallbackName, amount: total }]
  const rows = entries.map(([name, amount]) => {
    if (typeof amount !== 'number') throw new Error('薪酬项目金额不完整，请核对原始明细')
    return { name, amount }
  })
  if (!new Decimal(buildPayrollItems(rows).total).equals(new Decimal(total).toDecimalPlaces(2))) {
    throw new Error('薪酬项目合计与总额不一致，请核对原始明细')
  }
  return rows
}
