'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { CartView, OrderView } from '@/domain/commerce'
import { parseCartView, parseOrderView } from '@/domain/commerce-response'
import { commerceRequest } from '@/lib/commerce-client'
import { Button } from '@/components/ui/button'

const pendingKey = 'evoloop-pending-checkout'

export function CommercePanel({
  mode,
  orderId,
}: {
  mode: 'cart' | 'checkout' | 'order'
  orderId?: string
}) {
  const [cart, setCart] = useState<CartView | null>(null)
  const [order, setOrder] = useState<OrderView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retryPending, setRetryPending] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    const request =
      mode === 'order'
        ? commerceRequest(`orders/${orderId}`, parseOrderView).then((data) => {
            if (active) setOrder(data)
          })
        : commerceRequest(
            mode === 'checkout' ? 'checkout/preview' : 'cart',
            parseCartView,
            mode === 'checkout' ? { method: 'POST' } : undefined,
          ).then((data) => {
            if (active) setCart(data)
          })
    request
      .then(() => {
        if (!active) return
        setRetryPending(Boolean(sessionStorage.getItem(pendingKey)))
      })
      .catch((e: Error) => {
        if (active) {
          setError(e.message)
          setRetryPending(Boolean(sessionStorage.getItem(pendingKey)))
        }
      })
    return () => {
      active = false
    }
  }, [mode, orderId])

  async function act(operation: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  function change(id: string, quantity?: number) {
    return act(async () =>
      setCart(
        await commerceRequest(
          `cart/items/${id}`,
          parseCartView,
          quantity == null
            ? { method: 'DELETE' }
            : { method: 'PATCH', body: JSON.stringify({ quantity }) },
        ),
      ),
    )
  }

  function createOrder() {
    return act(async () => {
      const key = sessionStorage.getItem(pendingKey) ?? crypto.randomUUID()
      sessionStorage.setItem(pendingKey, key)
      setRetryPending(true)
      const created = await commerceRequest('checkout/create-order', parseOrderView, {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
      })
      setOrder(created)
      sessionStorage.removeItem(pendingKey)
      sessionStorage.setItem('evoloop-last-order', created.id)
    })
  }

  const view = order ?? cart
  return (
    <section className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="font-heading text-3xl font-semibold">
        {order || mode === 'order' ? 'Order details' : mode === 'cart' ? 'Cart' : 'Review order'}
      </h1>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 p-4 text-red-700">
          {error}
        </p>
      )}
      {!view && !error && <p role="status">Loading...</p>}
      {order && (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-surface p-5">
          <p className="break-all">Order ID: {order.id}</p>
          <p>
            Status:{' '}
            {order.status === 'cancelled'
              ? order.cancellation_reason === 'expired'
                ? 'Expired'
                : 'Cancelled'
              : 'Pending payment'}
          </p>
          <p role="status" className="font-semibold">
            Payments are not available yet.
          </p>
          <p className="text-sm text-neutral-600">
            {order.status === 'cancelled'
              ? 'No payment has been taken. Inventory has been released. Add the item to your cart again to purchase.'
              : 'No payment has been taken. Inventory will be released automatically when this order expires, or you can cancel it sooner.'}
          </p>
          {order.status === 'pending_payment' && order.expires_at && (
            <p className="text-sm text-neutral-600">
              Inventory reserved until:{' '}
              <time dateTime={order.expires_at}>{new Date(order.expires_at).toLocaleString()}</time>
            </p>
          )}
          <button
            type="button"
            className="text-sm underline"
            disabled={busy}
            onClick={() =>
              act(async () => setOrder(await commerceRequest(`orders/${order.id}`, parseOrderView)))
            }
          >
            Refresh order status
          </button>
          <Link href={`/orders/${order.id}`} className="text-sm underline">
            Permanent order link (available only in this shopping session)
          </Link>
        </div>
      )}
      {view?.items.map((item) => (
        <article
          key={item.id}
          className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 py-4"
        >
          <div className="space-y-1">
            <h2 className="font-medium">{item.title}</h2>
            <p className="text-sm text-neutral-600">
              {item.color} · EU {item.size}
            </p>
            <p className="text-xs text-neutral-500">{item.sku}</p>
            <p>
              {view.currency} {item.unit_price} / pair
            </p>
          </div>
          {mode === 'cart' && !order ? (
            <div className="flex items-center gap-3">
              <label className="text-sm">
                Quantity
                <select
                  aria-label={`${item.title} quantity`}
                  className="ml-2 rounded border p-2"
                  value={item.quantity}
                  disabled={busy}
                  onChange={(event) => change(item.id, Number(event.target.value))}
                >
                  {Array.from({ length: 99 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy} onClick={() => change(item.id)} className="text-sm underline">
                Remove {item.title}
              </button>
            </div>
          ) : (
            <p>Quantity: {item.quantity}</p>
          )}
        </article>
      ))}
      {view && (
        <p className="text-xl font-semibold">
          Total: {view.currency} {view.total}
        </p>
      )}
      {view?.items.length === 0 && <p>Your cart is empty.</p>}
      {mode === 'cart' && Boolean(cart?.items.length) && (
        <Link href="/checkout" className="inline-block rounded-full bg-ink px-6 py-3 text-white">
          Review checkout
        </Link>
      )}
      {mode === 'checkout' && !order && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Your total is recalculated when you place the order. This local demo does not add
            shipping or tax. Payments are not available yet.
          </p>
          <Button disabled={busy || (!cart?.items.length && !retryPending)} onClick={createOrder}>
            {busy ? 'Creating...' : retryPending ? 'Retry order request' : 'Create pending order'}
          </Button>
        </div>
      )}
      {order?.status === 'pending_payment' && (
        <Button
          disabled={busy}
          onClick={() =>
            act(async () =>
              setOrder(
                await commerceRequest(`orders/${order.id}/cancel`, parseOrderView, {
                  method: 'POST',
                }),
              ),
            )
          }
        >
          Cancel order and release inventory
        </Button>
      )}
      <div className="flex gap-5 text-sm underline">
        <Link href="/shop">Continue shopping</Link>
        {mode !== 'cart' && <Link href="/cart">Back to cart</Link>}
      </div>
    </section>
  )
}
