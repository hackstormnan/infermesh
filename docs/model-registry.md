# Model Registry Service

## Role in the routing pipeline

The model registry is the bridge between the model catalog (static metadata)
and the routing engine (dynamic decision-making).

When the routing engine needs to select a model for an incoming job, it calls
`modelRegistryService.findEligible(ctx, filter)` instead of querying raw model
records. The registry service:

1. Loads all registered models from the repository (`findAll`)
2. Applies multi-dimensional eligibility filtering (see below)
3. Projects each passing model onto a lean `ModelCandidate` object
4. Returns the candidates sorted by quality-tier descending, then name ascending

The routing engine receives `ModelCandidate[]` and attaches a `ScoreBreakdown`
to each candidate before selecting the winner (Ticket 14+).

```
Routing Engine
      │
      ├─ modelRegistryService.findEligible(ctx, filter) → ModelCandidate[]
      │         │
      │         ├─ repo.findAll()   ← full catalog, no pagination
      │         ├─ applyFilter()    ← eligibility logic (service layer)
      │         └─ toCandidate()    ← lean projection, no metadata
      │
      └─ score each candidate → RoutingDecision
```

## ModelRegistryFilter

All fields are optional. Absent fields are not applied as constraints.

| Field                | Type               | Description                                             |
|----------------------|--------------------|---------------------------------------------------------|
| `taskType`           | `ModelTask`        | Model must list this task in `supportedTasks`           |
| `requiredCapabilities` | `ModelCapability[]` | Model must declare ALL listed capabilities            |
| `provider`           | `ModelProvider`    | Restrict to a single provider                           |
| `minQualityTier`     | `QualityTier`      | Inclusive lower bound (Economy < Standard < Frontier)   |
| `minContextWindow`   | `number`           | Context window must be ≥ this value (tokens)            |
| `status`             | `ModelStatus`      | Defaults to `Active` when called from routing           |

## ModelCandidate

Routing-optimised projection of a `Model` entity. Contains exactly the fields
scoring strategies need — no internal metadata or admin-only fields.

```typescript
interface ModelCandidate {
  id:              string;
  name:            string;
  provider:        ModelProvider;
  version?:        string;
  capabilities:    ModelCapability[];
  supportedTasks:  ModelTask[];
  qualityTier:     QualityTier;
  contextWindow:   number;
  maxOutputTokens: number;
  pricing:         ModelPricing;        // cost per 1k tokens (input + output)
  latencyProfile:  ModelLatencyProfile; // ttftMs + tokensPerSecond
  status:          ModelStatus;
}
```

## Service API

```typescript
// Return all Active models as candidates (no filter)
modelRegistryService.listActive(ctx): Promise<ModelCandidate[]>

// Return models matching all constraints in the filter
modelRegistryService.findEligible(ctx, filter): Promise<ModelCandidate[]>
```

## HTTP endpoint (internal/debug)

```
GET /api/v1/models/candidates
```

Exposes the same filtering logic over HTTP. Intended for the routing engine,
integration tests, and internal debugging — not for external callers.

Query parameters mirror `ModelRegistryFilter` (single `capability` value maps
to `requiredCapabilities: [capability]` internally):

```
?taskType=coding
&capability=tool_use
&provider=anthropic
&minQualityTier=standard
&minContextWindow=100000
&status=active        (default; explicit values are for admin/debug use)
```

### Example response

```json
{
  "success": true,
  "data": [
    {
      "id": "a1b2c3d4-...",
      "name": "claude-sonnet-4-6",
      "provider": "anthropic",
      "qualityTier": "standard",
      "contextWindow": 100000,
      "maxOutputTokens": 8192,
      "pricing":        { "inputPer1kTokens": 0.003, "outputPer1kTokens": 0.015 },
      "latencyProfile": { "ttftMs": 300, "tokensPerSecond": 80 },
      "capabilities":   ["text_generation", "tool_use", "code_generation"],
      "supportedTasks": ["chat", "coding", "rag"],
      "status":         "active"
    }
  ],
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

## Separation of concerns

| Layer              | Responsibility                                              |
|--------------------|-------------------------------------------------------------|
| `IModelRepository` | Storage and indexed lookups (`findAll`, `findById`, `findByName`) |
| `ModelsService`    | Admin CRUD (register, update, getById, list with pagination) |
| `ModelRegistryService` | Eligibility filtering + candidate projection for routing |
| Route handler      | HTTP boundary only — Zod parse, call service, return envelope |

Filtering logic lives exclusively in `ModelRegistryService.applyFilter()`.
Neither the repository nor the route handler contains any eligibility rules.

## Not implemented yet

- Score calculation (Ticket 14+) — the routing engine will attach a
  `ScoreBreakdown` to each `ModelCandidate`
- Real-time latency profile refresh from observed metrics (Ticket N)
- Worker availability cross-check — currently candidates are model-only;
  routing will intersect with available workers at decision time
