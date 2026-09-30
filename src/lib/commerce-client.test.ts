import { afterEach, expect, it, vi } from 'vitest'
import { parseCartView, parseCommerceProduct, parseOrderView } from '@/domain/commerce-response'
import { commerceRequest } from './commerce-client'

const line = {
  id: 'item-1',
  variant_id: 'variant-1',
  title: 'Urban Bloom',
  sku: 'SKU',
  color: 'Ivory',
  size: 42,
  quantity: 1,
  unit_price: '59.00',
  available: 10,
}
const cart = { items: [line], total: '59.00', currency: 'USD' }
const order = {
  ...cart,
  id: 'order-1',
  status: 'pending_payment',
  payment_enabled: false,
  expires_at: null,
  cancellation_reason: null,
  message: 'Payments are not available yet.',
}
const variant = {
  id: 'variant-1',
  color: 'Ivory',
  size: 42,
  price: '59.00',
  currency: 'USD',
  available: 10,
}
const ok = (data: unknown) => ({ ok: true, json: async () => data })
const invalidMessage = 'The shopping service returned an invalid response. Please try again.'
afterEach(() => vi.unstubAllGlobals())

it('validates cart data, strips internal fields and preserves request options', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    ok({
      ...cart,
      session_id: 'secret',
      items: [{ ...line, internal_token: 'secret' }],
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  await expect(commerceRequest('cart', parseCartView, { method: 'GET' })).resolves.toEqual(cart)
  expect(fetcher).toHaveBeenCalledWith(
    '/api/commerce/cart',
    expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
    }),
  )
})

it('accepts null legacy deadlines and explicitly cancelled orders', () => {
  expect(parseOrderView(order)).toEqual(order)
  expect(
    parseOrderView({ ...order, status: 'cancelled', cancellation_reason: 'expired' }).status,
  ).toBe('cancelled')
  expect(parseCommerceProduct({ variants: [variant] })).toEqual({ variants: [variant] })
})

const invalidCases: [string, (value: unknown) => unknown, unknown][] = [
  ['null cart', parseCartView, null],
  ['non-array items', parseCartView, { ...cart, items: {} }],
  ['numeric total', parseCartView, { ...cart, total: 59 }],
  ['fractional cents', parseCartView, { ...cart, total: '59.001' }],
  ['negative money', parseCartView, { ...cart, total: '-1.00' }],
  ['newline money', parseCartView, { ...cart, total: '59.00\n' }],
  ['invalid currency', parseCartView, { ...cart, currency: 'usd' }],
  ['newline currency', parseCartView, { ...cart, currency: 'USD\n' }],
  ['string quantity', parseCartView, { ...cart, items: [{ ...line, quantity: '1' }] }],
  ['excess quantity', parseCartView, { ...cart, items: [{ ...line, quantity: 100 }] }],
  ['null line', parseCartView, { ...cart, items: [null] }],
  ['invalid stock', parseCommerceProduct, { variants: [{ ...variant, available: -1 }] }],
  ['numeric price', parseCommerceProduct, { variants: [{ ...variant, price: 59 }] }],
  ['paid order', parseOrderView, { ...order, status: 'paid' }],
  ['enabled payments', parseOrderView, { ...order, payment_enabled: true }],
  ['missing deadline', parseOrderView, { ...order, expires_at: undefined }],
  ['invalid deadline', parseOrderView, { ...order, expires_at: 'not-a-date' }],
  ['timezone-free deadline', parseOrderView, { ...order, expires_at: '2026-09-30T12:00:00' }],
]
it.each(invalidCases)('rejects %s before it reaches UI state', async (_name, parse, data) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(data)))
  await expect(commerceRequest('test', parse)).rejects.toThrow(invalidMessage)
})

it('does not expose parser errors or non-JSON upstream bodies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError('private upstream body')
      },
    }),
  )
  await expect(commerceRequest('cart', parseCartView)).rejects.toThrow(invalidMessage)
})

it.each([null, [], { detail: [] }, { code: '__proto__' }, { code: 'unknown', message: 'secret' }])(
  'handles unrecognized error envelopes safely: %j',
  async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => data }))
    await expect(commerceRequest('cart', parseCartView)).rejects.toThrow(
      "We couldn't complete that action. Check the quantity and try again.",
    )
  },
)

it.each([{ detail: 'insufficient_stock' }, { code: 'insufficient_stock', message: 'secret' }])(
  'preserves legacy and structured error codes: %j',
  async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => data }))
    await expect(commerceRequest('cart', parseCartView)).rejects.toThrow(
      'Not enough stock. Update the quantity in your cart.',
    )
  },
)
