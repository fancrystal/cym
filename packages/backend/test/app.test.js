import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'

test('健康检查返回正常状态，旧聊天室接口不存在', async t => {
  const server = createApp().listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const health = await fetch(`${base}/api/health`)
  assert.deepEqual(await health.json(), { ok: true })
  assert.equal((await fetch(`${base}/api/chat`)).status, 404)
})

test('未登录不能访问用户资料，商品列表可公开读取', async t => {
  const db = { query: async () => [[{ id: 1, name: '测试商品', cost: '69.80', stock: 2 }]] }
  const server = createApp({ db, secret: 'test-secret' }).listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(`${base}/api/me`)).status, 401)
  const products = await (await fetch(`${base}/api/products`)).json()
  assert.equal(products.data[0].name, '测试商品')
})

test('登录连续失败后暂时限制请求', async t => {
  const db = { query: async () => [[]] }
  const server = createApp({ db, secret: 'test-secret' }).listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise(resolve => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}/api/auth/login`
  let response
  for (let i = 0; i < 11; i++) response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '19900000000', password: 'bad' }) })
  assert.equal(response.status, 429)
})
