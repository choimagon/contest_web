export const BUCKET = 'team-python-files';
export const MAX_FILE_SIZE = 5 * 1024 * 1024;
const FIELDS = 'id,team_name,file_name,file_size,created_at';

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
export const isAccessError = error => ['PYROOM_LOGIN_REQUIRED','PYROOM_ACCESS_DENIED','42501'].includes(error?.code) || String(error?.message).includes('PYROOM_ACCESS_DENIED');
export function readableError(error) {
  const message = String(error?.message || '잠시 후 다시 시도해주세요.');
  if(error?.code === 'PYROOM_LOGIN_REQUIRED') return '허용된 이메일 계정으로 로그인하면 제출과 목록 확인을 할 수 있습니다.';
  if(error?.code === 'PYROOM_ACCESS_DENIED' || message.includes('PYROOM_ACCESS_DENIED')) return '이 계정은 제출 공간 접근이 허용되지 않았습니다.';
  if(isMissingFile(error)) return '업로드된 파일을 찾을 수 없습니다. 파일을 다시 선택해 제출해주세요.';
  if(message.includes('PYROOM_SUBMISSION_CONFLICT')) return '이미 등록된 제출과 정보가 다릅니다. 제출 목록을 확인해주세요.';
  if(/invalid login credentials/i.test(message)) return '이메일 또는 비밀번호를 확인해주세요. 처음이라면 계정을 먼저 만들어주세요.';
  if(/email not confirmed/i.test(message)) return '확인 이메일의 링크를 누른 뒤 로그인해주세요.';
  if(error?.code === 'email_address_not_authorized') return 'Supabase 이메일 발송 설정에서 이 주소로 보낼 수 없습니다. 관리자가 Authentication → Users에서 계정을 등록해야 합니다.';
  if(error?.code === 'over_email_send_rate_limit') return '확인 이메일 발송 한도에 도달했습니다. 잠시 후 다시 시도해주세요.';
  if(['PGRST202','PGRST205'].includes(error?.code) || /schema cache|does not exist/i.test(message)) return '제출 데이터베이스 설정을 확인해주세요.';
  if(/row.level security|permission denied/i.test(message)) return '파일 제출 권한이 없습니다. 허용된 계정으로 다시 로그인해주세요.';
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
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
    global:{fetch:(input,init={}) => fetch(input,{...init,signal:init.signal || AbortSignal.timeout(60000)})}
  })).catch(error => {clientPromise = null;throw error;});
  return clientPromise;
}

export class SubmissionRepository {
  static async connect(config, credentials) {
    const client = await clientFor(config);
    let {data:{session},error} = await client.auth.getSession();
    if(error) throw error;
    if(credentials) {
      const response = await client.auth.signInWithPassword(credentials);
      if(response.error) throw response.error;
      session = response.data.session;
    }
    if(!session?.user?.email) throw Object.assign(new Error('Login required'),{code:'PYROOM_LOGIN_REQUIRED'});
    const verified = await client.auth.getUser();
    if(verified.error) throw verified.error;
    if(!verified.data.user?.email_confirmed_at) throw new Error('Email not confirmed');
    const repository = new SubmissionRepository();
    repository.client = client;
    repository.userId = verified.data.user.id;
    repository.email = verified.data.user.email;
    repository.pendingKey = `pyroom.pending.v1:${new URL(config.url).hostname}:${repository.userId}`;
    await repository.assertAccess();
    return repository;
  }
  static async register(config, credentials) {
    if(credentials.password.length < 8) throw new Error('새 비밀번호는 8자 이상으로 정해주세요.');
    const client = await clientFor(config);
    const {data,error} = await client.auth.signUp({...credentials,options:{emailRedirectTo:window.location.origin}});
    if(error) throw error;
    return {signedIn:Boolean(data.session)};
  }
  async assertAccess() {
    const {data,error} = await this.client.rpc('submission_has_access');
    if(error) throw error;
    if(data !== true) throw Object.assign(new Error('Access denied'),{code:'PYROOM_ACCESS_DENIED'});
  }
  async list() {
    await this.assertAccess();
    const rows = [];
    for(let offset = 0;;offset += 500) {
      const {data,error} = await this.client.from('team_submissions').select(FIELDS).order('created_at',{ascending:false}).order('id').range(offset,offset+499);
      if(error) throw error;
      rows.push(...data);
      if(data.length < 500) return rows;
    }
  }
  getPending() {
    const raw = localStorage.getItem(this.pendingKey);
    if(!raw) return null;
    const receipt = JSON.parse(raw);
    if(!/^[0-9a-f-]{36}$/i.test(receipt.id) || receipt.submitted_by !== this.userId) throw new Error('제출 복구 정보를 확인해주세요.');
    validateTeam(receipt.team_name);
    validateFile({name:receipt.file_name,size:receipt.file_size});
    return receipt;
  }
  clearPending() {localStorage.removeItem(this.pendingKey);}
  async registerReceipt(receipt) {
    await this.assertAccess();
    const {data,error} = await this.client.rpc('register_team_submission',{p_id:receipt.id,p_team_name:receipt.team_name,p_file_name:receipt.file_name}).single();
    if(error) throw error;
    this.clearPending();
    return data;
  }
  async submit(teamName, file, onStage) {
    validateFile(file);
    teamName = validateTeam(teamName);
    await this.assertAccess();
    if(this.getPending()) throw new Error('이전 제출의 목록 등록을 먼저 완료해주세요.');
    const receipt = {id:crypto.randomUUID(),team_name:teamName,file_name:file.name,file_size:file.size,submitted_by:this.userId};
    // Only recovery metadata is stored locally. The file body is never read or cached here.
    localStorage.setItem(this.pendingKey,JSON.stringify(receipt));
    onStage?.('upload');
    const path = `${this.userId}/${receipt.id}.py`;
    // Pass the selected file's bytes directly to Storage. No text/AST parsing or execution.
    const opaqueFile = new Blob([file],{type:'application/octet-stream'});
    const {error} = await this.client.storage.from(BUCKET).upload(path,opaqueFile,{upsert:false,contentType:'application/octet-stream',cacheControl:'0'});
    if(error) throw error;
    onStage?.('metadata');
    return this.registerReceipt(receipt);
  }
  async signOut() {
    const {error} = await this.client.auth.signOut({scope:'local'});
    if(error) throw error;
  }
}
