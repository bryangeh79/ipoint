# iPoint Engineering Standards and Git Workflow V1.0

## 1. Roles

- Bryan: final business decision owner
- ChatGPT Command Center: product, architecture, review, and acceptance authority
- OpenClaw: project manager and task dispatcher; does not write code
- Codex CLI workers: engineering implementation, tests, commits, and technical evidence

## 2. Branch policy

- `main`: protected production baseline; no direct Codex CLI push
- `develop`: optional integration branch if explicitly adopted during Phase 0
- `phase/<number>-<name>`: Big Phase integration branch
- `task/<number>-<name>`: isolated small-phase work branch
- `hotfix/<name>`: only for approved urgent fixes

OpenClaw must assign file/module ownership before parallel work. Two workers must not independently modify the same core file or migration chain without a coordination plan.

## 3. Commit policy

Use conventional commits:

- `feat(member): ...`
- `feat(merchant): ...`
- `feat(admin): ...`
- `fix(transaction): ...`
- `test(reward): ...`
- `refactor(ledger): ...`
- `docs(architecture): ...`
- `chore(ci): ...`

Avoid vague messages such as `update`, `fix`, `changes`, or `done`.

Every small phase must have at least one coherent commit. Large tasks should use multiple reviewable commits.

## 4. Scope discipline

A Codex worker must:

- Read the assigned Phase brief and relevant baseline documents
- Inspect existing code before editing
- State assumptions and blockers
- Change only assigned scope
- Avoid opportunistic refactors unless required and reported
- Never change a locked product rule
- Never hard-code configurable commercial values
- Escalate contradictory documentation

## 5. Required checks

Phase 0 will finalize exact commands. At minimum, every applicable task must report:

- Formatting
- Lint
- Type check
- Unit tests
- Integration tests
- Build
- E2E or manual verification for critical flows
- Migration forward test
- Rollback or recovery strategy
- Dependency/security scan where configured

A failing check cannot be hidden. The report must include failure output and reason.

## 6. Code quality

- Prefer clear domain names over generic utilities
- Keep business calculations in tested domain services
- Avoid duplicated calculation logic between Member, Merchant, and Admin surfaces
- Use exact decimal types
- Use explicit status machines
- Use server-side authorization
- Use idempotent commands for critical writes
- Write audit events for privileged actions
- Add comments for business invariants, not obvious syntax
- Keep secrets and environment-specific values outside source control

## 7. UI/UX engineering rules

- Follow the official iPoint Product Design System
- Use shared tokens and components
- Do not sample colors or spacing from screenshots as the source of truth
- Support responsive mobile and desktop behavior where required
- Include loading, empty, error, success, disabled, expired, suspended, permission-denied, and offline states where relevant
- Provide screenshots or recordings in the task evidence
- Document any approved deviation from the Design System

## 8. Database rules

- One ordered migration chain
- No manual production schema edits
- No destructive migration without explicit approval
- No floating-point financial/point columns
- No deletion of ledger, transaction, approval, or audit history
- Seed scripts must be deterministic
- Data correction scripts must be reviewed, idempotent where possible, and audited

## 9. Pull request and review expectations

Each PR or Phase review package includes:

- Scope and acceptance criteria
- Commits
- Changed files
- Architecture notes
- Database/API changes
- Test commands and results
- UI evidence
- Security implications
- Risks and known limitations
- Rollback/recovery notes

OpenClaw consolidates worker reports, but does not approve the Big Phase. ChatGPT Command Center issues the acceptance decision.

## 10. OpenClaw execution report

```markdown
# iPoint Phase Execution Report

## Phase Information
- Big Phase:
- Small Phase:
- Assigned CLI:
- Branch:
- Status:

## Completed Scope

## Git Commits
- SHA:
- Message:
- Files changed:

## Test Results
- Format:
- Lint:
- Type check:
- Unit:
- Integration:
- Build:
- E2E/manual:

## UI/UX Verification
- Design System compliance:
- Desktop evidence:
- Mobile evidence:
- Deviations:

## Database and API Changes

## Security and Permissions

## Risks and Issues

## Outstanding Work

## Recommended Next Action
- Ready for review / Needs rework / Blocked
```

## 11. Completion states

Only ChatGPT Command Center may mark a reviewed delivery as:

- `APPROVED`
- `CHANGES REQUIRED`
- `REJECTED`
- `READY FOR NEXT PHASE`
