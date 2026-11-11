import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import 'dotenv/config'
import { createPool } from '../src/db.js'
import { createApp } from '../src/app.js'
process.env.WITHDRAWAL_ENCRYPTION_KEY ||= '11'.repeat(32)

test('MySQL 注册、充值、购买、重复请求及转赠保持账目一致', { skip: process.env.CYM_INTEGRATION !== '1' }, async t => {
  const db = createPool(), suffix = String(Date.now()).slice(-8), firstPhone = `19${suffix}1`, childPhone = `19${suffix}2`, invite = crypto.randomBytes(6).toString('hex').toUpperCase()
  let first, child, product
  const productName = `测试商品_${suffix}`
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
    else await db.query('DELETE FROM products WHERE name=?', [productName])
    await db.end()
  })
  const [[zone]] = await db.query('SELECT @@session.time_zone AS zone')
  assert.equal(zone.zone, '+08:00')
  const call = async (path, body, token, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const json = await response.json(); assert.equal(response.status, 200, JSON.stringify(json)); return json.data ?? json
  }
  const [created] = await db.query('INSERT INTO users (phone,username,password_hash,invite_code,purchase_count) VALUES (?,?,?,?,1)', [firstPhone,`test_${suffix}`,await bcrypt.hash('testpass',10),invite]); first=created.insertId
  const registered = await call('/auth/register',{phone:childPhone,username:`child_${suffix}`,password:'testpass',invite_code:invite,alipay_account:'test@example.com'}); const childToken=registered.token
  const [[found]] = await db.query('SELECT id,parent_id FROM users WHERE phone=?',[childPhone]); child=found.id; assert.equal(found.parent_id,first)
  const admin = await call('/admin/login',{username:process.env.ADMIN_USERNAME || 'admin',password:process.env.ADMIN_PASSWORD})
  const status = async (path, token, method='GET', body) => (await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {method,headers:{'content-type':'application/json',...(token ? {authorization:`Bearer ${token}`} : {})},...(body ? {body:JSON.stringify(body)} : {})})).status
  assert.equal(await status('/admin/users',childToken),403)
  assert.equal(await status('/orders',admin.token),403)
  assert.equal(await status('/orders',null),401)
  await call(`/admin/users/${child}/status`,{status:'disabled'},admin.token,'PUT')
  assert.equal(await status('/orders',childToken),401)
  await call(`/admin/users/${child}/status`,{status:'active'},admin.token,'PUT')
  const topup={amount:'100.00',request_id:crypto.randomUUID()}; await Promise.all([call(`/admin/users/${child}/topup`,topup,admin.token), call(`/admin/users/${child}/topup`,topup,admin.token)])
  const invalidProduct={name:productName,description:'测试',cost:'1',reward:'0',stock:1}
  assert.equal(await status('/admin/products',admin.token,'POST',{...invalidProduct,options:{bad:true}}),400)
  assert.equal(await status('/admin/products',admin.token,'POST',{...invalidProduct,options:[{id:'a',label:'红色'},{id:'a',label:'蓝色'}]}),400)
  assert.equal(await status('/admin/products',admin.token,'POST',{...invalidProduct,detail_images:Array(10).fill('/api/uploads/test.png')}),400)
  await call('/admin/products',{name:productName,description:'测试',category:'生活用品',image:'/api/uploads/test-image.png',cost:'69.80',reward:'30.00',stock:2,active:false},admin.token)
  const [[p]] = await db.query('SELECT id,category FROM products WHERE name=?',[productName]); product=p.id; assert.equal(p.category,'生活用品')
  const visible = await call('/products',null,null,'GET'); assert.equal(visible.find(item=>item.id===product),undefined)
  await call(`/admin/products/${product}`,{name:productName,description:'测试',category:'健康食品',image:'/api/uploads/test-image.png',cost:'69.80',reward:'30.00',stock:2,active:true,options:[{id:'red',label:'红色'},{id:'blue',label:'蓝色'}]},admin.token,'PUT')
  const edited = await call('/products',null,null,'GET'); assert.equal(edited.find(item=>item.id===product)?.category,'健康食品')
  await call('/addresses',{contact_name:'测试',contact_phone:childPhone,detail:'上海市浦东测试地址'},childToken)
  const addresses = await call('/addresses',null,childToken,'GET')
  const foreignToken=jwt.sign({id:first,role:'user'},process.env.JWT_SECRET)
  assert.equal(await status(`/addresses/${addresses[0].id}`,foreignToken,'PUT',{contact_name:'其他',contact_phone:firstPhone,detail:'地址'}),404)
  assert.equal(await status(`/addresses/${addresses[0].id}`,foreignToken,'DELETE'),404)
  assert.equal(addresses[0].detail,'上海市浦东测试地址')
  await call(`/addresses/${addresses[0].id}`,{contact_name:'测试',contact_phone:childPhone,detail:'上海市浦东新地址'},childToken,'PUT')
  const payload={product_id:product,address_id:addresses[0].id,variant:'red',request_id:crypto.randomUUID()}
  const [[root]]=await db.query('SELECT id FROM users WHERE is_root=1 LIMIT 1')
  const rootToken=jwt.sign({id:root.id,role:'user'},process.env.JWT_SECRET)
  const rootAttempt=await fetch(`http://127.0.0.1:${server.address().port}/api/purchases`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${rootToken}`},body:JSON.stringify(payload)})
  assert.equal(rootAttempt.status,400); assert.match((await rootAttempt.json()).message,/根账户/)
  const [a,b]=await Promise.all([call('/purchases',payload,childToken), call('/purchases',payload,childToken)]); assert.equal(a.id,b.id)
  assert.equal((await call('/orders',null,childToken,'GET')).find(order=>order.id===a.id).product_image,'/api/uploads/test-image.png')
  const [[purchased]]=await db.query('SELECT variant,address FROM orders WHERE id=?',[a.id]); assert.equal(purchased.variant,'红色')
  const firstLogin = await call('/auth/login',{phone:firstPhone,password:'testpass'})
  const earnings = await call('/team/earnings',null,firstLogin.token,'GET')
  assert.equal(earnings.total_reward,'30.00')
  const confirm = (token) => fetch(`http://127.0.0.1:${server.address().port}/api/orders/${a.id}/confirm`, {method:'PUT',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:'{}'})
  assert.equal((await confirm(firstLogin.token)).status,404)
  assert.equal((await confirm(childToken)).status,400)
  await call(`/admin/orders/${a.id}/notice`,{pickup_code:'TEST123',message:'请领取'},admin.token,'PUT')
  assert.equal((await call('/orders/unread-count',null,childToken,'GET')).count,1)
  await call(`/orders/${a.id}/read`,{},childToken,'PUT')
  assert.equal((await call('/orders/unread-count',null,childToken,'GET')).count,0)
  await call(`/admin/orders/${a.id}/notice`,{pickup_code:'TEST456'},admin.token,'PUT')
  assert.equal((await call('/orders/unread-count',null,childToken,'GET')).count,1)
  assert.equal((await confirm(childToken)).status,200)
  const confirmed = (await call('/orders',null,childToken,'GET')).find(order => order.id === a.id)
  assert.ok(confirmed.received_at)
  assert.equal((await call('/orders/unread-count',null,childToken,'GET')).count,0)
  assert.equal((await confirm(childToken)).status,200)
  assert.equal((await call('/orders',null,childToken,'GET')).find(order => order.id === a.id).received_at,confirmed.received_at)
  for (let i = 0; i < 201; i++) await db.query('INSERT INTO orders (order_no,user_id,product_id,request_id,request_fingerprint,product_name,variant,address,cost,reward,purchase_sequence,recipient_id,reward_destination) SELECT ?,user_id,product_id,?,request_fingerprint,product_name,variant,address,cost,reward,purchase_sequence,recipient_id,reward_destination FROM orders WHERE id=?', [`TEST_${suffix}_${i}`,crypto.randomUUID(),a.id])
  await db.query("UPDATE orders SET status='cancelled' WHERE order_no=?", [`TEST_${suffix}_0`])
  assert.ok((await call('/orders',null,childToken,'GET')).some(order => order.id === a.id))
  await call(`/admin/products/${product}`,{name:productName+'_改名',description:'测试',category:'健康食品',cost:'69.80',reward:'30.00',stock:1,active:true},admin.token,'PUT')
  const report = await call('/admin/overview',null,admin.token,'GET')
  assert.ok(report.trend.some(row => Number(row.order_count) >= 1))
  assert.ok(report.products.some(row => row.product_name === productName+'_改名' && row.product_id === product && row.order_count === 201))
  const searchedOrders = await call(`/admin/orders?q=${encodeURIComponent(childPhone)}`,null,admin.token,'GET')
  assert.ok(searchedOrders.some(order => order.id === a.id))
  assert.ok(searchedOrders.every(order => order.phone.includes(childPhone)))
  const ledger = await call(`/admin/users/${child}/transactions`,null,admin.token,'GET')
  assert.ok(ledger.some(entry => entry.type === 'purchase'))
  const searchedUsers = await call(`/admin/users?q=${encodeURIComponent(childPhone)}`,null,admin.token,'GET')
  assert.deepEqual(searchedUsers.map(user => user.id),[child])
  const [[state]]=await db.query('SELECT balance,purchase_count FROM users WHERE id=?',[child]); assert.equal(state.balance,'30.20'); assert.equal(state.purchase_count,1)
  const [[stock]]=await db.query('SELECT stock FROM products WHERE id=?',[product]); assert.equal(stock.stock,1)
  const transfer={phone:firstPhone,amount:'10',password:'testpass',request_id:crypto.randomUUID()}
  const [x,y]=await Promise.all([call('/transfer',transfer,childToken), call('/transfer',transfer,childToken)]); assert.equal(x.id,y.id)
  const mismatch = await fetch(`http://127.0.0.1:${server.address().port}/api/transfer`, {method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${childToken}`},body:JSON.stringify({...transfer,amount:'11'})})
  assert.equal(mismatch.status, 409)
  const [[balance]]=await db.query('SELECT balance FROM users WHERE id=?',[child]); assert.equal(balance.balance,'20.20')
})

test('后台创建独立普通用户或指定上级，并原子记录初始产品券', { skip: process.env.CYM_INTEGRATION !== '1' }, async t => {
  const db=createPool(), suffix=String(Date.now()).slice(-8), phones=[`18${suffix}1`,`18${suffix}2`], ids=[]
  const [[admin]]=await db.query('SELECT id FROM admins ORDER BY id LIMIT 1')
  const server=createApp({db,secret:process.env.JWT_SECRET}).listen(0,'127.0.0.1')
  await new Promise(resolve=>server.once('listening',resolve))
  t.after(async()=>{server.close(); for(const id of [...ids].reverse()){await db.query('DELETE FROM topups WHERE user_id=?',[id]); await db.query('DELETE FROM coupon_transactions WHERE user_id=?',[id]); await db.query('DELETE FROM users WHERE id=?',[id])} await db.end()})
  const token=jwt.sign({id:admin.id,role:'admin'},process.env.JWT_SECRET)
  const create=body=>fetch(`http://127.0.0.1:${server.address().port}/api/admin/users`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)})
  let response=await create({phone:phones[0],username:`parent_${suffix}`,password:'testpass',parent_phone:'',balance:'2000'})
  assert.equal(response.status,200); let data=(await response.json()).data; ids.push(data.id)
  response=await create({phone:phones[1],username:`child_${suffix}`,password:'testpass',parent_phone:phones[0],balance:'25.50'})
  assert.equal(response.status,200); data=(await response.json()).data; ids.push(data.id)
  const [[user]]=await db.query('SELECT parent_id,is_root,balance,password_hash,invite_code FROM users WHERE id=?',[ids[1]])
  assert.equal(user.parent_id,ids[0]); assert.equal(user.is_root,0); assert.equal(user.balance,'25.50'); assert.ok(user.invite_code); assert.ok(await bcrypt.compare('testpass',user.password_hash))
  const [[ledger]]=await db.query("SELECT amount FROM coupon_transactions WHERE user_id=? AND type='topup'",[ids[1]]); assert.equal(ledger.amount,'25.50')
  assert.equal((await create({phone:phones[1],username:`again_${suffix}`,password:'testpass',balance:'99'})).status,409)
  assert.equal((await create({phone:`17${suffix}3`,username:`bad_${suffix}`,password:'testpass',parent_phone:'18801620766',balance:'1'})).status,400)
})
