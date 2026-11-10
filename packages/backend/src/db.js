import mysql from 'mysql2/promise'

export function databaseOptions(env = process.env) {
  if (!env.DB_USER || !env.DB_NAME || env.DB_PASSWORD === undefined) throw new Error('缺少数据库配置')
  return {
    host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
    user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
    decimalNumbers: false, charset: 'utf8mb4', timezone: '+08:00',
  }
}

export function createPool() {
  const pool = mysql.createPool({ ...databaseOptions(), waitForConnections: true, connectionLimit: 10 })
  pool.on('connection', connection => connection.query("SET time_zone = '+08:00'"))
  return pool
}
