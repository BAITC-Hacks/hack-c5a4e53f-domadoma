# AI / Recommendation Engine

The recommendation engine keeps the existing deterministic baseline in
`backend/recommendation/engine.py`. The service adapter in `service.py` turns
that result into the shared `ProfileResponse` and `RecommendationResponse`
shapes without reading files or mutating the supplied `engine.Data` snapshot.

## Recommendation flow

1. `engine.recommend(..., k=5)` creates the eligible candidate pool.
2. Candidate facts are registered server-side from target, skill gaps, event
   gains and participation history.
3. When `OPENAI_API_KEY` is available, the Responses API may choose 1–3
   existing candidates using Structured Outputs. The model cannot create
   events, scores, gains, requirements or facts.
4. The response is validated against the candidate and fact registries. Any
   invalid, refused, timed-out or unavailable LLM response uses the baseline
   top-3 with `source=fallback` and a machine-readable `fallback_reason`.

The LLM call uses `OPENAI_MODEL`, a six-second client timeout and zero SDK
retries. `duration_ms` measures the complete service call. A protected baseline
leader stays first when its unrounded score is positive and is at least 1.35x
the next candidate (or it is the only candidate).

`reason_factors` are always reconstructed from the server registry. A valid
LLM choice must reference at least three available fact categories. Names,
contacts, full history and the whole dataset are not sent to the model.

## Snapshot and prior isolation

`engine.Data.prior` stores calibrated participation prior per snapshot.
`calibrate(data)` no longer changes a process-global value for later requests;
the legacy `likelihood(stats, event)` call remains available with its original
default prior for compatibility.

## Local checks

From the repository root, install the AI dependencies and run:

```text
python -m pip install -r backend/recommendation/requirements-ai.txt
python -m pytest tests/ai -q
```

Live OpenAI smoke tests require explicit permission from the key owner. Unit
tests must inject a fake selector and must not print or persist credentials.
