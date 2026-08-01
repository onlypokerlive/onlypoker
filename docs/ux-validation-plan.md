# UX validation plan

This document turns the UX audit hypotheses into measurements and real-user
checks. It is deliberately privacy-conscious: OnlyPoker is an accountless home
game, so no event may include a room code, player identifier or name, password,
token, card, action amount, or game-state payload.

## Funnel and diagnostic events

The primary funnel is:

`Create Viewed → Room Created → Invite Shared → Room Joined → Game Started → Tournament Finished → Results Shared → Guest Became Host`

Success events remain intentionally coarse. Diagnostic events explain where a
step failed without identifying a table.

| Event | When it fires | Allowed dimensions |
|---|---|---|
| `Create Viewed` | Creation page settles | viewport band, initial CTA visibility |
| `Create Attempted` / `Create Failed` | Submit and validation/API refusal | source, customized, changed-control count, stage, field, failure category, viewport |
| `Customize Opened` | Advanced setup is first opened | viewport |
| `Room Created` | Server creates the table | source, customized |
| `Invite Attempted` / `Invite Outcome` | Share control is invoked and settles | surface, phase, host role, native/clipboard/cancelled/error, viewport |
| `Invite Shared` | Native or clipboard share succeeds | method, surface, phase, host role, player count |
| `Invitation Viewed` | Join page resolves its preview | available/missing/unavailable, viewport |
| `Join Attempted` / `Join Failed` | Seat or spectator entry starts/fails | role, preview status, coarse failure category, viewport |
| `Room Joined` | Seat or spectator entry succeeds | role |
| `Game Start Attempted` / `Game Start Failed` | Initial host start starts/fails | player count or failure category, viewport |
| `Game Started` | First hand starts | player count |
| `Action Rejected` | A live decision is refused | action kind, failure category, viewport |
| `Tournament Finished` | Results become visible | player count, hand count, host role |
| `Finish CTA Impression` | Results actions render for the first time | host role, initial visibility, viewport |
| `Results Share Attempted` / `Results Share Outcome` | Poster sharing starts/settles | host role, method/cancelled/error, viewport |
| `Results Shared` | Poster sharing succeeds | method, player count, host role |
| `Finish CTA` | Play again or create is selected | action, host role |
| `Host Continuity` | Backup, recovery, or handoff runs | action, outcome, optional coarse failure category, viewport |
| `Room Session Missing` | A room route has no usable local seat credential | viewport |
| `Guest Became Host` | A former guest creates within 30 days on the same device | creation source, whole days since join |

Failure categories are limited to validation, authentication, not found, rate
limited, conflict, network, and other. These categories diagnose a broken step
without sending server messages, secrets, or user-entered values.

## Major hypotheses and validation

### H1 — A first-viewport creation action increases table creation

- **Primary metric:** `Room Created / Create Viewed`, segmented by viewport.
- **Diagnostics:** initial CTA visibility, `Create Failed`, and Customize-open rate.
- **Guardrails:** validation-failure rate, customized-table rate, and seven-day
  start rate; faster creation must not produce unusable tables.
- **Experiment:** if traffic permits, compare the current CTA-before-Customize
  hierarchy with the prior ordering. Run until the predeclared sample and full
  weekday/weekend cycle are reached; do not stop on a transient lift.

### H2 — Staged customization reduces cognitive load without suppressing useful rules

- **Primary metric:** create completion among sessions that open Customize.
- **Diagnostics:** Customize-open rate and changed-control count.
- **Guardrails:** host-reported setup confidence and later restart/abandonment.
- **Usability evidence required:** participants can explain the default setup and
  find a requested rule without being shown where it lives.

### H3 — Explicit invite outcomes and rich previews increase successful joins

- **Primary metric:** `Room Joined / Invite Shared` at aggregate cohort level.
- **Diagnostics:** share cancellation/error, preview unavailable/missing, join
  authentication/rate-limit failures, and join role.
- **Experiment:** preview copy can be randomized server-side by deployment cohort;
  never encode the variant or table identity in the invitation URL.

### H4 — Dead-link recovery converts frustration into new hosts

- **Primary metric:** `Room Created` with source `dead-invite` per missing preview.
- **Diagnostics:** missing-invitation volume by viewport.
- **Experiment:** compare direct Create-your-table emphasis with a home-only
  recovery, while retaining a clear exit in both variants.

### H5 — Accountless host recovery prevents abandoned tables

- **Primary metric:** successful recovery or handoff after an attempted continuity
  action.
- **Diagnostics:** failure category and missing-session frequency.
- **Guardrails:** rate-limit volume, unauthorized recovery reports, and handoff
  reversals. Shared room passwords alone must never grant host authority.
- **Usability evidence required:** hosts understand that the backup is one-time,
  store it outside the room, and can deliberately hand control to a seated player.

### H6 — Truthful final-hand and clearer timed controls improve trust

- **Primary evidence:** task success and post-task confidence in moderated tests;
  this is a correctness change, not a conversion experiment.
- **Diagnostics:** live `Action Rejected` and support reports mentioning an
  unexpected deal, timeout, pot, or result.
- **Guardrails:** hand duration, accidental-action reports, and abandonment during
  handover.

### H7 — Visible results actions increase sharing and repeat hosting

- **Primary metrics:** results-share success and `Finish CTA / Finish CTA Impression`.
- **Downstream metric:** `Guest Became Host`, especially source `finished-table`.
- **Diagnostics:** initial action visibility, cancellation/error, action type,
  viewport, and host role.
- **Experiment:** compare action copy/order only after the correctness and viewport
  work is stable. Keep the poster and all exit routes available in every variant.

## Moderated usability sessions

Recruit 8–12 people in pairs or existing friend groups. Include at least four
people who have hosted a home game, four casual poker players, two people with
low poker familiarity, and participants who routinely use 320–390 px phones.
Do not reuse the same participant as both host and guest in the first run.

Run each session on a participant’s own phone when possible, plus one desktop
host session. Observe without teaching the interface.

1. Create a normal private table and invite the other participant.
2. Change one advanced rule, then return it to the default.
3. Join as a player; repeat once as a spectator.
4. Explain who can start, what the 20-second clock and 60-second bank do, and
   what happens when time expires.
5. Start and play several decisions, including a raise and a timed decision.
6. Call the last hand and predict what happens next.
7. Share the final table and choose either Play again or Create your table.
8. On a second device, recover host access with the password and one-time backup.
9. Transfer host authority to a seated player and verify the prior device loses
   host controls.
10. Open an expired invitation and recover without outside help.

Capture task completion, critical errors, assists, time on task, backtracks,
mis-taps, confidence (1–7), and a short single-ease question after each task.
Screen-record only with explicit consent; redact invitations and recovery codes.

## Interview prompts

- Before tapping, what do you expect this action to do?
- Which settings feel required before you can invite friends?
- What would make you hesitate to share this invitation?
- Who do you believe can see the table or watch the game?
- What do you think happens when the action clock reaches zero?
- What is the difference between the clock and time bank?
- If the host’s phone dies, what would you try first?
- What does “Finishing the night” tell you will happen next?
- Which result would you actually send to your group, and why?
- After this night, where would you expect to start the next one?
- What made this feel like a private home game—or unlike one?

## Release interpretation

Analyze mobile bands separately; aggregate desktop results can hide compact-phone
friction. Compare conversion by creation source and guest/host role. Treat event
loss as possible because analytics blockers are expected; use ratios only when
both numerator and denominator come from the same client-side collection path.
Product analytics can support a hypothesis, but only observed task behavior can
validate comprehension, trust, and cognitive load.
