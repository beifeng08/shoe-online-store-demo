from uuid import UUID

from pydantic import BaseModel, Field


class Quantity(BaseModel):
    # Unknown fields, including forged prices/status, are deliberately ignored.
    quantity: int = Field(ge=1, le=99, strict=True)


class AddItem(Quantity):
    variant_id: UUID


class PaymentRequest(BaseModel):
    order_id: UUID
