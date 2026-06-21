# Test Plan — Aurora-Provider V2 Refactor (Aura Engine)

## Overview
- **Feature**: Aurora-Provider V2 — Lean, layered aura engine with Bifrost-only fallback chain
- **Issue**: AUR-9
- **Parent**: AUR-5 — Full refactor to Bifrost-only aura engine
- **System Design ref**: docs/design/aurora-provider-refactor.md
- **UX Design ref**: docs/design/aurora-provider-refactor-ux.md
- **Author**: QA (AUR-9)
- **Date**: 2026-06-21
- **Status**: Approved

## Test Levels Covered
L1: E2E | L2: UI/UX | L3: API | L4: Integration

## Scope
All code paths in the refactored aurora-provider: aura engine, API routes, services, DB layer, config, UI dashboard.

## Out of Scope
- Bifrost gateway itself (external dependency)
- Load / performance testing
- Cross-browser testing (Chromium-only for v1)

## Test Strategy
- **L3 (API)**: Unit tests against Hono app instance with test DB — no server required. Uses bun test with route handler injection.
- **L2 (UI/UX)**: Component rendering tests against UI with mocked API.
- **L1 (E2E)**: Full-stack tests — server running, UI loads, API calls through pipeline. Requires Bifrost.
- **L4 (Integration)**: Cross-component — DB + service + route combined flows. Uses test DB, mocks Bifrost.

---

## L3 — API Tests

| # | Test Name | Endpoint | Precondition | Expected |
|---|-----------|----------|--------------|----------|
| TC-API-001 | Health check returns status | GET /api/health | Test DB | 200: status ok, version, auras, bifrost |
| TC-API-002 | Aura list returns auras | GET /api/auras | Seeded aura | 200: auras object |
| TC-API-003 | Aura create valid body | POST /api/auras | — | 200: success true |
| TC-API-004 | Aura create missing name | POST /api/auras | — | 400: name required |
| TC-API-005 | Aura create missing fallbacks | POST /api/auras | — | 400: fallbacks required |
| TC-API-006 | Aura delete existing | DELETE /api/auras/:name | Seeded aura | 200: success true |
| TC-API-007 | Aura delete nonexistent | DELETE /api/auras/:name | — | 404: not found |
| TC-API-008 | Chat missing model | POST /v1/chat/completions | — | 400: model required |
| TC-API-009 | Chat unknown model | POST /v1/chat/completions | Seeded auras | 400: Unknown model/aura |
| TC-API-010 | Chat invalid JSON | POST /v1/chat/completions | — | 400: Invalid JSON body |
| TC-API-011 | Chat empty fallbacks | POST /v1/chat/completions | Aura with empty fallbacks | 503: ALL_FALLBACKS_EXHAUSTED |
| TC-API-012 | Models list | GET /v1/models | Seeded auras | 200: data array with aurora-provider/ IDs |
| TC-API-013 | Logs empty | GET /api/logs | Clean DB | 200: success, logs[] |
| TC-API-014 | Logs with pagination | GET /api/logs?page=1&limit=10 | Logged entries | 200: logs length <= limit |
| TC-API-015 | Logs status filter | GET /api/logs?status=Error | Mixed entries | All results have status Error |
| TC-API-016 | Logs clear | POST /api/logs/clear | Logs exist | 200: success true |
| TC-API-017 | Settings get | GET /api/settings | Default settings | 200: settings object |
| TC-API-018 | Settings update | PUT /api/settings | — | 200: updated settings |
| TC-API-019 | Chat aura prefix | POST /v1/chat/completions | Seeded aura | aurora-provider/name resolves |
| TC-API-020 | Health bifrost field | GET /api/health | — | bifrost field and endpoint present |
| TC-API-021 | Chat Bifrost error | POST /v1/chat/completions | Bifrost unreachable | 503: service_unavailable |

## L4 — Integration Tests

