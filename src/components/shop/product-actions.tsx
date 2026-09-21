'use client'

import { useSyncExternalStore, useEffect, useState, type ReactNode } from 'react'
import type { CommerceProduct } from '@/domain/commerce'
import { commerceRequest } from '@/lib/commerce-client'
import type { CanonicalSize } from '@/domain/product'
import type { ProductView } from '@/domain/product'
import type { ShopifyBuyConfig } from '@/server/catalog/shopify-buy'
import { footMmToEU } from '@/domain/size'
import { mySize } from '@/lib/my-size'
import { useAssistant } from '@/components/assistant/assistant-provider'
import { SizeSelector } from './size-selector'
import { ProductBuyBar } from './product-buy-bar'
import { ShopifyBuyButton } from './shopify-buy-button'
import { MySizeGuide } from './my-size-guide'
import { useOptionalProductColorSelection } from './product-color-selection'

interface ProductActionsProps {
  product: ProductView
  /** 服务端已算好的结算 URL（无 store → null） */
  buyUrl: string | null
  /**
   * 商店在售配置（2026-09-06 全目录）：非 null 时该 PDP 为「商店直购」形态 ——
   * 尺码/颜色选择与 demo 购买条整体隐藏，只渲染 Shopify Buy Button（其 iframe 内自带
   * 商店真实变体选择与店币价格）；Find my size / 手风琴 / 护理海报等 demo 内容保留。
   */
  buyConfig?: ShopifyBuyConfig | null
  /**
   * 由页面（RSC）注入、渲染于 "Find my size" 与购买条之间的内容
   * （材质/合脚手风琴，无尺码依赖）。
   */
  children?: ReactNode
}

// PDP 购买群集（顺序）：颜色选择（多色款，受控）→ 尺码选择 → "Find my size" → 手风琴（children 插槽）→ 购买条。
// children 插槽让本集群保持单一 'use client' 边界共享 selected 状态，同时允许页面以 RSC 注入中间内容；
// 持有所选尺码/颜色状态，供购买条在无 store 阶段做 aria-live 说明。
export function ProductActions({ product, buyConfig = null, children }: ProductActionsProps) {
  const storeLive = buyConfig != null
  const [commerce, setCommerce] = useState<CommerceProduct | null>(null)
  const [commerceError, setCommerceError] = useState<string | null>(null)
  useEffect(() => {
    if (storeLive) return
    let active = true
    commerceRequest<CommerceProduct>(`catalog/products/${product.handle}`)
      .then((data) => {
        if (active) setCommerce(data)
      })
      .catch((e: Error) => {
        if (active) setCommerceError(e.message)
      })
    return () => {
      active = false
    }
  }, [product.handle, storeLive])
  const colors = product.colors ?? []
  // 「我的尺码」快照：demo 分支 Select-size 命中高亮（产品在库才显形，天然自然）。
  const myMm = useSyncExternalStore(mySize.subscribe, mySize.getSnapshot, mySize.getServerSnapshot)
  const myCanonical = myMm != null ? footMmToEU(myMm) : null
  // 页面 Provider 存在时与图库共享色号；孤立渲染（测试/复用）时保留本地状态。
  const colorSelection = useOptionalProductColorSelection()
  const [localColorIdx, setLocalColorIdx] = useState(0)
  const colorIdx = colorSelection?.colorIndex ?? localColorIdx
  const setColorIdx = colorSelection?.setColorIndex ?? setLocalColorIdx
  const [selected, setSelected] = useState<CanonicalSize | null>(null)
  // 面板打开 + 预置 size-fit 上下文由 AssistantProvider 处理；context 为空（Provider 未挂载的孤立渲染）时静默。
  const assistant = useAssistant()
  const selectedLabel = product.sizeOptions.find((o) => o.value === selected)?.label ?? null
  const colorName =
    colors.length > 0 ? (colors[Math.min(colorIdx, colors.length - 1)]?.name ?? null) : null

  // Find my size（AI 尺码咨询，商店直购形态下保留 —— 决策：只隐藏选择器与 demo 购买条）
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

  // 商店直购形态：隐藏本站颜色/尺码选择器与 demo 购买条，以 Buy Button 全接管变体选择与结算。
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
        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-sm font-medium text-ink">
            Color
            {colorName ? (
              <span className="ml-1.5 font-normal text-neutral-500">{colorName}</span>
            ) : null}
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {colors.map((c, i) => {
              const active = i === colorIdx
              return (
                <label key={`${c.hex}-${c.name}`} className="group cursor-pointer">
                  <input
                    type="radio"
                    name="colors"
                    value={c.name}
                    checked={active}
                    aria-label={c.name}
                    onChange={() => setColorIdx(i)}
                    className="peer sr-only"
                  />
                  <span
                    className={`block h-9 w-9 rounded-full border transition-shadow group-focus-within:outline group-focus-within:outline-2 group-focus-within:outline-offset-2 group-focus-within:outline-neutral-400 ${
                      active
                        ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas'
                        : 'border-neutral-300'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                </label>
              )
            })}
          </div>
          <p className="text-xs leading-5 text-neutral-500">Colors may vary slightly on screen.</p>
        </fieldset>
      ) : null}
      <SizeSelector
        sizeOptions={product.sizeOptions}
        selected={selected}
        onChange={setSelected}
        match={myCanonical}
      />
      {/** 尺码旁「My size」行（克制）：保存后全站高亮 + Find my size 预填。 */}
      <MySizeGuide />
      {findMySize}
      {children}
      <ProductBuyBar
        variant={
          commerce?.variants.find(
            (v) => v.color === (colorName ?? 'Standard') && v.size === selected,
          ) ?? null
        }
        loading={!commerce && !commerceError}
        error={commerceError}
        selectedLabel={selectedLabel}
        colorName={colorName}
      />
    </div>
  )
}
