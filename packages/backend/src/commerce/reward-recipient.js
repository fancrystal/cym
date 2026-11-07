/** Resolve the single recipient for a buyer's Nth commerce purchase. */
export async function resolveRewardRecipient({ buyerId, sequence, rootUserId, getParentId, getPurchaseCount }) {
  for (const value of [buyerId, sequence, rootUserId]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('INVALID_REWARD_INPUT')
  }
  const visited = new Set([buyerId])
  let current = buyerId
  for (let depth = 1; depth <= sequence; depth += 1) {
    const parent = await getParentId(current)
    if (!Number.isSafeInteger(parent) || parent <= 0) {
      return { recipientId: rootUserId, destination: 'root', depth: sequence }
    }
    if (visited.has(parent)) throw new Error('RELATIONSHIP_CYCLE')
    visited.add(parent)
    if (depth === sequence) {
      const count = Number(await getPurchaseCount(parent))
      return Number.isFinite(count) && count >= sequence
        ? { recipientId: parent, destination: 'ancestor', depth }
        : { recipientId: rootUserId, destination: 'root', depth: sequence }
    }
    current = parent
  }
}
