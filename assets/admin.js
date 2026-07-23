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
const importDialog = $('#import-dialog');
const studentImportDialog = $('#student-import-dialog');
const passwordForm = $('#password-form');
const tceList = $('#tce-request-list');
const tceDialog = $('#tce-dialog');
const tceProcessForm = $('#tce-process-form');
const arrivedFromInvite = /(?:^|[&#])type=(?:invite|recovery)(?:&|$)/.test(window.location.hash);

let supabase;
let records = [];
let tceRequests = [];
let protocolStatuses = [];
let lastCopiedReminderBatch = null;
let pendingAcademicImport = [];
let pendingMissingAcademic = [];
let pendingStudentImport = [];
let pendingStudentRows = [];

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
  return `Olá, ${firstName}!\n\nConforme o cronograma do seu estágio, chegou o momento de entregar o ${report}. A data prevista para essa entrega é ${formatDate(dueDate)}.\n\nOs modelos dos relatórios e as orientações para preenchimento estão disponíveis em:\nhttps://coeri.tl.ifms.edu.br/relatorios\n\nConfira se o documento está totalmente preenchido e com as assinaturas necessárias. Encaminhe-o para coeri.tl@ifms.edu.br.\n\nEm caso de dúvida, entre em contato com a COERI.\n\nAtenciosamente,\nCoordenação de Extensão e Relações Institucionais\nIFMS Campus Três Lagoas`;
}

function setView(authenticated, email = '') {
  loginScreen.hidden = authenticated;
  dashboard.hidden = !authenticated;
  $('#admin-email').textContent = email;
}

async function loadRecords() {
  const [internshipsResult, requestsResult, statusesResult] = await Promise.all([
    supabase.from('internships').select('*').order('created_at', { ascending: false }),
    supabase.from('tce_requests').select('*').order('created_at', { ascending: true }),
    supabase.from('tce_protocol_statuses').select('*').order('updated_at', { ascending: false })
  ]);
  if (internshipsResult.error) throw internshipsResult.error;
  records = internshipsResult.data || [];
  tceRequests = requestsResult.error ? [] : (requestsResult.data || []);
  protocolStatuses = statusesResult.error ? [] : (statusesResult.data || []);
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
  return request.public_protocol || request.id.slice(0, 8).toUpperCase();
}

const publicStatusLabels = {
  recebido: 'Recebido pela COERI',
  em_processamento: 'Em processamento pela COERI',
  tce_gerado: 'TCE gerado e enviado para assinaturas',
  pendente_correcao: 'Pendente de correção',
  tce_negado: 'TCE negado — consulte a COERI'
};

function protocolStatus(request) {
  return protocolStatuses.find(item => item.protocol === request.public_protocol) || null;
}

function syncTceStatusFields() {
  $('#tce-document-url-field').hidden = $('#tce-public-status').value !== 'tce_gerado';
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
    const statusLine = document.createElement('span');
    statusLine.className = 'public-status-line';
    statusLine.textContent = publicStatusLabels[protocolStatus(request)?.status] || 'Status público indisponível';
    main.append(tag, title, summary, received, statusLine);
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
  $('#tce-status-message').textContent = '';
  const currentStatus = protocolStatus(request);
  $('#tce-public-status').value = currentStatus?.status || 'recebido';
  $('#tce-public-note').value = currentStatus?.public_note || '';
  $('#tce-document-url').value = currentStatus?.document_url || '';
  syncTceStatusFields();
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
    ['Outros benefícios', request.other_benefits],
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
  if (record.academic_system_id) {
    const details = document.createElement('details');
    details.className = 'academic-wrap';
    const summary = document.createElement('summary');
    summary.textContent = `Dados do Sistema Acadêmico · ID ${record.academic_system_id}`;
    const grid = document.createElement('div');
    grid.className = 'academic-grid';
    [
      ['Matrícula', record.academic_enrollment], ['RA', record.academic_ra], ['Início', formatDate(record.start_date)], ['Orientador', record.advisor_name], ['Tipo', record.internship_type],
      ['Carga horária', record.academic_workload], ['Situação do estágio', record.academic_status], ['Situação do curso', record.course_status],
      ['Plano/avaliação', record.academic_activity_status]
    ].filter(([, value]) => value).forEach(([label, value]) => grid.append(detailItem(label, value)));
    details.append(summary, grid);
    $('.notes-wrap', card).before(details);
  }  const notes = $('.notes', card);
  notes.textContent = record.notes || '';
  notes.closest('.notes-wrap').hidden = !record.notes;
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
    internship_number: $('#internship-number').value.trim() || null, student_name: $('#student-name').value.trim().toLocaleUpperCase('pt-BR'), student_cpf: $('#student-cpf').value.trim() || null, student_sex: $('#student-sex').value || null, student_birth_date: $('#student-birth-date').value || null, student_email: $('#student-email').value.trim() || null, student_whatsapp: $('#student-whatsapp').value.trim() || null, course: $('#student-course').value,
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
    const { error } = await supabase.rpc('complete_internship', { p_internship_id: record.id });
    if (error) { alert('Não foi possível concluir e excluir o cadastro. Tente novamente.'); return; }
    await loadRecords();
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
  const request = tceRequests.find(item => item.id === $('#tce-request-id').value);
  const savedPublicStatus = request ? protocolStatus(request) : null;
  if (!savedPublicStatus || savedPublicStatus.status !== 'tce_gerado' || !/^https:\/\//i.test(savedPublicStatus.document_url || '')) {
    message.textContent = 'Antes de registrar no acompanhamento, selecione “TCE gerado”, informe o link do Autentique e salve o status.';
    return;
  }
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
  if (request.public_protocol) await supabase.from('tce_protocol_statuses').delete().eq('protocol', request.public_protocol);
  tceDialog.close();
  await loadRecords();
});

