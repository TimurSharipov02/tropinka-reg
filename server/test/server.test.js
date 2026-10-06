// Тест сервера без Google: node server/test/server.test.js
// Имитирует Google Таблицу в памяти и прогоняет регистрацию, вход, сканы и топ.
const assert=require('assert');const {load}=require('./gas-mock');
const {ctx,sheets,cache}=load();
ctx.setup();
const S=n=>sheets[n];
const get=()=>JSON.parse(ctx.doGet({parameter:{action:'state'}}).s);
const post=b=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(b)}}).s);
const setStart=ms=>{S('Настройки').data[0][1]=new Date(ms).toISOString();cache.clear();};

setStart(Date.now()+3600e3);
let st=get(); assert.equal(st.open,false); assert.equal(st.checkpoints,undefined);
let reg=post({action:'register',telegram:'@Fixie_Masha',gender:'Ж',payment:'бесплатно'});
assert.equal(reg.nick,'fixie_masha'); assert.equal(reg.amount,0); assert.equal(reg.paid,true);
assert.equal(post({action:'register',telegram:'fixie_masha',gender:'Ж',payment:'x'}).already,true);
assert.equal(post({action:'register',telegram:'Иван',gender:'М',payment:'x'}).ok,false);
// цена после повышения
const change=S('Настройки').data.find(r=>r[0]==='Повышение цены');
change[1]=new Date(Date.now()-86400e3).toISOString();
reg=post({action:'register',telegram:'bob_1',gender:'М',payment:'Боб'});
assert.equal(reg.ok,true); assert.equal(reg.amount,600); assert.equal(reg.paid,false);
// цена до повышения
change[1]=new Date(Date.now()+86400e3).toISOString();
assert.equal(post({action:'register',telegram:'early_bird',gender:'М',payment:'x'}).amount,300);
// статус оплаты
let me=JSON.parse(ctx.doGet({parameter:{action:'me',nick:'@bob_1'}}).s); assert.equal(me.paid,false); assert.equal(me.amount,600);
S('Регистрации').data[2][5]=true;
me=JSON.parse(ctx.doGet({parameter:{action:'me',nick:'bob_1'}}).s); assert.equal(me.paid,true);
assert.equal(JSON.parse(ctx.doGet({parameter:{action:'me',nick:'nobody'}}).s).ok,false);
assert.equal(post({action:'register',telegram:'blocked_guy',gender:'М',payment:'-'}).ok,true);
S('Регистрации').data[4][6]='нет';
assert.equal(S('Регистрации').data.length,5);
assert.equal(post({action:'login',nick:'@FIXIE_MASHA'}).nick,'fixie_masha');
assert.equal(post({action:'login',nick:'nobody'}).ok,false);
assert.match(post({action:'login',nick:'blocked_guy'}).error,/не допущен/);
const pts=S('Точки').data.slice(1); // старый вид строки [.., .., .., lat, lng, .., .., secret] — чтобы не переписывать проверки ниже
const old=r=>{const [la,ln]=r[3].split(',').map(Number);return [r[0],r[1],r[2],la,ln,r[4],r[5],r[6]];};
const [c1,c2,fin]=pts.map(old); 
let r=post({action:'scan',nick:'bob_1',cp:'c1',k:c1[7],lat:c1[3],lng:c1[4],accuracy:10}); assert.equal(r.ok,false); assert.match(r.error,/старта/);
setStart(Date.now()-60e3);
assert.equal(post({action:'register',telegram:'late',gender:'М',payment:'x'}).ok,false);
st=get(); assert.equal(st.open,true); assert.equal(st.checkpoints.length,3); assert.ok(!('secret' in st.checkpoints[0])); assert.deepEqual(st.leaderboard,[]);
r=post({action:'scan',nick:'bob_1',cp:'c1',k:'wrong',lat:c1[3],lng:c1[4]}); assert.match(r.error,/не подошёл/);
r=post({action:'scan',nick:'bob_1',cp:'c1',k:c1[7],lat:c1[3]+0.01,lng:c1[4],accuracy:10}); assert.equal(r.far,true); 
r=post({action:'scan',nick:'bob_1',cp:'c1',k:c1[7],lat:c1[3]+0.001,lng:c1[4],accuracy:10}); assert.equal(r.ok,true); assert.equal(r.value,1); 
r=post({action:'scan',nick:'bob_1',cp:'c1',k:c1[7],lat:c1[3],lng:c1[4]}); assert.equal(r.already,true);
r=post({action:'scan',nick:'blocked_guy',cp:'c1',k:c1[7],lat:c1[3],lng:c1[4]}); assert.match(r.error,/не допущен/);
r=post({action:'scan',nick:'ghost',cp:'c1',k:c1[7],lat:c1[3],lng:c1[4]}); assert.match(r.error,/Войди/);
r=post({action:'scan',nick:'bob_1',cp:'c2',k:c2[7],lat:c2[3],lng:c2[4],accuracy:900}); assert.match(r.error,/неточная/);
r=post({action:'scan',nick:'fixie_masha',cp:'c2',k:c2[7],lat:c2[3],lng:c2[4],accuracy:5}); assert.equal(r.ok,true);
r=post({action:'scan',nick:'bob_1',cp:'c2',k:c2[7],lat:c2[3],lng:c2[4],accuracy:5}); assert.equal(r.ok,true);
st=get();
assert.deepEqual(st.leaderboard.map(x=>[x.nick,x.score]),[['bob_1',3],['fixie_masha',2]]);
// «Гонка только после оплаты»
S('Настройки').data.find(r=>r[0]==='Гонка только после оплаты')[1]='да';
r=post({action:'scan',nick:'early_bird',cp:'c1',k:c1[7],lat:c1[3],lng:c1[4],accuracy:5}); assert.match(r.error,/Оплата/);
S('Настройки').data.find(r=>r[0]==='Гонка только после оплаты')[1]='нет';
// повторный setup не затирает настройки и не дублирует строки
const before=JSON.stringify(S('Настройки').data); ctx.setup(); assert.equal(JSON.stringify(S('Настройки').data),before);
r=post({action:'scan',nick:'fixie_masha',cp:'c1',k:c1[7],lat:c1[3],lng:c1[4],accuracy:5}); 
st=get(); assert.deepEqual(st.leaderboard.map(x=>[x.nick,x.score]),[['bob_1',3],['fixie_masha',3]],'tie: earlier first');


