
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const fail=(message,status=400)=>json({error:message},status);

function b64url(input){
 const padded=input.replace(/-/g,'+').replace(/_/g,'/');
 return Uint8Array.from(atob(padded.padEnd(Math.ceil(padded.length/4)*4,'=')),c=>c.charCodeAt(0));
}

async function authenticate(request,env){
 const token=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!token||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)
  throw new Error('Admin Access authentication not configured or missing.');

 const [h,p,s]=token.split('.');
 if(!s)throw new Error('Invalid access token');

 const header=JSON.parse(new TextDecoder().decode(b64url(h)));
 const payload=JSON.parse(new TextDecoder().decode(b64url(p)));
 const team=env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//,'').replace(/\/$/,'');
 const issuer=`https://${team}`;

 if(
  header.alg!=='RS256'||
  payload.iss!==issuer||
  !Array.isArray(payload.aud)||
  !payload.aud.includes(env.ACCESS_AUD)||
  !payload.exp||
  payload.exp*1000<=Date.now()||
  payload.nbf&&payload.nbf*1000>Date.now()
 )throw new Error('Invalid Access token claims');

 const response=await fetch(`${issuer}/cdn-cgi/access/certs`);
 if(!response.ok)throw new Error('Cannot verify Access token');

 const keys=(await response.json()).keys||[];
 const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA');
 if(!jwk)throw new Error('Unknown Access signing key');

 const key=await crypto.subtle.importKey(
  'jwk',jwk,
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},
  false,['verify']
 );

 if(!await crypto.subtle.verify(
  'RSASSA-PKCS1-v1_5',
  key,
  b64url(s),
  new TextEncoder().encode(h+'.'+p)
 ))throw new Error('Invalid Access signature');

 return payload;
}

export async function onRequest(context){
 try{
  await authenticate(context.request,context.env);
  if(!context.env.DB)return fail('D1 binding DB is missing',503);
  return await route(context);
 }catch(e){
  return fail(e.message||'Unauthorised',401);
 }
}

