# STATUS — imageextract.pics

Last updated: 12 August 2026

**This file carries what is OPEN. Closed work and its evidence live in
`docs/record.md`** — the split happened 2026-08-12, when this document had
reached 753 lines of which 586 were closed boxes and 37 were open ones. A
16:1 dilution is why it failed at FINDING twice in one day while having
recorded everything correctly.

**The rule: a box that closes moves to the record, with its evidence, in the
same commit that closes it.** So this file's length tracks remaining work and
shrinks as the project finishes — the opposite of what it used to do.
`doc-sync.test.ts` layer 6 enforces the three parts of that mechanically
(no closed box may sit here; a phase called complete may hold no open box;
a decision that creates work must name its box).

---

## Where we are right now

The site is DEPLOYED and live at https://imageextract.pics.

| Phase | State |
|---|---|
| 1 — Core engine | complete |
| 2 — Results UI | open |
| 3 — Download | open |
| 4 — Abuse controls | complete |
| 5 — Trust and legal | complete |
| 6 — SEO and content | open |
| 7 — Deploy | open |
| 8 — Post-launch | open |

This table is machine-checked: a phase marked `complete` here with an open
box under its heading below fails the suite. That is the Phase 6 failure of
2026-08-12 — a summary line contradicting its own checklist 370 lines
further down — made impossible rather than merely corrected.

What each open phase is waiting on, in one line each: **2** the variant
collapse; **3** the mid-range Android device run; **6** the landing-page
content (the largest remaining item in the project); **7** legal review and
error telemetry; **8** post-launch observation, which cannot start earlier.

## Ledger warning

**Drift goes BOTH ways.** An earlier version of this warning said the
document drifts CONSERVATIVE — boxes staying unchecked after the work is
done — and called that the safe direction. The first half is real and still
happens. The second half was wrong, and a warning that names the wrong
direction is worse than no warning: it tells a reader which way not to check.

*Conservative drift.* Items get done and the box stays unchecked, so the
ledger under-reports progress. Six Phase 7 boxes were closed retroactively on
the morning of 2026-08-12; within the hour, mail routing and the billing
alert were reported as hard blockers when both were already done.

**Its latency is HOURS, not phases** (measured 2026-08-12). "Astro content
collection for tool-variant landing pages" was accurate at 09:00 and false by
commit `610e6c8` the same afternoon. Anyone treating drift as something the
phase-boundary read catches in arrears is calibrated wrong by an order of
magnitude, and **the new structure makes this specific failure worse: a
short STATUS is read more often, so a stale line in it is trusted more.**

**The tests do not close that gap, and it matters that they don't.** Layer 6
catches a box that is CLOSED and still sitting here. It cannot see a box that
is DONE and still unticked — the work exists, the tick does not, and no file
in the repo disagrees with itself. That one stays human: tick it when you do
it, in the same commit.

*Optimistic drift.* The header claimed Phase 6 complete while Phase 6's own
checklist showed otherwise. Summary lines are where this direction lives:
written once, from a phase that felt finished, then never re-read against the
boxes underneath. Now machine-checked via the phase table above.

*A MISSING box is worse than a stale one, because it is invisible.* A stale
box is at least on the list. An item with no box is absent from every list
built from this document, and nothing prompts anyone to look. The
`variantGroup` collapse was called owed-not-optional in both DECISIONS.md and
AGENTS.md and had a box in no phase. Now machine-checked too: a DECISIONS
entry carrying a `Tracked:` line must name a box that exists here.

*One item, one box.* Before the split the Android device run had THREE homes
(two boxes in this file, one in frontend-plan) and nothing kept them
agreeing — whichever you found first was the answer you got. It is now one
box, in Phase 3, and everywhere else points at it.

---

## Remaining work

### Phase 2 — Results UI

- [ ] Collapse variant sets in the grid — one tile per logical image
      (`variantGroup`), its other candidates reachable behind that tile.
      **Owed correctness, not polish**: DECISIONS.md "Coverage counts
      logical images" — a grid showing eight tiles for one product photo
      misrepresents what was found, in exactly the way exact-URL matching
      misrepresented coverage before the metric was fixed. AGENTS.md's
      manifest comment says the same.
      **Added to the ledger 2026-08-12; the WORK is not new, the BOX is.**
      The extractor has emitted `variantGroup` since 2026-08-09 and the UI
      has never read it (verified: zero references in `src/components` and
      `results-model.ts`) — but it appeared in no phase checklist, so every
      "what remains" list built from this document silently omitted it for
      three days. That is the missing-box class in the ledger warning above.
      **Name the collapse function `collapseVariants`** — copy on
      /tools/download-png-images declares itself dependent on that symbol
      being ABSENT (`assumes` in its frontmatter), so shipping it turns
      `content-claims.test.ts` red with the page and paragraph that need
      rewriting. Naming it something else silently loses that.

### Phase 3 — Download

