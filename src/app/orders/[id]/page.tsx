import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <SiteShell>
      <CommercePanel mode="order" orderId={id} />
    </SiteShell>
  )
}
