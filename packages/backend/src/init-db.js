import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import mysql from 'mysql2/promise'
import { databaseOptions } from './db.js'

const connection = await mysql.createConnection({ ...databaseOptions(), multipleStatements: true })
try {
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
  await connection.query(schema)
  const [[categoryColumn]] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'category'")
  if (!categoryColumn.count) await connection.query("ALTER TABLE products ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT '未分类' AFTER name")
  const [[receiptColumn]] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'received_at'")
  if (!receiptColumn.count) await connection.query('ALTER TABLE orders ADD COLUMN received_at TIMESTAMP NULL DEFAULT NULL AFTER notice_read')
  console.log('数据库表初始化完成')
} finally {
  await connection.end()
}
