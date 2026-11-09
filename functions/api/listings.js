const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function onRequestGet({env}) {
 if (!env.DB) return json({error:"Database unavailable"},503);
 try {
  const [listingData,categoryData,sessionsData,exceptionsData,settingsData] = await Promise.all([
   env.DB.prepare("SELECT * FROM listings WHERE status = ? ORDER BY name").bind("published").all(),
   env.DB.prepare("SELECT * FROM categories ORDER BY sort_order, name").all(),
   env.DB.prepare("SELECT * FROM listing_opening_sessions").all(),
   env.DB.prepare("SELECT * FROM listing_opening_exceptions").all(),
   env.DB.prepare("SELECT * FROM listing_hours_settings").all()
  ]);
  const categories=categoryData.results||[];
  const categoryNames=new Map(categories.map(c=>[c.id,c.name]));
  const listings=(listingData.results||[]).map(x=>{
   let gallery=[];try {const parsed=JSON.parse(x.gallery||"[]");if(Array.isArray(parsed))gallery=parsed;}catch{}
   const week={};for(const r of sessionsData.results||[]){if(r.listing_id===x.id)(week[r.weekday]??=[]).push({start:r.opens_at,end:r.closes_at});}
   const exceptions=(exceptionsData.results||[]).filter(r=>r.listing_id===x.id).map(r=>({date:r.local_date,closed:!!r.is_closed,start:r.opens_at||"",end:r.closes_at||"",note:r.note||""}));
   const hs=(settingsData.results||[]).find(r=>r.listing_id===x.id);
   return {id:x.id,name:x.name,category:categoryNames.get(x.category_id)||"",desc:x.description||"",extra:x.extra||"",essentials:(()=>{try{const v=JSON.parse(x.essentials||"[]");return Array.isArray(v)?v:[]}catch{return []}})(),address:x.address||"",contact:x.contact_person||"",phone:x.phone||"",email:x.email||"",website:x.website||"",facebook:x.facebook||"",instagram:x.instagram||"",image:x.hero_image||"",gallery,latitude:x.latitude,longitude:x.longitude,hours:x.opening_hours||"",status:x.status,mode:hs?.mode||"unknown",seasonal:hs?.seasonal_note||"",week,exceptions};
  });
  return json({listings,categories:categories.map(c=>({id:c.id,name:c.name}))});
 }catch(error){console.error("Public listings API error",error);return json({error:"Unable to load listings"},500);}
}
