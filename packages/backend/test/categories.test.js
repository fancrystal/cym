import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryOptions, filterProducts } from '../../shared/categories.js'

test('常用分类始终可选，保留并去重已有自定义分类', () => {
  const options = categoryOptions([{category:'生活用品'}, {category:'茶叶'}, {category:'茶叶'}, {category:''}])
  for (const name of ['生活用品','保健适配','水果','蔬菜','衣服','家电','茶叶','未分类']) assert.ok(options.includes(name))
  assert.equal(options.filter(name => name === '生活用品').length, 1)
  assert.equal(options.filter(name => name === '茶叶').length, 1)
})

test('旧健康食品分类归入新分类', () => {
  const products = [{category:'健康食品'}]
  assert.ok(!categoryOptions(products).includes('健康食品'))
  assert.deepEqual(filterProducts(products, '保健适配'), products)
})

test('按分类筛选商品且全部展示所有商品', () => {
  const items = [{category:'家电'}, {category:'生活用品'}, {category:null}]
  assert.deepEqual(filterProducts(items, '家电'), [items[0]])
  assert.deepEqual(filterProducts(items, '未分类'), [items[2]])
  assert.deepEqual(filterProducts(items, ''), items)
})
