import assert from 'node:assert/strict'
import test from 'node:test'
import {
  statementOptionLabel,
  statementDictionaryOptions
} from '../../src/views/modules/financial-statement-options'

test('未配置报表字典时不开放静态选项，历史值保留原码', () => {
  assert.deepEqual(statementDictionaryOptions(), [])
  assert.equal(statementOptionLabel('fmsCashFlowDirection', 'receipt', []), 'receipt')
  assert.equal(statementOptionLabel('fmsStatementDisplayStyle', 'subtotal', []), 'subtotal')
})

test('tenant dictionary labels take precedence when configured', () => {
  const configured: Api.DataCenter.DictListItem[] = [
    { code: 'receipt', name: '收款', label: '现金流入', value: 'receipt', status: '1' }
  ]
  assert.equal(statementOptionLabel('fmsCashFlowDirection', 'receipt', configured), '现金流入')
})
