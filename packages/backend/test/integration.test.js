import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import 'dotenv/config'
import { createPool } from '../src/db.js'
import { createApp } from '../src/app.js'

test('MySQL 注册、充值、购买、重复请求及转赠保持账目一致', { skip: process.env.CYM_INTEGRATION !== '1' }, async t => {
  const db = createPool(), suffix = String(Date.now()).slice(-8), firstPhone = `19${suffix}1`, childPhone = `19${suffix}2`, invite = crypto.randomBytes(6).toString('hex').toUpperCase()
  let first, child, product
  const server = createApp({ db, secret: process.env.JWT_SECRET }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => {
    server.close()
    if (first && child) {
      await db.query('DELETE FROM topups WHERE user_id IN (?,?)', [first, child])
      await db.query('DELETE FROM coupon_transactions WHERE user_id IN (?,?) OR order_id IN (SELECT id FROM orders WHERE user_id IN (?,?))', [first, child, first, child])
      await db.query('DELETE FROM transfers WHERE sender_id IN (?,?) OR recipient_id IN (?,?)', [first, child, first, child])
      await db.query('DELETE FROM orders WHERE user_id IN (?,?)', [first, child])
      await db.query('DELETE FROM addresses WHERE user_id IN (?,?)', [first, child])
      await db.query('DELETE FROM users WHERE id=?', [child])
    }
    if (first) await db.query('DELETE FROM users WHERE id=?', [first])
    if (product) await db.query('DELETE FROM products WHERE id=?', [product])
    await db.end()
  })
  const call = async (path, body, token, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const json = await response.json(); assert.equal(response.status, 200, JSON.stringify(json)); return json.data ?? json
  }
  const [created] = await db.query('INSERT INTO users (phone,username,password_hash,invite_code,purchase_count) VALUES (?,?,?,?,1)', [firstPhone,`test_${suffix}`,await bcrypt.hash('testpass',10),invite]); first=created.insertId
  const registered = await call('/auth/register',{phone:childPhone,username:`child_${suffix}`,password:'testpass',invite_code:invite}); const childToken=registered.token
  const [[found]] = await db.query('SELECT id,parent_id FROM users WHERE phone=?',[childPhone]); child=found.id; assert.equal(found.parent_id,first)
  const admin = await call('/admin/login',{username:process.env.ADMIN_USERNAME || 'admin',password:process.env.ADMIN_PASSWORD})
  const topup={amount:'100.00',request_id:crypto.randomUUID()}; await Promise.all([call(`/admin/users/${child}/topup`,topup,admin.token), call(`/admin/users/${child}/topup`,topup,admin.token)])
  const [p] = await db.query("INSERT INTO products (name,description,cost,reward,stock) VALUES ('测试商品','',69.80,30.00,2)"); product=p.insertId
  await call('/addresses',{contact_name:'测试',contact_phone:childPhone,province:'上海',city:'上海',district:'浦东',detail:'测试地址'},childToken)
  const addresses = await call('/addresses',null,childToken,'GET')
  const payload={product_id:product,address_id:addresses[0].id,request_id:crypto.randomUUID()}
  const [a,b]=await Promise.all([call('/purchases',payload,childToken), call('/purchases',payload,childToken)]); assert.equal(a.id,b.id)
  const [[state]]=await db.query('SELECT balance,purchase_count FROM users WHERE id=?',[child]); assert.equal(state.balance,'30.20'); assert.equal(state.purchase_count,1)
  const [[stock]]=await db.query('SELECT stock FROM products WHERE id=?',[product]); assert.equal(stock.stock,1)
  const transfer={phone:firstPhone,amount:'10',password:'testpass',request_id:crypto.randomUUID()}
  const [x,y]=await Promise.all([call('/transfer',transfer,childToken), call('/transfer',transfer,childToken)]); assert.equal(x.id,y.id)
  const mismatch = await fetch(`http://127.0.0.1:${server.address().port}/api/transfer`, {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${childToken}`},body:JSON.stringify({...transfer,amount:'11'})})
  assert.equal(mismatch.status, 409)
  const [[balance]]=await db.query('SELECT balance FROM users WHERE id=?',[child]); assert.equal(balance.balance,'20.20')
})
