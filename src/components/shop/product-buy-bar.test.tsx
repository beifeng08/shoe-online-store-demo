import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProductBuyBar } from './product-buy-bar'

const variant = {
  id: 'variant-ivory-42',
  color: 'Ivory',
  size: 42,
  price: '59.00',
  currency: 'USD',
  available: 10,
}
const props = { variant, selectedLabel: 'US 8.5', colorName: 'Ivory', loading: false, error: null }
afterEach(() => vi.unstubAllGlobals())

describe('Python cart purchase entry', () => {
  it('requires a real variant and disables unavailable stock', () => {
    const { rerender } = render(<ProductBuyBar {...props} variant={null} />)
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled()
    rerender(<ProductBuyBar {...props} variant={{ ...variant, available: 0 }} />)
    expect(screen.getByRole('button', { name: '加入购物车' })).toBeDisabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('submits only variant identity and quantity and reports success', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) })
    vi.stubGlobal('fetch', fetcher)
    render(<ProductBuyBar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }))
    expect(await screen.findByText('已加入购物车')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledWith(
      '/api/commerce/cart/items',
      expect.objectContaining({ body: JSON.stringify({ variant_id: variant.id, quantity: 1 }) }),
    )
  })
  it('shows a backend error without claiming an item was added', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Service offline')))
    render(<ProductBuyBar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '加入购物车' }))
    expect(await screen.findByText('Service offline')).toBeInTheDocument()
    expect(screen.queryByText('已加入购物车')).not.toBeInTheDocument()
  })
})
