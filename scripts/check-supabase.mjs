import { createInterface } from 'node:readline';
if (process.stdin.isTTY) {
  const { execFileSync } = await import('node:child_process');
  execFileSync('stty',['-echo'],{stdio:['inherit','inherit','inherit']});
}
console.log('Ready for public Supabase configuration on stdin (input hidden).');
const lines = createInterface({input:process.stdin});
const config = await new Promise(resolve => lines.once('line',line => resolve(JSON.parse(line))));
lines.close();
const results = await Promise.all([
  ['/auth/v1/settings','auth'],
  ['/rest/v1/team_submissions?select=id&limit=0','table'],
  ['/rest/v1/rpc/submission_has_access','access_function']
].map(async ([path,name]) => {
  const response = await fetch(config.url + path,{method:name==='access_function'?'POST':'GET',headers:{apikey:config.key,'Content-Type':'application/json'},body:name==='access_function'?'{}':undefined,signal:AbortSignal.timeout(15000)});
  const body = await response.json();
  return name === 'auth' ? {name,status:response.status,email_enabled:body.external?.email} : {name,status:response.status,code:body.code,message:body.message};
}));
console.log(JSON.stringify(results));
