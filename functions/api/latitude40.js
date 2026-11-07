
const FEED = 'https://rss.buzzsprout.com/1538629.rss';

function decode(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(xml, name) {
  const start = xml.indexOf('<' + name + '>');
  const end = xml.indexOf('</' + name + '>', start);
  if (start < 0 || end < 0) return '';
  return decode(xml.slice(start + name.length + 2, end));
}

export async function onRequestGet() {
  try {
    const response = await fetch(FEED);
    const xml = await response.text();

    const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)];

    const episodes = items.map((match, index) => {
      const item = match[1];
      const enclosure = item.match(/<enclosure\b[^>]*url=["']([^"']+)["']/i);
      const image = item.match(/<itunes:image\b[^>]*href=["']([^"']+)["']/i);

      return {
        id: String(index),
        title: tag(item, 'title'),
        url: tag(item, 'link'),
        date: tag(item, 'pubDate'),
        description: tag(item, 'description'),
        duration: tag(item, 'itunes:duration'),
        season: tag(item, 'itunes:season'),
        image: image?.[1] || '',
        audio: enclosure?.[1] || ''
      };
    });

    return Response.json({
      version: 'latitude40-debug-2',
      diagnostics: {
        feedStatus: response.status,
        xmlLength: xml.length,
        itemCount: items.length,
        episodeCount: episodes.length,
        looksLikeRSS: xml.includes('<rss')
      },
      episodes
    }, {
      headers: { 'Cache-Control': 'no-store' }
    });

  } catch (error) {
    return Response.json({
      version: 'latitude40-debug-2',
      error: String(error),
      episodes: []
    }, { status: 503 });
  }
}