// описание, фото и координаты точек; перестройка старого листа
{ const {load:l4}=require('./gas-mock'); const g4=l4();
  const pts=g4.ctx.SpreadsheetApp.getActive().insertSheet('Точки');
  pts.data=[["ID","Название","Адрес","Широта","Долгота","Ценность","Финиш","Секрет","Ссылка для QR","QR"],["c1","Мост","Наб., 1",55.75,37.61,2,"","sec1","",""]];
  g4.ctx.setup();
  assert.deepEqual(pts.data[0],["ID","Название","Адрес","Координаты","Ценность","Финиш","Секрет","Ссылка для QR","QR","Описание","Фото","Фото для сайта"]);
  assert.deepEqual(pts.data[1].slice(0,7),["c1","Мост","Наб., 1","55.75, 37.61",2,"","sec1"],'секрет и ценность на месте');
  g4.ctx.setup(); assert.equal(pts.data[0].length,12,'повторный setup ничего не ломает');
  pts.data[1][9]='Под мостом, у третьей опоры';
  pts.data[1][10]='https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing';
  pts.data.push(["c2","Б","","55.765000, 37.598000",1,"","sec2","","","","https://example.com/p.jpg"],["c3","В","","55,7; 37,6",1,"да","sec3","","","","не ссылка"]);
  g4.ctx.refreshQr(); assert.match(pts.data[2][7],/\?cp=c2&k=sec2$/); assert.match(pts.data[2][8],/ENCODEURL\(H3\)/);
  g4.sheets['Настройки'].data.find(r=>r[0]==='Старт')[1]=new Date(Date.now()-1000).toISOString();
  const cps=JSON.parse(g4.ctx.doGet({parameter:{action:'state'}}).s).checkpoints;
  assert.deepEqual([cps[0].lat,cps[0].lng,cps[0].value],[55.75,37.61,2]);
  assert.deepEqual([cps[1].lat,cps[1].lng],[55.765,37.598]); assert.deepEqual([cps[2].lat,cps[2].lng,cps[2].final],[55.7,37.6,true]);
  assert.equal(cps[0].description,'Под мостом, у третьей опоры');
  assert.equal(cps[0].photo,'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345&sz=w1200');
  assert.equal(cps[1].photo,'https://example.com/p.jpg'); assert.equal(cps[2].photo,''); assert.equal(cps[1].description,'');

  // фото, вставленное прямо в ячейку
  const img={getContentUrl:()=>'https://lh3.googleusercontent.com/tmp-image'};
  pts.data[3][10]=img; pts.data[3][9]='описание'; g4.ctx.refreshQr();
  assert.equal(g4.drive.files.length,1); assert.equal(g4.drive.files[0].name,'точка c3');
  assert.match(pts.data[3][11],/^https:\/\/drive\.google\.com\/file\/d\/file0+1\/view$/);
  assert.equal(pts.data[3][10],img,'ячейку с фото не трогаем'); assert.equal(pts.data[3][9],'описание');
  g4.cache.clear(); let c3=JSON.parse(g4.ctx.doGet({parameter:{action:'state'}}).s).checkpoints[2];
  assert.equal(c3.photo,'https://drive.google.com/thumbnail?id=file00000000000000000001&sz=w1200');
  // повторное обновление: новая копия, старая — в корзину; одна папка
  g4.ctx.refreshQr(); assert.equal(g4.drive.files.length,2); assert.deepEqual(g4.drive.trashed,['file00000000000000000001']); assert.equal(g4.drive.folder,1);
  // фото убрали из ячейки — копия тоже уходит, сайт показывает без фото
  pts.data[3][10]=''; g4.ctx.refreshQr(); assert.equal(pts.data[3][11],''); assert.equal(g4.drive.trashed.length,2);
  // ссылка-строка в «Фото» по-прежнему работает
  g4.cache.clear(); assert.equal(JSON.parse(g4.ctx.doGet({parameter:{action:'state'}}).s).checkpoints[1].photo,'https://example.com/p.jpg');
}

