import shutil
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import database
from app.infrastructure.database import make_engine
from app.main import app
from app.seed import seed


@pytest.fixture(scope="session")
def template(tmp_path_factory):
    path = tmp_path_factory.mktemp("template") / "commerce.db"
    original = settings.database_url
    settings.database_url = f"sqlite:///{path.as_posix()}"
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")
    engine = make_engine(settings.database_url)
    with Session(engine) as db, db.begin():
        seed(db)
    engine.dispose()
    settings.database_url = original
    return path


@pytest.fixture
def commerce(template, tmp_path, monkeypatch):
    # API tests use isolated DBs; worker lifecycle has dedicated tests with its own DB.
    monkeypatch.setattr(settings, "reservation_sweeper_enabled", False)
    path = tmp_path / "commerce.db"
    shutil.copyfile(template, path)
    engine = make_engine(f"sqlite:///{path.as_posix()}")

    def session():
        with Session(engine) as db, db.begin():
            yield db

    app.dependency_overrides[database] = session
    with TestClient(app) as client:
        client.headers["X-Session-ID"] = str(uuid4())
        yield client, engine
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def variant(commerce):
    client, _ = commerce
    return client.get("/api/v1/catalog/products/dc-1001").json()["variants"][0]
