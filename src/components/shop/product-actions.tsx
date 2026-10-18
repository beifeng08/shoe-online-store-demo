'use client'

import { useSyncExternalStore, useEffect, useState, type ReactNode } from 'react'
import type { CommerceProduct } from '@/domain/commerce'
import { parseCommerceProduct } from '@/domain/commerce-response'
import { commerceRequest } from '@/lib/commerce-client'
import type { CanonicalSize, ProductView, SizeSystem } from '@/domain/product'
import type { ShopifyBuyConfig } from '@/server/catalog/shopify-buy'
import { footMmToEU, sizeLabel } from '@/domain/size'
import { mySize } from '@/lib/my-size'
import { useAssistant } from '@/components/assistant/assistant-provider'
import { SizeSelector } from './size-selector'
import { ProductBuyBar } from './product-buy-bar'
import { ShopifyBuyButton } from './shopify-buy-button'
import { MySizeGuide } from './my-size-guide'
import { useOptionalProductColorSelection } from './product-color-selection'

interface ProductActionsProps {
  product: ProductView
  // Reserved direct-store URL; not consumed until getBuyUrl enables that channel.
  buyUrl: string | null
  buyConfig?: ShopifyBuyConfig | null
  sizeSystem?: SizeSystem
  children?: ReactNode
}

const CATALOG_TIMEOUT_MS = 15_000

export function ProductActions(props: ProductActionsProps) {
  // A new product or purchase provider cannot inherit an old transaction selection.
  return <ProductPurchase key={`${props.product.handle}:${props.buyConfig != null}`} {...props} />
}

function ProductPurchase({
  product,
  buyConfig = null,
  sizeSystem = 'US',
  children,
}: ProductActionsProps) {
  const storeLive = buyConfig != null
  const [commerce, setCommerce] = useState<CommerceProduct | null>(null)
  const [commerceError, setCommerceError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selectedColor, setSelectedColor] = useState<string | null>(null)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const colorSelection = useOptionalProductColorSelection()
  const focusImage = colorSelection?.focusImage

  useEffect(() => {
    if (storeLive) return
    let active = true
    let timedOut = false
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, CATALOG_TIMEOUT_MS)
    commerceRequest(
      `catalog/products/${encodeURIComponent(product.handle)}`,
      parseCommerceProduct,
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!active) return
        const color = data.variants[0]?.color ?? null
        setCommerce(data)
        setSelectedColor(color)
      })
      .catch((error: unknown) => {
        if (!active) return
        setCommerceError(
          timedOut
            ? 'Checking availability timed out. Please try again.'
            : error instanceof Error && error.name !== 'AbortError'
              ? error.message
              : 'Could not check availability. Please try again.',
        )
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [product.handle, storeLive, attempt])

  const selectedMedia = commerce?.media.find((entry) => entry.color === selectedColor)
  const imageUrl =
    selectedMedia && product.images?.includes(selectedMedia.url) ? selectedMedia.url : null
  useEffect(() => {
    if (!storeLive) focusImage?.(imageUrl)
  }, [imageUrl, selectedColor, attempt, storeLive, focusImage])

  const myMm = useSyncExternalStore(mySize.subscribe, mySize.getSnapshot, mySize.getServerSnapshot)
  const myCanonical = myMm != null ? footMmToEU(myMm) : null
  const assistant = useAssistant()
  const variants = commerce?.variants ?? []
  const colors = [
    ...new Map(variants.map((variant) => [variant.color, variant.color_hex])).entries(),
  ]
  const variant = variants.find((entry) => entry.id === selectedVariantId) ?? null
  const selected = variant?.size ?? null
  const sizeOptions = variants
    .filter((entry) => entry.color === selectedColor)
    .map((entry) => ({ value: entry.size, label: sizeLabel(entry.size, sizeSystem) }))
    .sort((a, b) => a.value - b.value)
  const loading = !commerce && !commerceError

  function chooseColor(color: string) {
    if (busy || loading || commerceError) return
    setSelectedColor(color)
    setSelectedVariantId(
      variants.find((entry) => entry.color === color && entry.size === selected)?.id ?? null,
    )
  }

  function chooseSize(size: CanonicalSize) {
    if (busy || loading || commerceError) return
    setSelectedVariantId(
      variants.find((entry) => entry.color === selectedColor && entry.size === size)?.id ?? null,
    )
  }

  function recheck() {
    if (busy || loading) return
    setCommerce(null)
    setCommerceError(null)
    setSelectedColor(null)
    setSelectedVariantId(null)
    focusImage?.(null)
    setAttempt((value) => value + 1)
  }

  const findMySize = (
    <div className={storeLive ? '' : '-mt-3'}>
      <button
        type="button"
        onClick={() => assistant?.open('size-fit', product)}
        className="text-sm font-medium text-ink underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
      >
        Find my size
      </button>
    </div>
  )

  if (storeLive) {
    return (
      <div className="flex flex-col gap-5">
        {findMySize}
        {children}
        <ShopifyBuyButton config={buyConfig} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {colors.length > 1 ? (
        <fieldset className="flex flex-col gap-2.5" disabled={busy || loading || !!commerceError}>
          <legend className="text-sm font-medium text-ink">
            Color
            {selectedColor ? (
              <span className="ml-1.5 font-normal text-neutral-500">{selectedColor}</span>
            ) : null}
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {colors.map(([color, hex]) => {
              const active = color === selectedColor
              return (
                <label key={color} className="group cursor-pointer">
                  <input
                    type="radio"
                    name="colors"
                    value={color}
                    checked={active}
                    aria-label={color}
                    onChange={() => chooseColor(color)}
                    onClick={() => {
                      if (active && !busy && !loading && !commerceError) focusImage?.(imageUrl)
                    }}
                    className="peer sr-only"
                  />
                  <span
                    className={`block h-9 w-9 rounded-full border transition-shadow group-focus-within:outline group-focus-within:outline-2 group-focus-within:outline-offset-2 group-focus-within:outline-neutral-400 ${
                      active
                        ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas'
                        : 'border-neutral-300'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                </label>
              )
            })}
          </div>
          <p className="text-xs leading-5 text-neutral-500">Colors may vary slightly on screen.</p>
        </fieldset>
      ) : null}
      <SizeSelector
        sizeOptions={sizeOptions}
        selected={selected}
        onChange={chooseSize}
        match={myCanonical}
        disabled={busy || loading || !!commerceError}
      />
      <MySizeGuide />
      {findMySize}
      {children}
      <ProductBuyBar
        key={attempt}
        variant={variant}
        loading={loading}
        error={commerceError}
        selectedLabel={selected == null ? null : sizeLabel(selected, sizeSystem)}
        colorName={selectedColor}
        onRecheck={recheck}
        onBusyChange={setBusy}
      />
    </div>
  )
}
