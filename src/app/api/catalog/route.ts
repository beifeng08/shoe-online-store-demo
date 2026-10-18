// GET /api/catalog?handles=dc-1001,dc-1002 — 只读商品摘要（决策：/saved 收藏页等
// 客户端场景需要按 handle 拉取展示数据；目录数据在 server（DB/seed），UI 无本地副本）。
// 返回最小展示字段（不含价/不含 store token）：保持顺序、去重、过滤未知 handle、
// 上限 30（防滥用；全目录仅 29 款）。storeAvailable = 该 handle 已映射商店 Buy（env 配置时）。
import { sizeRangeFromCanonical } from '@/domain/size'
import { listProductsForMarket } from '@/server/catalog/service'
import { shopifyBuyConfigFor } from '@/server/catalog/shopify-buy'

export const dynamic = 'force-dynamic' // 目录来自 DB（seed/DB 随运行变更），不做 SSG 缓存

const MAX_HANDLES = 30

export interface CatalogSummary {
  handle: string
  title: string
  subtitle: string
  /** 本地首图路径（/products/<handle>/…）或 null（无图款 → 调用方 SVG 兜底）。 */
  image: string | null
  colorCount: number
  photoCount: number
  /** 码段（market 体系，如 "US 4.5–9.5"）；无码款 null。 */
  sizeRange: string | null
  /** 已映射商店产品（Buy 全接管 PDP 时显示徽记）。 */
  storeAvailable: boolean
}

export async function GET(req: Request): Promise<Response> {
  // 不用 try/catch：req.url 必然可解析，catch 分支不可达（2026-10-12 审计核实后删除）。
  // 依据：NextRequest 构造时即调 validateURL（next/dist/server/web/spec-extension/request.js
  // 用 String(new URL(String(url)))），非法 URL 在构造阶段先抛；且 Request 本身无法用相对
  // URL 构造。故不存在「无效 URL」输入，包 try/catch 只会让读者以为该端点容忍非法 URL。
  const url = new URL(req.url)
  const raw = (url.searchParams.get('handles') ?? '').trim()
  if (!raw) return Response.json([])
  // 去重并保序；超上限只取前 30（防超大参数；后续有需要再谈分页）
  const handles = [
    ...new Set(
      raw
        .split(',')
        .map((h) => h.trim())
        .filter((h) => h !== ''),
    ),
  ].slice(0, MAX_HANDLES)
  if (!handles.length) return Response.json([])

  const all = await listProductsForMarket({})
  const byHandle = new Map(all.map((p) => [p.handle, p]))
  const out: CatalogSummary[] = []
  for (const handle of handles) {
    const p = byHandle.get(handle)
    if (!p) continue // 未知 handle 静默过滤（收藏过期项不 404 崩页）
    out.push({
      handle: p.handle,
      title: p.title,
      subtitle: p.subtitle,
      image: p.images?.[0] ?? null,
      colorCount: p.colors?.length ?? 0,
      photoCount: p.images?.length ?? 0,
      sizeRange: sizeRangeFromCanonical(p.sizes),
      storeAvailable: shopifyBuyConfigFor(p.handle) != null,
    })
  }
  return Response.json(out)
}
