import os

from app.config import get_settings


def pytest_configure():
    # 测试默认 Demo 轨（隔离 backend/.env 的 DATA_MODE=live）；
    # 用户显式 DATA_MODE=live 时保留，用于 Live 轨（PG）测试。
    os.environ.setdefault("DATA_MODE", "demo")
    get_settings.cache_clear()
