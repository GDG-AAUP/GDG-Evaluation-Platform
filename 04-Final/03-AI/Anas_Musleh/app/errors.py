class BackendError(Exception):
    """Same error shape the real backend returns: { error: { code, message } }."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    def to_dict(self) -> dict:
        return {"error": {"code": self.code, "message": self.message}}
