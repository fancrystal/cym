import {test} from 'node:test'
import assert from 'node:assert/strict'
import {secureId} from '../../h5/src/secure-id.js'

test('旧版 WebView 使用安全随机数生成有效 UUID',()=>{
  const api={getRandomValues:bytes=>bytes.fill(255)}
  assert.equal(secureId(api),'ffffffff-ffff-4fff-bfff-ffffffffffff')
  assert.throws(()=>secureId({}),/安全随机数/)
})
