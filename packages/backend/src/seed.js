import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { createPool } from './db.js'

if (!process.env.ROOT_PASSWORD || !process.env.ADMIN_PASSWORD) throw new Error('请设置 ROOT_PASSWORD 和 ADMIN_PASSWORD')
const pool = createPool()
try {
  const rootHash = await bcrypt.hash(process.env.ROOT_PASSWORD, 10)
  const adminHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10)
  const c = await pool.getConnection()
  try {
    await c.beginTransaction()
    const [[root]] = await c.query('SELECT id FROM users WHERE is_root=1 LIMIT 1 FOR UPDATE')
    if (!root) await c.query('INSERT INTO users (phone, username, password_hash, is_root) VALUES (?, ?, ?, 1)', ['18801620766', '商圈根账户', rootHash])
    const [[admin]] = await c.query('SELECT id FROM admins WHERE username=? FOR UPDATE', [process.env.ADMIN_USERNAME || 'admin'])
    if (!admin) await c.query('INSERT INTO admins (username,password_hash) VALUES (?,?)', [process.env.ADMIN_USERNAME || 'admin', adminHash])
    await c.commit()
  } catch (error) { await c.rollback(); throw error } finally { c.release() }
  console.log('根账户与管理员初始化完成；已有账户不会被重置。')
} finally { await pool.end() }
