'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { CommerceVariant } from '@/domain/commerce'
import { parseCartView } from '@/domain/commerce-response'
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
      await commerceRequest('cart/items', parseCartView, {
        method: 'POST',
        body: JSON.stringify({ variant_id: variant.id, quantity: 1 }),
      })
      setMessage('Added to cart.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not add this item to your cart.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {variant && (
        <p className="text-sm">
          {variant.currency} {variant.price} · {variant.available} available
        </p>
      )}
      <Button
        type="button"
        className="w-full py-2.5 text-base"
        disabled={loading || busy || !variant || variant.available < 1}
        onClick={add}
      >
        {busy ? 'Adding...' : 'Add to cart'}
      </Button>
      <p role="status" className="min-h-4 text-xs leading-5 text-neutral-500">
        {message ||
          error ||
          (loading
            ? 'Loading available options...'
            : !selectedLabel
              ? 'Choose a color and size.'
              : !variant
                ? 'This color and size are unavailable.'
                : `${colorName} · ${selectedLabel} selected`)}
      </p>
      <Link href="/cart" className="text-sm underline underline-offset-4">
        View cart
      </Link>
    </div>
  )
}
