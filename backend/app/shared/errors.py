class ApiError(Exception):
    def __init__(self, code: str, reason: str, status_code: int = 400, detail=None):
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self.status_code = status_code
        self.detail = detail


def not_implemented(module: str) -> ApiError:
    return ApiError(
        code="NOT_IMPLEMENTED",
        reason=f"{module} 模块尚未实现，请在对应目录开发",
        status_code=501,
    )
