
const FEED = 'https://rss.buzzsprout.com/1538629.rss';

function extract(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
    'i'
  );
  return xml.match(pattern)?.[1] || '';
}

function clean(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function onRequestGet() {
  try {
    const response = await fetch(FEED);

    if (!response.ok) {
      throw new Error(`Feed returned ${response.status}`);
    }

    const xml = await response.text();
    const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];

    const episodes = items.map(([_, item], index) => {
      const title = clean(extract(item, 'title'));
      const url = clean(extract(item, 'link'));
      const date = clean(extract(item, 'pubDate'));
      const description = clean(
        extract(item, 'content:encoded') ||
        extract(item, 'description') ||
        extract(item, 'itunes:summary')
      );
      const duration = clean(extract(item, 'itunes:duration'));
      const season = Number(clean(extract(item, 'itunes:season'))) || null;
      const image = item.match(/<itunes:image[^>]*href=["']([^"']+)["']/i)?.[1] || '';

      return {
        id: String(index),
        title,
        url,
        date: date
          ? new Date(date).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'Australia/Hobart'
            })
          : '',
        description,
        duration,
        season,
        image
      };
    }).filter(episode => episode.title && /^https:\/\//.test(episode.url));

    return Response.json(
      { episodes },
      { headers: { 'Cache-Control': 'public, max-age=1800' } }
    );
  } catch (error) {
    return Response.json(
      { error: 'Latitude 40 feed unavailable', episodes: [] },
      { status: 503 }
    );
  }
}
