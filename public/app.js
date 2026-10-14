import {SubmissionRepository,validateFile,validateTeam,readableError,isMissingFile,isAccessError} from './store.js';
const $ = id => document.getElementById(id);
const paths = {
  'code-file':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6m-10 4-3 3 3 3m4-6 3 3-3 3"/>',
  code:'<path d="m7 6-5 6 5 6m10-12 5 6-5 6m-4-15-2 18"/>',
  files:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  users:'<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2"/>',
  'check-circle':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  'arrow-up-right':'<path d="M6 18 18 6M7 6h11v11"/>',
  'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  x:'<path d="m6 6 12 12M6 18 18 6"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  folder:'<path d="M3 7V5h7l2 3h9v12H3Z"/><path d="M3 8h9"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  'log-out':'<path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.files}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
document.querySelectorAll('[data-icon]').forEach(node => {node.innerHTML = icon(node.dataset.icon);});
const state = {repository:null,rows:[],file:null,pending:null,busy:false,loading:true,query:''};
let toastTimer;
function toast(message,error=false) {
  clearTimeout(toastTimer);
  $('toast-message').textContent = message;
  $('toast').hidden = false;
  $('toast').classList.toggle('error',error);
  toastTimer = setTimeout(() => {$('toast').hidden = true;},4200);
}
const formatSize = bytes => bytes >= 1024*1024 ? `${(bytes/1024/1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes/1024).toFixed(1)} KB` : `${bytes} B`;
function notice(message) {$('connection-notice').hidden = !message;$('notice-text').textContent = message || '';}
function renderActions() {
  const busy = state.busy || state.loading;
  $('status-pill').classList.toggle('connected',Boolean(state.repository));
  $('status-pill').innerHTML = `<i></i>${state.loading ? '연결 중' : state.repository ? 'Supabase 연결됨' : '로그인 필요'}`;
  $('account-label').textContent = state.repository ? '내 계정' : '로그인';
  $('account-button').disabled = busy;
  $('submit-button').disabled = busy || Boolean(state.pending);
  $('submit-button').formNoValidate = !state.repository;
  $('submit-label').textContent = state.busy ? '제출 중…' : state.pending ? '목록 등록 대기' : state.repository ? '제출하기' : '로그인 후 제출';
  $('team-name').readOnly = busy || Boolean(state.pending);
  ['choose-file','change-file','remove-file'].forEach(id => {$(id).disabled = busy || Boolean(state.pending);});
  $('drop-zone').classList.toggle('busy',busy || Boolean(state.pending));
  $('retry-submission').disabled = busy;
  $('refresh-list').disabled = busy || !state.repository;
}
function renderFile() {
  const file = state.file || (state.pending ? {name:state.pending.file_name,size:state.pending.file_size} : null);
  $('file-placeholder').hidden = Boolean(file);
  $('selected-file').hidden = !file;
  $('selected-file-name').textContent = file?.name || '';
  $('selected-file-size').textContent = file ? formatSize(file.size) : '';
  $('pending-receipt').hidden = !state.pending;
  if(state.pending) {
    $('pending-description').textContent = `${state.pending.team_name} · ${state.pending.file_name}\n파일 보관과 목록 등록 상태를 다시 확인할 수 있습니다.`;
    $('team-name').value = state.pending.team_name;
  }
}
function renderList() {
  const query = state.query.trim().toLocaleLowerCase('ko');
  const rows = query ? state.rows.filter(row=>`${row.team_name}\n${row.file_name}`.toLocaleLowerCase('ko').includes(query)) : state.rows;
  $('total-submissions').innerHTML = `${state.rows.length}<small>개</small>`;
  $('total-teams').innerHTML = `${new Set(state.rows.map(row=>row.team_name)).size}<small>팀</small>`;
  $('list-count').textContent = rows.length;
  $('list-footer-count').textContent = `총 ${state.rows.length}개 파일${query ? ` · 검색 결과 ${rows.length}개` : ''}`;
  const colors = ['purple','green','peach','blue','rose'];
  const date = new Intl.DateTimeFormat('ko-KR',{month:'2-digit',day:'2-digit',timeZone:'Asia/Seoul'});
  $('submissions-body').innerHTML = rows.map(row => {
    const hash = Array.from(row.team_name).reduce((sum,char)=>sum+char.codePointAt(0),0);
    const initial = Array.from(row.team_name)[0]?.toUpperCase() || 'T';
    return `<tr data-submission-id="${escape(row.id)}"><td><div class="team-cell"><span class="team-avatar avatar-${colors[hash % colors.length]}" aria-hidden="true">${escape(initial)}</span><strong title="${escape(row.team_name)}">${escape(row.team_name)}</strong></div></td><td><div class="file-cell"><span>${icon('code-file')}</span><span class="file-name" title="${escape(row.file_name)}">${escape(row.file_name)}</span><span class="file-check" aria-label="Python 파일 등록됨" title="파일 등록됨">${icon('check-circle')}</span></div></td><td><time datetime="${escape(row.created_at)}">${date.format(new Date(row.created_at))}</time></td></tr>`;
  }).join('');
  $('empty-state').hidden = rows.length > 0;
  $('empty-title').textContent = state.loading ? '제출 목록을 불러오는 중이에요' : query ? '검색된 제출이 없어요' : '팀의 첫 번째 제출을 기다려요';
  $('empty-description').textContent = query ? '다른 팀 이름이나 파일명으로 검색해보세요.' : state.repository ? '왼쪽에서 팀 이름과 .py 파일을 등록해보세요.' : '로그인하고 팀 이름과 .py 파일을 등록해보세요.';
}
function render() {renderActions();renderFile();renderList();}
async function boot() {
  state.loading = true;
  state.repository = null;state.rows = [];state.pending = null;
  notice('');render();
  try {
    if(!window.PYROOM_CONFIG?.url) throw new Error('Supabase 프로젝트 연결 정보가 필요합니다.');
    const repository = await SubmissionRepository.connect(window.PYROOM_CONFIG);
    const rows = await repository.list();
    state.repository = repository;state.rows = rows;state.pending = repository.getPending();
  } catch(error) {notice(readableError(error));}
  finally {state.loading = false;render();}
}
function setBusy(value) {state.busy = value;renderActions();}
function chooseFiles(files) {
  if(state.busy || state.loading || state.pending) return;
  $('upload-error').hidden = true;
  try {
    if(files.length !== 1) throw new Error('한 번에 .py 파일 하나를 선택해주세요.');
    state.file = validateFile(files[0]);
  } catch(error) {state.file = null;$('file-input').value = '';$('upload-error').textContent = readableError(error);$('upload-error').hidden = false;}
  renderFile();
}
['choose-file','change-file'].forEach(id=>$(id).addEventListener('click',()=>$('file-input').click()));
$('file-input').addEventListener('change',event=>{if(event.target.files.length)chooseFiles(event.target.files);});
$('remove-file').addEventListener('click',()=>{state.file = null;$('file-input').value = '';$('upload-error').hidden = true;renderFile();});
['dragenter','dragover'].forEach(type=>$('drop-zone').addEventListener(type,event=>{event.preventDefault();if(!state.busy && !state.pending)$('drop-zone').classList.add('drag-over');}));
$('drop-zone').addEventListener('dragleave',event=>{if(!$('drop-zone').contains(event.relatedTarget))$('drop-zone').classList.remove('drag-over');});
$('drop-zone').addEventListener('drop',event=>{event.preventDefault();$('drop-zone').classList.remove('drag-over');chooseFiles(event.dataTransfer.files);});
document.addEventListener('dragover',event=>event.preventDefault());
document.addEventListener('drop',event=>event.preventDefault());
function savedSubmission(record) {
  const metadata = {id:record.id,team_name:record.team_name,file_name:record.file_name,file_size:record.file_size,created_at:record.created_at};
  state.rows = [metadata,...state.rows.filter(row=>row.id !== record.id)];
  state.query = '';$('search-input').value = '';
  state.pending = null;state.file = null;
  $('file-input').value = '';$('team-name').value = '';$('upload-error').hidden = true;
  render();toast('팀의 Python 파일을 등록했어요.');
}
$('upload-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(state.busy || state.loading) return;
  if(!state.repository) {openAuth();return;}
  try {validateTeam($('team-name').value);validateFile(state.file);} catch(error) {$('upload-error').textContent = readableError(error);$('upload-error').hidden = false;return;}
  setBusy(true);$('upload-error').hidden = true;$('upload-progress').hidden = false;
  try {
    const record = await state.repository.submit($('team-name').value,state.file,stage=>{$('upload-progress-label').textContent = stage === 'upload' ? '파일을 비공개 저장소에 보관하는 중…' : '팀 이름과 파일명을 목록에 등록하는 중…';});
    savedSubmission(record);
  } catch(error) {
    try {state.pending = state.repository.getPending();} catch {}
    $('upload-error').textContent = readableError(error) + (state.pending ? ' 아래 버튼으로 제출 상태를 확인해주세요.' : '');$('upload-error').hidden = false;
    if(isAccessError(error)) {state.repository = null;state.rows = [];notice('접근 권한을 확인하고 다시 로그인해주세요.');}
  } finally {setBusy(false);$('upload-progress').hidden = true;render();}
});
$('retry-submission').addEventListener('click',async()=>{
  if(state.busy || !state.pending) return;
  if(!state.repository) {openAuth();return;}
  setBusy(true);$('upload-error').hidden = true;
  try {savedSubmission(await state.repository.registerReceipt(state.pending));}
  catch(error) {
    if(isMissingFile(error)) {state.repository.clearPending();state.pending = null;state.file = null;$('file-input').value = '';}
    $('upload-error').textContent = readableError(error);$('upload-error').hidden = false;
    if(isAccessError(error)) {state.repository = null;state.rows = [];notice('접근 권한을 확인하고 다시 로그인해주세요.');}
  } finally {setBusy(false);render();}
});
$('search-input').addEventListener('input',event=>{state.query = event.target.value;renderList();});
$('refresh-list').addEventListener('click',async()=>{
  if(state.busy || !state.repository) return;
  setBusy(true);
  try {state.rows = await state.repository.list();notice('');toast('제출 목록을 새로 불러왔어요.');}
  catch(error) {notice(readableError(error));if(isAccessError(error)){state.repository = null;state.rows = [];}}
  finally {setBusy(false);render();}
});
function openAuth() {
  if(state.busy || state.loading) return;
  const connected = Boolean(state.repository);
  $('auth-heading').textContent = connected ? '나의 제출 계정' : '팀의 제출 공간에 로그인';
  $('auth-intro').innerHTML = connected ? '이 계정으로 Python 파일을 제출하고<br>등록된 팀과 파일명을 확인할 수 있습니다.' : '허용된 이메일 계정으로 로그인하면<br>파일 제출과 목록 확인을 할 수 있습니다.';
  $('auth-form').hidden = connected;
  $('account-info').hidden = !connected;
  $('account-info').textContent = state.repository?.email || '';
  $('signout-button').hidden = !connected;
  $('login-password').value = '';$('auth-error').hidden = true;$('auth-message').hidden = true;
  $('auth-dialog').showModal();
}
['account-button','notice-action'].forEach(id=>$(id).addEventListener('click',openAuth));
$('close-auth').addEventListener('click',()=>{if(!state.busy)$('auth-dialog').close();});
$('auth-dialog').addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
$('auth-dialog').addEventListener('close',()=>{$('login-password').value = '';});
function setAuthBusy(value) {
  setBusy(value);['login-submit','register-button','signout-button','close-auth'].forEach(id=>{$(id).disabled = value;});
  $('login-submit').innerHTML = value ? '확인 중…' : '로그인'+icon('arrow-right');
}
const credentials = () => ({email:$('login-email').value.trim(),password:$('login-password').value});
$('auth-form').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;
  setAuthBusy(true);$('auth-error').hidden = true;
  try {
    const repository = await SubmissionRepository.connect(window.PYROOM_CONFIG,credentials());
    const rows = await repository.list();
    state.repository = repository;state.rows = rows;state.pending = repository.getPending();
    notice('');$('auth-dialog').close();toast('로그인했어요. 이제 팀의 파일을 제출할 수 있습니다.');
  } catch(error) {$('auth-error').textContent = readableError(error);$('auth-error').hidden = false;}
  finally {setAuthBusy(false);render();}
});
$('register-button').addEventListener('click',async()=>{
  if(state.busy || !$('auth-form').reportValidity())return;
  setAuthBusy(true);$('auth-error').hidden = true;
  try {
    const result = await SubmissionRepository.register(window.PYROOM_CONFIG,credentials());
    if(result.signedIn) {$('auth-dialog').close();await boot();toast(state.repository ? '계정을 만들고 로그인했어요.' : '계정을 만들었어요. 접근 권한을 확인해주세요.');}
    else {$('auth-message').textContent = '확인 이메일을 보냈어요. 이메일의 링크를 누른 뒤 이 화면으로 돌아와 로그인해주세요.';$('auth-message').hidden = false;}
  } catch(error) {$('auth-error').textContent = readableError(error);$('auth-error').hidden = false;}
  finally {setAuthBusy(false);}
});
$('signout-button').addEventListener('click',async()=>{
  if(state.busy || !state.repository)return;
  setAuthBusy(true);
  try {await state.repository.signOut();$('auth-dialog').close();state.file = null;$('file-input').value = '';await boot();toast('로그아웃했어요.');}
  catch(error) {toast(readableError(error),true);}
  finally {setAuthBusy(false);}
});
window.addEventListener('storage',event=>{if(/^sb-.*-auth-token$/.test(event.key || '') && !state.busy) {$('auth-dialog').close();boot();}});
document.addEventListener('keydown',event=>{if(event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.matches('input,textarea') && !$('auth-dialog').open) {event.preventDefault();$('search-input').focus();}});
boot();
