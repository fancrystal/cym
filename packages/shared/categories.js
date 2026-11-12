export const DEFAULT_CATEGORIES = Object.freeze(['生活用品', '保健适配', '水果', '蔬菜', '衣服', '家电', '个护清洁', '家居用品', '母婴用品', '数码产品'])

export function categoryName(category) {
  return category === '健康食品' ? '保健适配' : (category || '未分类')
}

export function categoryOptions(products) {
  return [...new Set([...DEFAULT_CATEGORIES, ...products.map(product => categoryName(product.category))])]
}

export function filterProducts(products, category) {
  return category ? products.filter(product => categoryName(product.category) === category) : products
}
