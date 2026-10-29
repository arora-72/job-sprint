# Changelog

Changes to Job Sprint are recorded here. The initial Git snapshot is `v1.0.0`. Earlier work is summarized below because it predates version control.

## Unreleased

### Analytics tab + outcomes

- New **Analytics** tab. Goal: **5 applications a day each**, Monday to Friday (weekends count as a bonus).
  - **Today**: a goal ring per person ("3/5 · 2 to go"). Hitting 5 rings a confetti moment.
  - **This week**: team total vs the weekly goal, change vs the same point last week, and goal days per person.
  - **Streak**: days in a row each person applied, with personal best. Weekends never break it.
  - **Milestones**: total applications together, progress to the next milestone (10, 25, 50, 100…), best day and best week. Crossing a milestone celebrates.
  - **Today & yesterday**: who applied where, as company chips. Click one to jump to that job.
  - **Last 30 days**: a bar chart per person with the goal line; solid bars hit the goal, weekends shaded. Hover any bar for the day's numbers.
  - **Consistency**: a 16-week calendar heatmap for the team, plus which weekday you apply most.
  - **Pipeline health**: added vs cleared in the last 4 weeks, open jobs by age, jobs on hold, and how long To apply takes to clear at your pace.
  - **Networking follow-through**: share of applications networked and how many are waiting 5+ days, with a button to go nudge them.
  - **Funnel**: Added → Applied → Networked → Interview → Offer, with conversion at each step.
  - **Which resume works**: interviews per resume sent (rates show after 5 sends).
  - **What you're applying to**: applications by role type, and the top reasons jobs got blocked.
- **Outcomes**: on Networking and History rows, ⋯ → **Set outcome**: Got an interview, Got an offer, Rejected, I withdrew. A badge shows on the row (click it to change); interviews and offers celebrate. "Rejected after interview" is tracked. Undo restores the exact previous outcome.
- Database: outcome columns on jobs (`supabase/outcomes.sql`), with a backup of jobs first (`backup.jobs_before_outcomes`).

### PDFs: files on jobs + Resumes tab

- New **Resumes** tab (after Companies) for your standard resumes. **+ Upload resume** (or drop a PDF on the tab), name it, and pick the role it's for: Chief of Staff, Operations Management, BizOps, Strategy & Operations, Product Ops, or your own. Resumes are grouped by role. Star one per role as the **go-to**. Open, Download, Rename or replace, and Delete (with Undo). Each resume shows how many jobs it was sent for.
- Every job's notes panel is now **Notes & files**. Pick the **Resume sent** from your library, and attach PDFs (cover letter, JD, offer) by dropping them in or browsing. You can also drop a PDF straight onto a job row.
- The notes button on each row shows a 📎 count when a job has files.
- Files are PDFs up to 10 MB, kept in a private Supabase Storage bucket. The page only gets short-lived links (10 minutes) to view or upload one file. Deleted files can be undone for a day, then they're removed.
- Database: new `documents` table, a `resume_id` column on jobs, and the private `documents` bucket (`supabase/files.sql`), with a backup of jobs first (`backup.jobs_before_files`). New server function: `files`.

### Tidier rows

- On tablets and smaller laptops (721–1000 px wide), the company keeps its own column instead of moving under the role.
- The "On hold: …" note no longer repeats under the hold pill.
- Long multi-city locations stay on one line; hover to see all of them.
- Tabs stay on one line and scroll sideways when space runs out. "Last refreshed" hides below 1180 px (the refresh button stays).

### On hold (To apply)

- Put a To apply job **on hold** when you're waiting on something before applying: ⋯ → **Put on hold…**, then pick *Asked for referral*, *Coffee chats in progress*, *Waiting on contact*, or type your own reason. The reason is also logged in the job's notes.
- The job stays in the same list and keeps its priority spot. The row turns soft yellow with an amber edge and a pill: "On hold · reason · 1d". After **2 days** the pill turns solid amber and says "follow up?".
- **Resume** replaces Block on held rows (Block moves to ⋯). Clicking the pill changes the reason or resumes. Clicking **Applied** moves it to Networking as usual. Hold, Resume and reason changes all have Undo.
- An **On hold** chip next to the owner filter shows only held jobs, longest waiting first.
- The Backlog tile no longer counts held jobs as overdue and shows "· N on hold" instead.
- Database: three new columns on jobs (`supabase/hold.sql`), with a backup first (`backup.jobs_before_hold`).

### Tag jobs in to-dos

- Type **@** in the to-do box to tag a job or company. A dropdown suggests matches by role or company as you type (open roles first), with the tab each one is in. Arrow keys + Enter or Tab, or click, to pick. The @text is removed and the job shows as a chip.
- Auto-spot: if the to-do mentions a company you have (for example "Prep for Anduril chat"), a hint offers **Link to Anduril · Chief of Staff?** One click links it, × ignores it. If there are more roles at that company, the hint says so; use @ to pick a different one.
- Clicking a tagged job or company in a to-do now **jumps to its row**: the panel closes, the right tab opens, filters and search clear if they would hide it, and the row flashes. A small ↗ on job chips opens the posting.
- Job chips now read "Company · Role". All matching runs in the browser on data already loaded: no AI, no extra requests.
- Front-end only. No database change.

### Search

