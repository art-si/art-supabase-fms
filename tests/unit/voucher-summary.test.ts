import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatVoucherSummary,
  voucherSourceLabel,
  voucherSourceOptions
} from '../../src/views/modules/voucher-summary'

const billEvents = [{ value: 'discounted', label: '票据贴现' }]

test('凭证来源按字典标签和顺序展示，忽略未实现或停用的来源', () => {
  const configured = [
    { value: 'commercial_bill', label: '商业票据' },
    { value: 'manual', label: '手工录入' },
    { value: 'future_source', label: '未来来源' },
    { value: 'tax', label: '税务核算', status: '0' }
  ]
  assert.deepEqual(voucherSourceOptions(configured), [
    { value: 'commercial_bill', label: '商业票据' },
    { value: 'manual', label: '手工录入' }
  ])
  assert.equal(voucherSourceLabel('commercial_bill', configured), '商业票据')
  assert.equal(voucherSourceLabel('tax', configured), '税务核算')
  assert.equal(voucherSourceLabel('legacy_source', configured), '历史来源（待核对）')
  assert.equal(voucherSourceLabel(null, configured), '--')
})

test('票据系统摘要按票据动作字典展示，保留来源单号', () => {
  assert.equal(
    formatVoucherSummary('商业票据 · PJ202610-00001 · discounted', [], {
      sourceType: 'commercial_bill',
      billEvents
    }),
    '商业票据 · PJ202610-00001 · 票据贴现'
  )
})

test('票据动作字典不改写手工摘要或未知动作', () => {
  assert.equal(
    formatVoucherSummary('用户说明 · discounted', [], { sourceType: 'manual', billEvents }),
    '用户说明 · discounted'
  )
  assert.equal(
    formatVoucherSummary('商业票据 · PJ202610-00001 · future_event', [], {
      sourceType: 'commercial_bill',
      billEvents
    }),
    '商业票据 · PJ202610-00001 · future_event'
  )
})

test('票据缺少字典时不套用同名运单费用，既有费用摘要保持兼容', () => {
  const costs = [{ value: 'discounted', label: '费用同名项' }]
  assert.equal(
    formatVoucherSummary('商业票据 · PJ202610-00001 · discounted', costs, {
      sourceType: 'commercial_bill'
    }),
    '商业票据 · PJ202610-00001 · discounted'
  )
  assert.equal(
    formatVoucherSummary('运单费用审核 · YD01 · discounted', costs),
    '运单费用审核 · YD01 · 费用同名项'
  )
  assert.equal(formatVoucherSummary(null), '')
})
