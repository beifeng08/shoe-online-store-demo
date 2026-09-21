import json
import logging
import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from sqlalchemy import text

from app.api.v1.routes import DB, router

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("commerce")
app = FastAPI(title="Evoloop local commerce", version="0.1.0")
app.include_router(router)


@app.middleware("http")
async def request_log(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    start = time.monotonic()
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    logger.info(
        json.dumps(
            dict(
                event="request",
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                elapsed_ms=round((time.monotonic() - start) * 1000),
            )
        )
    )
    return response


@app.get("/health")
def health(db: DB) -> dict:
    db.execute(text("SELECT version_num FROM alembic_version"))
    return {"status": "ok", "payment_enabled": False}
