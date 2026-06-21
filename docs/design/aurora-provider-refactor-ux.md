# Aurora Provider Refactor — User Experience Design

## Overview

- **Feature**: Refactored aurora-provider dashboard — aura management, usage logs, settings
- **Issue**: [AUR-7](mention://issue/4a7c0aee-1af9-4341-b30e-1917e51b77e4)
- **System Design ref**: `docs/design/aurora-provider-refactor.md`
- **Status**: Draft — Ready for Review
- **Author**: UX Engineer
- **Date**: 2026-06-21

## User Flows

### Flow 1: View Dashboard & Usage Logs

**Trigger:** User navigates to `/` or clicks "Dashboard" tab
**Entry point:** App load or tab click

```
1. Dashboard tab loads
   |- 1a. Loading state -> show skeleton cards (pulsing placeholders)
   |    for: metric cards, charts, logs table
   |
   |- 1b. Success -> render:
   |    . Bifrost health indicator (header pill: green "Healthy" / red "Unhealthy")
   |    . 4 metric cards: Total Requests, Success Rate, Avg Latency, Total Tokens
   |    . Requests Over Time chart (line chart, last 7 days)
   |    . Usage Logs table with columns: Timestamp, Source, Aura, Model, Status, Latency, Tokens, Details
   |    . Pagination controls below table
   |    . Filter bar: Date range (start/end), Aura dropdown, Status dropdown
   |
   `- 1c. Error -> show inline error banner: "Failed to load dashboard data"
        with "Retry" button

2. User clicks filter controls or pagination
   |- 2a. Apply filters -> table reloads with filtered data, page resets to 1
   `- 2b. Next/Previous page -> table reloads with new page, page counter updates

3. User clicks "Details" button on a log row
   |- 3a. Modal opens with: Timestamp, Source, Aura, Model, Status,
   |    Latency, Prompt Tokens, Completion Tokens, Total Tokens, Error Message (if error)
   `- 3b. User clicks x or overlay -> modal closes

4. User clicks "Clear Logs" button
   `- 4a. Confirmation dialog: "Clear all usage logs? This cannot be undone."
       |- Confirm -> POST /api/usage/clear -> success toast "Logs cleared"
       |- Confirm -> API error -> error toast "Failed to clear logs: {message}"
       `- Cancel -> close dialog, no action
```

**Empty state:** No usage logs yet -> table shows single row: "No usage logs yet. Make a request to see data here." Metric cards show "0" / "0%" / "0ms" / "0". Chart shows empty state with text "No data yet".

**Edge cases:**
- Filter returns zero results -> table shows "No logs match your filter criteria. Try adjusting the date range."
- Health endpoint unreachable -> Bifrost indicator shows "Unhealthy" in red pill, metrics still show cached data if available
- Log clear already happened -> table just shows empty
- URL direct access to filter params (for bookmarking) -> not supported in v1, filters reset on page load

---

### Flow 2: Manage Auras — List & Create

**Trigger:** User clicks "Auras" tab
**Entry point:** Tab click

```
1. Auras tab loads
   |- 1a. Loading -> skeleton for aura list
   |- 1b. Success -> render:
   |    Left panel: aura list (auto-selects first aura if exists)
   |    Right panel: selected aura's settings (fallback chain + controls)
   |    If no auras: right panel shows empty state "No aura selected"
   `- 1c. Error -> error banner with "Retry" button

2. User selects an aura from the list
   |- 2a. Aura name highlights (selected state)
   `- 2b. Right panel populates with:
       . Aura name + Rename/Delete buttons
       . Fallback chain list (ordered steps)
       . Add step form (model dropdown + "Add Step" button)
       . "Save Auras Config" button

3. User creates a new aura
   1. Type name in "New Aura Name" input
   2. Click "Create" button
      |- 3a. Empty name -> nothing happens (button disabled for empty input)
      |- 3b. Duplicate name -> inline error "An aura with this name already exists"
      `- 3c. Valid name -> aura created (empty fallback chain)
           . New aura appears in list, auto-selected
           . Right panel shows empty fallback chain with hint "No fallback steps yet. Add one below!"
           . Changes are in-memory only until "Save Auras Config" is clicked

4. User renames an aura
   1. Click "Rename" button
   2. Inline text field appears (replacing aura name display)
      |- 4a. Empty name -> reject, revert to original
      |- 4b. Same name -> no-op, revert to original
      |- 4c. Duplicate name -> inline error "Name already in use"
      `- 4d. Valid new name -> rename applied in-memory
```

**Empty state:** No auras -> left panel shows "No auras defined yet. Create one above!" Right panel shows centered message "Select an aura from the list to view and configure its fallback chain."

**Edge cases:**
- Creating aura when server is offline -> aura created in-memory, save will fail -> user gets save error
- Renaming to a name that also has an unsaved new aura -> check locally against config.auras before allowing
- Delete last aura -> right panel resets to "No aura selected" empty state

---

### Flow 3: Edit Fallback Chain

**Trigger:** User selects an aura and uses the fallback editor
**Entry point:** Aura selected in Aura Hub

```
1. User views fallback chain for selected aura
   Each step shows: priority number (#1, #2...), model name, reasoning badge (if applicable)
   Each step has controls: Up Arrow Move Up, Down Arrow Move Down, "Remove" button

2. User reorders fallback steps
   |- 2a. Click Up Arrow on step N -> step swaps with step N-1, chain re-renders
   |- 2b. Click Down Arrow on step N -> step swaps with step N+1, chain re-renders
   |- 2c. Up Arrow disabled on first step
   `- 2d. Down Arrow disabled on last step

3. User removes a fallback step
   |- 3a. Click "Remove" -> step is removed, chain re-numbers
   `- 3b. Last step removed -> shows "No fallback steps yet"

4. User adds a fallback step
   1. Select model from dropdown (populated via Bifrost model catalog)
      |- 4a. Loading models -> dropdown shows "Loading models..."
      |- 4b. No models available -> dropdown shows "No models available"
      `- 4c. Models loaded -> dropdown shows model list with context info
   2. Click "Add Step" button
      |- 4d. No model selected -> nothing happens (button disabled)
      |- 4e. Duplicate model already in chain -> inline warning "This model is already in the fallback chain"
      `- 4f. Valid model -> step added as last in list, dropdown resets

5. User saves changes
   Click "Save Auras Config"
   |- 5a. Success -> toast "Aura configuration saved successfully!"
   |   . Server reloads aura config (POST /api/auras)
   |   . Local config re-fetched to ensure sync
   |- 5b. Network error -> toast "Failed to save: {message}"
   |   . Unsaved changes remain in-memory, user can retry
   `- 5c. Validation error -> toast "Invalid configuration: {message}"
```

**Note on provider field:** Provider is always "bifrost" (Bifrost Gateway). The UI does **not** offer a provider selector. The model dropdown alone implies bifrost routing. When saving, the step is serialized with `{ provider: "bifrost", model: "<selected-model>" }`.

**Note on drag-and-drop:** v1 uses arrow buttons for reordering (as currently implemented). If UX budget allows, v2 should support drag-and-drop reordering with visual feedback (drop indicator line, smooth animation).

**Edge cases:**
- Adding a step with a model that has reasoning capability -> show a "Reasoning" badge beside the step
- Rapidly adding/removing steps -> each action re-renders the list cleanly; no batch operations in v1
- Unsaved changes indicator -> consider a dot or "unsaved" badge on the card header if there are local modifications vs last-saved state
- Clicking "Save" with no changes -> no-op (or optimistically show success toast, server returns same config)

---

### Flow 4: Manage Settings

**Trigger:** User clicks "Settings" tab
**Entry point:** Tab click

```
1. Settings tab loads
   |- 1a. Loading -> skeleton form fields
   |- 1b. Success -> render settings form:
   |    . Server Port (number input, placeholder: current port)
   |    . Log Level (select: debug, info, warn, error)
   |    . Bifrost Endpoint (text input, placeholder: http://localhost:10550)
   |    . [Save Settings] button (bottom)
   `- 1c. Error -> error banner "Failed to load settings" with Retry

2. User modifies a setting
   |- 2a. Port changed -> client-side validation: must be 1024-65535
   |    . Invalid -> inline error "Port must be between 1024 and 65535"
   |- 2b. Log level changed -> no validation needed (select)
   `- 2c. Bifrost endpoint changed -> client-side validation: must be valid URL
       . Invalid -> inline error "Please enter a valid URL (e.g. http://localhost:10550)"

3. User clicks "Save Settings"
   |- 3a. Validation passes -> POST /api/settings
   |   |- Success -> toast "Settings saved. Server restart may be required."
   |   `- Error -> toast "Failed to save settings: {message}"
   `- 3b. Validation fails -> inline errors on invalid fields, toast "Please fix the errors above"
```

**Confirmation needed:** Changing port or bifrost endpoint may require a server restart. The save response should include a `restartRequired: boolean` field. If true, show a secondary confirmation: "Some changes require a server restart to take effect. Restart now? [Restart Later] [Restart Now]". Restart now triggers POST /api/restart.

**Edge cases:**
- Port already in use -> server should respond with error, UI shows toast "Port {port} is already in use"
- Empty bifrost endpoint -> not allowed, show inline error
- Log level change -> instant effect after save, no restart needed

---

### Flow 5: API Tester (Quick Test)

**Trigger:** User clicks "API Tester" tab
**Entry point:** Tab click

```
1. API Tester tab loads
   |- 1a. No auras exist -> show warning "No auras configured. Create one in the Auras tab first."
   |    Aura dropdown is disabled, test button is disabled
   `- 1b. Auras exist -> enable dropdown + test button

2. User selects aura + enters prompt
   1. Select aura from dropdown
   2. Type/edit prompt in textarea
   3. Toggle "Stream response" checkbox (default: on)
   4. Click "Run Test"
      |- 2a. No aura selected -> show inline "Please select an aura"
      |- 2b. Empty prompt -> show inline "Please enter a message"
      `- 2c. Valid -> start request

3. Request in progress
   . Button shows spinner / "Running..." text
   . Button becomes disabled
   . Response area shows "Waiting for response..."

4. Response received
   |- 4a. Non-streaming -> response area shows pretty-printed JSON response
   |- 4b. Streaming -> response area shows streaming text in real-time
   `- 4c. Error -> response area shows error message in red

5. User can click "Clear" to reset response area
```

---

## Screen-by-Screen Specifications

### Screen: Dashboard

**URL / Route:** `GET /` (default tab)
**Viewport behavior:** Desktop 1200px+ (full row layout) | Tablet 768-1199px (2-col metrics) | Mobile <768px (single column, stacked)
**Auth required:** No

#### Layout (text description)

```
+----------------------------------------------------------+
| [Logo] Aurora-Provider        v2.0.0    [* Bifrost: OK]  |
|                                                  [Theme] |
+----------------------------------------------------------+
| [Dashboard] [Auras] [API Tester] [Settings]              |
+----------------------------------------------------------+
| +--- Filter Bar ---------------------------------------+ |
| | Start: [____] End: [____] Aura: [v] Status: [v]      | |
| |                                        [Apply Filters]| |
| +-------------------------------------------------------+ |
|                                                           |
| +------+ +------+ +------+ +------+                     |
| |Total  | |Success| |Avg   | |Total |                     |
| |Req    | |Rate   | |Latency| |Tokens|                     |
| | 1,234 | | 97.2% | | 845ms| | 45.2K|                     |
| +------+ +------+ +------+ +------+                     |
|                                                           |
| +--- Requests Over Time ---+ +--- Model Distribution --+ |
| |   [line chart area]      | |   [pie chart area]      | |
| +--------------------------+ +-------------------------+ |
|                                                           |
| +--- Usage Logs --------------------------------------+ |
| |                                    [Clear Logs]     | |
| |  Timestamp | Source | Aura  | Model | Status | ...  | |
| | --------------------------------------------------- | |
| |  2026-06-21| API    | seol..| openc. | OK 200 | Eye| |
| |  ...       |        |       |        |        |     | |
| | --------------------------------------------------- | |
| | [< Previous]           Page 1 of 12       [Next >]  | |
| +-------------------------------------------------------+ |
+----------------------------------------------------------+
```

#### States

| State | Visual | Behavior |
|-------|--------|----------|
| Default | Metric cards show live data, charts render, table populated | All interactive elements enabled |
| Loading | Skeleton placeholders (pulsing grey blocks) for metric cards, chart area has dashed border + "Loading chart..." | No interaction until loaded |
| Empty (no logs) | Metric cards show 0/0%/0ms/0, chart shows "No data yet", table shows "No usage logs yet. Make a request to see data here." | Filters still visible but disabled |
| Empty (filtered) | Table shows "No logs match your filter criteria. Try adjusting the date range." | Filters still editable, pagination hidden |
| Error | Inline error banner at top: "Failed to load dashboard data" with "Retry" button | Previous data persists if available, or all cards show "-" |
| Bifrost unhealthy | Header pill shows red "Unhealthy" | Dashboard data still loads from SQLite (logs are local) |
| Clear logs confirm | Confirmation dialog overlay | Prompt + Cancel + Confirm buttons |
| Pagination active | "Previous" disabled on page 1, "Next" disabled on last page | Click handlers change page |

#### Filters

| Field | Type | Behavior |
|-------|------|----------|
| Start Date | date input | Default: empty (no filter). Any valid date. |
| End Date | date input | Default: empty (no filter). Must be >= start date. |
| Aura | select | Populated dynamically from aura list. "All Auras" default. |
| Status | select | Options: All, Success, Error. Default: All. |
| Apply Filters | button | Triggers new API call, resets page to 1. Disabled if date range invalid. |

#### Logs Table Columns

| Column | Content | Width |
|--------|---------|-------|
| Timestamp | `2026-06-21 12:00:00` | 170px |
| Source | "API" or "Testing" | 80px |
| Aura | Truncated with tooltip if >12 chars | 140px |
| Model | Full model ID with tooltip | 200px |
| Status | Success / Error (colored badge) | 90px |
| Latency | `1,234ms` (right-aligned, green if <2000ms, yellow if <5000ms, red if >=5000ms) | 90px |
| Tokens | `150` (right-aligned) | 70px |
| Details | Eye button | 60px |

#### Log Detail Modal

```
+------------------------------------------------+
|  Request Details                          X    |
+------------------------------------------------+
|  Timestamp:    2026-06-21 12:00:00             |
|  Source:       API                             |
|  Aura:         seolla-nyx-aura                 |
|  Model:        opencode-zen/big-pickle         |
|  Status:       Success / Error                 |
|  Error Msg:    (only shown if error)           |
|  Latency:      1,234ms                         |
|  Prompt Tokens:  100                           |
|  Comp Tokens:     50                           |
|  Total Tokens:   150                           |
+------------------------------------------------+
```

**Note:** Prompt and response content are not shown (removed per system design - PII concern).

#### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab | Filters -> Apply -> Table -> Clear Logs -> Pagination |
| Shift+Tab | Reverse direction |
| Enter | Apply Filters (when focused on filter), Navigate page (when focused on pagination) |
| Escape | Close detail modal if open |

#### Accessibility
- Table uses proper `<table>` with `<thead>` and `<tbody>`
- Sortable columns (future) use `aria-sort`
- Status badges use icon + text (not color alone)
- Detail modal has `role="dialog"` and `aria-modal="true"`
- Close button has `aria-label="Close details"`
- Toast notifications use `role="status"` and `aria-live="polite"`
- Metric cards use semantic heading hierarchy

---

### Screen: Auras

**URL / Route:** `GET /` (Auras tab)
**Viewport behavior:** Desktop (2-col: list | details) | Tablet (stacked: list above details) | Mobile (single col, list full width, toggle to detail view)
**Auth required:** No

#### Layout (text description)

```
+----------------------------------------------------------+
| [Logo] Aurora-Provider        v2.0.0    [* Bifrost: OK]  |
|                                                  [Theme] |
+----------------------------------------------------------+
| [Dashboard] [Auras] [API Tester] [Settings]              |
+----------------------------------------------------------+
| +-- Left: Aura List ---+ +-- Right: Aura Settings ----+ |
| |                       | |                             | |
| |  * seolla-nyx-aura   | |  Aura: seolla-nyx-aura      | |
| |  o lyra-nyx-aura     | |  [Rename] [Delete]          | |
| |                       | |                             | |
| |  [Create ________]    | |  Fallback Chain Priority    | |
| |  [Create]             | |                             | |
| |                       | |  +- #1 opencode-zen/... --+ | |
| |                       | |  |  Reasoning   Up Down X | | |
| |                       | |  +-------------------------+ | |
| |                       | |  +- #2 mistral/mistr... --+ | |
| |                       | |  |                Up Down X | | |
| |                       | |  +-------------------------+ | |
| |                       | |                             | |
| |                       | |  Add Fallback Step          | |
| |                       | |  Model: [v Select model]    | |
| |                       | |  [Add Step]                 | |
| |                       | |                             | |
| |                       | |  [Save Auras Config]        | |
| +-----------------------+ +-----------------------------+ |
|                                                           |
|  (Mobile: list full width, then tap aura to see detail)   |
+----------------------------------------------------------+
```

#### States

| State | Visual | Behavior |
|-------|--------|----------|
| Default | Aura list populated, first aura auto-selected | Right panel shows settings for selected aura |
| Loading | Skeleton for left panel list | -- |
| Empty (no auras) | Left: "No auras defined yet. Create one above!" Right: centered "No aura selected" | Create input enabled |
| Aura selected | Aura highlighted in list, right panel populated | All controls enabled |
| No aura selected | Right panel shows empty state | Controls hidden until aura selected |
| Editing fallback | Steps reorderable with arrow buttons | Real-time re-render |
| Saving | "Save Auras Config" button shows spinner | All controls disabled during save |
| Error | Error banner "Failed to load auras" + Retry | Aura list may be stale |
| Rename active | Aura name becomes editable input field | Rename/Delete hidden, Save/Cancel shown |
| Duplicate name on create | Inline error "An aura with this name already exists" | Create input retains text for editing |

#### Fallback Step Visual

```
+-----------------------------------------------+
| #1  opencode-zen/big-pickle          Up Down X |
|     Reasoning | Context: 200K                  |
+-----------------------------------------------+
```

Each step shows:
- Priority number (#1, #2...)
- Model ID (truncated with tooltip if >30 chars)
- Badges: Reasoning (if the model supports it), context window size
- Action buttons: Move Up (disabled at top), Move Down (disabled at bottom), Remove

#### Responsive Behavior

| Viewport | Layout |
|----------|--------|
| Desktop (>=1024px) | 2-column: left 280px, right fills |
| Tablet (768-1023px) | 2-column stacked: list above detail, both full width |
| Mobile (<768px) | Single column. List shows first. Tap aura to enter detail view (full screen with back button) |

#### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab | Aura list items -> Create input -> Create button -> Right panel fallback controls -> Add step form -> Save button |
| Enter | Select aura (when focused on list item), Execute button action |
| Arrow Up/Down | Navigate aura list items |
| Escape | Cancel rename, close any open state |

#### Accessibility
- Aura list uses `role="listbox"` with `aria-activedescendant`
- Selected aura uses `aria-selected="true"`
- Move up/down buttons have `aria-label="Move {model} up/down in fallback chain"`
- Remove button has `aria-label="Remove {model} from fallback chain"`
- Create input has associated `<label>`
- Save button has `aria-busy` during save operation
- Empty states are announced to screen readers via `aria-live="polite"`

---

### Screen: API Tester

**URL / Route:** `GET /` (API Tester tab)
**Viewport behavior:** Desktop (2-col: form left | response right) | Tablet (stacked) | Mobile (single column, form then response)
**Auth required:** No

#### Layout (text description)

```
+----------------------------------------------------------+
| [Logo] Aurora-Provider        v2.0.0    [* Bifrost: OK]  |
|                                                  [Theme] |
+----------------------------------------------------------+
| [Dashboard] [Auras] [API Tester] [Settings]              |
+----------------------------------------------------------+
| +-- Form ------------------+ +-- Response ------------+ |
| |                           | |                         | |
| |  Select Aura: [v        ] | |  API Response (JSON)    | |
| |                           | |  +-------------------+ | |
| |  Prompt / Message:        | |  | {"id": "chat...   | | |
| |  +---------------------+  | |  |  "object": "...   | | |
| |  | Write a hello world |  | |  |  ...               | | |
| |  | program in Python.  |  | |  +-------------------+ | |
| |  +---------------------+  | |                         | |
| |                           | |  [Clear]                | |
| |  [v] Stream response      | |                         | |
| |                           | |                         | |
| |  [> Run Test]             | |                         | |
| |                           | |                         | |
| +---------------------------+ +-------------------------+ |
+----------------------------------------------------------+
```

#### States

| State | Visual | Behavior |
|-------|--------|----------|
| Default | Aura dropdown populated, prompt filled with default text, stream checked | Button enabled |
| No auras | Aura dropdown disabled, warning shown "No auras configured. Create one in the Auras tab first." | Button disabled |
| Running test | Button shows "Running..." spinner, button disabled | Form fields disabled |
| Response received | JSON response shown in right panel | "Clear" button available |
| Streaming | Text streaming into response panel in real-time | Button changes to "Stop" (abort controller) |
| Error | Error message in red in response panel | Button re-enabled |
| Network timeout | "Request timed out. Please try again." | Button re-enabled |

#### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab | Aura dropdown -> Prompt textarea -> Stream checkbox -> Run Test button -> Clear button -> Response area |
| Enter | Run test (when focused on Run Test button) |
| Ctrl+Enter | Run test (when focused on textarea) |

#### Accessibility
- Form uses `<form>` element with proper `<label>` associations
- Response area has `role="region"` and `aria-label="API response output"`
- Streaming text uses `aria-live="polite"` for incremental updates
- Submit button shows loading state text (not just a spinner icon)

---

### Screen: Settings

**URL / Route:** `GET /` (Settings tab)
**Viewport behavior:** Desktop (centered card, max 600px) | Tablet (full width) | Mobile (full width)
**Auth required:** No

#### Layout (text description)

```
+----------------------------------------------------------+
| [Logo] Aurora-Provider        v2.0.0    [* Bifrost: OK]  |
|                                                  [Theme] |
+----------------------------------------------------------+
| [Dashboard] [Auras] [API Tester] [Settings]              |
+----------------------------------------------------------+
|                                                           |
|  +-- Settings -----------------------------------------+ |
|  |                                                      | |
|  |  Server Port                                         | |
|  |  [10550                           ]                  | |
|  |  (1024-65535, requires restart)                      | |
|  |                                                      | |
|  |  Log Level                                           | |
|  |  [v Info                  ]                          | |
|  |  Options: Debug, Info, Warn, Error                   | |
|  |                                                      | |
|  |  Bifrost Endpoint                                    | |
|  |  [http://localhost:10550             ]               | |
|  |  (URL of the Bifrost gateway)                        | |
|  |                                                      | |
|  |  [Save Settings]                                     | |
|  |                                                      | |
|  +------------------------------------------------------+ |
|                                                           |
+----------------------------------------------------------+
```

#### States

| State | Visual | Behavior |
|-------|--------|----------|
| Default | Form fields populated from GET /api/settings | Save button enabled |
| Loading | Skeleton form fields | -- |
| Error loading | Error banner "Failed to load settings" + Retry | Form may show empty fields |
| Validation error | Inline errors on invalid fields | Save button disabled until valid |
| Saving | Button shows spinner, fields disabled | -- |
| Save success | Toast "Settings saved!" | If restart required, show confirmation dialog |
| Save error | Toast "Failed to save: {message}" | Fields re-enabled, values preserved |
| Restart needed | Confirmation dialog: "Some settings require a restart. Restart now?" | Restart Later / Restart Now buttons |

#### Form Validation Rules

| Field | Type | Validation | Error Message |
|-------|------|------------|---------------|
| Server Port | number | Required, 1024-65535, integer | "Port must be between 1024 and 65535" |
| Log Level | select | Required | (select always has a value) |
| Bifrost Endpoint | text (URL) | Required, valid URL | "Please enter a valid URL (e.g. http://localhost:10550)" |

#### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab | Port -> Log Level -> Bifrost Endpoint -> Save |
| Enter | Save (when focused on Save button) |
| Escape | Dismiss confirmation dialog (if open) |

#### Accessibility
- Each field has `<label>` with `for` attribute
- Help text below each field uses `aria-describedby`
- Validation errors use `aria-invalid` on the input
- Restart confirmation dialog has `role="alertdialog"`
- Save button has `aria-busy` during save operation

---

## New Header Component: Bifrost Health Indicator

Added to the header bar, visible on all tabs.

```
[* Bifrost: OK]   (green dot, "Bifrost: OK" text, on hover tooltip: "Bifrost gateway at localhost:10550")
[* Bifrost: ERR]  (red dot, "Bifrost: ERR" text, on hover tooltip: "Bifrost unreachable - check gateway status")
```

**Behavior:**
- Polls `GET /health` every 5 seconds (reuses existing healthTimer pattern)
- The health response includes a bifrost field or we check by trying to reach the bifrost endpoint
- Green = last check succeeded; Red = last check failed (or 3 consecutive failures)
- Clicking the indicator could navigate to Settings tab (future enhancement)

---

## Component Inventory

### New Components Needed

| Component | Description | Parent | States |
|-----------|-------------|--------|--------|
| `BifrostHealthIndicator` | Header pill showing Bifrost connection status | Header | Online, Offline, Loading (initial) |
| `SettingsForm` | Settings form with port/log level/bifrost endpoint | Settings tab | Default, Loading, Validating, Saving, Error |
| `LogDetailModal` | Modal showing single log entry details | Dashboard | Closed, Open (with data) |
| `MetricsCardRow` | Row of 4 metric stat cards | Dashboard | Loaded, Loading (skeleton), Error (0 values) |
| `FallbackStepItem` | Single row in fallback chain editor | Auras | Default, First (disabled Up), Last (disabled Down), Removing (animate out) |

### Existing Components to Reuse

| Component | Current Location | Notes |
|-----------|-----------------|-------|
| `TabNavigation` | Header nav buttons | Refactored to 4 tabs instead of 7 |
| `Card` (glass) | Everywhere | Keep existing card CSS |
| `FormInput` | Multiple forms | Keep existing `.form-input` class |
| `FormSelect` | Multiple forms | Keep existing `.form-select` class |
| `FormTextarea` | API Tester | Keep existing `.form-textarea` class |
| `Button` (primary/secondary/danger/success) | Multiple | Keep existing `.btn` variants |
| `Loading Spinner` | Multiple | Keep existing pattern |
| `Toast` notification | Currently uses `alert()` | **New:** Replace `alert()` with non-blocking toast component |
| `Pagination controls` | Dashboard | Keep existing pattern |
| `ThemePicker` | Header | Keep as-is (5 themes) |
| `Modal` | Log detail | Keep existing modal pattern, simplify fields |
| `Confirm dialog` | Clear logs, delete aura | **New:** Replace confirm() with inline confirmation dialog |

### New Utility: Toast Notification System

Replace all `alert()` / `confirm()` calls with a non-blocking toast/notification system.

```
+----------------------------+
| Saved successfully!      X |  -> success toast (green)
+----------------------------+
+----------------------------+
| Failed to save: ...      X |  -> error toast (red)
+----------------------------+
+-------------------------------------------+
|  Clear all usage logs?                    |
|  [Cancel] [Clear Logs]                    |  -> confirmation toast
+-------------------------------------------+
```

**Behavior:**
- Auto-dismiss after 5 seconds for success/info toasts
- Error toasts persist until user dismisses (X) or after 10 seconds
- Confirmation toasts block interaction until user responds
- Stack multiple toasts vertically (up to 3)
- Accessible: `role="alert"`, `aria-live="polite"`

---

## States Summary for All Screens

| State | Dashboard | Auras | API Tester | Settings |
|-------|-----------|-------|------------|----------|
| **Default** | Charts + metrics + logs table | List + selected aura settings | Form + empty response | Filled form |
| **Loading** | Skeleton metric cards + chart | Skeleton list | No loading (fast) | Skeleton form |
| **Empty (no data)** | Empty logs table + metric zeros | "No auras" list + empty detail | "No auras" warning | N/A (settings always exist) |
| **Empty (filtered)** | "No matching logs" | N/A | N/A | N/A |
| **Error (load)** | Error banner + Retry | Error banner + Retry | N/A | Error banner + Retry |
| **Error (action)** | Toast: clear failed | Toast: save failed | Error in response panel | Toast: save failed |
| **Validation** | Date range errors | Duplicate name errors | Empty field warnings | Port/URL validation |
| **In progress** | N/A | Save button spinning | Test running | Save button spinning |
| **Success** | Logs refreshed | Toast: saved | Response shown | Toast: saved, restart? |

---

## User Flow Checklist

- [x] All acceptance criteria from the task context are addressed in the flows
- [x] Every API endpoint from the system design has a corresponding UI flow
- [x] All states covered per screen: default, loading, empty, error, validation, in-progress, success
- [x] Keyboard navigation tab order defined for each interactive screen
- [x] Accessibility requirements specified (labels, aria attributes, color contrast)
- [x] Responsive behavior defined (desktop / tablet / mobile) for each screen
- [x] Component inventory complete (new vs. existing, with states for new ones)
- [x] No ambiguity - a Frontend Engineer can implement from this document alone

## Open Questions

1. **Restart mechanism for settings changes** - The settings API says POST /api/settings. After saving port/bifrost endpoint, how is the server restarted? Options: (a) automatic restart on save, (b) manual restart via a separate endpoint, (c) restart required flag returned in save response. **Recommendation:** Return restartRequired: boolean from POST /api/settings. If true, show an in-page banner "Restart required - [Restart Now] [Later]". Restart Now calls POST /api/restart.

2. **Model catalog for fallback steps** - The add-step model dropdown needs a list of available Bifrost models. System design doesn't specify a models catalog endpoint. **Recommendation:** Either (a) Bifrost has a GET /v1/models that lists all models, (b) add a proxy endpoint in aurora-provider, or (c) maintain a static model list in the UI (not ideal). The dropdown currently fetches from /api/providers/{key}/models (old provider system) - that won't work after refactor. **This needs a system design update.**

3. **Log level options for UI** - What log level values does the server support? Assumption: debug, info, warn, error. Needs confirmation from server implementation.

4. **Streaming abort** - Should the "Stop" button during streaming use AbortController? **Assumption:** Yes, to properly cancel in-flight SSE connections.
