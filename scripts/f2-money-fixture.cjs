/* f2-money-fixture.cjs — the F-2 money guard's eyes (2.463.0).
 *
 * EXTRACT defines window.__f2Money() inside a booted app: for every house it
 * renders the builder's money surfaces (house Money line, Money screen,
 * selections ledger and list, invoice card, Invoices list and ledger), the
 * homeowner's (home, Upgrades & payments open) and each crew's house view,
 * and returns every dollar figure and money word ("Included") in order.
 * sim.js compares those against app/qa-baseline/f2-money-2.462.0.json, before
 * and after a full sync round trip through inv/selm.
 *
 * Regenerate the fixture from a 2.462.0 index.html (never from the app under test):
 *   node scripts/f2-money-fixture.cjs <path to 2.462.0 index.html> app/qa-baseline/f2-money-2.462.0.json
 */
const EXTRACT = `window.__f2Money=function(only,bsess){
  var out={};
  var nums=function(h){return (String(h==null?'':h).replace(/<[^>]+>/g,' ').replace(/&nbsp;|\\u00a0/g,' ').match(/[\\u2212+-]?\\$[\\d,]+(?:\\.\\d+)?|Included/g)||[]);};
  var keep={s:state.session,a:state.activeId,ct:typeof clientTab!=='undefined'?clientTab:null,mo:typeof _clientMoneyOpen!=='undefined'?_clientMoneyOpen:null,im:typeof invMode!=='undefined'?invMode:null};
  var safe=function(f){try{return f();}catch(e){return ['ERR '+String(e&&e.message).slice(0,80)];}};
  (state.projects||[]).forEach(function(p){
    if(only&&only.indexOf(String(p.id))<0)return;
    var r={};
    state.session=bsess||{role:'builder',name:'You'};state.activeId=p.id;
    r.houseLine=safe(function(){return nums(houseMoneyLine(p));});
    r.money=safe(function(){renderBudget();return nums(document.getElementById('budgetBody').innerHTML);});
    r.selLedger=safe(function(){_selFilter=null;renderSelections();return nums(document.getElementById('selSummary').innerHTML);});
    r.selList=safe(function(){return nums(document.getElementById('selList').innerHTML);});
    r.billingCard=safe(function(){return nums(billingCardHTML(p));});
    r.invoices=safe(function(){invMode='list';renderInvoices();return nums(document.getElementById('invBody').innerHTML);});
    r.ledger=safe(function(){invMode='ledger';renderInvoices();return nums(document.getElementById('invBody').innerHTML);});
    state.session={role:'client',site:p.id,name:'Homeowner'};
    r.homeowner=safe(function(){clientTab='home';_clientMoneyOpen=false;renderClient();return nums(document.getElementById('clBody').innerHTML);});
    r.homeownerMoney=safe(function(){clientTab='specs';_clientMoneyOpen=true;renderClient();return nums(document.getElementById('clBody').innerHTML);});
    r.crew={};
    (p.subs||[]).forEach(function(sb){if(!sb||!sb.name||r.crew[sb.name])return;
      r.crew[sb.name]=safe(function(){state.session={role:'subs',name:sb.name};subSel=null;renderSubView();openSubSite(p.id);return nums(document.getElementById('svBody').innerHTML);});});
    out[p.id]=r;
  });
  state.session=keep.s;state.activeId=keep.a;if(keep.ct!==null)clientTab=keep.ct;if(keep.mo!==null)_clientMoneyOpen=keep.mo;if(keep.im!==null)invMode=keep.im;
  return JSON.stringify(out);
};true`;
/* The example houses carry prices and invoices but no allowance, cost or budget
   line, so the guard adds one house ("pa") built the same way in both versions:
   a copy of p2 whose selections use all five money keys. */
const ALLOWANCE_HOUSE = `window.__f2AddAllowanceHouse=function(){
  if(state.projects.some(function(x){return x.id==='pa';}))return true;
  var p=JSON.parse(JSON.stringify(state.projects.find(function(x){return x.id==='p2';})));p.id='pa';p.name='Allowance house';
  var lines=(typeof costLines==='function'?costLines(p):(p.costs||[]))||[];var L=function(i){return lines[i]?lines[i].id:null;};
  var inv=(p.invoices||[])[0];var s=p.selections;
  var put=function(i,m){if(!s[i])return;['price','allowance','cost','costLineId','invoicedIn'].forEach(function(k){delete s[i][k];});Object.assign(s[i],m);};
  put(0,{allowance:450,cost:570,price:120,costLineId:L(0),approved:true});
  put(1,{allowance:450,cost:400,price:-50,costLineId:L(1),approved:true,invoicedIn:inv?inv.id:undefined});
  put(2,{allowance:1000,cost:null,price:null,costLineId:L(0),approved:false});
  put(3,{price:300,cost:210,approved:false});
  put(4,{allowance:800,cost:800,price:0,costLineId:L(2),approved:true});
  state.projects.push(p);return true;};true`;
module.exports = { EXTRACT, ALLOWANCE_HOUSE };

if (require.main === module) {
  const fs = require('fs'), path = require('path');
  let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { ({ JSDOM } = require(path.join(__dirname, '../app/node_modules/jsdom'))); }
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) { console.error('usage: node scripts/f2-money-fixture.cjs <index.html> <out.json>'); process.exit(2); }
  const html = fs.readFileSync(src, 'utf8').replace('</body>', '<script>window.$eval=c=>eval(c);</script></body>');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://sim.test/', pretendToBeVisual: true,
    beforeParse(w) { w.indexedDB = { open: () => ({}) }; w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.navigator.serviceWorker = { register: () => Promise.resolve({}), getRegistration: () => Promise.resolve(null), addEventListener() {} }; w.scrollTo = () => {};
      w.HTMLMediaElement.prototype.play = () => Promise.resolve(); } });
  setTimeout(() => {
    const w = dom.window; w.$eval(EXTRACT); w.$eval(ALLOWANCE_HOUSE); w.$eval('__f2AddAllowanceHouse()');
    const v = String(w.$eval('PLUMB_VERSION')).split(' ')[0];
    const data = JSON.parse(w.$eval('__f2Money()'));
    fs.writeFileSync(dst, JSON.stringify({ version: v, note: 'Every dollar figure and Included on builder, homeowner and crew screens of the example houses, rendered by ' + v + '. Regenerate only from 2.462.0.', houses: data }, null, 1) + '\n');
    console.log('wrote', dst, 'from', v, Object.keys(data).length, 'houses');
    process.exit(0);
  }, 1500);
}