- [ ] **The mid-range Android device run — THE one box for this item.**
      Runs against the real https URL from any phone, no LAN setup; script
      in `docs/frontend-plan.md` step 8. It settles TWO things that used to
      be tracked separately: the disk-backed-Blob assumption behind
      `MAX_ZIP_BYTES_IN_FLIGHT` (a large mobile ZIP could OOM the tab —
      failure mode is a lost download and a reload, not data loss), and
      grid scroll smoothness at scale (frontend-plan step 7, verified only
      to 220 tiles at 4× CPU throttle on desktop). It is what holds Phase 3
      open.
      **Consolidated 2026-08-12 from three homes** — "Device check (2)" in
      this file's Open items, "The mid-range Android ZIP pass" under Phase
      7, and frontend-plan step 7's grid-jank criterion. All three were the
      same device run; the other two are now pointers.
- [ ] Optional numeric prefix preserving grid order (deferred — polish toggle, not assembly)

### Phase 6 — SEO and content

- [ ] Landing pages 2–5 generated from the collection (page 1,
      `/tools/download-png-images`, shipped 2026-08-12 with the schema).
      The collection itself is done and recorded.
- [ ] Google Search Console verified by DNS TXT — approved and reasoned in
      DECISIONS.md ("Google Search Console yes, Web Analytics no"). It is
      the ONLY feedback channel left after the Web Analytics closure, so
      pages 6–60 are guesses until it exists.

### Phase 7 — Deploy

- [ ] Legal review of /privacy and /terms — the copy is an accurate
      technical description, claim-verified against source; what it has
      never had is a lawyer's read. Owed before launch.
- [ ] Anonymous error telemetry (error class only, never URLs)

### Phase 8 — Post-launch

- [ ] Monitor subrequest volume and cost for the first month
- [ ] Watch which sites produce zero results, and why
- [ ] Expand landing pages based on actual search queries — gated on the
      Search Console item in Phase 6; there is no other query source.

---

## Known risks

**Static parse coverage is measured, and the assumption inverted.** The feared number — "below 60% on ecommerce means the product needs rethinking" — was tested 2026-08-10 against browser ground truth on 7 live pages. SSR ecommerce lands ≥90%; news, marketing, and docs land 100% in logical images. The one sub-60% reading (a headless-React Shopify collection at 45.6%) was **our cap policy, not static parsing**: the served HTML held 2,998 image URLs the parser had already read, and the candidate-counted cap trimmed them. With the noscript and logical-cap fixes it recounts at 98.1%, and apple.com went 50% → 100% on noscript alone. No rethink is indicated. What static parsing cannot reach is what origins refuse to serve — bot walls (Anubis, challenge pages), which stop headless browsers too. Full table and method in frontend-plan.md; the closure reasoning in DECISIONS.md.

**Large-grid rendering: decided and shipped, one verification open.** The Phase 2 answer is incremental reveal (cap 120, IntersectionObserver append) plus content-visibility on fixed-ratio tiles — not virtualization, not pagination (pagination resets on filter changes and makes select-all ambiguous; see DECISIONS.md). Verified at 220 tiles under 4× CPU throttle in desktop Chrome: 120 tiles / ~1.5k DOM nodes at rest. What remains open is the real mid-range Android verification — the single Phase 3 device-run box above; @tanstack/react-virtual stays the escalation path if that run janks.

**The proxy is a deliberately open endpoint.** Rate limits and size caps are the only defence, since verifying that a URL came from a prior scan is not possible statelessly. Accepted risk, mitigated rather than eliminated.

**DNS rebinding remains structurally open.** Workers cannot pin a connection to a validated IP. DoH narrows the window; it does not close it. Documented, not solved.

**Distribution is the real bottleneck.** The build is perhaps 20% of the work. A competitor shipped this as a side project and wins on ~60 SEO landing pages and a publishing cadence. Phase 6 is not garnish.

---

## Known documentation debt

- **`docs/frontend-plan.md` is 749 lines with the same disease this split
  cured here**: a build plan that became a measurement archive (the coverage
  corpus, the vantage study, the device-pass narrative). Diagnosed
  2026-08-12, deliberately NOT done in the same pass — recorded so it is not
  rediscovered as a new finding in three weeks. The remedy is the same
  shape: the plan keeps its open criteria, the measurements move to a
  companion, nothing is reworded in the move.

---

## Deferred decisions

| Decision | Trigger for revisiting |
|---|---|
| Headless-browser deep scan | **Closed 2026-08-10: not indicated.** The boundary is bot walls, not JavaScript — see DECISIONS.md. Reopens only if live-scan telemetry shows a class of *readable* pages with a large truly-absent residue |
| Sign-in or quotas | **Foreclosed 2026-08-10 by /about's published promise** ("no account, and there won't be one") — the abuse case it was reserved for is handled by rate limiting. If abuse ever outpaces that, the promise breaks publicly: /about changes FIRST, the feature second. Full reasoning in DECISIONS.md |
| Monetization | Not before real traffic exists |
| Open-sourcing | Post-launch |
| Extending to a broader toolkit | After this ships end to end |
