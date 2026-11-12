import pytest

from app import llm


@pytest.fixture(autouse=True)
def fresh_model_health():
    """Model health is process-wide on purpose (shared by all requests); each test starts clean."""
    llm.reset_model_health()
    yield
    llm.reset_model_health()
