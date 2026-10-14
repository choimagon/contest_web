export const BUCKET = 'team-python-files';
export const MAX_FILE_SIZE = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateConfig({url, key}) {
  let parsed;
  try { parsed = new URL(String(url).trim()); } catch { throw new Error('Supabase 프로젝트 주소를 확인해주세요.'); }
  if(parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Supabase 프로젝트 주소를 확인해주세요.');
  key = String(key).trim();
  if(key.startsWith('sb_secret_')) throw new Error('브라우저에는 Supabase 공개 키만 사용할 수 있습니다.');
  if(!key.startsWith('sb_publishable_')) {
    let payload;
    try { payload = JSON.parse(atob(key.split('.')[1].replaceAll('-','+').replaceAll('_','/'))); } catch {}
    if(payload?.role !== 'anon') throw new Error('Publishable 또는 anon 공개 키를 사용해주세요.');
  }
  if(key.length < 25) throw new Error('Supabase 공개 키를 확인해주세요.');
  return {url:parsed.origin, key};
}

export function validateFile(file) {
  if(!file || typeof file.name !== 'string') throw new Error('제출할 .py 파일을 선택해주세요.');
  if(!/\.py$/i.test(file.name)) throw new Error('Python 파일(.py)만 제출할 수 있습니다.');
  if(file.name.length > 255 || /[/\\\0]/.test(file.name)) throw new Error('파일 이름은 경로 없이 255자 이하로 지정해주세요.');
  if(!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_SIZE) throw new Error('파일 크기는 최대 5 MB입니다.');
  return file;
}
export function validateTeam(name) {
  name = String(name || '').trim();
  if(!name || name.length > 80 || name.includes('\0')) throw new Error('팀 이름을 1~80자로 입력해주세요.');
  return name;
}
export const isMissingFile = error => String(error?.message).includes('PYROOM_FILE_NOT_FOUND');
export function readableError(error) {
  const message = String(error?.message || '잠시 후 다시 시도해주세요.');
  if(isMissingFile(error)) return '업로드된 파일을 찾을 수 없습니다. 파일을 다시 선택해 제출해주세요.';
  if(message.includes('PYROOM_SUBMISSION_CONFLICT')) return '이미 등록된 제출과 정보가 다릅니다. 제출 목록을 확인해주세요.';
  if(message.includes('PYROOM_RECEIPT_INVALID')) return '제출 복구 정보를 확인할 수 없습니다. 관리자에게 문의해주세요.';
  if(['PGRST202','PGRST205'].includes(error?.code) || /schema cache|does not exist/i.test(message)) return '제출 데이터베이스 설정을 확인해주세요.';
  if(/row.level security|permission denied/i.test(message)) return '파일 제출 권한 설정을 확인해주세요.';
  if(/failed to fetch|fetch failed|network|abort|timeout|timed out/i.test(message)) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해주세요.';
  if(/bucket not found/i.test(message)) return '파일 저장소 설정을 확인해주세요.';
  return message;
}

let sdkPromise, clientPromise;
async function clientFor(config) {
  config = validateConfig(config);
  if(!sdkPromise) sdkPromise = new Promise((resolve,reject) => {
    if(globalThis.supabase?.createClient) {resolve(globalThis.supabase);return;}
    const script = document.createElement('script');
    script.src = '/vendor/supabase.js';
    script.onload = () => globalThis.supabase?.createClient ? resolve(globalThis.supabase) : reject(new Error('연결 라이브러리를 불러올 수 없습니다.'));
    script.onerror = () => {sdkPromise = null;script.remove();reject(new Error('연결 라이브러리를 불러오지 못했습니다. 새로고침해주세요.'));};
    document.head.append(script);
  });
  if(!clientPromise) clientPromise = sdkPromise.then(sdk => sdk.createClient(config.url,config.key,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'pyroom-public-upload'},
    global:{fetch:(input,init={}) => fetch(input,{...init,signal:init.signal || AbortSignal.timeout(60000)})}
  })).catch(error => {clientPromise = null;throw error;});
  return clientPromise;
}

export class SubmissionRepository {
  static async connect(config) {
    const client = await clientFor(config);
    const repository = new SubmissionRepository();
    repository.client = client;
    repository.pendingKey = `pyroom.pending.v2:${new URL(config.url).hostname}:public`;
    return repository;
  }
  async list() {
    const rows = [];
    for(let offset = 0;;offset += 500) {
      const {data,error} = await this.client.rpc('list_public_team_submissions',{p_offset:offset,p_limit:500});
      if(error) throw error;
      rows.push(...data);
      if(data.length < 500) return rows;
    }
  }
  getPending() {
    const raw = localStorage.getItem(this.pendingKey);
    if(!raw) return null;
    const receipt = JSON.parse(raw);
    if(!UUID.test(receipt.id) || !UUID.test(receipt.upload_token)) throw new Error('제출 복구 정보를 확인해주세요.');
    validateTeam(receipt.team_name);
    validateFile({name:receipt.file_name,size:receipt.file_size});
    return receipt;
  }
  clearPending() {localStorage.removeItem(this.pendingKey);}
  async registerReceipt(receipt) {
    const {data,error} = await this.client.rpc('register_public_team_submission',{p_id:receipt.id,p_upload_token:receipt.upload_token,p_team_name:receipt.team_name,p_file_name:receipt.file_name}).single();
    if(error) throw error;
    this.clearPending();
    return data;
  }
  async submit(teamName, file, onStage) {
    validateFile(file);
    teamName = validateTeam(teamName);
    if(this.getPending()) throw new Error('이전 제출의 목록 등록을 먼저 완료해주세요.');
    const receipt = {id:crypto.randomUUID(),upload_token:crypto.randomUUID(),team_name:teamName,file_name:file.name,file_size:file.size};
    // Only recovery metadata is stored locally. The file body is never read or cached here.
    localStorage.setItem(this.pendingKey,JSON.stringify(receipt));
    onStage?.('upload');
    const path = `public/${receipt.upload_token}/${receipt.id}.py`;
    // Pass the selected file's bytes directly to Storage. No text/AST parsing or execution.
    const opaqueFile = new Blob([file],{type:'application/octet-stream'});
    const {error} = await this.client.storage.from(BUCKET).upload(path,opaqueFile,{upsert:false,contentType:'application/octet-stream',cacheControl:'0'});
    if(error) throw error;
    onStage?.('metadata');
    return this.registerReceipt(receipt);
  }
}
