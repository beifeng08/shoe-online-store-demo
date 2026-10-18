import type { components, paths } from './commerce-api.generated'

// API shapes come from Python. These projections retain the existing page contract.
type Schemas = components['schemas']
export type CommerceVariant = Pick<
  Schemas['VariantResponse'],
  'id' | 'color' | 'color_hex' | 'size' | 'price' | 'currency' | 'available'
>
export type CommerceProduct = Pick<Schemas['ProductResponse'], 'media'> & {
  [Key in keyof Pick<Schemas['ProductResponse'], 'variants'>]: CommerceVariant[]
}
// Old cart responses omit inventory fields; order items never include them.
export type CartLine = Schemas['OrderItemResponse'] &
  Partial<Pick<Schemas['CartItemResponse'], 'available' | 'sellable'>>
type CartResponse = paths['/api/v1/cart']['get']['responses'][200]['content']['application/json']
export type CartView = Omit<CartResponse, 'items'> & { items: CartLine[] }
export type OrderView = Omit<Schemas['OrderResponse'], 'items'> & { items: CartLine[] }
export type PaymentView = Schemas['PaymentResponse']
