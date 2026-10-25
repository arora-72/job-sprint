# Changelog

Changes to Job Sprint are recorded here. The initial Git snapshot is `v1.0.0`. Earlier work is summarized below because it predates version control.

## Unreleased

### Owners

- Every job and company has an **owner**: Garima, Indresh, or Unassigned. A small pill under the title shows it, and clicking the pill opens a menu to reassign with a six-second Undo.
- A new job belongs to whoever adds it, including jobs added from Discover. New companies start Unassigned unless you pick an owner in the popup.
- An **Owner** filter bar (Everyone, Garima, Indresh, Unassigned) narrows the list, the tab counts and the dashboard tiles together. It remembers your choice in that browser.
- Owner is separate from "applied by". The owner is who is responsible, and applied-by is who clicked Applied.
- Run `supabase/assign.sql` once before deploying. It saves a backup of the jobs table, adds an owner column to jobs and companies, and sets existing jobs to whoever added them.

### Notes in Discover

- Every Discover role has a notes button and a latest-note preview, same as jobs. When you click **Add to Pipeline**, the notes move onto the new job.
- Run `supabase/discover-notes.sql` once before deploying. It adds one column to `discover_jobs` and changes nothing else.

### Delete

- Every job and company row has a **⋯** menu with **Delete**. On desktop, right-clicking a row opens the same menu. Right-clicking a link or field still shows the browser's own menu.
- Delete needs two clicks, removes the entry for both of you, then shows a six-second **Undo** that puts it back exactly as it was, including notes, people and networking status.
- No database change.

### LinkedIn quick copy

- A **Copy LinkedIn** button sits in the top bar. One click copies your link. The first click asks you to save it, and the pencil edits it later. Each person's link is saved per name, in that browser.

### Companies

- New **Companies** tab for tracking companies you want to work at. The **+ Track company** popup takes the company (required), a source (LinkedIn, Referral, Event, Career page, or your own), the people to reach out to (name, role, link), and remarks.
- Each company has a stage (Watching, Reached out, In conversation, Referral secured) and each person has an outreach status (Not contacted, Messaged, Replied). Companies with no activity for 7+ days rise to a "Needs a nudge" group.
- A side panel holds the people list and a running notes log, same as job notes.
- Jobs at a tracked company show a **Tracked · N contacts** badge. Matching ignores case, punctuation and suffixes like Inc.
- Run `supabase/companies.sql` once before deploying. It adds one new table and leaves the jobs table alone.

### Celebration

- Clicking **Applied** now fires a short confetti burst. The 1st, 3rd, 5th and 10th application of the day get a bigger burst and a cheer in the toast. Users with reduced-motion turned on see no animation.

### Networking stage

- Marking a job **Applied** now moves it to a new **Networking** tab instead of History. Each job there has a status: Not networked, 1st pass done, 2nd pass done, Successful, or Stale. Changing it is one click from a dropdown, with a six-second Undo.
- **Done → History** closes a networking job and keeps its last status as the outcome. Jobs marked Successful or Stale are grouped under *Ready to close* with Done highlighted.
- Networking is grouped by status, longest-waiting first. A days-since badge turns amber after five days without a networking update.
- Added a fifth dashboard tile, **Networking**, with counts of jobs not started, needing a nudge, and ready to close.
- **History** shows each job's outcome (Successful, Stale, Blocked, or the status it was closed at) with filters. **Move back** returns closed jobs to Networking and blocked jobs to To apply.
- Jobs already marked Applied before this change start in Networking as Not networked.

### Notes

- Every job in To apply, Networking, and History has a running notes log. Each note records who wrote it and when. The latest note previews on the row, and links in notes are clickable.
- Notes open in a side panel (a bottom sheet on phones). Enter saves, Shift+Enter adds a line, and deleting takes two clicks.

### Other

- Tabs are now ordered To apply, Networking, History, Discover. On phones they scroll sideways with a fade at the edge.
- Duplicate-link warnings say which tab the existing job is in.
- Database: `supabase/networking.sql` adds networking and notes columns to `public.jobs` (additive, with a backup copy first). No new tables.

## 1.0.0 — 2026-10-24

### Shared pipeline (V1)

- Added the Garima/Indresh chooser, shared pipeline, job-link parser with editable company, role, and location, and Applied/Blocked actions with attributed History.
- Kept Supabase credentials in Netlify server functions and published the app on Netlify.

### Dashboard (V2)

- Added daily and backlog counts, filters, an undo option for status changes, duplicate-link warnings, and a responsive light/dark interface.

### Discover

- Added a review inbox for Garima's S- and A-tier matches, with fit reasons, scores, source links, and Add to Pipeline/Dismiss actions.
- Added duplicate suppression against Pipeline and History and a protected import endpoint in the same Supabase project.
- Moved the tier to a prominent right-side card and displayed scores in a circular progress gauge. Scores of 90 or higher are green.
- Limited automatic database refreshes to once every 10 minutes while visible; added manual and post-action refreshes and a last-refreshed indicator.
