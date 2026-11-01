# Provider list operational parity implementation plan

**Goal:** Operational parity with Business Tracker 055e01b, session-only.
**Spec:** User request 2026-11-01, six sections. Execution is native.
**Architecture:** Existing HTML, bounded relay and focused browser helpers; no
database, login, scheduler, permanent storage, dependency or new function overrides.
**Verification:** Explicit user override: manual original-helper/UI mock only;
no automated tests, live provider writes, merge or deploy.

- [x] Read exact reference commit; match raw candidate decisions across consumers.
- [x] Separate Adsterra Campaign adoption/same/reset from Placement; memory-only
  method/version/readiness; distinguish untouched legacy from interrupted setup.
- [x] Match parsers including blacklist hashes, Clickadu writable fields and
  GET-backed campaign status, Custom Bid guard/reset and final verification.
- [x] Parse only documented rejection record shapes; bind in-memory receipts
  to connection/provider/campaign/CSV/input/method/version/target; confirm exclusions.
- [x] Manual mock: boundaries, both providers/methods, adoption/reset, cancel,
  partial OFF, NO_CHANGE bid reset, repeated exclusions/empty/drift/timeout,
  desktop/mobile; node syntax, diff, independent review.
- [x] Update README. Delivery is a normal commit/push of this feature branch
  after the final syntax/diff gate; actual commit/push evidence is reported separately.

Review focus: null method after interrupted setup cannot bypass ON; Placement
never clears; landing IDs/diagnostic samples do not authorize exclusions;
GET cannot settle ambiguous requests; late responses cannot publish stale
methods, receipts or Active status. HTTP calls never inside a DB transaction
(there is no DB); no database fencing/exactly-once guarantee is claimed.

## Actual manual observations (no automated tests)

Used the original HTML/helper/relay through an isolated localhost HTTP server.
All provider transport was replaced with an in-memory upstream; no token or
real provider connection was used. Console commands were invoked individually,
observations inspected, with no assertions or test runner. Preview tools/images
are outside Git. Business Tracker remained read-only.

- Adsterra: cost 1000 / ROI 25 / CTR 5 -> SAFE/Whitelist; ROI 20 with valid
  zero impressions -> SAFE; ROI 15/CTR 9 -> SAFE; ROI 15/CTR 8 and ROI 10/CTR 9
  -> Blacklist; cost 999 -> insufficient; null ROI/invalid counts -> unknown.
  Clickadu ROI 29.999 -> Blacklist, 30 and 30.001 -> SAFE/Whitelist.
- Invalid primitive/whitespace/negative/nonfinite/fractional count rejected;
  zero accepted. Blacklist hash accepted as read evidence; nonempty top-level
  array rejected (only empty array supported), no relaxed target write parser.
- Active existing Whitelist adoption: zero writes, typed unavailable Blacklist
  evidence retained. Active empty Blacklist adoption: zero writes. Same method
  does not reset. Cancellation: zero writes and busy released.
- Both method switches: OFF followed by verified INACTIVE, necessary clear,
  final empty lists, bids unchanged; Whitelist reset leaves readiness false.
  Clear rejection after OFF leaves status OFF and initial method null/version>0;
  ON rejected. Truly untouched legacy null/version0 can ON.
- Matching Blacklist plus ID/GLOBAL bid overrides: DELETE both GEOs, zero PUT;
  repeat without bids: NO_CHANGE and zero new writes.
- Whitelist refusal via landing records retained only target ID 10, not landing
  ID 7/out-of-target 999; incomplete flag visible. Next refusal via placement
  records retained 40; fresh confirmation excluded 10, then 10+40. Final GET
  matched target 50 and readiness true; bids preserved. All remaining IDs
  rejected -> empty target rejected before another confirmation/write.
- Old receipt after new analysis rejected; statistics drift and input changes
  during a delayed GET stopped preflight without writing. Duplicate apply calls:
  one confirmation and one PUT. Arbitrary other 422 did not become empty data.
- Custom Bid edit, single-item create (including price zero), and delete worked
  while Blacklist was specially unreadable and valid Whitelist existed.
- Clickadu both directions: one PUT, exact GET, all other targeting and
  pushNotificationCreative/cohort retained; matching target NO_CHANGE.
  No-plan actual-method drift stopped preflight; Cancel sent no write.
- Mock timeout fenced later writes even after GET; OFF remained available and
  did not erase uncertainty. No automatic retry or rollback was observed.
- Desktop 1440 and mobile 390: no document overflow; local table horizontal
  scrolling retained, top failure/rejection action and Placement OFF visible.
  Resize desktop/mobile did not increase upstream call count (7 -> 7).

## Independent review and fix pass

Fresh read-only reviewer found five important issues. All were corrected:
1. OFF waits for in-flight write settlement/timeout; status epochs and cancellation
   prevent stale ON status publication. Original-helper mock ON then OFF returned
   OFF, released lock, and showed ordered PATCH true then PATCH false.
2. Ambiguous Custom Bid save stops before any DELETE; mock ambiguous POST produced
   one attempted save, zero automatic DELETE, uncertainty true.
3. Mismatching/malformed create response after a matching GET fails closed;
   mock response {} left uncertainty true and did not claim success.
4. Parser again rejects undocumented nonempty top-level Blacklist arrays.
5. Primitive validation precedes count coercion and aggregation. Boolean/array/
   whitespace/overflow cannot be promoted to valid statistics/candidates.

Ruling: user explicitly prohibited automated tests; verification uses manual
mock observations and syntax checks instead of the skill's TDD/test-run steps.
There is no package.json, TS/build/lint toolchain, or test dependency to invoke.
This is weaker than automated regression coverage, and no live acceptance is claimed.
Existing duplicate HTML function declarations were not cleaned up or overridden
again; only the effective definitions and the directly used shared functions
were changed. Session guards cannot coordinate other tabs/operators or survive
refresh; an ended HTTP response is distinguished from a lost/ambiguous response,
but a matching GET never proves an ambiguous provider request has stopped.
