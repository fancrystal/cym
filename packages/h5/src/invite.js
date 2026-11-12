export function inviteCodeFromUrl(value) {
  try {
    const url=new URL(value)
    if(url.protocol!=='https:' || url.hostname!=='cym.green' || url.port || url.username || url.password || url.pathname!=='/')return null
    const fragment=url.hash.slice(1)
    if(fragment && !fragment.startsWith('/login?'))return null
    const params=fragment ? new URLSearchParams(fragment.slice(fragment.indexOf('?')+1)) : url.searchParams
    const code=params.get('transfer_invite')
    return typeof code==='string' && /^[A-Za-z0-9]{1,32}$/.test(code) ? code.toUpperCase() : null
  } catch { return null }
}
