import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRewardRecipient } from '../src/commerce/reward-recipient.js'

const resolve = (sequence, parents, counts) => resolveRewardRecipient({
  buyerId: 10, sequence, rootUserId: 99,
  getParentId: async id => parents[id] ?? null,
  getPurchaseCount: async id => counts[id] ?? 0,
})

test('第 N 次购买奖励符合资格的第 N 层上级', async () => {
  assert.deepEqual(await resolve(2, { 10: 11, 11: 12 }, { 12: 2 }),
    { recipientId: 12, destination: 'ancestor', depth: 2 })
})

test('上级资格不足或者关系缺失时归根账户', async () => {
  assert.deepEqual(await resolve(2, { 10: 11, 11: 12 }, { 12: 1 }),
    { recipientId: 99, destination: 'root', depth: 2 })
  assert.deepEqual(await resolve(2, { 10: 11 }, {}),
    { recipientId: 99, destination: 'root', depth: 2 })
})

test('关系出现环时拒绝结算', async () => {
  await assert.rejects(resolve(2, { 10: 11, 11: 10 }, {}), /RELATIONSHIP_CYCLE/)
})
