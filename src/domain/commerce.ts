export interface CommerceVariant {
  id: string
  color: string
  size: number
  price: string
  currency: string
  available: number
}
export interface CommerceProduct {
  variants: CommerceVariant[]
}
export interface CartLine {
  id: string
  variant_id: string
  title: string
  sku: string
  color: string
  size: number
  quantity: number
  unit_price: string
  available?: number
}
export interface CartView {
  items: CartLine[]
  total: string
  currency: string
}
export interface OrderView extends CartView {
  id: string
  status: 'pending_payment' | 'cancelled'
  payment_enabled: false
  message: string
}
