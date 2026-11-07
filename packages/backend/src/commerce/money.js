export function toCents(value) {
  const text = String(value)
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) throw new Error('金额格式无效')
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('金额超出范围')
  return cents
}

export function fromCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('金额格式无效')
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

export function validateTransfer(value) {
  if (!/^[1-9]\d*$/.test(String(value))) throw new Error('转赠数量必须为正整数')
  try { return toCents(value) } catch { throw new Error('转赠数量超出范围') }
}
