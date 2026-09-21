import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { baseMetadata } from '@/lib/seo'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/newsreader'
import './globals.css'
import { WishlistProvider } from '@/components/shop/wishlist-provider'
import { AssistantProvider } from '@/components/assistant/assistant-provider'

// SEO 基座集中在 src/lib/seo.ts（brand 模板 / metadataBase / OG），单点维护。
export const metadata: Metadata = baseMetadata

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <WishlistProvider>
          <AssistantProvider>{children}</AssistantProvider>
        </WishlistProvider>
      </body>
    </html>
  )
}
