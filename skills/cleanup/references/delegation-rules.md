# Delegation

- **Risk judge** (`aca-risk-judge-agent`, opus): after approvals, before apply.
  Prompt: the run id and the user's answers (uses, keep). It runs
  `approvals show --json` and may veto. It can never approve.
- **Report writer** (`aca-report-agent`, sonnet): optional, for a long results
  summary; runs `results`, `report`.

Never delegate: connecting/pairing (needs the user's code), the interview,
approvals, apply, restart, clear-data, restore. Those stay with you and the user.
