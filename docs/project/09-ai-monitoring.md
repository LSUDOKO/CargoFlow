# AI Monitoring Agent

## 1. Purpose

The AI monitor watches the evidence stream and detects patterns that deterministic threshold rules may miss.

## 2. Inputs

- temperature series;
- humidity;
- shock;
- GNSS;
- checkpoint events;
- vessel context (demo-simulated if needed);
- packet quality;
- historical provider reliability.

## 3. Recommended processing pipeline

```text
raw telemetry
  ↓
validation
  ↓
Kalman / robust smoothing
  ↓
feature extraction
  ↓
anomaly detector
  ↓
risk context
  ↓
LLM explanation / recommendation
  ↓
structured action payload
```

## 4. AI output contract

Example:

```json
{
  "shipmentId": "CF-2026-SG01",
  "severity": "CRITICAL",
  "action": "PAUSE_FACILITY",
  "reasonCode": "THERMAL_EXCURSION",
  "confidence": 0.97,
  "evidence": {
    "maxTemperature": 11.7,
    "allowedMax": 8.0,
    "conflictFactor": 0.78
  },
  "requestedNextStep": "REQUEST_SECONDARY_PROOF"
}
```

## 5. Authority model

The AI can:

- create monitoring events;
- request a pause through an explicitly authorized controller endpoint;
- request secondary proof;
- trigger a dispute process if permitted.

The AI cannot:

- transfer arbitrary USDG;
- change the financier address;
- change the facility amount;
- modify a committed policy;
- bypass proof verification;
- erase audit history.

## 6. Prompt-injection boundary

Treat all external telemetry-derived text as untrusted input.

Never allow telemetry fields to rewrite the AI system instructions.

Recommended policy:

```text
model reasoning may propose action
contract state machine decides whether action is legal
```

## 7. Deterministic guardrails

Even if the AI recommends `APPROVE_ADVANCE`, the controller must independently verify:

- facility active;
- milestone exists;
- milestone not already released;
- evidence score above threshold;
- required proof exists if policy requires it;
- cumulative draw <= committed facility;
- recipient equals registered supplier.

## 8. AI is advisory, not oracle truth

The AI should never be described as "proving" physical reality. It is a risk-analysis layer. Cryptographic proofs and source attestations are the verification primitives.

## 9. Demo UX

Show the AI as an observability panel:

```text
CRITICAL
Thermal excursion detected
Confidence: 97%

Evidence:
Primary sensor: 11.7°C
Secondary sensor: 4.6°C
Conflict: 0.78

Action requested:
PAUSE_FACILITY
→ REQUEST_SECONDARY_PROOF
```

Then show the recovery event after the ZK proof verifies.
