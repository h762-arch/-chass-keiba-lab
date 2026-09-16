# 06 Model Governance

Stages: DISCOVERY → SHADOW → APPROVED → PRODUCTION → MONITORING → ROLLED_BACK.

- `<20`: exploration
- `20–49`: shadow candidate
- `>=50`: promotion review only
- production requires walk-forward pass, multiple KPI improvement, no material regression, baseline retention, same organization/theme, and explicit human approval.

Migration `0011_model_governance.sql` is additive. It creates candidate, event, shadow prediction and registry tables. No production pointer or model coefficient is changed. Shadow errors are isolated from production responses.
