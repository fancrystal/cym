export function isUnreadNotice(order) { return Boolean(order.pickup_code) && !Number(order.notice_read) }
export function unreadOrderCount(orders) { return orders.filter(isUnreadNotice).length }
