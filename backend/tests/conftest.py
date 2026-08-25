from app.config import get_settings


def pytest_configure():
    get_settings.cache_clear()
