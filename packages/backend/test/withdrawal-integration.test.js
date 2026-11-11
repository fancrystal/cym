import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import 'dotenv/config'
import { createPool } from '../src/db.js'
import { createApp } from '../src/app.js'
process.env.WITHDRAWAL_ENCRYPTION_KEY ||= '11'.repeat(32)

test('提现幂等扣款、并发余额保护和审核驳回退款', {skip:process.env.CYM_INTEGRATION!=='1'}, async t=>{
  const db=createPool(), suffix=String(Date.now()).slice(-8), phone=`17${suffix}8`
  const [[admin]]=await db.query('SELECT id FROM admins ORDER BY id LIMIT 1')
  const [insert]=await db.query('INSERT INTO users (phone,username,password_hash,invite_code,balance) VALUES (?,?,?,?,200)',[phone,`withdraw_${suffix}`,await bcrypt.hash('testpass',10),crypto.randomBytes(6).toString('hex')]); const userId=insert.insertId
  const uploadDir=await mkdtemp(join(tmpdir(),'cym-proof-'))
  const server=createApp({db,secret:process.env.JWT_SECRET,uploadDir}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve))
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.query('DELETE FROM coupon_transactions WHERE user_id=?',[userId]);await db.query('DELETE FROM withdrawals WHERE user_id=?',[userId]);await db.query('DELETE FROM users WHERE id=?',[userId]);await db.end();await rm(uploadDir,{recursive:true,force:true})})
  const user=jwt.sign({id:userId,role:'user'},process.env.JWT_SECRET), adminToken=jwt.sign({id:admin.id,role:'admin'},process.env.JWT_SECRET), base=`http://127.0.0.1:${server.address().port}/api`
  const request=(path,token,method,body)=>fetch(base+path,{method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)})
  const payload={amount:'100',account_name:'测试用户',alipay_account:'test@example.com',password:'testpass',request_id:crypto.randomUUID()}
  assert.equal((await request('/withdrawals',user,'POST',{...payload,amount:'55'})).status,400)
  assert.equal((await request('/withdrawals',user,'POST',{...payload,password:'wrong'})).status,400)
  const [a,b]=await Promise.all([request('/withdrawals',user,'POST',payload),request('/withdrawals',user,'POST',payload)]);assert.equal(a.status,200);assert.equal(b.status,200)
  const x=(await a.json()).data,y=(await b.json()).data;assert.equal(x.id,y.id)
  const userList=await (await fetch(base+'/withdrawals',{headers:{authorization:`Bearer ${user}`}})).json();assert.equal(userList.data[0].account_number,'****.com')
  const adminList=await (await fetch(base+'/admin/withdrawals',{headers:{authorization:`Bearer ${adminToken}`}})).json();assert.equal(adminList.data.find(row=>row.id===x.id).account_number,'****.com')
  const adminDetail=await (await fetch(base+`/admin/withdrawals/${x.id}`,{headers:{authorization:`Bearer ${adminToken}`}})).json();assert.equal(adminDetail.data.account_number,'test@example.com')
  const [[pending]]=await db.query('SELECT amount,fee,net,status FROM withdrawals WHERE id=?',[x.id]);assert.deepEqual(pending,{amount:'100.00',fee:'6.00',net:'94.00',status:'pending'})
  const [[encrypted]]=await db.query('SELECT alipay_account FROM users WHERE id=?',[userId]);assert.ok(encrypted.alipay_account.startsWith('v1:'));assert.ok(!encrypted.alipay_account.includes('test@example.com'))
  assert.equal((await (await fetch(base+'/account/alipay',{headers:{authorization:`Bearer ${user}`}})).json()).data.masked,'****.com')
  const [[state]]=await db.query('SELECT balance FROM users WHERE id=?',[userId]);assert.equal(state.balance,'100.00')
  assert.equal((await request('/withdrawals',user,'POST',{...payload,amount:'150',request_id:crypto.randomUUID()})).status,400)
  assert.equal((await request(`/admin/withdrawals/${x.id}/reject`,user,'POST',{reason:'测试'})).status,403)
  const [r1,r2]=await Promise.all([request(`/admin/withdrawals/${x.id}/reject`,adminToken,'POST',{reason:'测试'}),request(`/admin/withdrawals/${x.id}/reject`,adminToken,'POST',{reason:'测试'})]);assert.deepEqual([r1.status,r2.status].sort(),[200,409])
  const [[after]]=await db.query('SELECT balance FROM users WHERE id=?',[userId]);assert.equal(after.balance,'200.00')
  const [[logs]]=await db.query("SELECT COUNT(*) count FROM coupon_transactions WHERE user_id=? AND type='withdrawal_refund'",[userId]);assert.equal(logs.count,1)
  const second=await request('/withdrawals',user,'POST',{...payload,alipay_account:'',amount:'50',request_id:crypto.randomUUID()});assert.equal(second.status,200);const id=(await second.json()).data.id
  assert.equal((await request(`/admin/withdrawals/${id}/paid`,adminToken,'POST',{})).status,409)
  assert.equal((await request(`/admin/withdrawals/${id}/approve`,adminToken,'POST',{})).status,200)
  assert.equal((await request(`/admin/withdrawals/${id}/reject`,adminToken,'POST',{reason:'测试'})).status,409)
  assert.equal((await request(`/admin/withdrawals/${id}/paid`,adminToken,'POST',{transfer_note:'流水号 TEST'})).status,400)
  const image=await sharp({create:{width:3,height:3,channels:3,background:'#fff'}}).png().toBuffer()
  const upload=await fetch(base+`/admin/withdrawals/${id}/proof`,{method:'POST',headers:{authorization:`Bearer ${adminToken}`,'content-type':'image/png'},body:image});assert.equal(upload.status,200)
  assert.equal((await fetch(base+`/withdrawals/${id}/proof`,{headers:{authorization:`Bearer ${user}`}})).status,404)
  assert.equal((await fetch(base+`/withdrawals/${id}/proof`,{headers:{authorization:`Bearer ${adminToken}`}})).status,200)
  const replaced=await fetch(base+`/admin/withdrawals/${id}/proof`,{method:'POST',headers:{authorization:`Bearer ${adminToken}`,'content-type':'image/png'},body:image});assert.equal(replaced.status,200)
  assert.equal((await request(`/admin/withdrawals/${id}/paid`,adminToken,'POST',{transfer_note:'流水号 TEST'})).status,200)
  const proof=await fetch(base+`/withdrawals/${id}/proof`,{headers:{authorization:`Bearer ${user}`}});assert.equal(proof.status,200);assert.equal(proof.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await proof.arrayBuffer()),image)
  const [[root]]=await db.query('SELECT id FROM users WHERE is_root=1 LIMIT 1');const other=jwt.sign({id:root.id,role:'user'},process.env.JWT_SECRET);assert.equal((await fetch(base+`/withdrawals/${id}/proof`,{headers:{authorization:`Bearer ${other}`}})).status,404)
  const [[file]]=await db.query('SELECT proof_file FROM withdrawals WHERE id=?',[id]);assert.notEqual((await fetch(base+`/uploads/.withdrawal-proofs/${file.proof_file}`)).status,200)
  const record=await (await fetch(base+'/withdrawals',{headers:{authorization:`Bearer ${user}`}})).json();assert.equal(record.data.find(w=>w.id===id).transfer_note,'流水号 TEST')
  assert.equal((await request(`/admin/withdrawals/${id}/reject`,adminToken,'POST',{reason:'测试'})).status,409)
  const [[final]]=await db.query('SELECT balance FROM users WHERE id=?',[userId]);assert.equal(final.balance,'150.00')
})
