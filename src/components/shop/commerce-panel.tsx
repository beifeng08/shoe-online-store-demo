'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { CartView, OrderView } from '@/domain/commerce'
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
        ? commerceRequest<OrderView>(`orders/${orderId}`)
        : commerceRequest<CartView>(
            mode === 'checkout' ? 'checkout/preview' : 'cart',
            mode === 'checkout' ? { method: 'POST' } : undefined,
          )
    request
      .then((data) => {
        if (!active) return
        if (mode === 'order') setOrder(data as OrderView)
        else setCart(data)
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
      setError(e instanceof Error ? e.message : '操作失败，请重试。')
    } finally {
      setBusy(false)
      inFlight.current = false
    }
  }

  function change(id: string, quantity?: number) {
    return act(async () =>
      setCart(
        await commerceRequest<CartView>(
          `cart/items/${id}`,
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
      const created = await commerceRequest<OrderView>('checkout/create-order', {
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
        {order || mode === 'order' ? '订单详情' : mode === 'cart' ? '购物车' : '确认订单'}
      </h1>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 p-4 text-red-700">
          {error}
        </p>
      )}
      {!view && !error && <p role="status">正在加载…</p>}
      {order && (
        <div className="space-y-2 rounded-xl border border-neutral-200 bg-surface p-5">
          <p className="break-all">订单编号：{order.id}</p>
          <p>状态：{order.status === 'cancelled' ? '已取消' : '待支付（pending_payment）'}</p>
          <p role="status" className="font-semibold">
            支付暂未开放
          </p>
          <p className="text-sm text-neutral-600">
            没有扣款。待支付订单会保留库存，取消订单即可释放。
          </p>
          <Link href={`/orders/${order.id}`} className="text-sm underline">
            订单永久链接（仅当前购物会话可查看）
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
              {view.currency} {item.unit_price} / 双
            </p>
          </div>
          {mode === 'cart' && !order ? (
            <div className="flex items-center gap-3">
              <label className="text-sm">
                数量
                <select
                  aria-label={`${item.title} 数量`}
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
                删除 {item.title}
              </button>
            </div>
          ) : (
            <p>数量 {item.quantity}</p>
          )}
        </article>
      ))}
      {view && (
        <p className="text-xl font-semibold">
          合计：{view.currency} {view.total}
        </p>
      )}
      {view?.items.length === 0 && <p>购物车为空。</p>}
      {mode === 'cart' && Boolean(cart?.items.length) && (
        <Link href="/checkout" className="inline-block rounded-full bg-ink px-6 py-3 text-white">
          结算确认
        </Link>
      )}
      {mode === 'checkout' && !order && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            金额将在下单时重新核算。本地演示订单不收取运费和税费；支付暂未开放。
          </p>
          <Button disabled={busy || (!cart?.items.length && !retryPending)} onClick={createOrder}>
            {busy ? '正在创建…' : retryPending ? '重试订单请求' : '创建待支付订单'}
          </Button>
        </div>
      )}
      {order?.status === 'pending_payment' && (
        <Button
          disabled={busy}
          onClick={() =>
            act(async () =>
              setOrder(
                await commerceRequest<OrderView>(`orders/${order.id}/cancel`, { method: 'POST' }),
              ),
            )
          }
        >
          取消订单并释放库存
        </Button>
      )}
      <div className="flex gap-5 text-sm underline">
        <Link href="/shop">继续选购</Link>
        {mode !== 'cart' && <Link href="/cart">返回购物车</Link>}
      </div>
    </section>
  )
}
