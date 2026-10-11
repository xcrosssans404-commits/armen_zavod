// Backend для Telegram Mini App. Требуется Node.js 18+.
// Настрой BOT_TOKEN в переменных окружения и добавь бота администратором канала.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHANNEL = process.env.CHANNEL_USERNAME || '@armen228Canal';
const DB_FILE = path.join(ROOT, 'subscription-users.json');
let db = {};
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
function saveDb(){ fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function send(res, status, obj){res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj));}
function readBody(req){return new Promise((resolve,reject)=>{let body='';req.on('data',d=>{body+=d;if(body.length>100000)reject(new Error('Слишком большой запрос'));});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{reject(new Error('Неверный JSON'));}});req.on('error',reject);});}
function verifyInitData(initData){
 if(!BOT_TOKEN) throw new Error('На сервере не задан BOT_TOKEN');
 const params = new URLSearchParams(initData || ''); const hash=params.get('hash'); if(!hash) throw new Error('Нет данных Telegram Mini App');
 params.delete('hash'); const pairs=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 const expected=crypto.createHmac('sha256',secret).update(pairs).digest('hex');
 const a=Buffer.from(hash,'hex'), b=Buffer.from(expected,'hex'); if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) throw new Error('Не удалось подтвердить Telegram-пользователя');
 const authDate=Number(params.get('auth_date')||0); if(!authDate||Date.now()/1000-authDate>86400) throw new Error('Данные Telegram устарели. Перезапусти игру.');
 const user=JSON.parse(params.get('user')||'{}'); if(!user.id) throw new Error('В данных нет ID пользователя'); return String(user.id);
}
async function isMember(userId){
 const url=`https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(CHANNEL)}&user_id=${encodeURIComponent(userId)}`;
 const r=await fetch(url); const data=await r.json(); if(!data.ok) throw new Error('Telegram не смог проверить канал. Проверь, что бот — администратор @armen228Canal.');
 const status=data.result.status; return ['creator','administrator','member'].includes(status) || (status==='restricted' && data.result.is_member===true);
}
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET,OPTIONS'});return res.end();}
 const url=new URL(req.url,'http://localhost');
 if(req.method==='POST' && ['/api/subscription/status','/api/subscription/claim'].includes(url.pathname)){
  try{
   const body=await readBody(req); const id=verifyInitData(body.initData); const record=db[id] ||= {claimed:false,revoked:false};
   // После отзыва вернуть подписочный бонус уже нельзя — даже если игрок подпишется снова.
   if(record.revoked) return send(res,200,{member:false,claimed:false,revoked:true});
   const member=await isMember(id);
   if(!member && record.claimed){record.revoked=true;record.claimed=false;record.revokedAt=new Date().toISOString();saveDb();return send(res,200,{member:false,claimed:false,revoked:true});}
   if(url.pathname==='/api/subscription/claim'){
    if(!member)return send(res,200,{member:false,claimed:false,revoked:false});
    if(record.claimed)return send(res,200,{member:true,claimed:true,alreadyClaimed:true});
    record.claimed=true;record.claimedAt=new Date().toISOString();saveDb();return send(res,200,{member:true,claimed:true,award:{coins:25000,crystals:15,achievement:'Я с Арменом!'}});
   }
   return send(res,200,{member,claimed:record.claimed,revoked:false});
  }catch(e){return send(res,400,{error:e.message});}
 }
 const requested=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname); const file=path.resolve(ROOT,'.'+requested);
 if(!file.startsWith(ROOT+path.sep) && file!==path.join(ROOT,'index.html'))return send(res,403,{error:'Forbidden'});
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.txt':'text/plain; charset=utf-8'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});res.end(data);});
});
server.listen(PORT,()=>console.log(`Завод Армена запущен на порту ${PORT}. Настрой HTTPS для Telegram Mini App.`));
// Серверная перепроверка каждые 60 секунд: отписка отнимает право на бонус навсегда,
// даже если игра закрыта. Для небольшого проекта подходит; при большом онлайне нужен очередь/лимиты.
setInterval(async()=>{
 if(!BOT_TOKEN)return;
 for(const [id,record] of Object.entries(db)){
  if(!record.claimed||record.revoked)continue;
  try{const member=await isMember(id);if(!member){record.revoked=true;record.claimed=false;record.revokedAt=new Date().toISOString();saveDb();}}
  catch(e){console.error('Не удалось перепроверить подписку для',id,':',e.message);}
 }
},60000);
