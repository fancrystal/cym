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
  const [[typeColumn]] = await connection.query("SELECT COLUMN_TYPE AS column_type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupon_transactions' AND COLUMN_NAME = 'type'")
  if (!typeColumn.column_type.includes('withdrawal_refund')) await connection.query("ALTER TABLE coupon_transactions MODIFY COLUMN type ENUM('topup','purchase','reward','transfer_in','transfer_out','withdrawal','withdrawal_refund') NOT NULL")
  const [[last4Column]]=await connection.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='withdrawals' AND COLUMN_NAME='account_last4'")
  if(!last4Column.count)await connection.query("ALTER TABLE withdrawals ADD COLUMN account_last4 CHAR(4) NOT NULL DEFAULT '' AFTER account_number")
  const [[alipayColumn]]=await connection.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='alipay_account'")
  if(!alipayColumn.count)await connection.query('ALTER TABLE users ADD COLUMN alipay_account VARCHAR(255) NULL AFTER password_hash')
  const [[proofColumn]]=await connection.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='withdrawals' AND COLUMN_NAME='proof_file'")
  if(!proofColumn.count)await connection.query('ALTER TABLE withdrawals ADD COLUMN proof_file VARCHAR(100) NULL, ADD COLUMN transfer_note VARCHAR(500) NULL')
  const [[accountColumn]]=await connection.query("SELECT CHARACTER_MAXIMUM_LENGTH AS max_length FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='withdrawals' AND COLUMN_NAME='account_number'")
  if(accountColumn.max_length<255)await connection.query('ALTER TABLE withdrawals MODIFY COLUMN account_number VARCHAR(255) NOT NULL')
  console.log('数据库表初始化完成')
} finally {
  await connection.end()
}
