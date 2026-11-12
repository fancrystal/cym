export function secureId(api=globalThis.crypto){
  if(typeof api?.randomUUID==='function')return api.randomUUID()
  if(typeof api?.getRandomValues!=='function')throw new Error('设备不支持安全随机数，请更新系统 WebView')
  const b=api.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128
  const x=Array.from(b,n=>n.toString(16).padStart(2,'0')).join('')
  return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20)}`
}
