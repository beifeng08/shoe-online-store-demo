'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CommerceVariant } from '@/domain/commerce'
import { commerceRequest } from '@/lib/commerce-client'

export function ProductBuyBar({
  variant,
  selectedLabel,
  colorName,
  loading,
  error,
}: {
  variant: CommerceVariant | null
  selectedLabel: string | null
  colorName: string | null
  loading: boolean
  error: string | null
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function add() {
    if (!variant || busy) return
    setBusy(true)
    setMessage('')
    try {
      await commerceRequest('cart/items', {
        method: 'POST',
        body: JSON.stringify({ variant_id: variant.id, quantity: 1 }),
      })
      setMessage('已加入购物车')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '加入购物车失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {variant && (
        <p className="text-sm">
          {variant.currency} {variant.price} · 可用库存 {variant.available}
        </p>
      )}
      <Button
        type="button"
        className="w-full py-2.5 text-base"
        disabled={loading || busy || !variant || variant.available < 1}
        onClick={add}
      >
        {busy ? '正在加入…' : '加入购物车'}
      </Button>
      <p role="status" className="min-h-4 text-xs leading-5 text-neutral-500">
        {message ||
          error ||
          (loading
            ? '正在读取可选规格…'
            : !selectedLabel
              ? '请选择颜色和尺码'
              : !variant
                ? '此颜色和尺码暂不可用'
                : `${colorName} · ${selectedLabel} selected`)}
      </p>
      <Link href="/cart" className="text-sm underline underline-offset-4">
        查看购物车
      </Link>
    </div>
  )
}
