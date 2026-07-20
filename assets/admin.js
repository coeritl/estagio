const $ = (selector, root = document) => root.querySelector(selector);
const loginScreen = $('#login-screen');
const dashboard = $('#dashboard');
const loginForm = $('#login-form');
const loginMessage = $('#login-message');
const setupNotice = $('#setup-notice');
const list = $('#internship-list');
const sentList = $('#sent-internship-list');
const emptyState = $('#empty-state');
const internshipDialog = $('#internship-dialog');
const internshipForm = $('#internship-form');
const internshipMessage = $('#internship-message');
const messageDialog = $('#message-dialog');
const passwordDialog = $('#password-dialog');
const passwordForm = $('#password-form');
const tceList = $('#tce-request-list');
const tceDialog = $('#tce-dialog');
const tceProcessForm = $('#tce-process-form');
const arrivedFromInvite = /(?:^|[&#])type=(?:invite|recovery)(?:&|$)/.test(window.location.hash);

let supabase;
let records = [];
let tceRequests = [];

const config = window.SUPABASE_CONFIG || {};
const isConfigured = /^https:\/\/.+\.supabase\.co$/.test(config.url || '') && Boolean(config.anonKey);

function localDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function today() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function formatDate(value) {
  return localDate(value)?.toLocaleDateString('pt-BR') || 'Não informada';
}

function daysFromToday(value) {
  const date = localDate(value);
  return date ? Math.round((date - today()) / 86400000) : null;
}

function deadlineState(value) {
  const days = daysFromToday(value);
  if (days === null) return { className: '', label: '' };
  if (days < 0) return { className: 'due', label: `Atrasado há ${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'}` };
  if (days === 0) return { className: 'due', label: 'Prazo atingido hoje' };
  if (days <= 7) return { className: 'soon', label: `Faltam ${days} dia${days === 1 ? '' : 's'}` };
  return { className: '', label: `Faltam ${days} dias` };
}

function recordState(record) {
  if (record.status === 'concluido') return 'completed';
  const dates = [
    record.partial_reminder_sent_at ? null : record.partial_report_date,
    record.final_reminder_sent_at ? null : record.final_report_date,
    record.expected_end_date
  ];
  const states = dates.map(deadlineState);
  if (states.some(state => state.className === 'due')) return 'due';
  if (states.some(state => state.className === 'soon')) return 'soon';
  return 'active';
}

function reminderDue(record, type) {
  const date = type === 'partial' ? record.partial_report_date : record.final_report_date;
  const sentAt = type === 'partial' ? record.partial_reminder_sent_at : record.final_reminder_sent_at;
  const days = daysFromToday(date);
  return days !== null && days <= 0 && !sentAt;
}

function belongsToSentList(record) {
  const hasSentReminder = Boolean(record.partial_reminder_sent_at || record.final_reminder_sent_at);
  return hasSentReminder && !reminderDue(record, 'partial') && !reminderDue(record, 'final');
}

function emailMessage(record, type) {
  const isPartial = type === 'partial';
  const report = isPartial ? 'Relatório Parcial de Estágio' : 'Relatório Final de Estágio e a Ficha de Avaliação do Estagiário pelo Supervisor';
  const dueDate = isPartial ? record.partial_report_date : record.final_report_date;
  const firstName = record.student_name.trim().split(/\s+/)[0];
  return `Olá, ${firstName}!\n\nConforme o cronograma do seu estágio, chegou o momento de entregar o ${report}. A data prevista para essa entrega é ${formatDate(dueDate)}.\n\nOs modelos dos relatórios e as orientações para preenchimento estão disponíveis em:\nhttps://coeritl.github.io/estagio/relatorios\n\nConfira se o documento está totalmente preenchido e com as assinaturas necessárias. Encaminhe-o para coeri.tl@ifms.edu.br.\n\nEm caso de dúvida, entre em contato com a COERI.\n\nAtenciosamente,\nCoordenação de Extensão e Relações Institucionais\nIFMS Campus Três Lagoas`;
}

function setView(authenticated, email = '') {
  loginScreen.hidden = authenticated;
  dashboard.hidden = !authenticated;
  $('#admin-email').textContent = email;
}

async function loadRecords() {
  const [internshipsResult, requestsResult] = await Promise.all([
    supabase.from('internships').select('*').order('created_at', { ascending: false }),
    supabase.from('tce_requests').select('*').order('created_at', { ascending: true })
  ]);
  if (internshipsResult.error) throw internshipsResult.error;
  records = internshipsResult.data || [];
  tceRequests = requestsResult.error ? [] : (requestsResult.data || []);
  render();
  renderTceRequests();
}

function detailItem(label, value) {
  const item = document.createElement('div');
  const term = document.createElement('span');
  const content = document.createElement('strong');
  term.textContent = label;
  content.textContent = value || 'Não informado';
  item.append(term, content);
  return item;
}

function requestProtocol(request) {
  return request.id.slice(0, 8).toUpperCase();
}

function renderTceRequests() {
  tceList.replaceChildren();
  $('#tce-request-count').textContent = tceRequests.length;
  $('#tce-empty-state').hidden = tceRequests.length > 0;
  tceRequests.forEach(request => {
    const card = document.createElement('article');
    card.className = 'tce-request-card';
    card.dataset.id = request.id;
    const main = document.createElement('div');
    const tag = document.createElement('span');
    tag.className = 'status-pill';
    tag.textContent = request.request_type === 'interno' ? 'Estágio interno' : 'Estágio externo';
    const title = document.createElement('h3');
    title.textContent = request.student_name;
    const summary = document.createElement('p');
    summary.textContent = `${request.student_course} · ${request.company_name}`;
    const received = document.createElement('small');
    received.textContent = `Protocolo ${requestProtocol(request)} · Recebido em ${new Date(request.created_at).toLocaleString('pt-BR')}`;
    main.append(tag, title, summary, received);
    const button = document.createElement('button');
    button.className = 'admin-button primary';
    button.type = 'button';
    button.textContent = 'Analisar solicitação';
    card.append(main, button);
    tceList.append(card);
  });
}

function openTceDialog(request) {
  $('#tce-request-id').value = request.id;
  $('#tce-dialog-title').textContent = request.student_name;
  $('#tce-internship-number').value = '';
  $('#tce-partial-date').value = '';
  $('#tce-final-date').value = request.expected_end_date || '';
  $('#tce-insurance-provider').value = '';
  $('#tce-process-message').textContent = '';
  const details = $('#tce-request-details');
  details.replaceChildren();
  const fields = [
    ['Protocolo', requestProtocol(request)],
    ['Tipo', request.request_type === 'interno' ? 'Estágio interno' : 'Estágio externo'],
    ['CPF', request.student_cpf], ['Sexo', request.student_sex], ['Nascimento', formatDate(request.student_birth_date)],
    ['E-mail', request.student_email], ['WhatsApp', request.student_phone], ['Curso', request.student_course], ['Período', request.student_period],
    ['Menor de idade', request.is_minor ? 'Sim' : 'Não'], ['Responsável legal', request.guardian_name], ['E-mail do responsável', request.guardian_email],
    ['CPF do responsável', request.guardian_cpf], ['Contato do responsável', request.guardian_phone], ['Unidade concedente', request.company_name],
    ['CNPJ', request.company_cnpj], ['E-mail da concedente', request.company_email], ['Contato da concedente', request.company_phone],
    ['Modalidade', request.internship_modality], ['Professor orientador', request.advisor_name], ['Remunerado', request.is_paid ? `Sim · R$ ${Number(request.scholarship_amount || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'Não'],
    ['Horário semanal', request.weekly_schedule], ['Início', formatDate(request.start_date)], ['Previsão de término', formatDate(request.expected_end_date)],
    ['Setor', request.internship_sector], ['Plano de atividades', request.activity_plan], ['Supervisor', request.supervisor_name],
    ['E-mail do supervisor', request.supervisor_email], ['WhatsApp do supervisor', request.supervisor_phone], ['Formação do supervisor', request.supervisor_education], ['Formação/experiência', request.supervisor_experience],
    ['Necessita de EPI', request.requires_epi ? 'Sim' : 'Não'], ['EPIs', request.epi_types]
  ];
  fields.filter(([, value]) => value !== null && value !== '').forEach(([label, value]) => details.append(detailItem(label, value)));
  tceDialog.showModal();
}

function renderDeadline(container, value) {
  const state = deadlineState(value);
  container.classList.remove('due', 'soon');
  if (state.className) container.classList.add(state.className);
  $('strong', container).textContent = formatDate(value);
  $('small', container).textContent = state.label;
}

function renderCard(record, target) {
  const card = $('#internship-card-template').content.firstElementChild.cloneNode(true);
  const state = recordState(record);
  card.dataset.id = record.id;
  card.classList.add(`status-${state}`);
  $('.status-pill', card).textContent = record.status === 'concluido' ? 'Concluído' : state === 'due' ? 'Prazo atingido' : state === 'soon' ? 'Prazo próximo' : 'Em andamento';
  $('.internship-number', card).textContent = record.internship_number ? `Estágio nº ${record.internship_number}` : 'Número pendente';
  $('.student-name', card).textContent = record.student_name;
  $('.course-company', card).textContent = `${record.course} · ${record.company_name}`;
  const email = $('.student-email', card);
  email.textContent = record.student_email || 'E-mail pendente';
  if (record.student_email) email.href = `mailto:${record.student_email}`;
  const whatsapp = $('.student-whatsapp', card);
  whatsapp.textContent = record.student_whatsapp ? `WhatsApp: ${record.student_whatsapp}` : 'WhatsApp pendente';
  if (record.student_whatsapp) {
    whatsapp.href = `https://wa.me/55${record.student_whatsapp.replace(/\D/g, '')}`;
    whatsapp.target = '_blank';
    whatsapp.rel = 'noopener';
  }
  $('.insurance', card).textContent = record.insurance_provider ? `Seguro: ${record.insurance_provider}` : 'Seguro pendente';
  renderDeadline($('.partial', card), record.partial_report_date);
  renderDeadline($('.final', card), record.final_report_date);
  renderDeadline($('.end', card), record.expected_end_date);
  const partialCheck = $('[data-reminder-type="partial"]', card);
  partialCheck.checked = Boolean(record.partial_reminder_sent_at);
  partialCheck.disabled = !record.partial_report_date;
  const finalCheck = $('[data-reminder-type="final"]', card);
  finalCheck.checked = Boolean(record.final_reminder_sent_at);
  finalCheck.disabled = !record.final_report_date;
  $('.notes', card).textContent = record.notes || '';
  target.append(card);
}

function render() {
  const query = $('#search-input').value.trim().toLocaleLowerCase('pt-BR');
  const deadline = $('#deadline-filter').value;
  const filtered = records.filter(record => {
    const haystack = `${record.internship_number} ${record.student_name} ${record.course} ${record.company_name}`.toLocaleLowerCase('pt-BR');
    const state = recordState(record);
    return (!query || haystack.includes(query)) && (deadline === 'all' || (deadline === 'due' && state === 'due') || (deadline === 'soon' && state === 'soon') || (deadline === 'ok' && state === 'active'));
  });

  $('#stat-active').textContent = records.filter(record => record.status === 'em_andamento').length;
  $('#stat-due').textContent = records.filter(record => recordState(record) === 'due').length;
  $('#stat-soon').textContent = records.filter(record => recordState(record) === 'soon').length;
  const pending = filtered.filter(record => !belongsToSentList(record));
  const sent = filtered.filter(belongsToSentList);
  list.replaceChildren();
  sentList.replaceChildren();
  emptyState.hidden = filtered.length > 0;
  $('#pending-list-count').textContent = pending.length;
  $('#sent-list-count').textContent = sent.length;
  $('#sent-group').hidden = sent.length === 0;
  pending.forEach(record => renderCard(record, list));
  sent.forEach(record => renderCard(record, sentList));
}

function openInternshipDialog(record = null) {
  internshipForm.reset();
  internshipMessage.textContent = '';
  $('#internship-id').value = record?.id || '';
  $('#internship-dialog-title').textContent = record ? 'Editar estágio' : 'Novo estágio';
  $('#internship-number').value = record?.internship_number || '';
  $('#student-name').value = record?.student_name || '';
  $('#student-cpf').value = record?.student_cpf || '';
  $('#student-sex').value = record?.student_sex || '';
  $('#student-birth-date').value = record?.student_birth_date || '';
  $('#student-email').value = record?.student_email || '';
  $('#student-whatsapp').value = record?.student_whatsapp || '';
  $('#student-course').value = record?.course || '';
  $('#company-name').value = record?.company_name || '';
  $('#end-date').value = record?.expected_end_date || '';
  $('#partial-date').value = record?.partial_report_date || '';
  $('#final-date').value = record?.final_report_date || '';
  $('#insurance-provider').value = record?.insurance_provider || '';
  $('#internship-notes').value = record?.notes || '';
  internshipDialog.showModal();
}

function openMessage(record, type) {
  const text = emailMessage(record, type);
  const subject = type === 'partial' ? 'Entrega do Relatório Parcial de Estágio' : 'Entrega dos documentos finais de estágio';
  $('#message-title').textContent = type === 'partial' ? 'Lembrete do relatório parcial' : 'Lembrete dos documentos finais';
  $('#message-text').value = text;
  $('#open-email').href = `mailto:${record.student_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  messageDialog.showModal();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!isConfigured) return;
  loginMessage.textContent = 'Entrando…';
  const { error } = await supabase.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
  loginMessage.textContent = error ? 'E-mail ou senha inválidos.' : '';
});

internshipForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = internshipForm.querySelector('[type="submit"]');
  button.disabled = true;
  internshipMessage.textContent = 'Salvando…';
  const id = $('#internship-id').value;
  const payload = {
    internship_number: $('#internship-number').value.trim() || null, student_name: $('#student-name').value.trim(), student_cpf: $('#student-cpf').value.trim() || null, student_sex: $('#student-sex').value || null, student_birth_date: $('#student-birth-date').value || null, student_email: $('#student-email').value.trim() || null, student_whatsapp: $('#student-whatsapp').value.trim() || null, course: $('#student-course').value,
    company_name: $('#company-name').value.trim(), expected_end_date: $('#end-date').value || null, partial_report_date: $('#partial-date').value || null, final_report_date: $('#final-date').value || null,
    insurance_provider: $('#insurance-provider').value || null, notes: $('#internship-notes').value.trim()
  };
  const request = id ? supabase.from('internships').update(payload).eq('id', id) : supabase.from('internships').insert(payload);
  const { error } = await request;
  button.disabled = false;
  if (error) { internshipMessage.textContent = 'Não foi possível salvar. Verifique os dados e tente novamente.'; return; }
  internshipDialog.close();
  await loadRecords();
});

async function handleCardAction(event) {
  const card = event.target.closest('.internship-card');
  if (!card) return;
  const record = records.find(item => item.id === card.dataset.id);
  const sentCheck = event.target.closest('.reminder-sent');
  if (sentCheck) {
    const column = sentCheck.dataset.reminderType === 'partial' ? 'partial_reminder_sent_at' : 'final_reminder_sent_at';
    sentCheck.disabled = true;
    const { error } = await supabase.from('internships').update({ [column]: sentCheck.checked ? new Date().toISOString() : null }).eq('id', record.id);
    if (error) { alert('Não foi possível atualizar o aviso. Tente novamente.'); sentCheck.checked = !sentCheck.checked; sentCheck.disabled = false; return; }
    await loadRecords();
    return;
  }
  if (event.target.closest('.menu-action')) openInternshipDialog(record);
  if (event.target.closest('.partial-reminder')) openMessage(record, 'partial');
  if (event.target.closest('.final-reminder')) openMessage(record, 'final');
  if (event.target.closest('.complete-button')) {
    if (!confirm(`Concluir e excluir permanentemente o cadastro de ${record.student_name}? Esta ação não poderá ser desfeita.`)) return;
    const { error } = await supabase.from('internships').delete().eq('id', record.id);
    if (!error) await loadRecords();
  }
}

list.addEventListener('click', handleCardAction);
sentList.addEventListener('click', handleCardAction);

tceList.addEventListener('click', event => {
  const card = event.target.closest('.tce-request-card');
  if (!card) return;
  const request = tceRequests.find(item => item.id === card.dataset.id);
  if (request) openTceDialog(request);
});

document.querySelectorAll('[data-admin-view]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-admin-view]').forEach(tab => tab.classList.toggle('active', tab === button));
  $('#tracking-view').hidden = button.dataset.adminView !== 'tracking';
  $('#requests-view').hidden = button.dataset.adminView !== 'requests';
}));

tceProcessForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = tceProcessForm.querySelector('[type="submit"]');
  const message = $('#tce-process-message');
  button.disabled = true;
  message.textContent = 'Registrando no acompanhamento…';
  const { error } = await supabase.rpc('process_tce_request', {
    p_request_id: $('#tce-request-id').value,
    p_internship_number: $('#tce-internship-number').value.trim() || null,
    p_partial_report_date: $('#tce-partial-date').value || null,
    p_final_report_date: $('#tce-final-date').value || null,
    p_insurance_provider: $('#tce-insurance-provider').value
  });
  button.disabled = false;
  if (error) { message.textContent = 'Não foi possível processar a solicitação. Verifique os campos e tente novamente.'; return; }
  tceDialog.close();
  await loadRecords();
});

$('#delete-tce-request').addEventListener('click', async () => {
  const request = tceRequests.find(item => item.id === $('#tce-request-id').value);
  if (!request || !confirm(`Excluir permanentemente a solicitação de ${request.student_name}?`)) return;
  const { error } = await supabase.from('tce_requests').delete().eq('id', request.id);
  if (error) { $('#tce-process-message').textContent = 'Não foi possível excluir a solicitação.'; return; }
  tceDialog.close();
  await loadRecords();
});

function exportIfmsInsuranceList() {
  const now = new Date();
  const firstDayOfCoverageWindow = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const eligible = records
    .filter(record => record.status === 'em_andamento' && record.insurance_provider === 'IFMS' && record.expected_end_date && localDate(record.expected_end_date) >= firstDayOfCoverageWindow)
    .sort((a, b) => a.student_name.localeCompare(b.student_name, 'pt-BR'));
  if (!eligible.length) { alert('Nenhum estagiário atende aos critérios da lista do seguro IFMS.'); return; }
  const csvCell = value => `"${String(value || '').replaceAll('"', '""')}"`;
  const rows = [['CPF', 'Nome', 'Sexo', 'Data de nascimento'], ...eligible.map(record => [record.student_cpf, record.student_name, record.student_sex || 'Não informado', formatDate(record.student_birth_date)])];
  const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `estagiarios-seguro-ifms-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyPendingEmails(type) {
  const pending = records.filter(record => record.status === 'em_andamento' && reminderDue(record, type));
  const emails = [...new Set(pending.map(record => record.student_email?.trim()).filter(Boolean))];
  const missingEmail = pending.filter(record => !record.student_email?.trim()).length;
  const reportName = type === 'partial' ? 'relatório parcial' : 'relatório final';
  if (!emails.length) {
    alert(`Não há e-mails cadastrados para avisos pendentes do ${reportName}.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(emails.join(', '));
    alert(`${emails.length} e-mail${emails.length === 1 ? '' : 's'} copiado${emails.length === 1 ? '' : 's'}. Cole a lista no campo Cco/Bcc.${missingEmail ? ` Há ${missingEmail} estudante${missingEmail === 1 ? '' : 's'} pendente${missingEmail === 1 ? '' : 's'} sem e-mail cadastrado.` : ''}`);
  } catch {
    alert('O navegador não permitiu copiar os e-mails. Recarregue a página e tente novamente.');
  }
}

$('#new-internship-button').addEventListener('click', () => openInternshipDialog());
$('#export-ifms-button').addEventListener('click', exportIfmsInsuranceList);
$('#copy-partial-emails').addEventListener('click', () => copyPendingEmails('partial'));
$('#copy-final-emails').addEventListener('click', () => copyPendingEmails('final'));
$('#logout-button').addEventListener('click', () => supabase.auth.signOut());
$('#search-input').addEventListener('input', render);
$('#deadline-filter').addEventListener('change', render);
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => internshipDialog.close()));
document.querySelectorAll('[data-close-message]').forEach(button => button.addEventListener('click', () => messageDialog.close()));
document.querySelectorAll('[data-close-tce]').forEach(button => button.addEventListener('click', () => tceDialog.close()));
$('#copy-message').addEventListener('click', async () => { await navigator.clipboard.writeText($('#message-text').value); $('#copy-message').textContent = 'Copiado!'; setTimeout(() => $('#copy-message').textContent = 'Copiar texto', 1500); });

passwordForm.addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#password-message');
  const password = $('#new-password').value;
  if (password !== $('#confirm-password').value) { message.textContent = 'As senhas não coincidem.'; return; }
  message.textContent = 'Salvando…';
  const { error } = await supabase.auth.updateUser({ password });
  if (error) { message.textContent = 'Não foi possível salvar a senha. Use pelo menos 8 caracteres e tente novamente.'; return; }
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  passwordDialog.close();
  message.textContent = '';
});

async function initialize() {
  $('#today-label').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());
  if (!isConfigured) { setupNotice.hidden = false; loginForm.querySelector('button').disabled = true; return; }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  supabase.auth.onAuthStateChange(async (_event, session) => {
    setView(Boolean(session), session?.user?.email || '');
    if (session) { try { await loadRecords(); } catch { setView(false); loginMessage.textContent = 'Esta conta não possui autorização para acessar o painel.'; await supabase.auth.signOut(); } }
  });
  const { data } = await supabase.auth.getSession();
  setView(Boolean(data.session), data.session?.user?.email || '');
  if (data.session) {
    await loadRecords();
    if (arrivedFromInvite) passwordDialog.showModal();
  }
}

initialize();
