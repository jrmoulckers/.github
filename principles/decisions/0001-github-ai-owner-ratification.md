# GitHub and AI principle owner Ratification

- **Decision:** Ratify the listed principles only when repository owner `jrmoulckers` merges the pull
  request containing this record after the required `CI gate` succeeds.
- **Current approval state:** Proposed; this record does not claim repository-owner approval before
  merge.
- **Principles:** `GH-REPO-001`–`GH-REPO-007`, `GH-ACT-001`–`GH-ACT-007`,
  `GH-AIP-001`–`GH-AIP-008`, `GH-AIOPS-001`–`GH-AIOPS-015`, and
  `GH-AIEVAL-001`–`GH-AIEVAL-006`.
- **Source pull requests:** [#89](https://github.com/jrmoulckers/.github/pull/89) and
  [#92](https://github.com/jrmoulckers/.github/pull/92).
- **Final review evidence:** #89 ended at `95293ea98a26228d2ee143fbbb19e04e2aff80b3`
  with `Sync engine tests` successful and owner merge
  `7f5214741cb4b26a8df92c7a3e4abb10308dc94f`; #92 ended at
  `698bc2befb0b697b3946d996471339fbf2b13136` with `Principle metadata tests`,
  `Sync engine tests`, and `CI gate` successful and owner merge
  `3036d5d1ed882a4c5acffe1ccfa0b49165538eef`; #97 finalized `GH-ACT-005` at
  `73a5bf6769a4d4235b55057453d896d876f71069` with `Principle metadata tests`,
  `Sync engine tests`, and `CI gate` successful and owner merge
  `97ff60ec21321563fa0fc7ba80015261e7dcd6fa`.
- **Content and ownership:** IDs, statements, rationale, verification, owner / ratification wording,
  cross-authority handoffs, Legacy inputs, ordering, and paths are unchanged; only each listed
  `Status` changes from `Draft` to `Ratified`.
- **Effective approval:** The repository-owner merge event for the pull request containing this
  record is the Ratification act. Authorship, agent work, source-PR merges, checks, and this proposed
  record are evidence, not approval of this Ratification.
- **Required protection:** `main` strictly requires `CI gate`; force pushes and branch deletion are
  disabled. The required check must succeed on the final pull-request head before owner merge.
- **Non-goals:** This decision does not alter ADR-0003, authority boundaries, legacy evidence,
  migration history, agents, skills, prompts, instructions, sync behavior, or workflows.
