import crypto from 'node:crypto'

function keyBytes(key) { if(typeof key!=='string' || !/^[a-f0-9]{64}$/i.test(key))throw new Error('提现加密密钥未配置');return Buffer.from(key,'hex') }
export function encryptBankAccount(account,key) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',keyBytes(key),iv)
  const value=Buffer.concat([cipher.update(account,'utf8'),cipher.final()])
  return 'v1:'+Buffer.concat([iv,cipher.getAuthTag(),value]).toString('base64')
}
export function decryptBankAccount(value,key) {
  if(!value.startsWith('v1:'))throw new Error('收款信息格式无效')
  const raw=Buffer.from(value.slice(3),'base64'), decipher=crypto.createDecipheriv('aes-256-gcm',keyBytes(key),raw.subarray(0,12))
  decipher.setAuthTag(raw.subarray(12,28));return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8')
}
