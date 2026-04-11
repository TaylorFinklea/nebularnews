import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbAll, dbGet, dbRun } from '../db/helpers';

export const onboardingRoutes = new Hono<AppEnv>();

interface FeedSuggestion {
  url: string;
  title: string;
  description: string;
  category: string;
  iconUrl?: string;
}

const FEED_CATALOG: FeedSuggestion[] = [
  // Technology
  { url: 'https://feeds.arstechnica.com/arstechnica/index', title: 'Ars Technica', description: 'In-depth technology news and analysis', category: 'Technology' },
  { url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge', description: 'Technology, science, art, and culture', category: 'Technology' },
  { url: 'https://techcrunch.com/feed/', title: 'TechCrunch', description: 'Startup and technology news', category: 'Technology' },
  { url: 'https://hnrss.org/frontpage', title: 'Hacker News', description: 'Top stories from Hacker News', category: 'Technology' },
  // AI & ML
  { url: 'https://www.deeplearning.ai/the-batch/feed/', title: 'The Batch', description: 'Weekly AI newsletter by Andrew Ng', category: 'AI & ML' },
  { url: 'https://www.anthropic.com/feed.xml', title: 'Anthropic Blog', description: 'AI safety research and updates', category: 'AI & ML' },
  { url: 'https://openai.com/blog/rss/', title: 'OpenAI Blog', description: 'Research and product updates from OpenAI', category: 'AI & ML' },
  { url: 'https://blog.google/technology/ai/rss/', title: 'Google AI Blog', description: 'AI research and developments from Google', category: 'AI & ML' },
  // Science
  { url: 'https://www.nature.com/nature.rss', title: 'Nature', description: 'International journal of science', category: 'Science' },
  { url: 'https://www.sciencedaily.com/rss/all.xml', title: 'Science Daily', description: 'Breaking science news and research', category: 'Science' },
  { url: 'https://api.quantamagazine.org/feed/', title: 'Quanta Magazine', description: 'Illuminating math, physics, and computer science', category: 'Science' },
  // News
  { url: 'https://feeds.reuters.com/reuters/topNews', title: 'Reuters', description: 'International news wire service', category: 'News' },
  { url: 'https://feeds.apnews.com/rss/apf-topnews', title: 'AP News', description: 'Breaking news from the Associated Press', category: 'News' },
  { url: 'https://feeds.bbci.co.uk/news/rss.xml', title: 'BBC News', description: 'World news from the BBC', category: 'News' },
  // Developer
  { url: 'https://github.blog/feed/', title: 'GitHub Blog', description: 'Updates from the GitHub platform', category: 'Developer' },
  { url: 'https://dev.to/feed', title: 'Dev.to', description: 'Community-driven developer content', category: 'Developer' },
  { url: 'https://changelog.com/feed', title: 'Changelog', description: 'News and podcasts for developers', category: 'Developer' },
];

interface SubscribedFeed {
  feed_url: string;
}

interface ExistingFeed {
  id: string;
  url: string;
}

onboardingRoutes.get('/onboarding/suggestions', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');

  const subscribed = await dbAll<SubscribedFeed>(
    db,
    `SELECT f.url as feed_url FROM user_feed_subscriptions ufs
     JOIN feeds f ON f.id = ufs.feed_id
     WHERE ufs.user_id = ?`,
    [userId],
  );

  const subscribedUrls = new Set(subscribed.map((s: SubscribedFeed) => s.feed_url));

  const categoryIcons: Record<string, string> = {
    'Technology': 'cpu',
    'AI & ML': 'brain',
    'Science': 'flask',
    'News': 'newspaper',
    'Developer': 'chevron.left.forwardslash.chevron.right',
  };

  const grouped = new Map<string, { url: string; title: string; description: string | null; siteUrl: string | null }[]>();
  for (const feed of FEED_CATALOG) {
    const list = grouped.get(feed.category) ?? [];
    list.push({ url: feed.url, title: feed.title, description: feed.description, siteUrl: null });
    grouped.set(feed.category, list);
  }

  const categories = [...grouped.entries()].map(([name, feeds]) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    icon: categoryIcons[name] ?? 'folder',
    feeds,
  }));

  return c.json({ ok: true, data: { categories } });
});

onboardingRoutes.post('/onboarding/bulk-subscribe', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const { feedUrls } = await c.req.json<{ feedUrls: string[] }>();

  if (!Array.isArray(feedUrls) || feedUrls.length === 0) {
    return c.json({ ok: false, error: 'feedUrls array is required' }, 400);
  }

  let newCount = 0;
  const now = Date.now();

  for (const url of feedUrls) {
    let feed = await dbGet<ExistingFeed>(
      db,
      'SELECT id, url FROM feeds WHERE url = ?',
      [url],
    );

    if (!feed) {
      const feedId = nanoid();
      const catalogEntry = FEED_CATALOG.find((f) => f.url === url);
      await dbRun(
        db,
        'INSERT INTO feeds (id, url, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [feedId, url, catalogEntry?.title ?? url, now, now],
      );
      feed = { id: feedId, url };
    }

    const existing = await dbGet<{ id: string }>(
      db,
      'SELECT id FROM user_feed_subscriptions WHERE user_id = ? AND feed_id = ?',
      [userId, feed.id],
    );

    if (!existing) {
      await dbRun(
        db,
        'INSERT INTO user_feed_subscriptions (id, user_id, feed_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [nanoid(), userId, feed.id, now, now],
      );
      newCount++;
    }
  }

  return c.json({ ok: true, data: { subscribed: newCount } });
});
