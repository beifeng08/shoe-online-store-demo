from collections.abc import Iterator
from typing import Annotated
from uuid import UUID

from fastapi import Header
from sqlalchemy.orm import Session

from app.infrastructure.database import SessionLocal


def database() -> Iterator[Session]:
    with SessionLocal() as session, session.begin():
        yield session


def anonymous_session(x_session_id: Annotated[UUID, Header()]) -> str:
    # A random UUID is a bearer credential, supplied by the Next HttpOnly cookie proxy.
    return str(x_session_id)
