export interface OnboardingFeed {
  url: string;
  title: string;
  description: string;
  siteUrl: string;
}

export interface OnboardingCategory {
  id: string;
  name: string;
  icon: string;
  feeds: OnboardingFeed[];
}

export function getOnboardingCatalog(): { categories: OnboardingCategory[] } {
  return {
    categories: [
      {
        id: 'tech',
        name: 'Technology',
        icon: 'cpu',
        feeds: [
          { url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', title: 'Ars Technica', description: 'Original reporting on technology and science', siteUrl: 'https://arstechnica.com' },
          { url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge', description: 'Technology, science, art, and culture', siteUrl: 'https://www.theverge.com' },
          { url: 'https://hnrss.org/frontpage', title: 'Hacker News', description: 'Top stories from Hacker News', siteUrl: 'https://news.ycombinator.com' },
          { url: 'https://techcrunch.com/feed/', title: 'TechCrunch', description: 'Startup and technology news', siteUrl: 'https://techcrunch.com' },
          { url: 'https://www.wired.com/feed/rss', title: 'Wired', description: 'The latest in technology and culture', siteUrl: 'https://www.wired.com' }
        ]
      },
      {
        id: 'science',
        name: 'Science',
        icon: 'flask',
        feeds: [
          { url: 'https://www.nature.com/nature.rss', title: 'Nature', description: 'International journal of science', siteUrl: 'https://www.nature.com' },
          { url: 'https://www.quantamagazine.org/feed', title: 'Quanta Magazine', description: 'Illuminating science and mathematics', siteUrl: 'https://www.quantamagazine.org' },
          { url: 'https://www.sciencedaily.com/rss/all.xml', title: 'Science Daily', description: 'Breaking science news and research', siteUrl: 'https://www.sciencedaily.com' },
          { url: 'https://www.newscientist.com/section/news/feed/', title: 'New Scientist', description: 'Science and technology news', siteUrl: 'https://www.newscientist.com' }
        ]
      },
      {
        id: 'business',
        name: 'Business & Finance',
        icon: 'briefcase',
        feeds: [
          { url: 'https://feeds.reuters.com/reuters/businessNews', title: 'Reuters Business', description: 'Global business and financial news', siteUrl: 'https://www.reuters.com/business' },
          { url: 'https://feeds.bloomberg.com/markets/news.rss', title: 'Bloomberg Markets', description: 'Financial markets and investing', siteUrl: 'https://www.bloomberg.com/markets' },
          { url: 'https://www.ft.com/?format=rss', title: 'Financial Times', description: 'International business and finance', siteUrl: 'https://www.ft.com' }
        ]
      },
      {
        id: 'world',
        name: 'World News',
        icon: 'globe',
        feeds: [
          { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', title: 'BBC World', description: 'World news from the BBC', siteUrl: 'https://www.bbc.com/news/world' },
          { url: 'https://feeds.reuters.com/Reuters/worldNews', title: 'Reuters World', description: 'Top world news stories', siteUrl: 'https://www.reuters.com/world' },
          { url: 'https://rss.app/feeds/apnews-top-news.xml', title: 'Associated Press', description: 'Breaking news from AP', siteUrl: 'https://apnews.com' },
          { url: 'https://www.aljazeera.com/xml/rss/all.xml', title: 'Al Jazeera', description: 'News and current affairs', siteUrl: 'https://www.aljazeera.com' }
        ]
      },
      {
        id: 'programming',
        name: 'Programming',
        icon: 'code',
        feeds: [
          { url: 'https://lobste.rs/rss', title: 'Lobsters', description: 'Computing-focused link aggregation', siteUrl: 'https://lobste.rs' },
          { url: 'https://jvns.ca/atom.xml', title: 'Julia Evans', description: 'Making hard things easy with comics and writing', siteUrl: 'https://jvns.ca' },
          { url: 'https://simonwillison.net/atom/everything/', title: 'Simon Willison', description: 'Web development, AI, and open data', siteUrl: 'https://simonwillison.net' },
          { url: 'https://changelog.com/feed', title: 'Changelog', description: 'Open source and software development', siteUrl: 'https://changelog.com' },
          { url: 'https://danluu.com/atom.xml', title: 'Dan Luu', description: 'Programming, hardware, and decision making', siteUrl: 'https://danluu.com' }
        ]
      },
      {
        id: 'design',
        name: 'Design & Product',
        icon: 'palette',
        feeds: [
          { url: 'https://www.smashingmagazine.com/feed/', title: 'Smashing Magazine', description: 'Web design and development articles', siteUrl: 'https://www.smashingmagazine.com' },
          { url: 'https://alistapart.com/main/feed/', title: 'A List Apart', description: 'Web design, development, and content', siteUrl: 'https://alistapart.com' },
          { url: 'https://www.nngroup.com/feed/rss/', title: 'Nielsen Norman Group', description: 'UX research and usability', siteUrl: 'https://www.nngroup.com' }
        ]
      },
      {
        id: 'ai',
        name: 'AI & Machine Learning',
        icon: 'sparkles',
        feeds: [
          { url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', title: 'MIT Tech Review AI', description: 'AI coverage from MIT Technology Review', siteUrl: 'https://www.technologyreview.com/topic/artificial-intelligence/' },
          { url: 'https://huggingface.co/blog/feed.xml', title: 'Hugging Face Blog', description: 'Open-source ML models and research', siteUrl: 'https://huggingface.co/blog' },
          { url: 'https://lilianweng.github.io/index.xml', title: "Lil'Log", description: 'In-depth ML and AI research posts', siteUrl: 'https://lilianweng.github.io' }
        ]
      }
    ]
  };
}