| # | Test Name | Scenario | Expected |
|---|-----------|----------|----------|
| TC-INT-001 | Aura create list roundtrip | Create via service, list via route | Data matches |
| TC-INT-002 | Aura create delete verify | Create, delete, list | Aura gone |
| TC-INT-003 | Error log recorded | Chat with unknown aura, query logs | Error entry exists |
| TC-INT-004 | Success log recorded | Record success log | Entry with Success status |
| TC-INT-005 | Settings persist | Update settings, get back | Values persist |
| TC-INT-006 | Log clear verify | Clear logs, query | totalCount 0 |
| TC-INT-007 | DB init creates table | initDb in new dir | vault.db, usage_logs table |
| TC-INT-008 | Corrupt JSON reset | Load config with corrupt JSON | Default returned, file rewritten |
| TC-INT-009 | Multi aura operations | Create 3, update 1, delete 1 | Consistent |
| TC-INT-010 | Log stats filtered | Entry for different auras, filter by one | Scoped stats |
| TC-INT-011 | Model prefix resolution | Chat with aurora-provider/test | Strips prefix correctly |

## L2 — UI/UX Tests

| # | Test Name | Screen | Scenario | UX Source |
|---|-----------|--------|----------|-----------|
| TC-UI-001 | Dashboard metric cards | Dashboard | Navigate /, 4 metric cards visible | UX Flow 1 |
| TC-UI-002 | Dashboard log table | Dashboard | Correct columns present | UX Flow 1 |
| TC-UI-003 | Auras list view | Auras | Left panel lists auras | UX Flow 2 |
| TC-UI-004 | Auras create new | Auras | Type name, click Create | UX Flow 2 |
| TC-UI-005 | Auras duplicate name | Auras | Create with existing name | UX Flow 2 |
| TC-UI-006 | Settings form loads | Settings | Fields populated | UX Flow 4 |
| TC-UI-007 | Settings port validation | Settings | Invalid port | UX Flow 4 |
| TC-UI-008 | API Tester no auras | API Tester | Warning shown | UX Flow 5 |
| TC-UI-009 | Health indicator | Header | Bifrost pill | UX Design |
| TC-UI-010 | Dashboard empty logs | Dashboard | Empty state message | UX Flow 1 |
| TC-UI-011 | Auras rename | Auras | Click Rename, change name | UX Flow 2 |
| TC-UI-012 | Auras reorder steps | Auras | Up/down arrows | UX Flow 3 |
| TC-UI-013 | Auras add step | Auras | Select model, Add Step | UX Flow 3 |
| TC-UI-014 | Settings save | Settings | Save, toast shown | UX Flow 4 |

## L1 — E2E Tests

| # | Test Name | Precondition | Expected |
|---|-----------|-------------|----------|
| TC-E2E-001 | Dashboard loads | Bifrost reachable | Metric cards, health visible |
| TC-E2E-002 | Chat completion | Bifrost running | 200 with completion |
| TC-E2E-003 | Full aura CRUD | Server running | All ops succeed |
| TC-E2E-004 | Unknown aura error | Server running | 400 error |
| TC-E2E-005 | Health Bifrost status | Bifrost available | bifrost field |

## Coverage Gaps (L5-L6 Review)

Existing: 35 tests, 5 files — all pass.

| Area | Status | Notes |
|------|--------|-------|
| DB layer (db.js) | Good | Insert, query, stats, clear, edge cases |
| Aura service | Good | CRUD, replaceAll, names, edge cases |
| Config | Adequate | Basic save/load, defaults |
| Aura engine | Gaps | Missing executeAura fallback logic tests |
| Routes | Good | All endpoints covered |
| Settings service | Missing | No unit tests for allowed-key filter |
| Chat route handler | Missing | No isolated tests |
| UI components | Missing | No component tests |

## Fixtures

- tests/fixtures/sample-auras.json
- tests/fixtures/sample-chat-request.json
- tests/fixtures/mock-bifrost-response.json
- tests/fixtures/mock-bifrost-error.json
- tests/fixtures/sample-settings.json

## Execution

```bash
# L3 + L4 (no server needed)
bun test tests/l3-api.test.js tests/l4-integration.test.js

# All tests
bun test

# L2 UI (server must be running)
bun test tests/l2-ui.test.js

# L1 E2E (server + Bifrost running)
bun test tests/l1-e2e.test.js
```

## Exit Criteria
1. All L1-L4 test cases pass
2. No critical/blocker bugs found
3. L5-L6 coverage gaps filled
4. UX design matches implementation
5. No provider/key/proxy logic remains
