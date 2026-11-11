import { fromCents } from './money.js'

export function withdrawalAmounts(value) {
  if (!/^[1-9]\d*$/.test(String(value))) throw new Error('提现金额须为 50 的整数倍')
  const amount=Number(value)
  if (!Number.isSafeInteger(amount) || amount < 50 || amount % 50 !== 0 || amount > 9999999999) throw new Error('提现金额至少 50 且必须为 50 的整数倍')
  const cents=amount*100, fee=amount*6
  return {amount:fromCents(cents),fee:fromCents(fee),net:fromCents(cents-fee)}
}
