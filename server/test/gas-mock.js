// Имитация сервисов Google Apps Script поверх таблиц в памяти — для server.test.js
const vm = require('vm'), fs = require('fs'), crypto = require('crypto');
function colIdx(a){return a.toUpperCase().split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);}
class Sheet {
  constructor(name){this.name=name;this.data=[];}
  getName(){return this.name;}
  appendRow(r){this.data.push(r.slice());}
  getLastRow(){return this.data.length;}
  getLastColumn(){return Math.max(0,...this.data.map(r=>r.length));}
  getRange(a,b,c,d){
    if(typeof a==='string'){const m=a.match(/([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?/);const c1=colIdx(m[1]),r1=+m[2],c2=m[3]?colIdx(m[3]):c1,r2=m[4]?+m[4]:r1;return this.getRange(r1,c1,r2-r1+1,c2-c1+1);}
    const sh=this,r0=a-1,c0=b-1,nr=c||1,nc=d||1;
    const rng={getValues(){return Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>{const v=(sh.data[r0+i]||[])[c0+j];return v===undefined?'':v;}));},
      setValues(v){v.forEach((row,i)=>{sh.data[r0+i]=sh.data[r0+i]||[];row.forEach((x,j)=>sh.data[r0+i][c0+j]=x);});return rng;},
      setNumberFormat(){return rng;},setFontWeight(){return rng;},insertCheckboxes(){return rng;},setValue(x){sh.data[r0]=sh.data[r0]||[];sh.data[r0][c0]=x;return rng;}};
    return rng;
  }
  getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));}
  deleteColumn(c){this.data.forEach(r=>r.splice(c-1,1));}
  setFrozenRows(){} autoResizeColumns(){} setRowHeights(){} setColumnWidth(){}
}
function load(){
  const sheets={};
  const cache=new Map(), props={}, triggers=[];
  const ctx={console,JSON,Math,Date,Number,String,Object,Error,isFinite,encodeURIComponent,
    SpreadsheetApp:{getActive:()=>({getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet(n)),getSheets:()=>Object.values(sheets)})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=v;}})},
    ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:h=>({forSpreadsheet:()=>({onFormSubmit:()=>({create:()=>triggers.push({getHandlerFunction:()=>h})})})})},
    CacheService:{getScriptCache:()=>({get:k=>{const e=cache.get(k);return e&&e.exp>Date.now()?e.v:null;},put:(k,v,s)=>cache.set(k,{v,exp:Date.now()+s*1000}),remove:k=>cache.delete(k)})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({s,setMimeType(){return this;}})},
    Utilities:{getUuid:()=>crypto.randomUUID()}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'Code.gs'),'utf8'),ctx);
  return {ctx,sheets,cache,props,triggers,Sheet};
}
module.exports={load,Sheet};
