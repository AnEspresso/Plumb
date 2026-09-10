'use strict';
// A data-only plan. Importing or running this file makes no network requests.
const {hash}=require('../functions/service.cjs');
const VERSION='staging-fixtures-v1';
function fixtures(){
 const houses=[{id:'qa_a1',companyId:'qa_company_a',address:'42 Sample Lane'},{id:'qa_a2',companyId:'qa_company_a',address:'44 Sample Lane'},{id:'qa_b1',companyId:'qa_company_b',address:'90 Other Sample Road'}];
 const users=[
  {uid:'qa_owner',role:'owner',houseId:'qa_a1'},
  {uid:'qa_gc',role:'gc',houseId:'qa_a1'},
  {uid:'qa_homeowner',role:'homeowner',houseId:'qa_a1'},
  {uid:'qa_pm',role:'pm',houseId:'qa_a1',capabilities:['specify','approve']},
  {uid:'qa_employee',role:'employee',houseId:'qa_a1',capabilities:[]},
  {uid:'qa_crew',role:'crew',houseId:'qa_a1',trades:['plumb']},
  {uid:'qa_wrong_trade',role:'crew',houseId:'qa_a1',trades:['elec']},
  {uid:'qa_revoked',role:'owner',houseId:'qa_a1',companyActive:false},
  {uid:'qa_disabled',role:'homeowner',houseId:'qa_a1',disabled:true},
  {uid:'qa_other_house',role:'homeowner',houseId:'qa_a2'},
  {uid:'qa_other_company',role:'owner',houseId:'qa_b1'},
  {uid:'qa_unassigned',role:null,houseId:null}
 ].map(u=>({...u,email:u.uid+'@siteplumb.example',disabled:!!u.disabled}));
 const documents=[];
 const add=(path,data)=>documents.push({path,data:{...data,fixtureVersion:VERSION}});
 for(const h of houses){
  add('companies/'+h.companyId,{name:h.companyId==='qa_company_a'?'Sample Builder A':'Sample Builder B'});
  add('houses/'+h.id,{address:h.address,companyId:h.companyId});
  const content={selections:[{id:9001,item:'QA shower valve',cat:'Plumbing Fixtures',room:'Primary bath',price:450,note:'QA Note — leave unchanged',spec:{rough:'Approved valve',finish:''},specCustom:[]}],notes:'Fake staging sample only',docs:[],bookings:[]};
  const base='houses/'+h.id+'/packets/plumb';
  add(base,{trade:'plumb',currentRevision:'qa_r1',approvals:{},policy:{9001:[{key:'rough',label:'Rough-in',who:'builder',required:true},{key:'finish',label:'Finish',who:'homeowner',required:true}]}});
  add(base+'/revisions/qa_r1',{id:'qa_r1',hash:hash(content),content,changes:[],createdBy:'fixture-provisioner'});
 }
 for(const u of users){
  if(!u.houseId)continue;
  const h=houses.find(h=>h.id===u.houseId);
  add('houses/'+h.id+'/members/'+u.uid,{companyId:h.companyId,role:u.role,active:true,capabilities:u.capabilities||[],trades:u.trades||[]});
  if(['owner','gc','pm','employee'].includes(u.role))add('companies/'+h.companyId+'/members/'+u.uid,{active:u.companyActive!==false});
  // Even invalid assignments must be reauthorized by the service.
  add('users/'+u.uid+'/packetAssignments/'+h.id,{houseId:h.id,packetId:'plumb'});
 }
 return {version:VERSION,target:'siteplumb-staging',projectNumber:'625071693246',users,houses,documents:[...new Map(documents.map(d=>[d.path,d])).values()]};
}
module.exports={fixtures};
if(require.main===module)console.log(JSON.stringify(fixtures(),null,2));
