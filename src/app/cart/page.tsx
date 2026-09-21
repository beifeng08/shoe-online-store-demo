import { CommercePanel } from '@/components/shop/commerce-panel'
import { SiteShell } from '@/components/marketing/site-shell'

export default function CartPage() {
  return (
    <SiteShell>
      <CommercePanel mode="cart" />
    </SiteShell>
  )
}
