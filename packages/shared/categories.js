export const DEFAULT_CATEGORIES = Object.freeze(['生活用品', '健康食品', '衣服', '家电', '个护清洁', '家居用品', '母婴用品', '数码产品'])

export function categoryOptions(products) {
  return [...new Set([...DEFAULT_CATEGORIES, ...products.map(product => product.category || '未分类')])]
}

export function filterProducts(products, category) {
  return category ? products.filter(product => (product.category || '未分类') === category) : products
}
