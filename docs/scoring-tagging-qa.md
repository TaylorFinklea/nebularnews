# Scoring And Tagging QA

Use this between scoring and tagging iterations so regressions stay localized.

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
2. Confirm the list renders score pills and tag chips without console errors
3. Open one article detail page
4. Confirm the detail score banner or learning state renders

## Rerun path

Requeue score and tag jobs for one article:

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
