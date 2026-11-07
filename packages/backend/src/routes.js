import express from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { toCents, fromCents, validateTransfer } from './commerce/money.js'
import { resolveRewardRecipient } from './commerce/reward-recipient.js'

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const required = (value, message) => { if (!value) throw fail(message); return value }
const requestId = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(value)) throw fail('请求标识无效'); return value }
const phoneValid = phone => /^1\d{10}$/.test(phone || '')
const productCategory = value => { if (value == null || value === '') return '未分类'; if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw fail('商品分类需为 1 至 40 个字符'); return value.trim() }
const fingerprint = values => crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex')
const sameRequest = (row, expected) => { if (row.request_fingerprint !== expected) throw fail('请求标识已用于其他操作', 409); return row }

export function routes(db, secret) {
  const r = express.Router()
  const authorize = role => async (req, res, next) => {
    try {
      const identity = jwt.verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), secret)
      if (identity.role !== role) throw fail('无权限', 403)
      const [[row]] = await db.query(`SELECT id FROM ${role === 'admin' ? 'admins' : 'users'} WHERE id = ?${role === 'user' ? " AND status = 'active'" : ''}`, [identity.id])
      if (!row) throw fail('账户不可用', 401)
      req.identity = identity; next()
    } catch (e) { next(e.status ? e : fail('请先登录', 401)) }
  }
  const user = authorize('user'), admin = authorize('admin')
  const token = (id, role) => jwt.sign({ id, role }, secret, { expiresIn: '7d' })
  const transaction = async fn => {
    for (let attempt = 0; ; attempt += 1) {
      const c = await db.getConnection()
      try { await c.beginTransaction(); const result = await fn(c); await c.commit(); return result }
      catch (e) { await c.rollback(); if (attempt >= 2 || !['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(e.code)) throw e }
      finally { c.release() }
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }

  r.post('/auth/login', wrap(async (req, res) => {
    const { phone, password } = req.body
    const [[row]] = await db.query("SELECT id, password_hash FROM users WHERE phone = ? AND status = 'active'", [phone || ''])
    if (!row || !await bcrypt.compare(String(password || ''), row.password_hash)) throw fail('手机号或密码错误', 401)
    res.json({ token: token(row.id, 'user') })
  }))
  r.post('/auth/register', wrap(async (req, res) => {
    const { phone, username, password, invite_code } = req.body
    if (!phoneValid(phone) || !/^[\w\u4e00-\u9fa5]{2,20}$/.test(username || '') || typeof password !== 'string' || password.length < 6 || password.length > 64) throw fail('请填写有效的手机号、用户名和密码')
    const hash = await bcrypt.hash(password, 10)
    const id = await transaction(async c => {
      const [[parent]] = await c.query("SELECT id FROM users WHERE invite_code = ? AND is_root = 0 AND status = 'active' FOR UPDATE", [String(invite_code || '').toUpperCase()])
      if (!parent) throw fail('邀请码无效')
      const [result] = await c.query('INSERT INTO users (phone, username, password_hash, invite_code, parent_id) VALUES (?, ?, ?, ?, ?)', [phone, username, hash, crypto.randomBytes(6).toString('hex').toUpperCase(), parent.id])
      return result.insertId
    })
    res.json({ token: token(id, 'user') })
  }))
  r.post('/admin/login', wrap(async (req, res) => {
    const [[row]] = await db.query('SELECT id, password_hash FROM admins WHERE username = ?', [req.body.username || ''])
    if (!row || !await bcrypt.compare(String(req.body.password || ''), row.password_hash)) throw fail('用户名或密码错误', 401)
    res.json({ token: token(row.id, 'admin') })
  }))
  r.put('/account', user, wrap(async (req, res) => {
    const { username, old_password, new_password } = req.body
    if (username !== undefined) {
      if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(username)) throw fail('用户名为 2-20 位中文、字母、数字或下划线')
    }
    if (new_password !== undefined && (typeof new_password !== 'string' || new_password.length < 6 || new_password.length > 64)) throw fail('新密码长度为 6 至 64 位')
    await transaction(async c => {
      const [[row]] = await c.query('SELECT password_hash FROM users WHERE id=? FOR UPDATE', [req.identity.id])
      if (!row) throw fail('用户不存在', 404)
      if (new_password !== undefined) {
        if (!await bcrypt.compare(String(old_password || ''), row.password_hash)) throw fail('原密码错误')
        await c.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(new_password, 10), req.identity.id])
      }
      if (username !== undefined) await c.query('UPDATE users SET username=? WHERE id=?', [username, req.identity.id])
    })
    res.json({ ok: true })
  }))
  r.get('/addresses', user, wrap(async (req, res) => { const [data] = await db.query('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [req.identity.id]); res.json({ data }) }))
  r.post('/addresses', user, wrap(async (req, res) => {
    const { contact_name, contact_phone, province, city, district, detail } = req.body
    if (![contact_name, contact_phone, province, city, district, detail].every(x => typeof x === 'string' && x.trim())) throw fail('请填写完整地址')
    await transaction(async c => { await c.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [req.identity.id]); await c.query('INSERT INTO addresses (user_id, contact_name, contact_phone, province, city, district, detail, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', [req.identity.id, contact_name, contact_phone, province, city, district, detail]) })
    res.json({ ok: true })
  }))
  r.delete('/addresses/:id', user, wrap(async (req, res) => { await db.query('DELETE FROM addresses WHERE id = ? AND user_id = ?', [req.params.id, req.identity.id]); res.json({ ok: true }) }))
  r.put('/addresses/:id', user, wrap(async (req, res) => {
    const b = req.body
    if (![b.contact_name,b.contact_phone,b.province,b.city,b.district,b.detail].every(x => typeof x === 'string' && x.trim())) throw fail('请填写完整地址')
    await db.query('UPDATE addresses SET contact_name=?,contact_phone=?,province=?,city=?,district=?,detail=? WHERE id=? AND user_id=?', [b.contact_name,b.contact_phone,b.province,b.city,b.district,b.detail,req.params.id,req.identity.id]); res.json({ ok: true })
  }))
  r.get('/team', user, wrap(async (req, res) => {
    const [data] = await db.query('WITH RECURSIVE team AS (SELECT id, 1 depth FROM users WHERE parent_id = ? UNION ALL SELECT u.id, team.depth + 1 FROM users u JOIN team ON u.parent_id = team.id WHERE team.depth < 100) SELECT depth, COUNT(*) count FROM team GROUP BY depth ORDER BY depth', [req.identity.id])
    res.json({ data })
  }))
  r.get('/transactions', user, wrap(async (req, res) => { const [data] = await db.query('SELECT * FROM coupon_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 200', [req.identity.id]); res.json({ data }) }))
  r.get('/orders', user, wrap(async (req, res) => { const [data] = await db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 200', [req.identity.id]); res.json({ data }) }))
  r.get('/orders/unread-count', user, wrap(async (req, res) => { const [[row]] = await db.query('SELECT COUNT(*) AS count FROM orders WHERE user_id=? AND pickup_code IS NOT NULL AND pickup_code <> ? AND notice_read=0', [req.identity.id, '']); res.json({ data: { count: Number(row.count) } }) }))
  r.put('/orders/:id/read', user, wrap(async (req, res) => { await db.query('UPDATE orders SET notice_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.identity.id]); res.json({ ok: true }) }))
  r.post('/transfer', user, wrap(async (req, res) => {
    const amount = fromCents(validateTransfer(req.body.amount)); const rid = requestId(req.body.request_id), fp = fingerprint([req.body.phone, amount])
    const result = await transaction(async c => {
      const [[old]] = await c.query('SELECT id,request_fingerprint FROM transfers WHERE sender_id = ? AND request_id = ?', [req.identity.id, rid]); if (old) return sameRequest(old, fp)
      const [[target]] = await c.query("SELECT id FROM users WHERE phone = ? AND status = 'active'", [req.body.phone || ''])
      if (!target || target.id === req.identity.id) throw fail('收款用户不存在或为本人')
      const [rows] = await c.query('SELECT id, password_hash, balance, status FROM users WHERE id IN (?, ?) ORDER BY id FOR UPDATE', [req.identity.id, target.id])
      const [[again]] = await c.query('SELECT id,request_fingerprint FROM transfers WHERE sender_id = ? AND request_id = ? FOR UPDATE', [req.identity.id, rid]); if (again) return sameRequest(again, fp)
      const sender = rows.find(x => x.id === req.identity.id)
      const receiver = rows.find(x => x.id === target.id)
      if (!receiver || receiver.status !== 'active' || !sender || sender.status !== 'active') throw fail('账户不可用')
      if (!sender || !await bcrypt.compare(String(req.body.password || ''), sender.password_hash)) throw fail('密码错误')
      if (toCents(sender.balance) < toCents(amount)) throw fail('产品券余额不足')
      await c.query('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, req.identity.id]); await c.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, target.id])
      const [insert] = await c.query('INSERT INTO transfers (sender_id, recipient_id, request_id, request_fingerprint, amount) VALUES (?, ?, ?, ?, ?)', [req.identity.id, target.id, rid, fp, amount])
      await c.query("INSERT INTO coupon_transactions (user_id,type,amount,description) VALUES (?, 'transfer_out', -?, '产品券转出'), (?, 'transfer_in', ?, '产品券转入')", [req.identity.id, amount, target.id, amount])
      return { id: insert.insertId }
    }); res.json({ data: result })
  }))
  r.post('/purchases', user, wrap(async (req, res) => {
    const rid = requestId(req.body.request_id), productId = Number(req.body.product_id), addressId = Number(req.body.address_id), fp = fingerprint([Number(req.body.product_id), Number(req.body.address_id), req.body.variant || ''])
    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(addressId) || addressId < 1) throw fail('请选择商品和地址')
    const data = await transaction(async c => {
      const [[buyer]] = await c.query('SELECT * FROM users WHERE id = ? FOR UPDATE', [req.identity.id])
      const [[existing]] = await c.query('SELECT id, order_no, request_fingerprint FROM orders WHERE user_id = ? AND request_id = ? FOR UPDATE', [req.identity.id, rid]); if (existing) return sameRequest(existing, fp)
      if (!buyer || buyer.is_root || buyer.status !== 'active') throw fail('账户不可购买')
      const [[product]] = await c.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [productId])
      if (!product || !product.active || product.stock < 1) throw fail('商品不可购买或库存不足')
      if (toCents(buyer.balance) < toCents(product.cost)) throw fail('产品券余额不足')
      const [[address]] = await c.query('SELECT contact_name,contact_phone,province,city,district,detail FROM addresses WHERE id = ? AND user_id = ?', [addressId, buyer.id]); if (!address) throw fail('请选择有效收货地址')
      const options = typeof product.options === 'string' ? JSON.parse(product.options) : (product.options || [])
      const option = options.find(x => x.id === req.body.variant); if (options.length && !option) throw fail('请选择商品款式')
      const [[root]] = await c.query("SELECT id FROM users WHERE is_root = 1 AND status = 'active' LIMIT 1 FOR UPDATE"); if (!root) throw fail('系统根账户未配置')
      const sequence = buyer.purchase_count + 1
      const recipient = await resolveRewardRecipient({ buyerId: buyer.id, sequence, rootUserId: root.id, getParentId: async id => { const [[row]] = await c.query('SELECT parent_id FROM users WHERE id = ?', [id]); return row?.parent_id }, getPurchaseCount: async id => { const [[row]] = await c.query('SELECT purchase_count FROM users WHERE id = ? FOR UPDATE', [id]); return row?.purchase_count || 0 } })
      await c.query('UPDATE users SET balance = balance - ?, purchase_count = purchase_count + 1 WHERE id = ?', [product.cost, buyer.id]); await c.query('UPDATE users SET balance = balance + ? WHERE id = ?', [product.reward, recipient.recipientId]); await c.query('UPDATE products SET stock = stock - 1 WHERE id = ?', [product.id])
      const orderNo = `TR${Date.now()}${crypto.randomBytes(5).toString('hex').toUpperCase()}`
      const [order] = await c.query('INSERT INTO orders (order_no,user_id,product_id,request_id,request_fingerprint,product_name,variant,address,cost,reward,purchase_sequence,recipient_id,reward_destination) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [orderNo, buyer.id, product.id, rid, fp, product.name, option?.label || null, JSON.stringify(address), product.cost, product.reward, sequence, recipient.recipientId, recipient.destination])
      await c.query("INSERT INTO coupon_transactions (user_id,type,amount,description,order_id) VALUES (?, 'purchase', -?, ?, ?), (?, 'reward', ?, ?, ?)", [buyer.id, product.cost, `购买 ${product.name}`, order.insertId, recipient.recipientId, product.reward, `商圈收益 ${product.name}`, order.insertId])
      return { id: order.insertId, order_no: orderNo }
    }); res.json({ data })
  }))
  r.get('/admin/users', admin, wrap(async (_req, res) => { const [data] = await db.query('SELECT id,phone,username,invite_code,parent_id,is_root,status,balance,purchase_count,created_at FROM users ORDER BY id DESC LIMIT 500'); res.json({ data }) }))
  r.put('/admin/users/:id/status', admin, wrap(async (req, res) => { if (!['active','disabled'].includes(req.body.status)) throw fail('状态无效'); const [result] = await db.query('UPDATE users SET status=? WHERE id=? AND is_root=0', [req.body.status,req.params.id]); if (!result.affectedRows) throw fail('用户不存在或为根账户'); res.json({ ok: true }) }))
  r.post('/admin/users/:id/topup', admin, wrap(async (req, res) => {
    const amount = fromCents(toCents(req.body.amount)), rid = requestId(req.body.request_id), fp = fingerprint([String(req.params.id), amount]); if (toCents(amount) < 1) throw fail('充值金额必须大于零')
    await transaction(async c => { const [[userRow]] = await c.query('SELECT id FROM users WHERE id=? FOR UPDATE', [req.params.id]); if (!userRow) throw fail('用户不存在', 404); const [[old]] = await c.query('SELECT id,request_fingerprint FROM topups WHERE admin_id=? AND request_id=? FOR UPDATE', [req.identity.id,rid]); if (old) return sameRequest(old,fp); await c.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, req.params.id]); await c.query('INSERT INTO topups (admin_id,user_id,request_id,request_fingerprint,amount) VALUES (?,?,?,?,?)', [req.identity.id,req.params.id,rid,fp,amount]); await c.query("INSERT INTO coupon_transactions (user_id,type,amount,description) VALUES (?, 'topup', ?, ?)", [req.params.id, amount, `管理员 ${req.identity.id} 充值`]) }); res.json({ ok: true })
  }))
  r.get('/admin/products', admin, wrap(async (_req, res) => { const [data] = await db.query('SELECT * FROM products ORDER BY id DESC'); res.json({ data }) }))
  r.post('/admin/products', admin, wrap(async (req, res) => {
    const b = req.body; required(b.name, '请输入商品名称'); const cost = fromCents(toCents(b.cost)), reward = fromCents(toCents(b.reward)); const stock = Number(b.stock)
    if (!Number.isSafeInteger(stock) || stock < 0) throw fail('库存无效')
    await db.query('INSERT INTO products (name,category,description,image,cost,reward,stock,options,detail_images) VALUES (?,?,?,?,?,?,?,?,?)', [b.name, productCategory(b.category), b.description || '', b.image || '', cost, reward, stock, JSON.stringify(b.options || []), JSON.stringify(b.detail_images || [])]); res.json({ ok: true })
  }))
  r.put('/admin/products/:id', admin, wrap(async (req, res) => {
    const b = req.body; required(b.name, '请输入商品名称'); const cost = fromCents(toCents(b.cost)), reward = fromCents(toCents(b.reward)); const stock = Number(b.stock); if (!Number.isSafeInteger(stock) || stock < 0) throw fail('库存无效')
    await db.query('UPDATE products SET name=?,category=?,description=?,image=?,cost=?,reward=?,stock=?,active=?,options=?,detail_images=? WHERE id=?', [b.name,productCategory(b.category),b.description || '',b.image || '',cost,reward,stock,b.active ? 1 : 0,JSON.stringify(b.options || []),JSON.stringify(b.detail_images || []),req.params.id]); res.json({ ok: true })
  }))
  r.get('/admin/orders', admin, wrap(async (_req, res) => { const [data] = await db.query('SELECT o.*, u.username, u.phone, recipient.username recipient_name FROM orders o JOIN users u ON u.id=o.user_id JOIN users recipient ON recipient.id=o.recipient_id ORDER BY o.id DESC LIMIT 500'); res.json({ data }) }))
  r.put('/admin/orders/:id/notice', admin, wrap(async (req, res) => { const code = String(req.body.pickup_code || '').trim(); if (!code || code.length > 100 || String(req.body.message || '').length > 500) throw fail('提货码或留言无效'); await db.query('UPDATE orders SET pickup_code=?, pickup_message=?, notice_read=0 WHERE id=? AND status <> ?', [code,req.body.message || '',req.params.id,'cancelled']); res.json({ ok: true }) }))
  r.get('/admin/overview', admin, wrap(async (_req, res) => { const [[data]] = await db.query('SELECT COUNT(*) order_count, COALESCE(SUM(cost),0) total_cost, COALESCE(SUM(reward),0) total_reward FROM orders'); res.json({ data }) }))
  return r
}