- A search box sits at the top of the list. Type a role, a company, a location (or a tracked contact's name) and every tab is searched at once. Several words narrow the results, so `ops lead faire` finds the BizOps Lead role at Faire.
- Results appear as normal rows, grouped by where they live (To apply, Networking, History, Companies, Discover), with the matching text highlighted. Applied, Block, notes and the ⋯ menu all work from the results.
- Case and punctuation are ignored. A result count shows next to the box. Press **Esc** or **×** to clear, **Ctrl/⌘ + K** to jump to the box. Clicking a tab or a dashboard tile leaves search.
- Front-end only. No database change.

### Colour themes + theme picker

- Four colour themes, each with a light and a dark version: **Sunset** (new default), **Lagoon**, **Grape**, and **Classic** (the previous look). The new dark modes are softer and more colourful than the old near-black.
- The header theme button opens a picker: choose a colour theme (cards preview light and dark), and a mode: **Light**, **Dark** or **Auto** (follows the device). Each browser remembers its own choice, so you and Indresh can use different themes.
- Text and button colours pass a 4.5:1 contrast check in every theme and mode.
- Front-end only (`public/themes.css`). No database change.

### Moved off Netlify: GitHub Pages + Supabase Edge Functions

- The site now lives at **https://arora-72.github.io/job-sprint/** and publishes automatically on every push to `main`. No deploy command, no Netlify credits.
- The server code moved from Netlify Functions to Supabase Edge Functions (`supabase/functions/`). Same behaviour, same database, same checks. The functions only answer the GitHub Pages site.
- The page sets its own security rules (Content-Security-Policy, referrer policy), since GitHub Pages can't send headers.
- Removed the Netlify config and the Netlify CLI dependency. The old Netlify site stays up on its last build.

### Priority order on To apply

- To apply has a new switch: **Priority | Date added**. Priority is the default, and each browser remembers the last choice. Date added is the old view, unchanged.
- Priority view is one ranked list. Each row shows a drag handle (⠿) and its rank; the top 3 ranks are in clay. Drag with a mouse or a finger and a line shows where the row will land. The page scrolls when you drag near the edge.
- New jobs (pasted links and Discover adds) wait in a **To rank** group at the top until you drag them into place or use ⋯ → **Move to top**.
- ⋯ menu adds **Move to top** and **Move to bottom**, each with Undo. Keyboard: focus the handle and use the arrow keys.
- The owner filter shows each person's own order: pick Indresh to see his jobs numbered 1, 2, 3. Dragging there only changes his order; Garima's jobs keep their order.
- Applied, Undo, Delete and Undo keep a job's rank. Reordering doesn't change when a job was last updated.
- Existing open jobs start ranked in the Date added order (backlog oldest first, then today's newest first), so nothing looks scrambled.
- Database: new `priority` column on jobs (`supabase/priority.sql`), with a backup of the jobs table first (`backup.jobs_before_priority`).

### To-do lists

- New **To-do** button in the header opens a side panel (a bottom sheet on phones). Garima and Indresh each have their own list, with a switch at the top. It opens on yours.
- The count on the button is your open items. It turns clay when something on your list is due today or overdue.
- Type and press Enter to add. New items go to the top. Click the text to edit it.
- Tick an item: it strikes through, plays a soft tick (same mute button as the bell), then slides into **Done** with Undo. Done items show for 7 days, then drop off the list (they stay in the database). Untick to send an item back to the bottom of the list.
- Drag the ⠿ handle to reorder, with a mouse or a finger. Keyboard: focus the handle and use the arrow keys.
- The ⋯ menu (or right-click) sets a due date (Today, Tomorrow, or any date), moves the item to the other person's list, unlinks it, or deletes it with Undo.
- You can add to the other person's list. Those items show "from Garima" or "from Indresh".
- **Add to-do…** in a job's or company's ⋯ menu opens the panel with that company linked. The company chip on the item opens that job's or company's notes.
- On tablets the header buttons show icons only, and on phones the user pill shows just the circle, to make room.
- Database: new `todos` table (`supabase/todos.sql`). Existing tables are not touched.

### Bell on Applied

- Clicking **Applied** on a role rings a soft bell. The first application of the day, and the 3rd, 5th and 10th, ring a double strike to match the confetti milestones.
- The bell is synthesized in the browser (no audio file). It plays only from your click, and Undo is silent.
- A bell button in the header mutes or unmutes it; the choice is remembered per browser. Turning it on plays a quick test ping.
- Front-end only. No database change.

### Dark mode: Ink

- Dark mode moves from warm brown-grey to a deep navy-black ("Ink"), with clearer depth: darker page, lighter cards, and a faint top-edge highlight in place of heavy shadows.
- Per-row **Applied** and other row-level primary buttons become a soft clay outline in dark mode and fill solid on hover, so the main **Add** button is the one loud action.
- The Backlog card is a normal card with an amber edge and amber number, no brown fill. Block and Open are outline-only.
- Light mode is unchanged. No database change.

### Company at a glance

- Each job row has its own **company column** right before "Added", with a colored tile (initials) and the bold company name. The same company always gets the same tile color on every row and tab. Roles can use two lines.
- On tablets and phones there is no room for a column, so the company moves under the role with a small tile.
- Companies tab rows and Discover roles show the tile too.
- No database change.

### Owners

- Every job and company has an **owner**: Garima, Indresh, or Unassigned. A big profile circle at the left of each row shows it (G, I, or a dashed + when unassigned). Clicking the circle opens a menu to reassign, with a six-second Undo.
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
