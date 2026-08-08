# Product AI

These Draft principles govern `.github`-owned AI standards for user-facing model capabilities.
[ADR-0003](../../docs/architecture/0003-four-authority-topology.md) remains the sole authority
topology; each handoff below applies that topology without restating or transferring it.

## GH-AIP-001 — Select the smallest passing model

- **Status:** Draft
- **Statement:** Select the smallest model and pinned version that passes the feature's Product-supplied
  quality bar, and configure a bounded fallback chain for timeout, refusal, or unavailability.
- **Rationale:** Excess capability raises cost and latency, while an unversioned single-provider
  dependency makes quality and availability drift outside review.
- **Verification / evidence:** Versioned feature configuration names the model version, eval result,
  timeout, and ordered fallbacks; a representative failure test reaches each fallback and terminates
  in a Studio-defined unavailable state rather than a raw error or loop.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product supplies the outcome and quality threshold; Engineering owns
  provider adapters and resilience mechanisms; Studio owns degraded-state UX. `.github` owns the AI
  selection, versioning, and eval-gate standard.
- **Legacy inputs:** `ai-products.md §1`, `ai-products.md §1.1`

## GH-AIP-002 — Design prompts through the user experience

- **Status:** Draft
- **Statement:** Design each product prompt as a versioned contract whose user inputs, steering,
  correction, cancellation, and output states are handed to Studio for accessible UX expression.
- **Rationale:** A technically effective prompt still fails users when expectations, control, and
  recovery are unclear.
- **Verification / evidence:** Review links the prompt version to its Product outcome and Studio UI
  contract; acceptance evidence covers loading, retry, edit, reject, undo, error, and non-AI paths
  without embedding prompt text in scattered UI literals.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product defines the intended user outcome; Studio owns interaction,
  copy, localization, and accessibility; Engineering implements the interface. `.github` owns prompt
  structure and traceability, not the Product decision or UI design.
- **Legacy inputs:** `ai-products.md §2`

## GH-AIP-003 — Constrain model inputs, outputs, and actions

- **Status:** Draft
- **Statement:** Validate and bound every model input, parse every output against an explicit
  contract, and allow model-proposed tools or privileged actions only through reviewed allowlists
  and required confirmation.
- **Rationale:** User text, retrieved context, and model output all cross trust boundaries and can
  carry injection, malformed data, or unsafe instructions into the next system.
- **Verification / evidence:** Input limits, output schemas, sanitization, tool allowlists, and
  confirmation rules are versioned beside the feature; adversarial evals cover injection,
  non-conforming output, unsafe rendering, and refused privileged actions.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns validation, sanitization, authorization, and secure
  execution mechanisms; Product defines prohibited outcomes and obligations; Studio owns safe
  presentation. `.github` owns AI-specific prompt, output, and tool boundaries.
- **Legacy inputs:** `ai-products.md §3`, `security.md §5`

## GH-AIP-004 — Gate AI changes on representative evals

- **Status:** Draft
- **Statement:** Gate every shipped AI capability and every prompt, model, parameter, retrieval, or
  guardrail change on a versioned eval set with a Product-approved threshold.
- **Rationale:** A convincing example cannot reveal regressions across representative, failure, and
  adversarial cases.
- **Verification / evidence:** The change identifies the eval dataset revision, rubric, threshold,
  baseline, and result; CI invokes the repository's Engineering-owned test command and blocks a
  regression. Mutation evidence demonstrates the new or changed gate can fail.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product owns acceptable outcomes and the ship decision; Engineering
  owns test execution and CI mechanisms; Studio supplies UX and accessibility cases. `.github` owns
  AI eval structure and the requirement that configuration changes re-run it.
- **Legacy inputs:** `ai-products.md §4`, `testing.md §7`, `testing.md §8`

## GH-AIP-005 — Budget latency and cost before release

- **Status:** Draft
- **Statement:** Record explicit per-request and aggregate cost limits plus end-to-end and tail
  latency limits before enabling a production AI path, and refuse release when measured evidence
  exceeds them.
- **Rationale:** Unbounded tokens, context, retries, and model calls can make a valuable capability
  economically or experientially unshippable.
- **Verification / evidence:** Product requirements name the acceptable service and cost envelope;
  Engineering telemetry records model, token, retry, cost, and latency dimensions; release evidence
  compares representative and production measurements with the approved limits.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product supplies value, demand, and spend constraints; Engineering
  owns instrumentation, caching, and performance mechanisms; Studio owns waiting and timeout UX.
  `.github` owns the AI budget metadata and gate, not business or performance policy.
- **Legacy inputs:** `ai-products.md §5`

## GH-AIP-006 — Disclose AI involvement and limits

- **Status:** Draft
- **Statement:** Disclose when a user-visible result is AI-generated or AI-assisted, distinguish it
  from human-authored content, and expose material limits or uncertainty without claiming authority
  the evidence does not support.
- **Rationale:** Hidden automation and overstated confidence prevent informed use and erode trust.
- **Verification / evidence:** Product requirements identify where disclosure is required; the
  Studio-owned UI contract includes the label, limits, correction path, and report path; acceptance
  tests verify disclosure remains attached through save, share, and export flows.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product defines disclosure obligations and claims; Studio owns
  wording and presentation; Engineering preserves disclosure metadata. `.github` owns the AI-origin
  standard and verification requirement.
- **Legacy inputs:** `ai-products.md §6`, `compliance.md §1`

## GH-AIP-007 — Minimize and authorize user data sent to models

- **Status:** Draft
- **Statement:** Minimize user data included in model context, require the Product-defined
  obligation and consent posture before transmission, and prohibit raw sensitive data from prompts,
  logs, eval fixtures, retention, or provider training unless explicitly authorized.
- **Rationale:** Model context can cross provider, logging, retention, and training boundaries that
  users do not expect.
- **Verification / evidence:** A data-flow record names categories, purpose, provider, region,
  retention, training setting, deletion path, and consent or other basis; fixtures are synthetic,
  logs are redacted, and revocation tests stop downstream processing.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product owns obligations and consent posture; Engineering owns
  privacy and data-handling mechanisms; Studio owns consent expression. `.github` owns AI context
  minimization and provider/tool configuration standards.
- **Legacy inputs:** `ai-products.md §7`, `compliance.md §7`, `compliance.md §8`

## GH-AIP-008 — Preserve a non-AI completion path

- **Status:** Draft
- **Statement:** Keep AI capabilities optional and provider-swappable, and preserve a tested
  non-AI or clearly unavailable path that lets the surrounding product complete its essential job.
- **Rationale:** A hosted model should not turn provider failure, budget pressure, or product scope
  into an unrelated product outage.
- **Verification / evidence:** The model sits behind a capability interface; configuration can
  disable or replace it without changing callers; tests exercise provider, local, rule-based, and
  unavailable implementations against the same contract and verify the kill switch.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product decides whether AI creates enough value and whether a
  substitute satisfies the outcome; Engineering owns the interface and fallback mechanisms; Studio
  owns degraded UX. `.github` owns optionality and swappability standards.
- **Legacy inputs:** `ai-products.md §8`, `featuring.md §6`
