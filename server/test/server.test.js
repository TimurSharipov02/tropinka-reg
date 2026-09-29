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
assert.equal(post({action:'register',telegram:'@Fixie_Masha',gender:'Ж',payment:'бесплатно'}).nick,'fixie_masha');
assert.equal(post({action:'register',telegram:'fixie_masha',gender:'Ж',payment:'x'}).already,true);
assert.equal(post({action:'register',telegram:'Иван',gender:'М',payment:'x'}).ok,false);
assert.equal(post({action:'register',telegram:'bob_1',gender:'М',payment:'Боб'}).ok,true);
assert.equal(post({action:'register',telegram:'blocked_guy',gender:'М',payment:'-'}).ok,true);
S('Регистрации').data[3][4]='нет';
assert.equal(S('Регистрации').data.length,4);
assert.equal(post({action:'login',nick:'@FIXIE_MASHA'}).nick,'fixie_masha');
assert.equal(post({action:'login',nick:'nobody'}).ok,false);
assert.match(post({action:'login',nick:'blocked_guy'}).error,/не допущен/);
const pts=S('Точки').data.slice(1); const [c1,c2,fin]=pts; 
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
r=post({action:'scan',nick:'fixie_masha',cp:'c1',k:c1[7],lat:c1[3],lng:c1[4],accuracy:5}); 
st=get(); assert.deepEqual(st.leaderboard.map(x=>[x.nick,x.score]),[['bob_1',3],['fixie_masha',3]],'tie: earlier first');

console.log('ALL OK');
