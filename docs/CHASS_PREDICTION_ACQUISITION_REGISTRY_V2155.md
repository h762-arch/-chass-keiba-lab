# Phase92: preregistered source-reader gate

Expected upstream main: 1c31b2e9407acfe4b4c8ecbaa44968b59cbe8161 (PR158).
Local baseline tree af368f683837b10e88b6c7a2c8e80c3d2edc0f63 is identical to
upstream main. Local git history was reconstructed from PR157 plus the exact
PR158 patch because direct GitHub git transport was unavailable. Tree equality,
not an invented upstream commit, grounds this patch.

## Authority and live read scope

Read 2026-10-09: official prompt v2.15.5 Acquisition-First:
https://docs.google.com/document/d/1VivM-SpbiyKwJENk58wWlGdeBqGO0L1iapWXw4KQHhk/edit
Master:
https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit

Metadata resolved native tabs and dimensions. Read only bounded ranges:
- RUN_MANIFEST A1:P15
- SOURCE_REGISTRY A1:P15
- PROVIDER_MAP A1:P15
- FIELD_ELIGIBILITY_LEDGER A1:AF12
- ACQUISITION_LEDGER A1:P15
(all CHASS_V215_*_V1 tabs).
These windows show past shadow runs, source/provider descriptions, field policy
rows and the acquisition header/contract row. They do not prove that no run exists
elsewhere. No target forward race/field/endpoint registration or independently
verified Freeze evidence was established in this task. No Drive writes occurred.

## Implemented gate

`registerPredictionAcquisitionSourcesV2155({plan,registry,anchor,readers})` returns
collectors only after an explicitly frozen FORWARD/ORIGINAL_EARLY registry binds
one Phase90 plan. Required bindings: planHash, plan/run/race/eligibility/field/
scope/requirement/contract IDs; explicit-timezone registry freeze <= plan freeze;
separately supplied anchor with registry ID/hash and plan hash.

Four ordered T0-T3 entries exactly match the plan provider/sourceCandidate. Each
requires a distinct provider, readerId, sourceRef, enabled=true, allowedStage=EARLY,
preResultRequired=true, identityRequired=true and an own registered reader function.
Missing, reordered, duplicate, template, diagnostic, unbound or changed entries
return HOLD before any external read. No contract thresholds are hardcoded.

Readers receive frozen registration, Phase90 context and AbortSignal. Return
{sourceRef,receipt}; sourceRef must exactly equal the preregistered sourceRef.
Use by another plan, endpoint substitution, absent receipt or observed abort
returns CONFLICT; Phase90 stops HOLD instead of declaring exhaustion. FOUND
receipt identity, pre-cutoff availability and value remain Phase90 responsibilities.
Provider exceptions are sanitized by Phase90. All supplied readers are captured
at registration so later map mutation cannot replace a reader silently.

This is an offline normalized registry interface, not a parser for raw Drive rows.
It does not translate policy/template rows into live registrations or guess exact
sourceRefs. The separately supplied anchor proves content matching only, not
external authentication. Readers own authorized source access and honest endpoint
reporting; this module cannot detect a reader falsely reporting sourceRef. Source
Registry/Identity/Availability authentication and anchor trust are caller duties.
No built-in HTTP/Drive fetch or real provider is installed. Phase91 persists plan
and executor output; this gate does not persist its registry or full source data.
Those records must be independently retained before production connection.

## Validation and limitations

14 synthetic new tests cover exact registration/exhaustion, zero, missing readers,
templates/replay, foreign bindings, tampering/anchor omission, freeze ordering,
duplicate/reordered tiers, disabled/POST sources, substitution, foreign context,
reader mutation, registered execution-to-quarantine reconnect and diagnostic plan.
No actual current race acquisition, formal Freeze, KPI adoption or production
activation is claimed. All formal/adoption/activation flags remain false.

Next: establish a specific future race and frozen per-field contract, normalize
real Source/Identity/Availability evidence, independently retain registry/source
snapshots and register authenticated readers. Then validate acquisition plus
remote persistence/reconnect and formal Core gates. Activation remains NO-GO.
