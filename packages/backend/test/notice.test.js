import { test } from 'node:test'
import assert from 'node:assert/strict'
import { unreadOrderCount } from '../../h5/src/notice.js'

test('仅统计存在提货码且未读的订单', () => {
  assert.equal(unreadOrderCount([{ pickup_code:'A', notice_read:0 }, { pickup_code:'B', notice_read:1 }, { pickup_code:null, notice_read:0 }]), 1)
  assert.equal(unreadOrderCount([]), 0)
})
