# CHASS KEIBA LAB Ver.10.0.1 Validation Placeholder Fix

## Root cause

`index.html` contained race-specific example values as placeholders in the empty validation form:

- Actual weather: `雨`
- Actual TIME: `5=1:59.6`, `3=1:59.6`, `8=1:59.6`

Because placeholders remain visible while the form has no saved result, they looked like stale values from another race.

## Changes

- Replaced the race-specific placeholders with `未入力`.
- Disabled browser autocomplete on the two free-text actual-result fields.
- Kept saved Result Snapshot restoration unchanged.
- Added a regression test that prevents race-specific sample results from returning to empty fields.

## Verification

- Focused active-race tests: 11/11 passed.
- Full syntax and regression check: 286/286 passed, 0 failed.
- Prediction, probability, TIME, market, result, D1, Public API, AI Data Bridge and MCP logic were not changed.
