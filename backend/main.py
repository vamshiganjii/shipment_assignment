"""FastAPI entrypoint. Run from the backend/ folder:

    uvicorn main:app --reload
"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from api import api_router
from core.config import get_settings
from core.exceptions import register_exception_handlers
from core.keep_alive import keep_alive
from core.logging import configure_logging
from services.shipment_service import get_shipment_service

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_shipment_service()  # load + validate the dataset at startup (fail fast)
    pinger = (
        asyncio.create_task(keep_alive(settings.keep_alive_url, settings.keep_alive_interval_s))
        if settings.keep_alive_url
        else None
    )
    yield
    if pinger:
        pinger.cancel()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.version,
        description=(
            "Recommends shipment routes by balancing cost, transit time, delay risk and "
            "geopolitical/congestion risk, and explains each decision."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.1f}"
        logger.info("%s %s -> %d (%.1f ms)", request.method, request.url.path, response.status_code, elapsed_ms)
        return response

    register_exception_handlers(app)
    app.include_router(api_router)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str | int]:
        return {"status": "ok", "version": settings.version, "shipments_loaded": len(get_shipment_service())}

    return app


app = create_app()