async function route({request,env}){
 const path=new URL(request.url).pathname;

 if(path==='/api/admin/listings'&&request.method==='GET'){
  const [l,c,w,e,h]=await Promise.all([
   env.DB.prepare('SELECT * FROM listings ORDER BY name').all(),
   env.DB.prepare('SELECT * FROM categories ORDER BY sort_order,name').all(),
   env.DB.prepare('SELECT * FROM listing_opening_sessions').all(),
   env.DB.prepare('SELECT * FROM listing_opening_exceptions').all(),
   env.DB.prepare('SELECT * FROM listing_hours_settings').all()
  ]);

  const categories=c.results||[];
  const catMap=new Map(categories.map(c=>[c.id,c.name]));

  const listings=(l.results||[]).map(x=>{
   const week={};

   for(const r of w.results||[]){
    if(r.listing_id===x.id)
     (week[r.weekday]??=[]).push({
      start:r.opens_at,
      end:r.closes_at
     });
   }

   const exceptions=(e.results||[])
    .filter(r=>r.listing_id===x.id)
    .map(r=>({
     date:r.local_date,
     closed:!!r.is_closed,
     start:r.opens_at||'',
     end:r.closes_at||'',
     note:r.note||''
    }));

   const hs=(h.results||[]).find(r=>r.listing_id===x.id);

   let gallery=[];
   try{gallery=JSON.parse(x.gallery||'[]')}catch{}

   return {
    id:x.id,
    name:x.name,
    category:catMap.get(x.category_id)||'',
    desc:x.description||'',
    extra:x.extra||'',
    address:x.address||'',
    contact:x.contact_person||'',
    phone:x.phone||'',
    email:x.email||'',
    website:x.website||'',
    facebook:x.facebook||'',
    instagram:x.instagram||'',
    image:x.hero_image||'',
    gallery,
    latitude:x.latitude??'',
    longitude:x.longitude??'',
    hours:x.opening_hours||'',
    status:x.status||'draft',
    mode:hs?.mode||'unknown',
    seasonal:hs?.seasonal_note||'',
    week,
    exceptions
   };
  });

  return json({listings,categories});
 }

 if(path==='/api/admin/listings'&&request.method==='POST'){
  const x=await request.json();

  if(typeof x.name!=='string'||!x.name.trim()||x.name.length>200)
   return fail('Valid listing name required');

  if(!['draft','published'].includes(x.status))
   return fail('Invalid status');

  if(!['not_applicable','unknown','appointment','scheduled'].includes(x.mode))
   return fail('Invalid hours mode');

  const cat=await env.DB.prepare(
   'SELECT id FROM categories WHERE name=?'
  ).bind(x.category).first();

  if(!cat)return fail('Choose a valid category');

  const lat=x.latitude===''||x.latitude==null
   ?null:Number(x.latitude);

  const lng=x.longitude===''||x.longitude==null
   ?null:Number(x.longitude);

  if(
   (lat===null)!==(lng===null)||
   lat!==null&&(
    !Number.isFinite(lat)||
    !Number.isFinite(lng)||
    Math.abs(lat)>90||
    Math.abs(lng)>180
   )
  )return fail('Invalid map coordinates');

  const gallery=Array.isArray(x.gallery)?x.gallery:[];

  if(
   gallery.length>20||
   gallery.some(u=>
    typeof u!=='string'||
    u.length>2048||
    !/^https:\/\//.test(u)
   )
  )return fail('Invalid gallery');

  const exceptions=Array.isArray(x.exceptions)?x.exceptions:[];
  if(exceptions.length>366)return fail('Too many exceptions');

  const sessions=[];

  for(let day=0;day<7;day++){
   const entries=x.week?.[day]||[];

   for(const r of (Array.isArray(entries)?entries:[entries])){
    if(!r.start&&!r.end)continue;

    if(!validTime(r.start)||!(validTime(r.end)||r.end==='24:00')||r.start>=r.end)
     return fail('Invalid opening session');

    sessions.push({
     day,
     start:r.start,
     end:r.end
    });
   }

   const sorted=sessions
    .filter(r=>r.day===day)
    .sort((a,b)=>a.start.localeCompare(b.start));

   if(sorted.some((r,i)=>i&&r.start<sorted[i-1].end))
    return fail('Overlapping opening sessions');
  }

  const seen=new Set();

  for(const e of exceptions){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||seen.has(e.date))
    return fail('Invalid or duplicate exception date');

   seen.add(e.date);

   if(!e.closed&&(
    !validTime(e.start)||
    !validTime(e.end)||
    e.start>=e.end
   ))return fail('Invalid exception hours');
  }

  const slug=(
   x.name.toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-|-$/g,'')||'listing'
  ).slice(0,90);

  const fields=[
   x.name.trim(),
   cat.id,
   x.desc||'',
   x.extra||'',
   x.address||'',
   lat,
   lng,
   x.phone||'',
   x.email||'',
   x.website||'',
   x.facebook||'',
   x.instagram||'',
   x.hours||'',
   x.image||'',
   JSON.stringify(gallery),
   x.status,
   x.contact||''
  ];

  let id=Number(x.id)||null;

  if(id){
   const old=await env.DB.prepare(
    'SELECT id FROM listings WHERE id=?'
   ).bind(id).first();

   if(!old)return fail('Listing not found',404);

   await env.DB.prepare(
    `UPDATE listings SET
     name=?,category_id=?,description=?,extra=?,address=?,
     latitude=?,longitude=?,phone=?,email=?,website=?,
     facebook=?,instagram=?,opening_hours=?,hero_image=?,
     gallery=?,status=?,contact_person=?,
     updated_at=CURRENT_TIMESTAMP WHERE id=?`
   ).bind(...fields,id).run();

  }else{
   const result=await env.DB.prepare(
    `INSERT INTO listings (
     name,category_id,description,extra,address,latitude,longitude,
     phone,email,website,facebook,instagram,opening_hours,
     hero_image,gallery,status,contact_person,slug
    ) VALUES (${Array(18).fill('?').join(',')})`
   ).bind(
    ...fields,
    slug+'-'+crypto.randomUUID().slice(0,8)
   ).run();

   id=result.meta.last_row_id;
  }

  const statements=[
   env.DB.prepare(
    'DELETE FROM listing_opening_sessions WHERE listing_id=?'
   ).bind(id),

   env.DB.prepare(
    'DELETE FROM listing_opening_exceptions WHERE listing_id=?'
   ).bind(id),

   env.DB.prepare(
    `INSERT INTO listing_hours_settings
     (listing_id,mode,timezone,seasonal_note,last_confirmed_at)
     VALUES (? ,?,'Australia/Hobart',?,CURRENT_TIMESTAMP)
     ON CONFLICT(listing_id) DO UPDATE SET
     mode=excluded.mode,
     timezone=excluded.timezone,
     seasonal_note=excluded.seasonal_note,
     last_confirmed_at=excluded.last_confirmed_at`
   ).bind(id,x.mode,x.seasonal||''),

   ...sessions.map(r=>
    env.DB.prepare(
     'INSERT INTO listing_opening_sessions (listing_id,weekday,opens_at,closes_at) VALUES (?,?,?,?)'
    ).bind(id,r.day,r.start,r.end)
   ),

   ...exceptions.map(e=>
    env.DB.prepare(
     'INSERT INTO listing_opening_exceptions (listing_id,local_date,is_closed,opens_at,closes_at,note) VALUES (?,?,?,?,?,?)'
    ).bind(
     id,
     e.date,
     e.closed?1:0,
     e.closed?null:e.start,
     e.closed?null:e.end,
     e.note||''
    )
   )
  ];

  await env.DB.batch(statements);
  return json({ok:true,id});
 }

 // MEDIA LIBRARY: BROWSE BOTH R2 BUCKETS
 // Existing production images are read-only.
 // New images are stored in the Preview bucket.

 if(path==='/api/admin/media'&&request.method==='GET'){
  if(!env.MEDIA_LIBRARY||!env.IMAGES)
   return fail('Media Library bindings missing',503);

  const params=new URL(request.url).searchParams;

  let state={existing:null,preview:null};
  const token=params.get('cursor');

  if(token){
   try{
    const parsed=JSON.parse(
     atob(token.replace(/-/g,'+').replace(/_/g,'/'))
    );

    if(
     parsed&&
     typeof parsed==='object'&&
     ['string','object'].includes(typeof parsed.existing)&&
     ['string','object'].includes(typeof parsed.preview)
    ){
     state=parsed;
    }else{
     return fail('Invalid media cursor');
    }
   }catch{
    return fail('Invalid media cursor');
   }
  }

  const existingBase=
   'https://pub-2a26cdacb48143ad82a5270167809ed0.r2.dev';

  const previewBase=(env.PUBLIC_IMAGE_BASE||'').replace(/\/$/,'');

  if(!previewBase)
   return fail('Preview image base URL missing',503);

  const sources=[
   {
    name:'existing',
    bucket:env.MEDIA_LIBRARY,
    base:existingBase
   },
   {
    name:'preview',
    bucket:env.IMAGES,
    base:previewBase
   }
  ];

  const images=[];
  const next={existing:null,preview:null};

  for(const source of sources){
   if(state[source.name]==='done'){
    next[source.name]='done';
    continue;
   }

   const options={
    prefix:'listings/',
    limit:60
   };

   if(state[source.name])
    options.cursor=state[source.name];

   const result=await source.bucket.list(options);

   for(const obj of result.objects||[]){
    if(!/\.(jpg|jpeg|png|webp|avif)$/i.test(obj.key))
     continue;

    images.push({
     key:obj.key,
     url:source.base+'/'+obj.key,
     size:obj.size,
     source:source.name
    });
   }

   next[source.name]=result.truncated
    ?result.cursor
    :'done';
  }

  const more=
   next.existing!=='done'||
   next.preview!=='done';

  const cursor=more
   ?btoa(JSON.stringify(next))
     .replace(/\+/g,'-')
     .replace(/\//g,'_')
     .replace(/=+$/,'')
   :null;

  return json({images,cursor});
 }

 // IMAGE UPLOADS: PREVIEW BUCKET ONLY

 if(path==='/api/admin/images'&&request.method==='POST'){
  if(!env.IMAGES||!env.PUBLIC_IMAGE_BASE)
   return fail('R2 binding or public image base missing',503);

  const form=await request.formData();
  const file=form.get('file');

  if(
   !(file instanceof File)||
   !['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)||
   file.size>5*1024*1024
  )return fail('Use JPG, PNG, WebP or AVIF under 5 MB');

  const ext={
   'image/jpeg':'jpg',
   'image/png':'png',
   'image/webp':'webp',
   'image/avif':'avif'
  }[file.type];

  const key=`listings/uploads/${crypto.randomUUID()}.${ext}`;

  await env.IMAGES.put(
   key,
   await file.arrayBuffer(),
   {httpMetadata:{contentType:file.type}}
  );

  return json({
   url:env.PUBLIC_IMAGE_BASE.replace(/\/$/,'')+'/'+key
  });
 }

 return fail('Not found',404);
}

function validTime(t){
 return typeof t==='string'&&
  /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}