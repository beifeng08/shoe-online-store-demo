"""Run one bounded cleanup pass: python -m app.expire_orders."""

from app.application.expiry import expire_due_orders

if __name__ == "__main__":
    print(f"Expired {expire_due_orders()} orders.")
