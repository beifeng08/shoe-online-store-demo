const messages: Record<string, string> = {
  insufficient_stock: 'Not enough stock. Update the quantity in your cart.',
  empty_cart: 'Your cart is empty. Choose a product first.',
  order_not_found: "We couldn't find this order for the current session.",
  backend_unavailable: 'The shopping service is temporarily unavailable. Please try again.',
}
export async function commerceRequest<T>(
  path: string,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/commerce/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const invalidResponse = 'The shopping service returned an invalid response. Please try again.'
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error(invalidResponse)
  }
  if (!response.ok) {
    let code = ''
    if (data !== null && typeof data === 'object') {
      if ('code' in data && typeof data.code === 'string') code = data.code
      else if ('detail' in data && typeof data.detail === 'string') code = data.detail
    }
    throw new Error(
      Object.hasOwn(messages, code)
        ? messages[code]
        : "We couldn't complete that action. Check the quantity and try again.",
    )
  }
  try {
    return parse(data)
  } catch {
    throw new Error(invalidResponse)
  }
}
