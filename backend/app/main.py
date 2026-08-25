from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.config import get_settings
from app.shared.http import install_error_handlers, trace_middleware


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="atx-perform API", version=settings.contract_version)
    app.middleware("http")(trace_middleware)
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(v1_router, prefix="/api/v1")
    return app


app = create_app()
