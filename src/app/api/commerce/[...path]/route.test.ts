import { afterEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

afterEach(() => vi.unstubAllGlobals())
it('accepts the browser host when Next internally normalizes the URL to localhost', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"items":[]}'))
  vi.stubGlobal('fetch', fetcher)
  const req = new NextRequest('http://localhost:3000/api/commerce/cart/items', {
    method: 'POST',
    headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
  })
  expect((await POST(req, { params: Promise.resolve({ path: ['cart', 'items'] }) })).status).toBe(
    200,
  )
})
it('sets a private no-store session cookie and forwards only the trusted session', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"items":[]}'))
  vi.stubGlobal('fetch', fetcher)
  const response = await GET(
    new NextRequest('http://localhost:3000/api/commerce/cart', {
      headers: { 'X-Session-ID': 'spoof' },
    }),
    { params: Promise.resolve({ path: ['cart'] }) },
  )
  expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  expect(response.headers.get('set-cookie')).toContain('SameSite=lax')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(fetcher.mock.calls[0][1].headers['X-Session-ID']).not.toBe('spoof')
})
it('rejects cross-origin writes and arbitrary upstream paths', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const req = new NextRequest('http://localhost:3000/api/commerce/cart/items', {
    method: 'POST',
    headers: { origin: 'https://attacker.example' },
  })
  expect((await POST(req, { params: Promise.resolve({ path: ['cart', 'items'] }) })).status).toBe(
    403,
  )
  expect((await GET(req, { params: Promise.resolve({ path: ['admin'] }) })).status).toBe(404)
  expect(fetcher).not.toHaveBeenCalled()
})
it('preserves session and idempotency key across a retry and reports outages', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetcher)
  const sid = crypto.randomUUID()
  const req = new NextRequest('http://localhost:3000/api/commerce/checkout/create-order', {
    method: 'POST',
    headers: { cookie: `evoloop_cart_session=${sid}`, 'Idempotency-Key': 'same-key' },
  })
  const response = await POST(req, {
    params: Promise.resolve({ path: ['checkout', 'create-order'] }),
  })
  expect(response.status).toBe(503)
  expect(fetcher.mock.calls[0][1].headers).toMatchObject({
    'X-Session-ID': sid,
    'Idempotency-Key': 'same-key',
  })
  expect(response.headers.get('set-cookie')).toBeNull()
})
