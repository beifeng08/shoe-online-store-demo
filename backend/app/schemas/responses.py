from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Money = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]*)\.[0-9]{2}$")]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]
Stock = Annotated[int, Field(ge=0)]
ItemQuantity = Annotated[int, Field(ge=1, le=99)]
OrderStatus = Literal["pending_payment", "cancelled"]


class ResponseModel(BaseModel):
    # Validate output without coercing numbers to strings or leaking internal fields.
    model_config = ConfigDict(strict=True, extra="ignore")


class HealthResponse(ResponseModel):
    status: Literal["ok"]
    payment_enabled: Literal[False]


class MediaResponse(ResponseModel):
    url: str
    color: str | None


class VariantResponse(ResponseModel):
    id: str
    sku: str
    color: str
    color_hex: str
    size: int
    price: Money
    currency: Currency
    available: Stock


class ProductResponse(ResponseModel):
    id: str
    handle: str
    title: str
    description: str
    media: list[MediaResponse]
    variants: list[VariantResponse]


class OrderItemResponse(ResponseModel):
    id: str
    variant_id: str
    title: str
    sku: str
    color: str
    size: int
    quantity: ItemQuantity
    unit_price: Money


class CartItemResponse(OrderItemResponse):
    subtotal: Money
    available: Stock


class CartResponse(ResponseModel):
    items: list[CartItemResponse]
    total: Money
    currency: Currency


class OrderResponse(ResponseModel):
    id: str
    status: OrderStatus
    expires_at: str | None
    cancellation_reason: Literal["expired", "customer_cancelled"] | None
    total: Money
    currency: Currency
    payment_enabled: Literal[False]
    message: str
    items: list[OrderItemResponse]


class PaymentResponse(ResponseModel):
    code: Literal["payment_disabled"]
    payment_enabled: Literal[False]
    provider: Literal["mock"]
    charged: Literal[False]
    order_id: str
    order_status: OrderStatus
    message: str
