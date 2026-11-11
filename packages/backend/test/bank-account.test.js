import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encryptBankAccount, decryptBankAccount } from '../src/commerce/bank-account.js'

test('支付宝账号使用独立密钥加密并检测篡改',()=>{
  const key='11'.repeat(32), account='6222001234567890'
  const cipher=encryptBankAccount(account,key)
  assert.ok(!cipher.includes(account))
  assert.equal(decryptBankAccount(cipher,key),account)
  assert.throws(()=>decryptBankAccount(cipher,'22'.repeat(32)))
})
