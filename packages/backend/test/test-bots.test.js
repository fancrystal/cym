import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parentIndex } from '../src/commerce/test-bots.js'

test('十个测试账户按二叉金字塔排列', () => {
  assert.deepEqual(Array.from({length:10}, (_, i) => parentIndex(i)), [null,0,0,1,1,2,2,3,3,4])
})
