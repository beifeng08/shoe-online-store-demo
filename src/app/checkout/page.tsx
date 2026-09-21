import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'

export default function CheckoutPage() {
  return (
    <SiteShell>
      <CommercePanel mode="checkout" />
    </SiteShell>
  )
}
