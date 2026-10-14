import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../supabase/public-config.json',import.meta.url),'utf8'));
const checks = [
  {name:'direct_table_denied',path:'/rest/v1/team_submissions?select=id&limit=0',status:401},
  {name:'public_metadata_list',path:'/rest/v1/rpc/list_public_team_submissions',body:{p_offset:0,p_limit:1},status:200},
  {name:'missing_upload_denied',path:'/rest/v1/rpc/register_public_team_submission',body:{p_id:crypto.randomUUID(),p_upload_token:crypto.randomUUID(),p_team_name:'connection-check',p_file_name:'check.py'},status:400}
];
const results = await Promise.all(checks.map(async check => {
  const response = await fetch(config.url + check.path,{method:check.body?'POST':'GET',headers:{apikey:config.key,'Content-Type':'application/json'},body:check.body?JSON.stringify(check.body):undefined,signal:AbortSignal.timeout(15000)});
  const body = await response.json();
  assert.equal(response.status,check.status,`${check.name}: ${body.message || response.status}`);
  if(check.name==='public_metadata_list') {
    for(const row of body) assert.deepEqual(Object.keys(row).sort(),['created_at','file_name','file_size','id','team_name']);
  }
  if(check.name==='missing_upload_denied') assert.equal(body.message,'PYROOM_FILE_NOT_FOUND');
  return {name:check.name,status:response.status};
}));
console.log(JSON.stringify(results));
