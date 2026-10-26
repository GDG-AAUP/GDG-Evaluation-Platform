# Scorecard API additions (v2)

These are the exact frontend contracts, supplementing API_CONTRACT.md. The supplied mock implements these rules; a production server must implement them independently. The mock's public response omits emails/passwords. Never expose the raw database in a production response.

## Endpoints

| Method | Path | Request | Response / access |
| --- | --- | --- | --- |
| GET | `/ratings/targets` | none | `Identity[]` + nullable `total`; organizer/manager, restricted eligible targets |
| GET | `/ratings/:userId?month=YYYY-MM` | month defaults current | `Detail`; self or authorized evaluator |
| POST | `/ratings` | `{userId,month,scores,reason,expectedRev}` | saved `Scorecard`; authorized evaluator, current open month |
| GET | `/public/hall?campus=jenin&month=YYYY-MM` | public, no token | `Hall` |
| POST | `/awards` | `{campus,month,userId}` | `Winner`; organizer only; candidate must be a current group leader for that branch/month |
| GET | `/news` | none | `News[]` including drafts; organizer only |
| POST | `/news` | `{id?,title,body,status}` | upserted `News`; organizer only |

`Identity = {id,name,photo,campus,role,teamsLabel}`

`Scorecard = {id,targetId,month,scores:{cat1:0,...,cat15:0},total,core,rev,actor,ts,reason}`

`Detail = {user:Identity,month,current:Scorecard|null,history:[Scorecard+{actorName}],categories:[{id,label,max}],locked:boolean}`

`Hall = {campus,month,months:[{id,status}],groups:[{teamId,name,leader:{id,name,photo,total}|null}],winner:Winner|null,stale:boolean,ratedCount,memberCount,demo:boolean,news:[{id,title,body,date}]}`

`Winner = {userId,name,photo,total,teamId,teamName,campus,month,selectedBy,selectedAt}`

`News = {id,title,body,status:'draft'|'published',date:'YYYY-MM-DD'}`

## Validation and transactions

- Exactly 15 explicitly supplied integer scores. cat1–5 in 0..10; cat6–15 in 0..5. Reject blanks, missing/extra keys, out-of-range and fractional values. Server recomputes total/core; never trust supplied totals or maxima.
- Reason required (maximum 2,000 characters). `expectedRev` is the revision loaded by the dialog (0 if no card). Use a transaction/optimistic lock to reject stale saves with HTTP409. One effective scorecard per person/month; append revision history atomically.
- Authenticated active organizer can rate every active target except self, across both branches. Active manager can only rate active members of the same branch with a shared active team assigned to the manager. Members cannot rate. Check these rules server-side on every read/write, not merely via target list.
- Month must exist and be current/open to rate. Scorecards cannot be edited after closure. Persist scorecard snapshots when closing the month. Keep original legacy ledger data independent.
- News title: nonblank, max160; body: nonblank, max3000; draft/published. Render as text, never raw HTML.
- Existing create/update-user endpoints now accept `photo`; user/leaderboard views return it. Demo accepts JPEG/PNG/WebP base64 data URLs up to180,000 characters. Production should decode/validate images and store safely in object storage. A square320px JPEG is produced by the upload UI.
- A current award uses live name/photo/score and is hidden as stale if its chosen member is no longer a group leader. An archived award preserves its selected snapshot. Choose from four active groups of the branch; original team management remains available.
- Global ranking deduplicates members in multiple teams; team chart totals count memberships. Only member roles enter rankings/awards. Unrated members are excluded; explicitly scored zero remains valid.
- Rank by total DESC, core DESC, current revision timestamp ASC, Arabic name ASC, id ASC. Legacy snapshots lack core and retain the old totals.

## Existing response changes

`/leaderboard` rows add `photo`, `core`, `kind` (`scorecard` or `legacy`). `/points/mine` adds `scorecard` and `legacyTotal`; current `total` is scorecard total or null. Positive/negative fields still describe the legacy ledger. `/overview.pointsAdded` now means sum of latest active-member scorecard totals. `/overview.perTeam[].points` and `/teams/:id/overview` use current scorecards, not old entries. The old administrative manager evaluation is separate and unchanged.

## Synchronization

The mock broadcasts localStorage changes across tabs and refreshes subscribed views. Production APIs need shared persistence and polling/SSE/WebSocket invalidation to deliver the same behavior across devices. All endpoints return Arabic error messages in `{message,details?}` with 400/401/403/404/409 as applicable. No real backend is included or implied by this document.
