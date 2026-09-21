import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CommercePanel } from './commerce-panel'

const line = {
  id: 'item-1',
  variant_id: 'variant-1',
  title: 'Urban Bloom',
  sku: 'SKU',
  color: 'Ivory',
  size: 42,
  quantity: 1,
  unit_price: '59.00',
}
const cart = { items: [line], total: '59.00', currency: 'USD' }
const order = {
  ...cart,
  id: 'order-1',
  status: 'pending_payment',
  payment_enabled: false,
  message: '支付暂未开放',
  expires_at: '2026-09-21T14:30:00+00:00',
  cancellation_reason: null,
}
const ok = (data: unknown) => ({ ok: true, json: async () => data })
beforeEach(() => sessionStorage.clear())
afterEach(() => vi.unstubAllGlobals())

it('changes cart quantity using the backend total and removes an item', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(cart))
    .mockResolvedValueOnce(ok({ ...cart, items: [{ ...line, quantity: 2 }], total: '118.00' }))
    .mockResolvedValueOnce(ok({ ...cart, items: [], total: '0.00' }))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="cart" />)
  fireEvent.change(await screen.findByLabelText('Urban Bloom 数量'), { target: { value: '2' } })
  expect(await screen.findByText('合计：USD 118.00')).toBeInTheDocument()
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/commerce/cart/items/item-1',
    expect.objectContaining({ method: 'PATCH', body: '{"quantity":2}' }),
  )
  fireEvent.click(screen.getByRole('button', { name: '删除 Urban Bloom' }))
  expect(await screen.findByText('购物车为空。')).toBeInTheDocument()
})

it('creates pending order, shows payment disabled and supports cancellation', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(cart))
    .mockResolvedValueOnce(ok(order))
    .mockResolvedValueOnce(ok({ ...order, status: 'cancelled' }))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="checkout" />)
  await screen.findByText('Urban Bloom')
  fireEvent.click(screen.getByRole('button', { name: '创建待支付订单' }))
  expect(await screen.findByText('订单编号：order-1')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('支付暂未开放')
  expect(screen.getByText('状态：待支付（pending_payment）')).toBeInTheDocument()
  const request = fetcher.mock.calls[1][1]
  expect(request.headers['Idempotency-Key']).toBeTruthy()
  expect(request.body).toBeUndefined()
  fireEvent.click(screen.getByRole('button', { name: '取消订单并释放库存' }))
  expect(await screen.findByText('状态：已取消')).toBeInTheDocument()
})

it('keeps the same idempotency key after an ambiguous network failure', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(cart))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(ok(order))
  vi.stubGlobal('fetch', fetcher)
  render(<CommercePanel mode="checkout" />)
  await screen.findByText('Urban Bloom')
  fireEvent.click(screen.getByRole('button', { name: '创建待支付订单' }))
  await screen.findByText('offline')
  fireEvent.click(screen.getByRole('button', { name: '重试订单请求' }))
  await screen.findByText('订单编号：order-1')
  expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(
    fetcher.mock.calls[2][1].headers['Idempotency-Key'],
  )
  await waitFor(() => expect(sessionStorage.getItem('evoloop-pending-checkout')).toBeNull())
})

it('shows the reservation deadline and refreshes to expired without enabling payment', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(ok(order))
    .mockResolvedValueOnce(
      ok({
        ...order,
        status: 'cancelled',
        cancellation_reason: 'expired',
      }),
    )
  vi.stubGlobal('fetch', fetcher)
  const { container } = render(<CommercePanel mode="order" orderId="order-1" />)
  await screen.findByText('状态：待支付（pending_payment）')
  expect(container.querySelector('time')).toHaveAttribute('dateTime', order.expires_at)
  fireEvent.click(screen.getByRole('button', { name: '刷新订单状态' }))
  expect(await screen.findByText('状态：已过期')).toBeInTheDocument()
  expect(screen.getByText(/库存已释放/)).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('支付暂未开放')
  expect(screen.queryByRole('button', { name: '取消订单并释放库存' })).not.toBeInTheDocument()
})

it('renders historical cancelled orders with no reservation deadline', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(ok({ ...order, status: 'cancelled', expires_at: null })),
  )
  const { container } = render(<CommercePanel mode="order" orderId="order-1" />)
  await screen.findByText('状态：已取消')
  expect(container.querySelector('time')).toBeNull()
  expect(screen.getByText(/库存已释放/)).toBeInTheDocument()
})
