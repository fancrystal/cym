import express from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import path from 'node:path'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import sharp from 'sharp'
import { toCents, fromCents, validateTransfer } from './commerce/money.js'
import { resolveRewardRecipient } from './commerce/reward-recipient.js'
import { withdrawalAmounts } from './commerce/withdrawal.js'
import { encryptBankAccount, decryptBankAccount } from './commerce/bank-account.js'

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const required = (value, message) => { if (!value) throw fail(message); return value }
const requestId = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(value)) throw fail('请求标识无效'); return value }
const phoneValid = phone => /^1\d{10}$/.test(phone || '')
const alipayValid = value => typeof value==='string' && value.trim().length>=5 && Buffer.byteLength(value.trim(),'utf8')<=100 && !/\s/.test(value.trim())
const productCategory = value => { if (value == null || value === '') return '未分类'; if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw fail('商品分类需为 1 至 40 个字符'); return value.trim() }
const productLists = body => {
  const options = body.options ?? [], images = body.detail_images ?? []
  if (!Array.isArray(options) || options.length > 50) throw fail('商品款式格式无效')
  const ids = new Set()
  const normalized = options.map(o => { if (!o || typeof o.id !== 'string' || !o.id.trim() || o.id.length > 100 || typeof o.label !== 'string' || !o.label.trim() || o.label.length > 100 || ids.has(o.id)) throw fail('款式名称或编号无效'); ids.add(o.id); return {id:o.id,label:o.label.trim()} })
  if (!Array.isArray(images) || images.length > 9 || images.some(x => typeof x !== 'string' || !x || x.length > 1000)) throw fail('详情图片无效，最多 9 张')
  return {options:normalized,images}
}
const fingerprint = values => crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex')
const sameRequest = (row, expected) => { if (row.request_fingerprint !== expected) throw fail('请求标识已用于其他操作', 409); return row }

