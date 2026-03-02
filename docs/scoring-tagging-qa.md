# Scoring And Tagging QA

Use this between scoring and tagging iterations so regressions stay localized.

## TODO

- Fix the repo-wide `npm run check` typing backlog so `svelte-check` can become a real release gate again.
- Focus first on the broad `platform.env`, `locals`, and `unknown` response-body errors across server routes and shared helpers.

## SQL checks

Score distribution:

```sh
npx wrangler d1 execute nebularnews-prod --local --command \
  "SELECT scoring_method, score_status, score, COUNT(*) AS count
   FROM article_scores
   GROUP BY scoring_method, score_status, score
   ORDER BY scoring_method, score_status, score;"
```

Tag counts by source:

```sh
npx wrangler d1 execute nebularnews-prod --local --command \
  "SELECT source, COUNT(*) AS count
   FROM article_tags
   GROUP BY source
   ORDER BY source;"
```

## Browser smoke path

1. Open `http://localhost:5173/articles`
2. Confirm the list renders score pills without layout regressions
3. Confirm a known `ready` article still shows a numeric fit pill like `3/5`
4. Confirm a known `insufficient_signal` article shows `Learning` instead of a numeric score
5. Open one article detail page with a ready score
6. Confirm the numeric detail score banner still renders
7. Open one article detail page with an insufficient-signal score
8. Confirm the inline learning banner renders with the guidance copy
9. Open `http://localhost:5173/settings`
10. Confirm the `Tagging engine` control renders and the `Scoring QA` summary block is visible

## Deterministic tagging smoke path

1. Pick an untagged article with an obvious keyword match to an existing canonical tag
2. Requeue `auto_tag` for that article
3. Run the dev jobs handler
4. Confirm a `source='system'` row was added in `article_tags`
5. Confirm a score job was enqueued and then completed for the same article
6. Confirm the article detail page now shows the new tag

## Low-signal score smoke path

1. Use an article with very little preference-backed data
2. Requeue `score` after tagging or reaction changes
3. Confirm the latest `article_scores` row has `score_status = 'insufficient_signal'`
4. Confirm the article list treats it like an unscored item for filter/sort purposes
5. Confirm the detail page shows `Learning your preferences` instead of a numeric score

## Hybrid tagging fallback smoke path

1. Set `Tagging engine` to `Hybrid (algorithmic + AI)` in Settings
2. Requeue `auto_tag` for one article while no provider key is configured
3. Confirm the job completes without failing
4. Confirm deterministic `system` tags can still be written
5. Confirm no AI-only failure is required for the job to finish

## Detail reaction smoke path

1. Open one article detail page
2. Save a thumbs up or thumbs down with reason chips
3. Reopen the same reaction and confirm the saved reasons are preselected
4. Edit only the reasons and confirm the save succeeds
5. Confirm the reaction still renders and no new score-learning side effect is triggered from a same-value reason edit

## List reaction smoke path

1. On `/articles`, click a thumbs up or thumbs down button
2. Confirm the reason dialog opens before the reaction is saved
3. Use `Skip` once and confirm the active state updates correctly
4. Reopen the active reaction and confirm previous reasons are preselected when they exist
5. Cancel the dialog and confirm the prior reaction state is unchanged

## Browser console note

Ignore unrelated existing CSP/image noise from external `http:` assets unless the page itself fails to render or a changed feature breaks.

## Comparison target

For each rollout, keep one known `ready` article and one known `insufficient_signal` article handy so UI comparisons are deterministic.

## Rerun path

Requeue score and tag jobs for one article:

If you call this route directly from `curl`, include auth/session and CSRF headers from a real dev session. The example below shows only the request body shape.

```sh
curl -s -X POST "http://localhost:5173/api/articles/ARTICLE_ID/rerun" \
  -H "content-type: application/json" \
  --data '{"types":["score","auto_tag"]}'
```

## Signal inspection

Inspect one article's signal breakdown:

```sh
npx wrangler d1 execute nebularnews-prod --local --command \
  "SELECT signal_name, raw_value, normalized_value
   FROM article_signal_scores
   WHERE article_id = 'ARTICLE_ID'
   ORDER BY signal_name;"
```
