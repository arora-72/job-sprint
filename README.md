# Job Sprint

A shared, mobile-friendly job pipeline for Garima and Indresh.

## Current deployment

- **Site:** https://arora-72.github.io/job-sprint/ (GitHub Pages). Every push to `main` that touches `public/` publishes automatically (`.github/workflows/pages.yml`).
- **Server code:** Supabase Edge Functions in `supabase/functions/` (`jobs`, `companies`, `discover`, `todos`, `parse-job`), served at `https://tuggvixzrgbqagqrrkey.supabase.co/functions/v1/<name>`. They use the project's own server key, which Supabase provides to functions automatically; no key is stored in this repository.
- **Database:** the same Supabase project. The browser never reads tables directly; it only calls the functions.
- The publishable key in `public/app.js` is meant to be public. It identifies the project and gives no table access.
- The old Netlify site (`jobsprint-shared-v1.netlify.app`) stays on its last build and is no longer updated.

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
- The protected `PUT /functions/v1/discover` endpoint accepts batches of 1–30 S/A roles with a `Bearer` token from the `DISCOVER_INGEST_TOKEN` function secret (not set at the moment, so the endpoint refuses imports). New roles are imported through the Supabase SQL Editor instead. Regular visitors can only review, add, or dismiss matches through the public site.
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

### 2. Deploy the server functions

Deploy each folder in `supabase/functions/` as an Edge Function with JWT verification turned off (the functions are public, like the site). With the Supabase CLI: `supabase functions deploy jobs --no-verify-jwt`, and the same for `companies`, `discover`, `todos` and `parse-job`. The protected Discover import (`PUT /discover`) only works if you also set a `DISCOVER_INGEST_TOKEN` secret; otherwise it refuses every import.

### 3. Publish the site

In the GitHub repository, open **Settings → Pages** and set the source to **GitHub Actions**. The workflow publishes `public/` on every push to `main`. If you fork this to another account, update `ALLOWED_ORIGINS` in `supabase/functions/_shared/serve.js` and the project URL and publishable key at the top of the API section in `public/app.js`.

### 4. Use it

Open the URL → choose **Garima** or **Indresh** → paste a job link → save.

## Version control

The first Git version is the current working app (`v1.0.0`). Earlier V1, dashboard, and Discover changes are summarized in [CHANGELOG.md](CHANGELOG.md); they were built before Git tracking began and therefore do not have individual historical commits.

For each future change, update `CHANGELOG.md`, run `npm test`, then commit and push. Pushing to `main` publishes the site; server changes also need the changed functions redeployed. To try the site locally, run `npm run serve` and open http://localhost:8080 (it talks to the live functions).

## Notes about parsing

The parser first looks for standard `JobPosting` JSON-LD data, which many career sites expose. If it cannot read the page or the site blocks automated requests, the UI falls back to editable Company / Role / Location fields so the job can still be saved.

## Security note

V2 is designed for two-person personal use. The Supabase secret key stays server-side and the database is not directly readable from the browser. The functions only answer browsers on the GitHub Pages site (CORS), and the page sets a Content-Security-Policy. The public site itself has no password/login yet. The name chooser is attribution, not authentication. If you want stronger access control later, add authentication or a site-level password.