// без setup — понятная ошибка
{ const {load:l3}=require('./gas-mock'); const g3=l3();
  assert.match(JSON.parse(g3.ctx.doGet({parameter:{action:'state'}}).s).error,/setup/); }

// ===== таблица ответов Google Формы =====
{
  const {load:load2}=require('./gas-mock');
  const g=load2();
  const form=g.ctx.SpreadsheetApp.getActive().insertSheet('Ответы на форму (1)');
  const d=(s)=>new Date(s);
  form.data=[['Отметка времени','Я ник телеграмм','пол ','стоимость участия…'],
    [d('2026-10-03T17:46:53+03:00'),'Lmsmolentsev','М','Перевод, т банк (Леонид С)'],
    [d('2026-10-04T09:38:00+03:00'),'difdebik','М','Тимур Рафаэлевич. Т-Банк'],
    [d('2026-10-05T12:22:25+03:00'),'@JasonFunderberkerr','М','Альфа'],
    [d('2026-10-05T13:00:00+03:00'),'Аня','Ж','бесплатно'],
    [d('2026-10-27T10:00:00+03:00'),'late_guy','М','Сбер']];
  g.ctx.setup();
  const regs=()=>g.sheets['Регистрации'].data.slice(1).map(r=>[r[1],r[2],r[4],r[5]].join('/'));
  assert.deepEqual(regs(),['lmsmolentsev/М/300/false','difdebik/М/300/false','jasonfunderberkerr/М/300/false','Аня/Ж/0/true','late_guy/М/600/false']);
  assert.equal(g.triggers.length,1,'триггер на новые ответы формы');
  g.ctx.setup(); assert.equal(g.triggers.length,1); assert.equal(regs().length,5,'повторный setup не дублирует');
  // новый ответ формы
  form.data.push([new Date(),'new_one','М','x']); g.ctx.importFormResponses();
  assert.equal(regs().length,6); g.ctx.importFormResponses(); assert.equal(regs().length,6);
  // уже зарегистрированный с сайта не дублируется
  g.sheets['Настройки'].data.find(r=>r[0]==='Старт')[1]=new Date(Date.now()+3600e3).toISOString();
  JSON.parse(g.ctx.doPost({postData:{contents:JSON.stringify({action:'register',telegram:'site_guy',gender:'М',payment:'x'})}}).s);
  form.data.push([new Date(),'@Site_Guy','М','x']); g.ctx.importFormResponses(); assert.equal(regs().length,7);
  // вход по нику из формы
  assert.equal(JSON.parse(g.ctx.doPost({postData:{contents:JSON.stringify({action:'login',nick:'@lmsmolentsev'})}}).s).nick,'lmsmolentsev');
  console.log('form import:', regs().join(' | '));
}
console.log('ALL OK');
