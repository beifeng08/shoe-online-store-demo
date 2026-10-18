import { site } from './site'
import type { Metadata } from 'next'

/**
 * 站点绝对基址（OG 图片等需要）。开发环境回退 localhost:3000，
 * 生产环境默认使用正式域名；部署时仍可用 NEXT_PUBLIC_SITE_URL 覆盖。
 * 非法 env 不抛错：按当前环境选择安全回退。
 */
const DEFAULT_BASE = site.url
const DEV_BASE = 'http://localhost:3000'
const resolveBaseUrl = (): URL => {
  const fallback = process.env.NODE_ENV === 'production' ? DEFAULT_BASE : DEV_BASE
  try {
    const raw = process.env.NEXT_PUBLIC_SITE_URL ?? ''
    if (!raw) return new URL(fallback)
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url
    return new URL(fallback)
  } catch {
    // 入参来自 env，非编译期常量：解析失败按缺省处理，绝不抛出
    return new URL(fallback)
  }
}

export const absoluteUrl = (pathname = '/'): string =>
  new URL(pathname, resolveBaseUrl()).toString()

const baseDescription =
  'Casual shoes printed to order with digital manufacturing, millimetre-based sizing, and a lower-inventory footprint.'

export const baseMetadata: Metadata = {
  metadataBase: resolveBaseUrl(),
  title: { default: site.name, template: `%s — ${site.name}` },
  description: baseDescription,
  alternates: { canonical: '/' },
  keywords: ['Evoloop', 'made-to-order shoes', '3D printed shoes', 'shoe sizing guide'],
  authors: [{ name: site.name, url: site.url }],
  creator: site.name,
  publisher: site.name,
  openGraph: {
    type: 'website',
    url: '/',
    title: site.name,
    description: baseDescription,
    images: ['/og'],
    siteName: site.name,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: site.name,
    description: baseDescription,
    images: ['/og'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
}

export const pageMetadata = (o: Partial<Metadata>): Metadata => {
  const title = typeof o.title === 'string' ? o.title : undefined
  return {
    ...baseMetadata,
    ...o,
    openGraph: {
      ...baseMetadata.openGraph,
      ...(o.openGraph ?? {}),
      ...(title ? { title } : {}),
    },
    twitter: {
      ...baseMetadata.twitter,
      ...(o.twitter ?? {}),
      ...(title ? { title } : {}),
    },
  }
}