$('#save-tce-status').addEventListener('click', async () => {
  const request = tceRequests.find(item => item.id === $('#tce-request-id').value);
  const message = $('#tce-status-message');
  if (!request?.public_protocol) { message.textContent = 'Esta solicitação antiga não possui protocolo público.'; return; }
  const status = $('#tce-public-status').value;
  const publicNote = $('#tce-public-note').value.trim();
  const documentUrl = $('#tce-document-url').value.trim();
  if (status === 'pendente_correcao' && !publicNote) {
    message.textContent = 'Informe o que o estudante precisa corrigir.';
    $('#tce-public-note').focus();
    return;
  }
  if (status === 'tce_gerado' && !/^https:\/\//i.test(documentUrl)) {
    message.textContent = 'Informe o link completo do documento no Autentique.';
    $('#tce-document-url').focus();
    return;
  }
  const button = $('#save-tce-status');
  button.disabled = true;
  message.textContent = 'Salvando…';
  const { error } = await supabase.from('tce_protocol_statuses').update({ status, public_note: publicNote || null, document_url: status === 'tce_gerado' ? documentUrl : null }).eq('protocol', request.public_protocol);
  button.disabled = false;
  if (error) { message.textContent = 'Não foi possível atualizar o status.'; return; }
  message.textContent = 'Status público atualizado.';
  await loadRecords();
});

