export function parentIndex(index) {
  if (!Number.isInteger(index) || index < 0) throw new Error('无效的测试账户序号')
  return index === 0 ? null : Math.floor((index - 1) / 2)
}
