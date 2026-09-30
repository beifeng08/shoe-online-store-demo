import type { CartLine, CartView, CommerceProduct, OrderView } from './commerce'

function invalid(): never {
  throw new Error('Invalid commerce response')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalid()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid()
}

function money(value: unknown): string {
  const result = text(value)
  return result === result.trim() && /^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(result) ? result : invalid()
}

function currency(value: unknown): string {
  const result = text(value)
  return result === result.trim() && /^[A-Z]{3}$/.test(result) ? result : invalid()
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : invalid()
}

function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalid()
}

export function parseCommerceProduct(value: unknown): CommerceProduct {
  const data = record(value)
  return {
    variants: list(data.variants, (entry) => {
      const variant = record(entry)
      return {
        id: text(variant.id),
        color: text(variant.color),
        size: integer(variant.size, 1),
        price: money(variant.price),
        currency: currency(variant.currency),
        available: integer(variant.available, 0),
      }
    }),
  }
}

function parseLine(value: unknown): CartLine {
  const line = record(value)
  return {
    id: text(line.id),
    variant_id: text(line.variant_id),
    title: text(line.title),
    sku: text(line.sku),
    color: text(line.color),
    size: integer(line.size, 1),
    quantity: integer(line.quantity, 1, 99),
    unit_price: money(line.unit_price),
    ...(line.available === undefined ? {} : { available: integer(line.available, 0) }),
  }
}

export function parseCartView(value: unknown): CartView {
  const data = record(value)
  return {
    items: list(data.items, parseLine),
    total: money(data.total),
    currency: currency(data.currency),
  }
}

export function parseOrderView(value: unknown): OrderView {
  const data = record(value)
  if (data.status !== 'pending_payment' && data.status !== 'cancelled') invalid()
  if (data.payment_enabled !== false) invalid()
  const reason = data.cancellation_reason
  if (reason !== null && reason !== 'expired' && reason !== 'customer_cancelled') invalid()
  const expires = data.expires_at === null ? null : text(data.expires_at)
  if (
    expires !== null &&
    (expires !== expires.trim() ||
      !/T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(expires) ||
      !Number.isFinite(Date.parse(expires)))
  )
    invalid()
  return {
    ...parseCartView(data),
    id: text(data.id),
    status: data.status,
    expires_at: expires,
    cancellation_reason: reason,
    payment_enabled: false,
    message: text(data.message),
  }
}
