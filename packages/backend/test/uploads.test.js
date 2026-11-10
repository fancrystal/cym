import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import { createApp } from '../src/app.js'

test('仅管理员可上传图片，图片可公开读取且拒绝伪造文件', async t => {
  const uploadDir = await mkdtemp(join(tmpdir(), 'cym-uploads-'))
  const db = { query: async () => [[{ id: 1 }]] }
  const secret = 'test-secret'
  const server = createApp({ db, secret, uploadDir }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(uploadDir, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${server.address().port}`
  const admin = jwt.sign({id:1,role:'admin'},secret), user = jwt.sign({id:1,role:'user'},secret)
  const png = await sharp({create:{width:2,height:2,channels:3,background:'#ffffff'}}).png().toBuffer()
  const post = (token, body, type='image/png') => fetch(base+'/api/admin/uploads', {method:'POST',headers:{'content-type':type,...(token ? {authorization:`Bearer ${token}`} : {})},body})
  assert.equal((await post(null,png)).status,401)
  assert.equal((await post(user,png)).status,403)
  assert.equal((await post(admin,Buffer.from('not a png'))).status,400)
  assert.equal((await post(admin,png.subarray(0,8))).status,400)
  const response = await post(admin,png); assert.equal(response.status,200)
  const {data} = await response.json(); assert.match(data.url,/^\/api\/uploads\/[a-f0-9]+\.png$/)
  const image = await fetch(base+data.url); assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()),png)
})
