import { round } from 'lodash-es'

/** Table action contexts are untyped records; require a readable refundable balance. */
export function canCreateReceiptRefund(
  source:
    | {
        status?: unknown
        supplierId?: unknown
        refundableAmount?: unknown
      }
    | undefined
): boolean {
  return (
    source?.status === 'confirmed' &&
    !source.supplierId &&
    typeof source.refundableAmount === 'number' &&
    source.refundableAmount > 0
  )
}

export type ReceivableBasis = 'quantity' | 'amount'
export type ReceivablePriceBasis = 'untaxed' | 'taxed'
export type ReceivableDiscountMethod = 'none' | 'rate' | 'amount'

export interface RevenueCostDisplayInput {
  costAmount: number | null
  lines: ReadonlyArray<{ costAmount: number | null }>
}

/** Header costs cache the known subtotal; null headers are masked, and null lines remain unresolved. */
export function getRevenueCostDisplayState(
  input: RevenueCostDisplayInput
): 'hidden' | 'pending' | 'ready' {
  if (input.costAmount === null) return 'hidden'
  return input.lines.length > 0 && input.lines.every((line) => line.costAmount !== null)
    ? 'ready'
    : 'pending'
}

export interface ReceivableCalculationInput {
  basis: ReceivableBasis
  quantity: number
  priceBasis: ReceivablePriceBasis
  unitPrice: number
  taxInclusiveUnitPrice: number
  taxRate: number
  discountMethod: ReceivableDiscountMethod
  discountRate: number
  discountAmount: number
  enteredGrossAmount?: number | null
  gift: boolean
}

export interface ReceivableCalculationResult {
  unitPrice: number
  taxInclusiveUnitPrice: number
  discountAmount: number
  amount: number
  taxAmount: number
  totalAmount: number
}

export interface ReceivableReversalInput {
  basis: ReceivableBasis
  estimatedQuantity: number
  estimatedAmount: number
  reversedQuantity: number
  reversedAmount: number
  matchedQuantity: number
  matchedAmount: number
}

export interface ReceivableReversalResult {
  quantity: number
  amount: number
  fullyReversed: boolean
}

export interface ReceivableSettlementBalanceInput {
  receivableAmount: number
  adjustedAmount: number
  appliedAmount: number
  reservedAmount: number
}

export interface ReceivableSettlementBalance {
  outstandingAmount: number
  availableAmount: number
}

export function calculateReceivableLine(
  input: ReceivableCalculationInput
): ReceivableCalculationResult {
  if (
    !Number.isFinite(input.quantity) ||
    input.quantity < 0 ||
    (input.basis === 'quantity' && input.quantity === 0) ||
    !Number.isFinite(input.taxRate) ||
    input.taxRate < 0 ||
    input.taxRate > 100 ||
    !Number.isFinite(input.unitPrice) ||
    input.unitPrice < 0 ||
    !Number.isFinite(input.taxInclusiveUnitPrice) ||
    input.taxInclusiveUnitPrice < 0 ||
    !Number.isFinite(input.discountRate) ||
    input.discountRate < 0 ||
    input.discountRate > 1
  ) {
    throw new Error('数量、单价、税率或折扣率无效，请检查明细')
  }
  const taxFactor = 1 + input.taxRate / 100
  if (!Number.isFinite(taxFactor) || taxFactor <= 0) {
    throw new Error('税率无效，请重新选择')
  }

  const unitPrice =
    input.priceBasis === 'taxed'
      ? round(input.taxInclusiveUnitPrice / taxFactor, 6)
      : input.unitPrice
  const taxInclusiveUnitPrice =
    input.priceBasis === 'untaxed'
      ? round(input.unitPrice * taxFactor, 2)
      : input.taxInclusiveUnitPrice

  if (input.gift) {
    return {
      unitPrice,
      taxInclusiveUnitPrice,
      discountAmount: 0,
      amount: 0,
      taxAmount: 0,
      totalAmount: 0
    }
  }

  const originalGross =
    input.basis === 'amount'
      ? (input.enteredGrossAmount ?? 0)
      : round(input.quantity * taxInclusiveUnitPrice, 2)
  const discountAmount =
    input.discountMethod === 'rate'
      ? round(originalGross * input.discountRate, 2)
      : input.discountMethod === 'amount'
        ? round(input.discountAmount, 2)
        : 0
  if (
    !Number.isFinite(originalGross) ||
    originalGross < 0 ||
    !Number.isFinite(discountAmount) ||
    discountAmount < 0 ||
    discountAmount > originalGross
  ) {
    throw new Error('价税金额或折扣额无效，请检查明细')
  }

  const totalAmount = round(originalGross - discountAmount, 2)
  const amount = round(totalAmount / taxFactor, 2)
  return {
    unitPrice,
    taxInclusiveUnitPrice,
    discountAmount,
    amount,
    taxAmount: round(totalAmount - amount, 2),
    totalAmount
  }
}

/** Allocate reversals at the original estimate, not the actual invoice price. */
export function calculateReceivableReversal(
  input: ReceivableReversalInput
): ReceivableReversalResult {
  if (
    Object.values(input).some((value) => typeof value === 'number' && !Number.isFinite(value)) ||
    input.estimatedAmount < 0 ||
    input.reversedAmount < 0 ||
    input.reversedQuantity < 0
  ) {
    throw new Error('暂估冲回数据无效，请刷新单据')
  }
  const remainingAmount = round(input.estimatedAmount - input.reversedAmount, 2)
  if (remainingAmount < 0 || input.matchedAmount < 0) {
    throw new Error('暂估冲回金额无效，请刷新单据')
  }
  if (input.basis === 'amount') {
    if (input.matchedAmount > remainingAmount) {
      throw new Error('本次冲回金额超过未冲回金额，请调整财务应收明细')
    }
    const amount = round(input.matchedAmount, 2)
    return { quantity: 0, amount, fullyReversed: amount === remainingAmount }
  }

  const remainingQuantity = round(input.estimatedQuantity - input.reversedQuantity, 6)
  if (
    input.estimatedQuantity <= 0 ||
    remainingQuantity < 0 ||
    input.matchedQuantity <= 0 ||
    input.matchedQuantity > remainingQuantity
  ) {
    throw new Error('本次冲回数量超过未冲回数量，请调整财务应收明细')
  }
  const amount =
    input.matchedQuantity === remainingQuantity
      ? remainingAmount
      : round((input.estimatedAmount * input.matchedQuantity) / input.estimatedQuantity, 2)
  return {
    quantity: input.matchedQuantity,
    amount,
    fullyReversed: input.matchedQuantity === remainingQuantity
  }
}

/** Saved receipt drafts reserve availability; only confirmed applications reduce the balance. */
export function calculateReceivableSettlementBalance(
  input: ReceivableSettlementBalanceInput
): ReceivableSettlementBalance {
  const outstandingAmount = round(
    input.receivableAmount + input.adjustedAmount - input.appliedAmount,
    2
  )
  const availableAmount = round(outstandingAmount - input.reservedAmount, 2)
  if (
    Object.values(input).some((value) => !Number.isFinite(value)) ||
    outstandingAmount < 0 ||
    availableAmount < 0
  ) {
    throw new Error('应收可核销余额不足，请刷新单据')
  }
  return { outstandingAmount, availableAmount }
}
