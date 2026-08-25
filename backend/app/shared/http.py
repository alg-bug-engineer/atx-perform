from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse

from app.shared.errors import ApiError


def new_trace_id() -> str:
    return uuid4().hex[:16]


async def trace_middleware(request: Request, call_next):
    trace_id = request.headers.get("x-trace-id") or new_trace_id()
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    return response


def install_error_handlers(app):
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError):
        trace_id = getattr(request.state, "trace_id", None) or new_trace_id()
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "ok": False,
                "code": exc.code,
                "reason": exc.reason,
                "trace_id": trace_id,
                **({"detail": exc.detail} if exc.detail is not None else {}),
            },
        )
