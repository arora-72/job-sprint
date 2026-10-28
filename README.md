# Job Sprint

A shared, mobile-friendly job pipeline for Garima and Indresh.

## Current deployment

- The public site is hosted on Netlify, with its database in Supabase. Keep project links and account details in your password manager or private notes.
- Netlify environment variables: `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the secret value is stored in Netlify, not in this source archive).
- Discover import variable: `DISCOVER_INGEST_TOKEN`, stored as a Netlify secret for production functions.
- Keep the Supabase database password in your password manager. It is not included here.

This site is public and has no login. The name chooser records who an action is
attributed to; it does not verify that person's identity. Anyone with the URL
can view and change the shared jobs.

## What the app does

- Asks **Garima or Indresh?** on first use and remembers the choice in that browser.
- Pasting a job URL starts parsing immediately. The server suggests company, role, and location without an AI API; all suggestions are editable before saving.
- Warns about an existing job URL after removing common tracking parameters. Saving anyway is allowed.
- Shows counts and filters for open jobs, applications today, open jobs added today, and older open jobs.
- Groups open jobs into Backlog and Added today. Pipeline and Discover refresh on first load, after successful actions, when manually refreshed, and at most once every 10 minutes while visible. Returning to the tab only refreshes when the last attempt is at least 10 minutes old. The header shows the last successful refresh time.
- **Open**, **Applied**, and **Block** actions; the last two show a six-second Undo. Blocking supports a custom or one-click reason.
- **Applied** moves a job to **Networking**, where it carries a status (Not networked, 1st pass done, 2nd pass done, Successful, Stale). **Done → History** closes it with that status as the outcome.
- Blocked jobs and closed networking jobs appear in **History**, with attribution, timestamps, and outcome filters. **Move back** returns a closed job to Networking and a blocked job to To apply.
- Every job has a running **notes** log (who and when for each note).
- Uses a warm cream and clay theme, with a header button for dark mode. It follows the device setting until a choice is made, then remembers that choice in the browser.
- No PDF upload or analytics graphs yet.

## Discover

- **Discover** is a separate review inbox for Garima's S- and A-tier role matches. It shows the company, title, location, score/tier, a short fit reason, date found, and official job link.
- **Add to Pipeline** creates a normal job in `public.jobs` and records who added it. **Dismiss** hides a match and records who dismissed it.
- Matches already in Pipeline or History are hidden by normalized job URL. Repeated imports update role details without resetting an existing Added or Dismissed decision.
- Initial match data is kept outside this repository because it contains candidate-specific fit notes. New matches can be imported without committing personal data.
- The new table is `public.discover_jobs` in the **same Supabase project**. Its migration is `supabase/discover.sql`.
- The protected `PUT /.netlify/functions/discover` endpoint accepts batches of 1–30 S/A roles with a `Bearer` token from `DISCOVER_INGEST_TOKEN`. The key stays on the server. Regular visitors can only review, add, or dismiss matches through the public site.
- The watch chats do not expose a machine-readable tracker link in their messages. Until the pipeline source is connected, new watch results need to be imported; the existing seven matches are live now.
- To prepare another import through Supabase SQL Editor, save a local JSON array of matches, then run `node scripts/prepare-discover-import.cjs input.json output.sql`. Keep the input and generated SQL outside this repository. The generated upsert preserves Added and Dismissed status.

## Free deployment setup

### 1. Create a free Supabase project

Open Supabase, create a project, then open **SQL Editor** and run the contents of `supabase/schema.sql`.
For Discover, also run `supabase/discover.sql` in the same project. For the Networking stage and notes, run `supabase/networking.sql`. For tracked companies, run `supabase/companies.sql`. For notes on Discover roles, run `supabase/discover-notes.sql`. For owners, run `supabase/assign.sql`. For the to-do lists, run `supabase/todos.sql`. For the Priority order on To apply, run `supabase/priority.sql`. All eight are safe to re-run.

From **Project Settings → API**, copy:
- Project URL → `SUPABASE_URL`
- Secret API key → `SUPABASE_SECRET_KEY`

Keep the secret key private. It is only used by server-side functions.

### 2. Deploy this folder to Netlify

Create a free Netlify site from this folder/repository. The public files are
in `public/`; Netlify Functions are in `netlify/functions/`.

In **Site configuration → Environment variables**, add:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `DISCOVER_INGEST_TOKEN` (a randomly generated value marked **Contains secret values**, needed only for the protected import endpoint)

Deploy. Netlify will give you one public URL to share.

The current site was deployed with the Netlify CLI and is not connected to a Git repository. After linking this folder to the existing Netlify project, publish updates with `netlify deploy --prod --dir=public --functions=netlify/functions --context production`.

### 3. Use it

Open the URL → choose **Garima** or **Indresh** → paste a job link → save.

## Version control

The first Git version is the current working app (`v1.0.0`). Earlier V1, dashboard, and Discover changes are summarized in [CHANGELOG.md](CHANGELOG.md); they were built before Git tracking began and therefore do not have individual historical commits.

For each future change, update `CHANGELOG.md`, run `node --test tests/*.test.cjs`, then commit and push the code. Give each release a version in `package.json` and a matching Git tag (for example, `v1.1.0`). The repository is separate from the live Netlify site until Git-based deployment is connected there; pushing a commit alone does not change the public app.

## Notes about parsing

The parser first looks for standard `JobPosting` JSON-LD data, which many career sites expose. If it cannot read the page or the site blocks automated requests, the UI falls back to editable Company / Role / Location fields so the job can still be saved.

## Security note

V2 is designed for two-person personal use. The Supabase secret key stays server-side and the database is not directly readable from the browser. The public site itself has no password/login yet. The name chooser is attribution, not authentication. If you want stronger access control later, add authentication or a site-level password.
