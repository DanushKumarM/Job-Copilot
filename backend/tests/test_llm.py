from types import SimpleNamespace

from jobcopilot.llm.base import GeminiProvider


class FakeModels:
    def generate_content(self, **kwargs):
        assert kwargs["model"] == "test-model"
        assert kwargs["config"]["response_mime_type"] == "application/json"
        return SimpleNamespace(
            text='{"ok": true}',
            usage_metadata=SimpleNamespace(prompt_token_count=10, candidates_token_count=5),
        )


class FakeClient:
    models = FakeModels()


def test_gemini_provider_returns_structured_response(monkeypatch):
    monkeypatch.setenv("JOBCOPILOT_GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("JOBCOPILOT_GEMINI_MODEL", "test-model")
    monkeypatch.setenv("JOBCOPILOT_GEMINI_ALLOWS_PERSONAL_DATA", "true")
    from jobcopilot.config import get_settings

    get_settings.cache_clear()
    provider = GeminiProvider(client=FakeClient())
    response = provider.complete_json("system", "prompt", {"type": "object"})

    assert response.text == '{"ok": true}'
    assert response.input_tokens == 10
    assert response.output_tokens == 5
