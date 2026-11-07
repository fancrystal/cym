import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCents, fromCents, validateTransfer } from '../src/commerce/money.js'

test('产品券金额以分处理并精确还原', () => {
  assert.equal(toCents('69.80'), 6980)
  assert.equal(fromCents(6980), '69.80')
  assert.throws(() => toCents('1.001'), /金额/)
  assert.throws(() => toCents('-1'), /金额/)
})

test('转赠仅接受正整数产品券', () => {
  assert.equal(validateTransfer('12'), 1200)
  for (const value of ['0', '-1', '1.5', '', '1e3']) assert.throws(() => validateTransfer(value), /转赠/)
})