export function routes(db, secret, uploadDir) {
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
  const userOrAdmin = (req,res,next) => { try { const id=jwt.verify((req.headers.authorization||'').replace(/^Bearer\s+/i,''),secret); if(!['user','admin'].includes(id.role))throw fail('无权限',403); return authorize(id.role)(req,res,next) } catch(e){return next(e.status?e:fail('请先登录',401))} }
  r.post('/admin/uploads', admin, express.raw({ type: ['image/jpeg','image/png','image/webp','image/gif'], limit: '5mb' }), wrap(async (req, res) => {
    const b = req.body
    if (!Buffer.isBuffer(b) || !b.length) throw fail('请选择 JPG、PNG、GIF 或 WebP 图片')
    const isPng = b.length >= 8 && b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
    const isJpeg = b.length >= 3 && b.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))
    const isGif = b.length >= 6 && ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString('ascii'))
    const isWebp = b.length >= 12 && b.subarray(0,4).toString('ascii') === 'RIFF' && b.subarray(8,12).toString('ascii') === 'WEBP'
    const ext = isPng ? 'png' : isJpeg ? 'jpg' : isGif ? 'gif' : isWebp ? 'webp' : null
    if (!ext) throw fail('图片格式无效，请选择 JPG、PNG、GIF 或 WebP')
    try { await sharp(b, { limitInputPixels: 40000000, failOn: 'warning' }).resize(1,1).toBuffer() } catch { throw fail('图片已损坏或尺寸过大，请重新选择') }
    const filename = `${crypto.randomBytes(20).toString('hex')}.${ext}`
    await mkdir(uploadDir, { recursive: true }); await writeFile(path.join(uploadDir, filename), b, { flag:'wx' })
    res.json({data:{url:`/api/uploads/${filename}`}})
  }))
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
    const { phone, username, password, invite_code, alipay_account } = req.body
    if (!phoneValid(phone) || !/^[\w\u4e00-\u9fa5]{2,20}$/.test(username || '') || typeof password !== 'string' || password.length < 6 || password.length > 64) throw fail('请填写有效的手机号、用户名和密码')
    if(!alipayValid(alipay_account))throw fail('请填写有效的支付宝账号')
    const alipayEncrypted=encryptBankAccount(alipay_account.trim(),process.env.WITHDRAWAL_ENCRYPTION_KEY)
    const hash = await bcrypt.hash(password, 10)
    const id = await transaction(async c => {
      const [[parent]] = await c.query("SELECT id FROM users WHERE invite_code = ? AND is_root = 0 AND status = 'active' FOR UPDATE", [String(invite_code || '').toUpperCase()])
      if (!parent) throw fail('邀请码无效')
      const [result] = await c.query('INSERT INTO users (phone, username, password_hash, alipay_account, invite_code, parent_id) VALUES (?, ?, ?, ?, ?, ?)', [phone, username, hash, alipayEncrypted, crypto.randomBytes(6).toString('hex').toUpperCase(), parent.id])
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
  r.get('/account/alipay',user,wrap(async(req,res)=>{res.set('Cache-Control','no-store');const [[row]]=await db.query('SELECT alipay_account FROM users WHERE id=?',[req.identity.id]);const account=row?.alipay_account?decryptBankAccount(row.alipay_account,process.env.WITHDRAWAL_ENCRYPTION_KEY):'';res.json({data:{masked:account?'****'+account.slice(-4):''}})}))
  r.get('/addresses', user, wrap(async (req, res) => { const [data] = await db.query('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [req.identity.id]); res.json({ data }) }))
  r.post('/addresses', user, wrap(async (req, res) => {
    const { contact_name, contact_phone, detail } = req.body
    const { province = '', city = '', district = '' } = req.body
    if (![contact_name, contact_phone, detail].every(x => typeof x === 'string' && x.trim()) || contact_name.length > 100 || contact_phone.length > 20 || detail.length > 500) throw fail('请填写收件人、电话和不超过 500 字的收货地址')
    await transaction(async c => { await c.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [req.identity.id]); await c.query('INSERT INTO addresses (user_id, contact_name, contact_phone, province, city, district, detail, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', [req.identity.id, contact_name, contact_phone, province, city, district, detail]) })
    res.json({ ok: true })
  }))
  r.delete('/addresses/:id', user, wrap(async (req, res) => { const [result]=await db.query('DELETE FROM addresses WHERE id = ? AND user_id = ?', [req.params.id, req.identity.id]); if(!result.affectedRows)throw fail('地址不存在',404); res.json({ ok: true }) }))
  r.put('/addresses/:id', user, wrap(async (req, res) => {
    const b = req.body
    if (![b.contact_name,b.contact_phone,b.detail].every(x => typeof x === 'string' && x.trim()) || b.contact_name.length > 100 || b.contact_phone.length > 20 || b.detail.length > 500) throw fail('请填写收件人、电话和不超过 500 字的收货地址')
    const [result]=await db.query('UPDATE addresses SET contact_name=?,contact_phone=?,province=?,city=?,district=?,detail=? WHERE id=? AND user_id=?', [b.contact_name,b.contact_phone,b.province || '',b.city || '',b.district || '',b.detail,req.params.id,req.identity.id]); if(!result.affectedRows)throw fail('地址不存在',404); res.json({ ok: true })
  }))
  r.get('/team', user, wrap(async (req, res) => {
    const [data] = await db.query('WITH RECURSIVE team AS (SELECT id, 1 depth FROM users WHERE parent_id = ? UNION ALL SELECT u.id, team.depth + 1 FROM users u JOIN team ON u.parent_id = team.id WHERE team.depth < 100) SELECT depth, COUNT(*) count FROM team GROUP BY depth ORDER BY depth', [req.identity.id])
    res.json({ data })
  }))
  r.get('/team/earnings', user, wrap(async (req,res)=>{const [[row]]=await db.query("SELECT COALESCE(SUM(amount),0) total_reward FROM coupon_transactions WHERE user_id=? AND type='reward'",[req.identity.id]);res.json({data:row})}))
  r.get('/withdrawals', user, wrap(async (req,res)=>{res.set('Cache-Control','no-store');const [data]=await db.query("SELECT id,amount,fee,net,CONCAT('****',account_last4) account_number,status,reason,created_at,reviewed_at,paid_at,transfer_note,(proof_file IS NOT NULL AND status='paid') has_proof FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 200",[req.identity.id]);res.json({data})}))
  r.post('/withdrawals', user, wrap(async(req,res)=>{
    let amounts;try{amounts=withdrawalAmounts(req.body.amount)}catch(e){throw fail(e.message)}
    const rid=requestId(req.body.request_id)
    const accountName=String(req.body.account_name||'').trim(), suppliedAlipay=String(req.body.alipay_account||'').trim()
    if(!accountName||accountName.length>100 || (suppliedAlipay && !alipayValid(suppliedAlipay)))throw fail('请填写收款人和有效支付宝账号')
    const data=await transaction(async c=>{
      const [[account]]=await c.query("SELECT id,balance,password_hash,alipay_account FROM users WHERE id=? AND status='active' FOR UPDATE",[req.identity.id])
      if(!account || !await bcrypt.compare(String(req.body.password||''),account.password_hash))throw fail('登录密码错误')
      const accountNumber=suppliedAlipay || (account.alipay_account ? decryptBankAccount(account.alipay_account,process.env.WITHDRAWAL_ENCRYPTION_KEY) : '')
      if(!alipayValid(accountNumber))throw fail('请填写支付宝账号')
      const encryptedAccount=encryptBankAccount(accountNumber,process.env.WITHDRAWAL_ENCRYPTION_KEY), fp=fingerprint([amounts.amount,accountName,accountNumber])
      const [[existing]]=await c.query('SELECT id,request_fingerprint FROM withdrawals WHERE user_id=? AND request_id=? FOR UPDATE',[req.identity.id,rid]);if(existing)return {id:sameRequest(existing,fp).id}
      if(toCents(account.balance)<toCents(amounts.amount))throw fail('产品券余额不足')
      await c.query('UPDATE users SET balance=balance-? WHERE id=?',[amounts.amount,req.identity.id])
      if(suppliedAlipay)await c.query('UPDATE users SET alipay_account=? WHERE id=?',[encryptedAccount,req.identity.id])
      const [insert]=await c.query('INSERT INTO withdrawals (user_id,request_id,request_fingerprint,amount,fee,net,account_name,bank_name,account_number,account_last4) VALUES (?,?,?,?,?,?,?,?,?,?)',[req.identity.id,rid,fp,amounts.amount,amounts.fee,amounts.net,accountName,'支付宝',encryptedAccount,accountNumber.slice(-4)])
      await c.query("INSERT INTO coupon_transactions (user_id,type,amount,description) VALUES (?,'withdrawal',-?,?)",[req.identity.id,amounts.amount,`提现申请 #${insert.insertId}`])
      return {id:insert.insertId}
    });res.json({data})
  }))
  r.get('/admin/withdrawals',admin,wrap(async(_req,res)=>{res.set('Cache-Control','no-store');const [data]=await db.query("SELECT w.id,w.user_id,w.amount,w.fee,w.net,CONCAT('****',w.account_last4) account_number,w.status,w.reason,w.created_at,(w.proof_file IS NOT NULL) has_proof,w.transfer_note,u.username,u.phone FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY (w.status IN ('pending','approved')) DESC,w.id DESC");res.json({data})}))
  r.get('/admin/withdrawals/:id',admin,wrap(async(req,res)=>{res.set('Cache-Control','no-store');const [[data]]=await db.query('SELECT id,account_name,account_number FROM withdrawals WHERE id=?',[req.params.id]);if(!data)throw fail('提现申请不存在',404);data.account_number=decryptBankAccount(data.account_number,process.env.WITHDRAWAL_ENCRYPTION_KEY);res.json({data})}))
  r.get('/withdrawals/:id/proof',userOrAdmin,wrap(async(req,res)=>{const [[row]]=await db.query('SELECT user_id,proof_file,status FROM withdrawals WHERE id=?',[req.params.id]);if(!row || (req.identity.role==='user' && (row.status!=='paid' || Number(row.user_id)!==Number(req.identity.id))) || (req.identity.role==='admin' && !['approved','paid'].includes(row.status)) || !/^[a-f0-9]{40}\.(jpg|png|webp)$/.test(row.proof_file||''))throw fail('转账截图不存在',404);res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.sendFile(path.resolve(uploadDir,'.withdrawal-proofs',row.proof_file))}))
  r.post('/admin/withdrawals/:id/proof',admin,express.raw({type:['image/jpeg','image/png','image/webp'],limit:'5mb'}),wrap(async(req,res)=>{
    if(!Buffer.isBuffer(req.body)||!req.body.length)throw fail('请选择转账截图')
    let ext;try{const meta=await sharp(req.body,{limitInputPixels:40000000,failOn:'warning'}).metadata();ext={jpeg:'jpg',png:'png',webp:'webp'}[meta.format];if(!ext)throw new Error('invalid image');await sharp(req.body,{limitInputPixels:40000000,failOn:'warning'}).resize(1,1).toBuffer()}catch{throw fail('截图格式无效或图片已损坏')}
    const dir=path.resolve(uploadDir,'.withdrawal-proofs'), filename=crypto.randomBytes(20).toString('hex')+'.'+ext, file=path.join(dir,filename)
    await mkdir(dir,{recursive:true,mode:0o700});await writeFile(file,req.body,{flag:'wx',mode:0o600})
    let oldFile;try{oldFile=await transaction(async c=>{const [[item]]=await c.query('SELECT status,proof_file FROM withdrawals WHERE id=? FOR UPDATE',[req.params.id]);if(!item || item.status!=='approved')throw fail('请先审核通过，转账完成后不可修改截图',409);await c.query('UPDATE withdrawals SET proof_file=? WHERE id=?',[filename,req.params.id]);return item.proof_file})}catch(e){await unlink(file).catch(()=>{});throw e}
    if(/^[a-f0-9]{40}\.(jpg|png|webp)$/.test(oldFile||''))await unlink(path.join(dir,oldFile)).catch(()=>{})
    res.json({ok:true})
  }))
  r.post('/admin/withdrawals/:id/:action',admin,wrap(async(req,res)=>{
    const action=req.params.action;if(!['approve','reject','paid'].includes(action))throw fail('操作无效')
    const reason=String(req.body.reason||'').trim();if(action==='reject' && (!reason||reason.length>500))throw fail('请填写驳回原因')
    await transaction(async c=>{
      const [[item]]=await c.query('SELECT id,user_id,amount,status,proof_file FROM withdrawals WHERE id=? FOR UPDATE',[req.params.id]);if(!item)throw fail('提现申请不存在',404)
      if(action==='approve'){if(item.status!=='pending')throw fail('当前状态不可审核',409);await c.query("UPDATE withdrawals SET status='approved',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",[req.identity.id,item.id])}
      if(action==='paid'){if(item.status!=='approved')throw fail('请先审核通过，且不可重复确认转账',409);const note=String(req.body.transfer_note||'').trim();if(!item.proof_file||!note||note.length>500)throw fail('请上传转账截图并填写转账记录');await c.query("UPDATE withdrawals SET status='paid',paid_by=?,paid_at=CURRENT_TIMESTAMP,transfer_note=? WHERE id=?",[req.identity.id,note,item.id])}
      if(action==='reject'){if(item.status!=='pending')throw fail('仅待审核申请可驳回退券，已审核申请请线下核对',409);await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[item.user_id]);await c.query('UPDATE users SET balance=balance+? WHERE id=?',[item.amount,item.user_id]);await c.query("INSERT INTO coupon_transactions (user_id,type,amount,description) VALUES (?,'withdrawal_refund',?,?)",[item.user_id,item.amount,`提现驳回退回 #${item.id}`]);await c.query("UPDATE withdrawals SET status='rejected',reason=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",[reason,req.identity.id,item.id])}
    });res.json({ok:true})
  }))
  r.get('/transactions', user, wrap(async (req, res) => { const [data] = await db.query('SELECT * FROM coupon_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 200', [req.identity.id]); res.json({ data }) }))
  r.get('/orders', user, wrap(async (req, res) => { const [data] = await db.query('SELECT o.*, p.image AS product_image FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.user_id = ? ORDER BY o.id DESC', [req.identity.id]); res.json({ data }) }))
  r.get('/orders/unread-count', user, wrap(async (req, res) => { const [[row]] = await db.query('SELECT COUNT(*) AS count FROM orders WHERE user_id=? AND pickup_code IS NOT NULL AND pickup_code <> ? AND notice_read=0', [req.identity.id, '']); res.json({ data: { count: Number(row.count) } }) }))
  r.put('/orders/:id/read', user, wrap(async (req, res) => { await db.query('UPDATE orders SET notice_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.identity.id]); res.json({ ok: true }) }))
  r.put('/orders/:id/confirm', user, wrap(async (req, res) => {
    const [result] = await db.query("UPDATE orders SET received_at = COALESCE(received_at, CURRENT_TIMESTAMP), notice_read = 1 WHERE id = ? AND user_id = ? AND status <> 'cancelled' AND pickup_code IS NOT NULL AND pickup_code <> ''", [req.params.id, req.identity.id])
    if (!result.affectedRows) { const [[order]] = await db.query('SELECT id FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.identity.id]); if (!order) throw fail('订单不存在', 404); throw fail('收到到货通知后才能确认收货') }
    res.json({ ok: true })
  }))
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
      if (buyer?.is_root) throw fail('根账户用于承接商圈收益，不能购买商品，请使用普通用户账户')
      if (!buyer || buyer.status !== 'active') throw fail('账户不可购买')
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
  r.get('/admin/users', admin, wrap(async (req, res) => { const q = String(req.query.q || '').trim().slice(0, 100); const pattern = `%${q}%`; const [data] = await db.query('SELECT id,phone,username,invite_code,parent_id,is_root,status,balance,purchase_count,created_at FROM users WHERE (? = ? OR username LIKE ? OR phone LIKE ? OR CAST(id AS CHAR) = ?) ORDER BY id DESC LIMIT 500', [q,'',pattern,pattern,q]); res.json({ data }) }))
  r.post('/admin/users', admin, wrap(async (req, res) => {
    const {phone,username,password}=req.body, parentPhone=String(req.body.parent_phone || '').trim()
    if (!phoneValid(phone) || typeof username !== 'string' || !/^[\w\u4e00-\u9fa5]{1,20}$/.test(username) || typeof password !== 'string' || password.length < 6 || password.length > 64) throw fail('请填写有效的手机号、用户名和至少 6 位密码')
    if (parentPhone && !phoneValid(parentPhone)) throw fail('上级手机号无效')
    let cents; try { cents=toCents(req.body.balance ?? '0') } catch { throw fail('初始产品券金额无效') }
    if (cents > 999999999999) throw fail('初始产品券金额超出范围')
    const amount=fromCents(cents), hash=await bcrypt.hash(password,10)
    const data=await transaction(async c=>{
      let parentId=null
      if(parentPhone){const [[parent]]=await c.query("SELECT id FROM users WHERE phone=? AND is_root=0 AND status='active' FOR UPDATE",[parentPhone]);if(!parent)throw fail('上级不存在、已停用或为系统根账户');parentId=parent.id}
      const [created]=await c.query('INSERT INTO users (phone,username,password_hash,invite_code,parent_id,is_root,balance) VALUES (?,?,?,?,?,0,0)',[phone,username,hash,crypto.randomBytes(6).toString('hex').toUpperCase(),parentId])
      if(cents>0){const rid=crypto.randomUUID(), fp=fingerprint([String(created.insertId),amount]);await c.query('UPDATE users SET balance=? WHERE id=?',[amount,created.insertId]);await c.query('INSERT INTO topups (admin_id,user_id,request_id,request_fingerprint,amount) VALUES (?,?,?,?,?)',[req.identity.id,created.insertId,rid,fp,amount]);await c.query("INSERT INTO coupon_transactions (user_id,type,amount,description) VALUES (?,'topup',?,'管理员创建用户并充值')",[created.insertId,amount])}
      return {id:created.insertId}
    })
    res.json({data})
  }))
  r.get('/admin/users/:id/transactions', admin, wrap(async (req, res) => { const [data] = await db.query('SELECT id,type,amount,description,order_id,created_at FROM coupon_transactions WHERE user_id=? ORDER BY id DESC LIMIT 500', [req.params.id]); res.json({ data }) }))
  r.put('/admin/users/:id/status', admin, wrap(async (req, res) => { if (!['active','disabled'].includes(req.body.status)) throw fail('状态无效'); const [result] = await db.query('UPDATE users SET status=? WHERE id=? AND is_root=0', [req.body.status,req.params.id]); if (!result.affectedRows) throw fail('用户不存在或为根账户'); res.json({ ok: true }) }))
  r.post('/admin/users/:id/topup', admin, wrap(async (req, res) => {
    const amount = fromCents(toCents(req.body.amount)), rid = requestId(req.body.request_id), fp = fingerprint([String(req.params.id), amount]); if (toCents(amount) < 1) throw fail('充值金额必须大于零')
    await transaction(async c => { const [[userRow]] = await c.query('SELECT id FROM users WHERE id=? FOR UPDATE', [req.params.id]); if (!userRow) throw fail('用户不存在', 404); const [[old]] = await c.query('SELECT id,request_fingerprint FROM topups WHERE admin_id=? AND request_id=? FOR UPDATE', [req.identity.id,rid]); if (old) return sameRequest(old,fp); await c.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, req.params.id]); await c.query('INSERT INTO topups (admin_id,user_id,request_id,request_fingerprint,amount) VALUES (?,?,?,?,?)', [req.identity.id,req.params.id,rid,fp,amount]); await c.query("INSERT INTO coupon_transactions (user_id,type,amount,description) VALUES (?, 'topup', ?, ?)", [req.params.id, amount, `管理员 ${req.identity.id} 充值`]) }); res.json({ ok: true })
  }))
  r.get('/admin/products', admin, wrap(async (_req, res) => { const [data] = await db.query('SELECT * FROM products ORDER BY id DESC'); res.json({ data }) }))
  r.post('/admin/products', admin, wrap(async (req, res) => {
    const b = req.body; required(b.name, '请输入商品名称'); const cost = fromCents(toCents(b.cost)), reward = fromCents(toCents(b.reward)); const stock = Number(b.stock)
    const {options,images}=productLists(b)
    if (!Number.isSafeInteger(stock) || stock < 0) throw fail('库存无效')
    await db.query('INSERT INTO products (name,category,description,image,cost,reward,stock,active,options,detail_images) VALUES (?,?,?,?,?,?,?,?,?,?)', [b.name, productCategory(b.category), b.description || '', b.image || '', cost, reward, stock, b.active === false ? 0 : 1, JSON.stringify(options), JSON.stringify(images)]); res.json({ ok: true })
  }))
  r.put('/admin/products/:id', admin, wrap(async (req, res) => {
    const b = req.body; required(b.name, '请输入商品名称'); const cost = fromCents(toCents(b.cost)), reward = fromCents(toCents(b.reward)); const stock = Number(b.stock); if (!Number.isSafeInteger(stock) || stock < 0) throw fail('库存无效')
    const {options,images}=productLists(b)
    await db.query('UPDATE products SET name=?,category=?,description=?,image=?,cost=?,reward=?,stock=?,active=?,options=?,detail_images=? WHERE id=?', [b.name,productCategory(b.category),b.description || '',b.image || '',cost,reward,stock,b.active ? 1 : 0,JSON.stringify(options),JSON.stringify(images),req.params.id]); res.json({ ok: true })
  }))
  r.get('/admin/orders', admin, wrap(async (req, res) => { const q = String(req.query.q || '').trim().slice(0, 100); const pattern = `%${q}%`; const [data] = await db.query('SELECT o.*, u.username, u.phone, recipient.username recipient_name FROM orders o JOIN users u ON u.id=o.user_id JOIN users recipient ON recipient.id=o.recipient_id WHERE (? = ? OR o.order_no LIKE ? OR o.product_name LIKE ? OR u.username LIKE ? OR u.phone LIKE ?) ORDER BY o.id DESC LIMIT 500', [q,'',pattern,pattern,pattern,pattern]); res.json({ data }) }))
  r.put('/admin/orders/:id/notice', admin, wrap(async (req, res) => { const code = String(req.body.pickup_code || '').trim(); if (!code || code.length > 100 || String(req.body.message || '').length > 500) throw fail('提货码或留言无效'); await db.query('UPDATE orders SET pickup_code=?, pickup_message=?, notice_read=0 WHERE id=? AND status <> ?', [code,req.body.message || '',req.params.id,'cancelled']); res.json({ ok: true }) }))
  r.get('/admin/overview', admin, wrap(async (_req, res) => { const [[data]] = await db.query("SELECT COUNT(*) order_count, COALESCE(SUM(cost),0) total_cost, COALESCE(SUM(reward),0) total_reward FROM orders WHERE status='completed'"); const [[users]] = await db.query('SELECT COUNT(*) AS user_count FROM users'); const [trend] = await db.query("SELECT DATE_FORMAT(created_at, '%Y-%m-%d') day, COUNT(*) order_count, COALESCE(SUM(cost),0) total_cost FROM orders WHERE status='completed' AND created_at >= CURRENT_DATE - INTERVAL 29 DAY GROUP BY day ORDER BY day DESC"); const [products] = await db.query("SELECT p.id product_id, p.name product_name, COUNT(*) order_count, COALESCE(SUM(o.cost),0) total_cost FROM orders o JOIN products p ON p.id=o.product_id WHERE o.status='completed' GROUP BY p.id,p.name ORDER BY order_count DESC, p.id DESC LIMIT 10"); res.json({ data: { ...data, user_count: users.user_count, trend, products } }) }))
  return r
}
