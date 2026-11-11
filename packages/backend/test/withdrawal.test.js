import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withdrawalAmounts } from '../src/commerce/withdrawal.js'

test('提现金额至少 50 且必须为 50 的整数倍，手续费为 6%', () => {
  assert.deepEqual(withdrawalAmounts('50'), { amount:'50.00', fee:'3.00', net:'47.00' })
  assert.deepEqual(withdrawalAmounts('100'), { amount:'100.00', fee:'6.00', net:'94.00' })
  for (const value of ['0','49','51','100.00','-50','abc']) assert.throws(() => withdrawalAmounts(value))
})