$('#tce-public-status').addEventListener('change', syncTceStatusFields);

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
  const recordsWithEmail = pending.filter(record => record.student_email?.trim());
  const emails = [...new Set(recordsWithEmail.map(record => record.student_email.trim()))];
  const missingEmail = pending.filter(record => !record.student_email?.trim()).length;
  const reportName = type === 'partial' ? 'relatório parcial' : 'relatório final';
  if (!emails.length) {
    alert(`Não há e-mails cadastrados para avisos pendentes do ${reportName}.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(emails.join(', '));
    lastCopiedReminderBatch = { type, ids: recordsWithEmail.map(record => record.id), count: recordsWithEmail.length };
    const markButton = $('#mark-copied-emails-sent');
    markButton.disabled = false;
    markButton.textContent = `Marcar ${type === 'partial' ? 'parcial' : 'final'} como enviado (${recordsWithEmail.length})`;
    alert(`${emails.length} e-mail${emails.length === 1 ? '' : 's'} copiado${emails.length === 1 ? '' : 's'}. Cole a lista no campo Cco/Bcc. Depois de efetivamente enviar o aviso, volte ao painel e use “Marcar como enviado”.${missingEmail ? ` Há ${missingEmail} estudante${missingEmail === 1 ? '' : 's'} pendente${missingEmail === 1 ? '' : 's'} sem e-mail cadastrado.` : ''}`);
  } catch {
    alert('O navegador não permitiu copiar os e-mails. Recarregue a página e tente novamente.');
  }
}

async function markCopiedEmailsAsSent() {
  if (!lastCopiedReminderBatch?.ids.length) return;
  const reportName = lastCopiedReminderBatch.type === 'partial' ? 'relatório parcial' : 'relatório final';
  if (!confirm(`Confirme somente se o aviso do ${reportName} já foi efetivamente enviado. Marcar ${lastCopiedReminderBatch.count} estudante${lastCopiedReminderBatch.count === 1 ? '' : 's'} como avisado${lastCopiedReminderBatch.count === 1 ? '' : 's'}?`)) return;
  const button = $('#mark-copied-emails-sent');
  button.disabled = true;
  button.textContent = 'Marcando avisos…';
  const column = lastCopiedReminderBatch.type === 'partial' ? 'partial_reminder_sent_at' : 'final_reminder_sent_at';
  const { error } = await supabase.from('internships').update({ [column]: new Date().toISOString() }).in('id', lastCopiedReminderBatch.ids);
  if (error) {
    button.disabled = false;
    button.textContent = 'Tentar marcar novamente';
    alert('Não foi possível marcar os avisos como enviados. Tente novamente.');
    return;
  }
  lastCopiedReminderBatch = null;
  button.textContent = 'Marcar última lista como enviada';
  await loadRecords();
  alert('Os avisos da lista copiada foram marcados como enviados.');
}

function normalizeHeader(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
}
function parseCsv(text) {
  const separatorLine = text.match(/^sep=([;,])\r?\n/i);
  const source = separatorLine ? text.slice(separatorLine[0].length) : text;
  const sample = source.split(/\r?\n/).find(line => line.trim()) || '';
  const delimiter = separatorLine?.[1] || ((sample.match(/;/g) || []).length >= (sample.match(/,/g) || []).length ? ';' : ',');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '"') { if (quoted && source[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && source[index + 1] === '\n') index++; row.push(cell.trim()); if (row.some(value => value)) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(value => value)) rows.push(row);
  if (rows.length < 2) throw new Error('O arquivo não possui linhas de dados.');
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ''])));
}
function csvValue(row, ...aliases) { for (const alias of aliases) { const value = row[normalizeHeader(alias)]; if (value) return value; } return ''; }
function csvDate(value) {
  const clean = String(value || '').trim(); let match = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  match = clean.match(/^(\d{4})-(\d{2})-(\d{2})/); return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
function normalizedIdentity(value) { return normalizeHeader(value).replace(/\s+/g, ' '); }
function canonicalCourse(value) {
  const withoutCode = String(value || '').replace(/^\s*\d+\s*-\s*/, '').trim();
  const key = normalizedIdentity(withoutCode);
  const aliases = {
    'tecnologia em analise e desenvolvimento de sistemas': 'Análise e Desenvolvimento de Sistemas',
    'tecnologia em automacao industrial': 'Automação Industrial',
    'tecnico em eletrotecnica': 'Técnico Integrado em Eletrotécnica',
    'tecnico em informatica': 'Técnico Integrado em Informática',
    'tecnico em administracao': 'Técnico Integrado em Administração (EJA-EPT)'
  };
  return aliases[key] || withoutCode;
}
function isTresLagoasCampus(value) {
  const campus = normalizedIdentity(value);
  return !campus || campus === 'tl' || campus === 'campus tl' || campus.includes('tres lagoas');
}
function academicPayload(row) {
  const academicStatus = csvValue(row, 'Situ. Estágio', 'Situacao Estagio', 'Situação Estágio');
  return {
    academic_system_id: csvValue(row, 'ID', 'Código', 'Codigo'), student_name: csvValue(row, 'Estudante', 'Aluno', 'Nome do estudante').toLocaleUpperCase('pt-BR'), course: canonicalCourse(csvValue(row, 'Curso')),
    company_name: csvValue(row, 'Convênio', 'Convenio', 'Unidade concedente', 'Empresa') || 'NÃO INFORMADA NO SISTEMA ACADÊMICO', start_date: csvDate(csvValue(row, 'Data de início', 'Data inicio')),
    expected_end_date: csvDate(csvValue(row, 'Data de Previsão de Encerramento', 'Previsão de encerramento')), advisor_name: csvValue(row, 'Orientador'), internship_type: csvValue(row, 'Tipo'),
    academic_workload: csvValue(row, 'Carga horária', 'Carga horaria'), academic_status: academicStatus, course_status: csvValue(row, 'Situ. Curso', 'Situacao Curso', 'Situação Curso'),
    academic_activity_status: csvValue(row, 'Lançamento Plano de Atividades/Avaliação', 'Lancamento Plano de Atividades Avaliacao'), closure_date: csvDate(csvValue(row, 'Data Fechamento', 'Data de fechamento')),
    academic_imported_at: new Date().toISOString(), campus: csvValue(row, 'Campus')
  };
}
function importedFields(payload) {
  const allowed = ['academic_system_id','student_name','course','company_name','start_date','expected_end_date','advisor_name','internship_type','academic_workload','academic_status','course_status','academic_activity_status','closure_date','academic_imported_at'];
  return Object.fromEntries(allowed.filter(key => payload[key] !== '' && payload[key] !== undefined).map(key => [key, payload[key] || null]));
}
function academicMatchScore(record, payload) {
  let score = 0;
  if (normalizedIdentity(canonicalCourse(record.course)) === normalizedIdentity(payload.course)) score++;
  if (normalizedIdentity(record.company_name) === normalizedIdentity(payload.company_name)) score++;
  if (record.expected_end_date && record.expected_end_date === payload.expected_end_date) score++;
  if (record.start_date && record.start_date === payload.start_date) score++;
  return score;
}function classifyAcademicRows(rows) {
  const seen = new Set();
  return rows.map((row, index) => {
    const payload = academicPayload(row);
    if (!payload.academic_system_id || !payload.student_name || !payload.course) return { action:'review', reason:'Faltam ID, estudante ou curso', payload, row:index + 2 };
    if (seen.has(payload.academic_system_id)) return { action:'review', reason:'ID repetido no arquivo', payload, row:index + 2 }; seen.add(payload.academic_system_id);
    if (!isTresLagoasCampus(payload.campus)) return { action:'review', reason:'Campus diferente de Três Lagoas', payload, row:index + 2 };
    const closed = payload.closure_date || /conclu|fechad|cancelad|rescindid/.test(normalizedIdentity(payload.academic_status));
    if (closed) return { action:'review', reason:'Fechado — não será excluído automaticamente', payload, row:index + 2 };
    let existing = records.find(item => String(item.academic_system_id || '') === payload.academic_system_id);
    if (!existing) {
      const candidates = records.filter(item => !item.academic_system_id && normalizedIdentity(item.student_name) === normalizedIdentity(payload.student_name));
      const ranked = candidates.map(item => ({ item, score: academicMatchScore(item, payload) })).sort((a, b) => b.score - a.score);
      const bestScore = ranked[0]?.score || 0;
      const best = ranked.filter(match => match.score === bestScore && match.score >= 2);
      if (best.length === 1) existing = best[0].item;
      if (best.length > 1) return { action:'review', reason:'Mais de um cadastro correspondente', payload, row:index + 2 };
    }    if (!existing) return { action:'new', reason:'Novo estágio', payload, row:index + 2 };
    const changes = importedFields(payload); delete changes.academic_imported_at;
    const changed = Object.entries(changes).some(([key,value]) => String(existing[key] ?? '') !== String(value ?? ''));
    return { action:changed ? 'update' : 'skip', reason:changed ? 'Atualizar dados acadêmicos' : 'Sem alterações', payload, existing, row:index + 2 };
  });
}
function renderImportPreview(items) {
  pendingAcademicImport = items; const counts = Object.fromEntries(['new','update','skip','review'].map(action => [action,items.filter(item => item.action === action).length]));
  const summary = $('#import-summary'); summary.replaceChildren(...[['new','Novos'],['update','Atualizações'],['skip','Sem alteração'],['review','Revisar']].map(([key,label]) => { const item=document.createElement('div'), strong=document.createElement('strong'), span=document.createElement('span'); strong.textContent=counts[key]; span.textContent=label; item.append(strong,span); return item; })); summary.hidden=false;
  const body=$('#import-preview-body'); body.replaceChildren(); items.forEach((item,itemIndex) => { const tr=document.createElement('tr'); const selectCell=document.createElement('td'); const check=document.createElement('input'); check.type='checkbox'; check.className='import-select'; check.dataset.index=itemIndex; check.checked=item.action==='new'||item.action==='update'; check.disabled=!check.checked; item.selected=check.checked; selectCell.append(check); tr.append(selectCell); [item.reason,item.payload.academic_system_id,item.payload.student_name,item.payload.course,item.payload.company_name,formatDate(item.payload.expected_end_date)].forEach((value,index) => { const td=document.createElement('td'); if(index===0){const badge=document.createElement('span');badge.className=`import-action ${item.action}`;badge.textContent=value;td.append(badge);}else td.textContent=value||'—';tr.append(td);});body.append(tr); });
  $('#import-preview-wrap').hidden=false; updateImportButton();
}
function updateMissingAcademicButton() {
  const selected=pendingMissingAcademic.filter(item=>item.selected).length;
  $('#remove-missing-academic').disabled=selected===0;
  $('#remove-missing-academic').textContent=selected?`Concluir e remover ${selected} selecionado${selected===1?'':'s'}`:'Concluir e remover selecionados';
}
function renderMissingAcademic(rows) {
  const csvIds=new Set(rows.map(row=>academicPayload(row)).filter(payload=>isTresLagoasCampus(payload.campus)&&payload.academic_system_id).map(payload=>payload.academic_system_id));
  pendingMissingAcademic=records.filter(record=>record.status==='em_andamento'&&record.academic_system_id&&!csvIds.has(String(record.academic_system_id))).sort((a,b)=>a.student_name.localeCompare(b.student_name,'pt-BR')).map(record=>({record,selected:false}));
  const section=$('#missing-academic-section'),body=$('#missing-academic-body');body.replaceChildren();section.hidden=pendingMissingAcademic.length===0;
  pendingMissingAcademic.forEach((item,index)=>{const tr=document.createElement('tr'),selectCell=document.createElement('td'),check=document.createElement('input');check.type='checkbox';check.className='missing-select';check.dataset.index=index;selectCell.append(check);tr.append(selectCell);[item.record.academic_system_id,item.record.internship_number||'Pendente',item.record.student_name,item.record.course,formatDate(item.record.expected_end_date)].forEach(value=>{const td=document.createElement('td');td.textContent=value||'—';tr.append(td);});body.append(tr);});
  updateMissingAcademicButton();
}function updateImportButton() {
  const selected=pendingAcademicImport.filter(item=>item.selected&&(item.action==='new'||item.action==='update')).length;
  $('#confirm-import-button').disabled=selected===0;
  $('#confirm-import-button').textContent=selected?`Confirmar ${selected} alteração${selected===1?'':'ões'}`:'Nada selecionado';
}
async function readAcademicCsv(file) { const bytes=await file.arrayBuffer(); let text=new TextDecoder('utf-8').decode(bytes); if(text.includes('\uFFFD')) text=new TextDecoder('windows-1252').decode(bytes); return text.replace(/^\uFEFF/,''); }
$('#import-academic-button').addEventListener('click', () => { $('#academic-csv-file').value=''; $('#import-message').textContent=''; $('#import-summary').hidden=true; $('#import-preview-wrap').hidden=true; $('#confirm-import-button').disabled=true; pendingAcademicImport=[]; pendingMissingAcademic=[]; $('#missing-academic-section').hidden=true; updateMissingAcademicButton(); importDialog.showModal(); });
$('#academic-csv-file').addEventListener('change', async event => {
  const file=event.target.files[0]; if(!file)return; const message=$('#import-message'); message.textContent='Analisando o arquivo…';
  try { const rows=parseCsv(await readAcademicCsv(file)); const headers=Object.keys(rows[0]||{}); if(!['id','estudante','curso'].every(header=>headers.includes(header))) throw new Error('As colunas ID, Estudante e Curso não foram reconhecidas.'); renderImportPreview(classifyAcademicRows(rows)); renderMissingAcademic(rows); message.textContent=`${rows.length} linha${rows.length===1?'':'s'} analisada${rows.length===1?'':'s'}. Confira antes de confirmar.`; }
  catch(error){ pendingAcademicImport=[]; pendingMissingAcademic=[]; $('#import-summary').hidden=true; $('#import-preview-wrap').hidden=true; $('#missing-academic-section').hidden=true; $('#confirm-import-button').disabled=true; updateMissingAcademicButton(); message.textContent=error.message||'Não foi possível ler o CSV.'; }
});
$('#import-preview-body').addEventListener('change',event=>{const check=event.target.closest('.import-select');if(!check)return;pendingAcademicImport[Number(check.dataset.index)].selected=check.checked;updateImportButton();});
$('#missing-academic-body').addEventListener('change',event=>{const check=event.target.closest('.missing-select');if(!check)return;pendingMissingAcademic[Number(check.dataset.index)].selected=check.checked;updateMissingAcademicButton();});
$('#remove-missing-academic').addEventListener('click',async()=>{const selected=pendingMissingAcademic.filter(item=>item.selected);if(!selected.length)return;const names=selected.map(item=>item.record.student_name).join('\n• ');if(!confirm(`Confirme que estes ${selected.length} estágio${selected.length===1?' foi concluído':'s foram concluídos'} e deve${selected.length===1?'':'m'} ser removido${selected.length===1?'':'s'} permanentemente do acompanhamento:\n\n• ${names}\n\nEsta ação não poderá ser desfeita.`))return;const button=$('#remove-missing-academic'),message=$('#import-message');button.disabled=true;message.textContent='Concluindo e removendo os estágios selecionados…';let completed=0;for(const item of selected){const {error}=await supabase.rpc('complete_internship',{p_internship_id:item.record.id});if(error){message.textContent=`${completed} removido${completed===1?'':'s'}. Não foi possível remover ${item.record.student_name}.`;await loadRecords();return;}completed++;}await loadRecords();pendingMissingAcademic=pendingMissingAcademic.filter(item=>!item.selected);message.textContent=`${completed} estágio${completed===1?'':'s'} concluído${completed===1?'':'s'} e removido${completed===1?'':'s'} do acompanhamento.`;$('#missing-academic-section').hidden=true;});$('#confirm-import-button').addEventListener('click', async () => {
  const actionable=pendingAcademicImport.filter(item=>item.selected&&(item.action==='new'||item.action==='update')); if(!actionable.length||!confirm(`Importar ${actionable.length} registro${actionable.length===1?'':'s'} do Sistema Acadêmico?`))return;
  const button=$('#confirm-import-button'),message=$('#import-message'); button.disabled=true; message.textContent='Importando registros…'; let completed=0;
  for(const item of actionable){ const payload=importedFields(item.payload); const query=item.action==='new'?supabase.from('internships').insert({...payload,status:'em_andamento'}):supabase.from('internships').update(payload).eq('id',item.existing.id); const {error}=await query; if(error){message.textContent=`${completed} registro${completed===1?'':'s'} importado${completed===1?'':'s'}. A importação parou na linha ${item.row}: ${error.message}`;await loadRecords();return;}completed++;}
  await loadRecords();message.textContent=`${completed} registro${completed===1?'':'s'} importado${completed===1?'':'s'} com sucesso.`;button.textContent='Importação concluída';pendingAcademicImport=[];
});
function formattedCpf(value) {
  const number=String(value||'').replace(/\D/g,'').slice(0,11);
  return number.length===11?number.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4'):'';
}
function normalizedPhones(value) {
  const matches=String(value||'').match(/\(\d{2}\)\s*\d{4,5}-\d{4}/g)||[];
  if(matches.length)return [...new Set(matches.map(phone=>phone.replace(/\s+/g,' ').trim()))].join(' / ');
  const number=String(value||'').replace(/\D/g,'').slice(0,11);
  if(number.length===11)return `(${number.slice(0,2)}) ${number.slice(2,7)}-${number.slice(7)}`;
  if(number.length===10)return `(${number.slice(0,2)}) ${number.slice(2,6)}-${number.slice(6)}`;
  return '';
}
function studentComplementPayload(row) {
  return {student_name:csvValue(row,'Estudante','Aluno','Nome do estudante').toLocaleUpperCase('pt-BR'),course:canonicalCourse(csvValue(row,'Curso')),campus:csvValue(row,'Campus'),academic_enrollment:csvValue(row,'Matrícula','Matricula'),academic_ra:csvValue(row,'RA'),student_email:csvValue(row,'Email','E-mail').toLowerCase(),student_cpf:formattedCpf(csvValue(row,'CPF')),student_birth_date:csvDate(csvValue(row,'Data de Nascimento','Nascimento')),student_whatsapp:normalizedPhones(csvValue(row,'Telefone','WhatsApp'))};
}
function classifyStudentRows(rows, replaceEmails = false) {
  const seen=new Set();
  return rows.map((row,index)=>{
    const payload=studentComplementPayload(row);const identity=payload.academic_enrollment||payload.academic_ra||normalizedIdentity(payload.student_name);
    if(!payload.student_name)return {action:'review',reason:'Nome do estudante ausente',payload,row:index+2};
    if(!isTresLagoasCampus(payload.campus))return {action:'review',reason:'Campus diferente de Três Lagoas',payload,row:index+2};
    if(seen.has(identity))return {action:'review',reason:'Estudante repetido no arquivo',payload,row:index+2};seen.add(identity);
    let matches=records.filter(item=>(payload.academic_enrollment&&item.academic_enrollment===payload.academic_enrollment)||(payload.academic_ra&&item.academic_ra===payload.academic_ra));
    if(!matches.length)matches=records.filter(item=>normalizedIdentity(item.student_name)===normalizedIdentity(payload.student_name));
    if(matches.length>1&&payload.course){const sameCourse=matches.filter(item=>normalizedIdentity(canonicalCourse(item.course))===normalizedIdentity(payload.course));if(sameCourse.length)matches=sameCourse;}
    if(matches.length===0)return {action:'review',reason:'Sem estágio correspondente',payload,row:index+2};
    const targets=matches.map(existing=>{const changes={};['student_cpf','student_birth_date','student_whatsapp','academic_enrollment','academic_ra'].forEach(key=>{if(!existing[key]&&payload[key])changes[key]=payload[key];});if(payload.student_email&&(!existing.student_email||(replaceEmails&&existing.student_email.trim().toLowerCase()!==payload.student_email)))changes.student_email=payload.student_email;if(Object.keys(changes).length)changes.academic_student_imported_at=new Date().toISOString();return {existing,changes};}).filter(target=>Object.keys(target.changes).length);
    if(!targets.length)return {action:'skip',reason:'Dados já preenchidos',payload,row:index+2};
    const fieldCount=targets.reduce((total,target)=>total+Object.keys(target.changes).length-1,0);
    const reason=matches.length>1?`Atualizar ${matches.length} estágios vinculados`:`Preencher ${fieldCount} campo${fieldCount===1?'':'s'}`;
    return {action:'update',reason,payload,targets,row:index+2,selected:true};
  });
}function updateStudentImportButton(){const selected=pendingStudentImport.filter(item=>item.action==='update'&&item.selected).length;$('#confirm-student-import').disabled=selected===0;$('#confirm-student-import').textContent=selected?`Confirmar ${selected} complementação${selected===1?'':'ões'}`:'Nada selecionado';}
function renderStudentImportPreview(items){pendingStudentImport=items;const counts={update:items.filter(x=>x.action==='update').length,skip:items.filter(x=>x.action==='skip').length,review:items.filter(x=>x.action==='review').length};const summary=$('#student-import-summary');summary.replaceChildren(...[['update','Complementar'],['skip','Já preenchidos'],['review','Revisar']].map(([key,label])=>{const item=document.createElement('div'),strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=counts[key];span.textContent=label;item.append(strong,span);return item;}));summary.hidden=false;const body=$('#student-import-preview-body');body.replaceChildren();items.forEach((item,itemIndex)=>{const tr=document.createElement('tr'),selectCell=document.createElement('td'),check=document.createElement('input');check.type='checkbox';check.className='student-import-select';check.dataset.index=itemIndex;check.checked=item.action==='update';check.disabled=item.action!=='update';item.selected=check.checked;selectCell.append(check);tr.append(selectCell);[item.reason,item.payload.student_name,item.payload.student_cpf,item.payload.student_email,formatDate(item.payload.student_birth_date),item.payload.student_whatsapp].forEach((value,index)=>{const td=document.createElement('td');if(index===0){const badge=document.createElement('span');badge.className=`import-action ${item.action}`;badge.textContent=value;td.append(badge);}else td.textContent=value||'—';tr.append(td);});body.append(tr);});$('#student-import-preview-wrap').hidden=false;updateStudentImportButton();}
$('#import-students-button').addEventListener('click',()=>{$('#student-csv-file').value='';$('#student-import-message').textContent='';$('#student-import-summary').hidden=true;$('#student-import-preview-wrap').hidden=true;pendingStudentImport=[];pendingStudentRows=[];$('#replace-student-emails').checked=false;updateStudentImportButton();studentImportDialog.showModal();});
$('#student-csv-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;const message=$('#student-import-message');message.textContent='Analisando o arquivo…';try{const rows=parseCsv(await readAcademicCsv(file)),headers=Object.keys(rows[0]||{});const hasHeader=(...aliases)=>aliases.some(alias=>headers.includes(normalizeHeader(alias)));const hasStudent=hasHeader('Estudante','Aluno','Nome do estudante');const hasComplement=hasHeader('Matrícula','Matricula','RA','Email','E-mail','CPF','Data de Nascimento','Nascimento','Telefone','WhatsApp');if(!hasStudent||!hasComplement)throw new Error('Cabeçalhos não reconhecidos. Encontrados: ' + (headers.join(', ') || 'nenhum') + '.');pendingStudentRows=rows;renderStudentImportPreview(classifyStudentRows(rows,$('#replace-student-emails').checked));message.textContent=`${rows.length} linha${rows.length===1?'':'s'} analisada${rows.length===1?'':'s'}. O campo sexo não está presente neste relatório.`;}catch(error){pendingStudentImport=[];$('#student-import-summary').hidden=true;$('#student-import-preview-wrap').hidden=true;updateStudentImportButton();message.textContent=error.message||'Não foi possível ler o CSV.';}});
$('#replace-student-emails').addEventListener('change',()=>{if(pendingStudentRows.length)renderStudentImportPreview(classifyStudentRows(pendingStudentRows,$('#replace-student-emails').checked));});$('#student-import-preview-body').addEventListener('change',event=>{const check=event.target.closest('.student-import-select');if(!check)return;pendingStudentImport[Number(check.dataset.index)].selected=check.checked;updateStudentImportButton();});
$('#confirm-student-import').addEventListener('click',async()=>{const selected=pendingStudentImport.filter(item=>item.action==='update'&&item.selected);if(!selected.length||!confirm(`Complementar os dados de ${selected.length} estudante${selected.length===1?'':'s'}?`))return;const button=$('#confirm-student-import'),message=$('#student-import-message');button.disabled=true;message.textContent='Atualizando dados faltantes…';let completed=0;for(const item of selected){for(const target of item.targets){const {error}=await supabase.from('internships').update(target.changes).eq('id',target.existing.id);if(error){message.textContent=`${completed} estudante${completed===1?'':'s'} atualizado${completed===1?'':'s'}. A operação parou na linha ${item.row}: ${error.message}`;await loadRecords();return;}}completed++;}await loadRecords();message.textContent=`Dados de ${completed} estudante${completed===1?'':'s'} complementados com sucesso.`;button.textContent='Complementação concluída';pendingStudentImport=[];});
$('#new-internship-button').addEventListener('click', () => openInternshipDialog());
$('#export-ifms-button').addEventListener('click', exportIfmsInsuranceList);
$('#copy-partial-emails').addEventListener('click', () => copyPendingEmails('partial'));
$('#copy-final-emails').addEventListener('click', () => copyPendingEmails('final'));
$('#mark-copied-emails-sent').addEventListener('click', markCopiedEmailsAsSent);
$('#logout-button').addEventListener('click', () => supabase.auth.signOut());
$('#search-input').addEventListener('input', render);
$('#deadline-filter').addEventListener('change', render);
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => internshipDialog.close()));
document.querySelectorAll('[data-close-message]').forEach(button => button.addEventListener('click', () => messageDialog.close()));
document.querySelectorAll('[data-close-tce]').forEach(button => button.addEventListener('click', () => tceDialog.close()));
document.querySelectorAll('[data-close-import]').forEach(button => button.addEventListener('click', () => importDialog.close()));
document.querySelectorAll('[data-close-student-import]').forEach(button => button.addEventListener('click', () => studentImportDialog.close()));
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
