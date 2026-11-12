import {test} from 'node:test'
import assert from 'node:assert/strict'
import { inviteCodeFromUrl } from '../../h5/src/invite.js'

test('只接受商圈域名的邀请注册链接，保留邀请码',()=>{
  assert.equal(inviteCodeFromUrl('https://cym.green/#/login?transfer_invite=ABC123'), 'ABC123')
  assert.equal(inviteCodeFromUrl('https://cym.green/?transfer_invite=ABC123'), 'ABC123')
  for (const url of ['https://cym.green.evil.test/#/login?transfer_invite=ABC123','http://cym.green/#/login?transfer_invite=ABC123','https://cym.green/#/login?transfer_invite=<bad>','https://cym.green/#/other?transfer_invite=ABC123']) assert.equal(inviteCodeFromUrl(url),null)
})
