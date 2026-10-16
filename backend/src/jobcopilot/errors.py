class DomainError(Exception):
    """A request that violates a business rule. Maps to HTTP 409/422 at the API edge."""


class NotFound(DomainError):
    pass


class InvalidTransition(DomainError):
    pass


class ConcurrentModification(DomainError):
    """The optimistic-lock version did not match; the caller should reload and retry."""


class ValidationFailed(DomainError):
    def __init__(self, issues: list[str]):
        super().__init__("; ".join(issues))
        self.issues = issues
