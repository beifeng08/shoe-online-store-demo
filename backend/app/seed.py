"""Explicit, repeatable demo import; migrations must already be applied."""

import json
from decimal import Decimal
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy.orm import Session

from app.application.commerce import audit
from app.domain.models import Inventory, Media, Product, Variant
from app.infrastructure.database import SessionLocal


def seed(db: Session) -> None:
    products = json.loads((Path(__file__).parents[1] / "data/catalog.json").read_text("utf-8"))
    for p in products:
        if db.get(Product, p["id"]):
            continue
        db.add(
            Product(id=p["id"], handle=p["handle"], title=p["title"], description=p["description"])
        )
        db.flush()
        colors = p.get("colors") or [{"name": "Standard", "hex": "#888888"}]
        for color in colors:
            for size in p["sizes"]:
                # Stable import keys, never color array positions.
                identity = f"evoloop/{p['handle']}/{color['name'].casefold()}/{size}"
                variant_id = str(uuid5(NAMESPACE_URL, identity))
                db.add(
                    Variant(
                        id=variant_id,
                        product_id=p["id"],
                        sku=f"{p['handle']}-{variant_id[:8]}-{size}",
                        color=color["name"],
                        color_hex=color["hex"],
                        size=size,
                        price=Decimal(str(p["price"]["amount"])),
                        currency="USD",
                    )
                )
                db.flush()
                db.add(Inventory(variant_id=variant_id, available=10, reserved=0))
                audit(db, variant_id, "inventory_seeded", available=10, reserved=0)
        for index, url in enumerate(p.get("images", [])):
            db.add(
                Media(
                    product_id=p["id"],
                    url=url,
                    position=index,
                    color=colors[index]["name"] if len(colors) == len(p["images"]) else None,
                )
            )


if __name__ == "__main__":
    with SessionLocal() as session, session.begin():
        seed(session)
    print("Demo catalog imported; existing products and stock preserved.")
