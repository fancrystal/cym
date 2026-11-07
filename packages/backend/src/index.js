import 'dotenv/config'
import { createApp } from './app.js'
import { createPool } from './db.js'

const port = Number(process.env.PORT || 3100)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET 至少需要 32 个字符')
createApp({ db: createPool(), secret: process.env.JWT_SECRET }).listen(port, '127.0.0.1', () => console.log(`API listening on 127.0.0.1:${port}`))
