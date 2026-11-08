import express from 'express'
import jwt from 'jsonwebtoken'
import { rateLimit } from 'express-rate-limit'
import { routes } from './routes.js'

export function createApp({ db, secret } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')
  app.use(express.json({ limit: '1mb' }))
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: '尝试次数过多，请稍后再试' } })
  app.use(['/api/auth/login', '/api/admin/login'], loginLimit)
  app.use(['/api/auth/register', '/api/transfer'], rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, message: { message: '尝试次数过多，请稍后再试' } }))
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  const auth = (req, res, next) => {
    try { req.identity = jwt.verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''), secret); next() }
    catch { res.status(401).json({ message: '请先登录' }) }
  }
  app.get('/api/products', async (_req, res, next) => {
    try { const [data] = await db.query('SELECT * FROM products WHERE active = 1 ORDER BY id DESC'); res.json({ data }) } catch (error) { next(error) }
  })
  app.get('/api/me', auth, async (req, res, next) => {
    try { if (req.identity.role !== 'user') return res.status(403).json({ message: '无权限' }); const [[data]] = await db.query('SELECT id, phone, username, invite_code, is_root, balance, purchase_count FROM users WHERE id = ? AND status = ?', [req.identity.id, 'active']); if (!data) return res.status(401).json({ message: '账户不可用' }); res.json({ data }) } catch (error) { next(error) }
  })
  app.use('/api', routes(db, secret))
  app.use((error, _req, res, _next) => { const status = error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : 500); if (status === 500) console.error(error); res.status(status).json({ message: status === 500 ? '系统暂时不可用' : (error.code === 'ER_DUP_ENTRY' ? '手机号、用户名或请求已存在' : error.message) }) })
  return app
}
