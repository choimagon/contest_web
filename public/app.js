import {SubmissionRepository,validateFile,validateName,readableError,isMissingFile} from './store.js';
const $ = id => document.getElementById(id);
const paths = {
  'code-file':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6m-10 4-3 3 3 3m4-6 3 3-3 3"/>',
  'check-circle':'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  x:'<path d="m6 6 12 12M6 18 18 6"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths['code-file']}</svg>`;
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
  $('status-pill').textContent = state.loading ? '연결 중' : state.repository ? '제출 가능' : '연결 확인 필요';
  $('notice-action').disabled = busy;
  $('submit-button').disabled = busy || Boolean(state.pending) || !state.repository;
  $('submit-label').textContent = state.busy ? '제출 중…' : state.pending ? '목록 등록 대기' : '제출하기';
  $('submitter-name').readOnly = busy || Boolean(state.pending);
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
    $('submitter-name').value = state.pending.team_name;
  }
}
function renderList() {
  const query = state.query.trim().toLocaleLowerCase('ko');
  const rows = query ? state.rows.filter(row=>`${row.team_name}\n${row.file_name}`.toLocaleLowerCase('ko').includes(query)) : state.rows;
  $('list-count').textContent = rows.length;
  $('list-footer-count').textContent = `총 ${state.rows.length}개 파일${query ? ` · 검색 결과 ${rows.length}개` : ''}`;
  const date = new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZone:'Asia/Seoul'});
  $('submissions-body').innerHTML = rows.map(row => {
    const result = String(row.result ?? 'X');
    const parts = Object.fromEntries(date.formatToParts(new Date(row.created_at)).map(part=>[part.type,part.value]));
    return `<tr data-submission-id="${escape(row.id)}"><td><span class="submission-name" title="${escape(row.team_name)}">${escape(row.team_name)}</span></td><td><span class="file-name" title="${escape(row.file_name)}">${escape(row.file_name)}</span></td><td><time datetime="${escape(row.created_at)}"><span class="submission-date">${parts.year}.${parts.month}.${parts.day}</span><span>${parts.hour}:${parts.minute}:${parts.second}</span></time></td><td><span class="${result === 'X' ? 'result-placeholder' : 'submission-result'}" aria-label="${result === 'X' ? '결과 미등록' : '제출 결과'}">${escape(result)}</span></td></tr>`;
  }).join('');
  $('empty-state').hidden = rows.length > 0;
  $('empty-title').textContent = state.loading ? '제출 목록을 불러오는 중이에요' : query ? '검색된 제출이 없어요' : '아직 제출된 파일이 없습니다.';
  $('empty-description').textContent = query ? '다른 이름이나 파일명으로 검색해보세요.' : '이름과 .py 파일을 제출해주세요.';
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
  const metadata = {id:record.id,team_name:record.team_name,file_name:record.file_name,file_size:record.file_size,created_at:record.created_at,result:record.result ?? 'X'};
  state.rows = [metadata,...state.rows.filter(row=>row.id !== record.id)];
  state.query = '';$('search-input').value = '';
  state.pending = null;state.file = null;
  $('file-input').value = '';$('submitter-name').value = '';$('upload-error').hidden = true;
  render();toast('대회 제출을 완료했어요.');
}
$('upload-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(state.busy || state.loading) return;
  if(!state.repository) return;
  try {validateName($('submitter-name').value);validateFile(state.file);} catch(error) {$('upload-error').textContent = readableError(error);$('upload-error').hidden = false;return;}
  setBusy(true);$('upload-error').hidden = true;$('upload-progress').hidden = false;
  try {
    const record = await state.repository.submit($('submitter-name').value,state.file,stage=>{$('upload-progress-label').textContent = stage === 'upload' ? '파일을 비공개 저장소에 보관하는 중…' : '이름과 파일명을 목록에 등록하는 중…';});
    savedSubmission(record);
  } catch(error) {
    try {state.pending = state.repository.getPending();} catch {}
    $('upload-error').textContent = readableError(error) + (state.pending ? ' 아래 버튼으로 제출 상태를 확인해주세요.' : '');$('upload-error').hidden = false;
  } finally {setBusy(false);$('upload-progress').hidden = true;render();}
});
$('retry-submission').addEventListener('click',async()=>{
  if(state.busy || !state.pending) return;
  if(!state.repository) return;
  setBusy(true);$('upload-error').hidden = true;
  try {savedSubmission(await state.repository.registerReceipt(state.pending));}
  catch(error) {
    if(isMissingFile(error)) {state.repository.clearPending();state.pending = null;state.file = null;$('file-input').value = '';}
    $('upload-error').textContent = readableError(error);$('upload-error').hidden = false;
  } finally {setBusy(false);render();}
});
$('search-input').addEventListener('input',event=>{state.query = event.target.value;renderList();});
$('refresh-list').addEventListener('click',async()=>{
  if(state.busy || !state.repository) return;
  setBusy(true);
  try {state.rows = await state.repository.list();notice('');toast('제출 목록을 새로 불러왔어요.');}
  catch(error) {notice(readableError(error));}
  finally {setBusy(false);render();}
});
$('notice-action').addEventListener('click',()=>{if(!state.busy && !state.loading)boot();});
document.addEventListener('keydown',event=>{if(event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target.matches('input,textarea')) {event.preventDefault();$('search-input').focus();}});
boot();
