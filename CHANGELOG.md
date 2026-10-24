# Changelog

Changes to Job Sprint are recorded here. The initial Git snapshot is `v1.0.0`. Earlier work is summarized below because it predates version control.

## Unreleased

Add future changes here before publishing the next version.

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
