import 'dotenv/config'
import { appendFile, readFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { createPool } from './db.js'
import { parentIndex } from './commerce/test-bots.js'

if (process.env.CYM_ALLOW_TEST_BOTS !== '1' || !['127.0.0.1','localhost'].includes(process.env.DB_HOST) || process.env.NODE_ENV === 'production') throw new Error('仅允许在明确启用的本地测试环境执行')
const envPath = new URL('../.env', import.meta.url)
const envContents = await readFile(envPath, 'utf8')
if (/^CYM_BOT_01_PHONE=/m.test(envContents)) throw new Error('本地环境文件已有测试账户记录，未重复创建')
const pool = createPool()
const conn = await pool.getConnection()
try {
  await conn.beginTransaction()
  const ids = [], credentials = []
  for (let index = 0; index < 10; index++) {
    const number = String(index + 1).padStart(2, '0')
    const phone = `199000000${number}`
    const password = crypto.randomBytes(9).toString('hex')
    const invite = crypto.randomBytes(6).toString('hex').toUpperCase()
    const parent = parentIndex(index)
    const [result] = await conn.query('INSERT INTO users (phone, username, password_hash, invite_code, parent_id, balance) VALUES (?, ?, ?, ?, ?, 500.00)', [phone, `测试机器人${number}`, await bcrypt.hash(password, 10), invite, parent === null ? null : ids[parent]])
    ids.push(result.insertId)
    await conn.query("INSERT INTO coupon_transactions (user_id,type,amount,description) VALUES (?, 'topup', 500.00, '本地测试账户初始产品券')", [result.insertId])
    credentials.push(`CYM_BOT_${number}_PHONE=${phone}`, `CYM_BOT_${number}_PASSWORD=${password}`)
  }
  await appendFile(envPath, `\n# 本地测试机器人账号，仅供测试，不要提交\n${credentials.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  await conn.commit()
  console.log('已创建 10 个本地测试账户，四层金字塔关系；手机号和密码已记录在本地环境文件。')
} catch (error) {
  await conn.rollback()
  throw error
} finally {
  conn.release()
  await pool.end()
}
