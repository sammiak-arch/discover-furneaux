// Cloudflare Pages Function: serve the official Latitude 40 Buzzsprout RSS feed as JSON.
// Deploy with Wrangler or Git-based Pages deployment (not dashboard drag-and-drop).
const FEED = 'https://feeds.buzzsprout.com/1538629.rss';
const between=(s,tag)=>{const m=s.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i'));return m?m[1]:''};
const clean=s=>String(s||'').replace(/^<!\[CDATA\[|\]\]>$/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
export async function onRequestGet(){
 try{
  const res=await fetch(FEED,{headers:{'User-Agent':'DiscoverFurneaux/1.0'}});
  if(!res.ok)throw new Error('Feed '+res.status);
  const xml=await res.text();
  const items=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(x=>x[1]);
  const episodes=items.map((item,index)=>{
   const title=clean(between(item,'title'));
   const link=clean(between(item,'link'));
   const dateText=clean(between(item,'pubDate'));
   const description=clean(between(item,'content:encoded')||between(item,'description')||between(item,'itunes:summary'));
   const duration=clean(between(item,'itunes:duration'));
   const season=Number(clean(between(item,'itunes:season')))||null;
   const imgMatch=item.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
   const image=imgMatch?imgMatch[1]:'';
   return {id:String(index),title,url:link,date:dateText?new Date(dateText).toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric',timeZone:'Australia/Hobart'}):'',duration,description,season,image};
  }).filter(e=>e.title&&/^https:\/\//.test(e.url));
  return Response.json({episodes},{headers:{'Cache-Control':'public, max-age=1800'}});
 }catch(e){return Response.json({error:'Latitude 40 feed unavailable',episodes:[]},{status:503});}
}
