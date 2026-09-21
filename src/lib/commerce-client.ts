const messages: Record<string, string> = {
  insufficient_stock: '库存不足，请调整购物车数量。',
  empty_cart: '购物车为空，请先选择商品。',
  order_not_found: '找不到此会话的订单。',
  backend_unavailable: '购物服务暂时无法连接，请稍后重试。',
}
export async function commerceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/commerce/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(messages[data.detail] ?? '操作未完成，请检查数量后重试。')
  return data as T
}
