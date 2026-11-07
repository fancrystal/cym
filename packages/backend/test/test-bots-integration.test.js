import { test } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import 'dotenv/config'
import { createPool } from '../src/db.js'
import { parentIndex } from '../src/commerce/test-bots.js'

test('本地十个机器人凭据及金字塔关系有效', { skip: process.env.CYM_BOT_INTEGRATION !== '1' }, async () => {
  const pool = createPool()
  try {
    const ids = []
    for (let i = 0; i < 10; i++) {
      const number = String(i + 1).padStart(2, '0')
      const [[user]] = await pool.query('SELECT id,parent_id,password_hash FROM users WHERE phone=?', [process.env[`CYM_BOT_${number}_PHONE`]])
      assert.ok(user, `机器人 ${number} 存在`)
      assert.equal(await bcrypt.compare(process.env[`CYM_BOT_${number}_PASSWORD`], user.password_hash), true)
      const parent = parentIndex(i)
      assert.equal(user.parent_id, parent === null ? null : ids[parent])
      ids.push(user.id)
    }
  } finally { await pool.end() }
})
