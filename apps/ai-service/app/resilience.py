"""Circuit breaker and provider fallback chain (API.md §7.4).

In-process per provider: one service instance trips independently. A shared (Redis) breaker is a
later step; this keeps the service stateless and dependency-free.
"""

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from .providers import ImageProvider, ProviderError

BreakerState = Literal["closed", "open", "half_open"]


class CircuitBreaker:
    """closed → open after `threshold` consecutive retryable failures → half-open after `cooldown`
    seconds, where exactly one probe request is let through; its outcome closes or re-opens it."""

    def __init__(self, threshold: int = 5, cooldown: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.threshold = threshold
        self.cooldown = cooldown
        self._clock = clock
        self._state: BreakerState = "closed"
        self.consecutive_failures = 0
        self._opened_at = 0.0
        self._probe_in_flight = False

    @property
    def state(self) -> BreakerState:
        if self._state == "open" and self._clock() - self._opened_at >= self.cooldown:
            return "half_open"
        return self._state

    def allow(self) -> bool:
        state = self.state
        if state == "closed":
            return True
        if state == "open":
            return False
        if self._probe_in_flight:
            return False
        self._state = "half_open"
        self._probe_in_flight = True
        return True

    def record_success(self) -> None:
        self._state = "closed"
        self.consecutive_failures = 0
        self._probe_in_flight = False

    def record_failure(self) -> None:
        self.consecutive_failures += 1
        if self._state == "half_open" or self.consecutive_failures >= self.threshold:
            self._state = "open"
            self._opened_at = self._clock()
        self._probe_in_flight = False

    def record_neutral(self) -> None:
        """The provider answered, but the request itself was bad: proof of life, not of failure."""
        if self._state == "half_open":
            self.record_success()


@dataclass
class ChainResult:
    image: bytes
    provider: str
    model: str
    fallback_used: bool


class ProviderChain:
    def __init__(self, providers: list[ImageProvider], threshold: int = 5, cooldown: float = 60.0,
                 provider_timeout: float = 120.0, clock: Callable[[], float] = time.monotonic):
        if not providers:
            raise ValueError("at least one provider is required")
        self.providers = providers
        self.provider_timeout = provider_timeout
        self._breaker = lambda: CircuitBreaker(threshold, cooldown, clock)
        # One breaker per provider name, shared by every model of that provider and by panel-chosen chains.
        self.breakers = {p.name: self._breaker() for p in providers}

    @property
    def primary(self) -> ImageProvider:
        return self.providers[0]

    def snapshot(self) -> list[dict]:
        return [
            {"name": name, "state": b.state, "consecutive_failures": b.consecutive_failures}
            for name, b in self.breakers.items()
        ]

    async def generate(self, image: bytes, prompt: str, variant: int, tint_hex: str | None, deadline: float,
                       providers: list[ImageProvider] | None = None) -> ChainResult:
        """Primary first; on a retryable error or an open circuit, the next provider. A non-retryable
        error stops the chain (another provider would reject the same request too). `providers` is the panel's
        chain for this request (API.md §7.27); None uses the server's."""
        loop = asyncio.get_running_loop()
        last: ProviderError | None = None
        for index, provider in enumerate(providers or self.providers):
            breaker = self.breakers.setdefault(provider.name, self._breaker())
            if not breaker.allow():
                last = ProviderError(f"{provider.name}_circuit_open", retryable=True)
                continue
            remaining = deadline - loop.time()
            if remaining <= 0.05:
                breaker.record_neutral()
                raise ProviderError("time_budget_exceeded", retryable=True)
            timeout = min(self.provider_timeout, remaining)
            try:
                data = await asyncio.wait_for(provider.generate(image, prompt, variant, tint_hex, timeout), timeout=timeout)
            except (TimeoutError, asyncio.TimeoutError):
                err = ProviderError(f"{provider.name}_timeout", retryable=True)
            except ProviderError as exc:
                err = exc
            else:
                breaker.record_success()
                return ChainResult(data, provider.name, provider.model, index > 0)
            if not err.retryable:
                breaker.record_neutral()
                raise err
            breaker.record_failure()
            last = err
        raise last or ProviderError("no_provider_available", retryable=True)
