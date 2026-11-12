"""Domain exceptions and the handlers that turn them into consistent JSON errors.

Every error response has the shape: {"error": {"code": str, "message": str}}
"""
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class InvalidInputError(AppError):
    status_code = 422
    code = "invalid_input"


class DataLoadError(AppError):
    status_code = 503
    code = "data_unavailable"


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            logger.error("%s %s -> %s", request.method, request.url.path, exc.message)
        return _error(exc.status_code, exc.code, exc.message)

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Log full traceback server-side, never leak internals to the client
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _error(500, "internal_error", "An unexpected error occurred.")
