// Run once on the mskj host as root. Abort if either target name is in use.
const fs = require('node:fs')
const dotenv = require('/opt/mskj/packages/backend/node_modules/dotenv')
const mysql = require('/opt/mskj/packages/backend/node_modules/mysql2/promise')
const existing = dotenv.parse(fs.readFileSync('/opt/mskj/packages/backend/.env'))
const target = dotenv.parse(fs.readFileSync('/srv/cym/shared/initial.env'))
if (target.DB_NAME !== 'cym_db' || target.DB_USER !== 'cym_app' || !/^[a-f0-9]{64}$/.test(target.DB_PASSWORD || '')) throw new Error('目标数据库配置无效')
async function main() {
  const c = await mysql.createConnection({ host: existing.DB_HOST || '127.0.0.1', port: Number(existing.DB_PORT || 3306), user: existing.DB_USER, password: existing.DB_PASSWORD })
  try {
    const [[db]] = await c.query('SELECT COUNT(*) AS n FROM information_schema.schemata WHERE schema_name=?', [target.DB_NAME])
    const [[user]] = await c.query('SELECT COUNT(*) AS n FROM mysql.user WHERE user=?', [target.DB_USER])
    if (db.n || user.n) throw new Error('目标数据库或账号已存在，停止初始化')
    await c.query('CREATE DATABASE `cym_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
    await c.query("CREATE USER 'cym_app'@'localhost' IDENTIFIED BY ?", [target.DB_PASSWORD])
    await c.query("GRANT ALL PRIVILEGES ON `cym_db`.* TO 'cym_app'@'localhost'")
    console.log('独立数据库和账号已创建。')
  } finally { await c.end() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
