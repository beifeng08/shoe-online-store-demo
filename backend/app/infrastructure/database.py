from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings


def make_engine(url: str) -> Engine:
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False, "timeout": 15}
        if url.startswith("sqlite")
        else {},
    )
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def configure(connection, _record) -> None:  # type: ignore[no-untyped-def]
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")

    return engine


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(engine, class_=Session, expire_on_commit=False)
