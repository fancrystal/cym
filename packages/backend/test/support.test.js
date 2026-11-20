import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'

test('客服接口拒绝空留言并要求登录', async t => {
  const db = { query: async () => [[{id:1}]] }
  const server = createApp({db,secret:'test-secret'}).listen(0,'127.0.0.1')
  t.after(()=>server.close())
  await new Promise(resolve=>server.once('listening',resolve))
  const url=`http://127.0.0.1:${server.address().port}/api/support/messages`
  assert.equal((await fetch(url)).status,401)
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({id:1,role:'user'},'test-secret')}`},body:JSON.stringify({content:' '})})
  assert.equal(response.status,400)
  assert.equal((await response.json()).message, "\u7559\u8a00\u5185\u5bb9\u9700\u4e3a 1 \u81f3 1000 \u5b57")
})
