const $ = (selector, root = document) => root.querySelector(selector);
const loginScreen = $('#login-screen');
const dashboard = $('#dashboard');
const loginForm = $('#login-form');
const loginMessage = $('#login-message');
const dashboardMessage = $('#dashboard-message');
const setupNotice = $('#setup-notice');
const list = $('#internship-list');
const sentList = $('#sent-internship-list');
const suspendedList = $('#suspended-internship-list');
const emptyState = $('#empty-state');
const internshipDialog = $('#internship-dialog');
const internshipForm = $('#internship-form');
const internshipMessage = $('#internship-message');
const messageDialog = $('#message-dialog');
const passwordDialog = $('#password-dialog');
const importDialog = $('#import-dialog');
const studentImportDialog = $('#student-import-dialog');
const agreementImportDialog = $('#agreement-import-dialog');
const advisorDialog = $('#advisor-dialog');
const advisorForm = $('#advisor-form');
const coordinationUserDialog = $('#coordination-user-dialog');
const coordinationUserForm = $('#coordination-user-form');
const passwordForm = $('#password-form');
const tceList = $('#tce-request-list');
const reportList = $('#report-admin-list');
const notificationList = $('#notification-admin-list');
const reportCorrectionDialog = $('#report-correction-dialog');
const reportCorrectionForm = $('#report-correction-form');
const tceDialog = $('#tce-dialog');
const tceProcessForm = $('#tce-process-form');
const arrivedFromInvite = /(?:^|[&#])type=(?:invite|recovery)(?:&|$)/.test(window.location.hash);

let supabase;
let records = [];
let tceRequests = [];
let reportSubmissions = [];
let emailNotifications = [];
let protocolStatuses = [];
let lastCopiedReminderBatch = null;
let pendingAcademicImport = [];
let pendingMissingAcademic = [];
let pendingStudentImport = [];
let pendingStudentRows = [];
let agreements = [];
let pendingAgreementImport = [];
let advisors = [];
let coordinationUsers = [];
let advisorAvailability = [];
let signatureSettings = { director_name: '', director_email: '' };

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

function formatPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function validBrazilianPhone(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  return /^\d{10,11}$/.test(digits);
}

function syncSignerDelivery(select) {
  const card = select.closest('.signer-card');
  if (!card) return;
  card.querySelectorAll('[data-contact]').forEach(field => { field.hidden = field.dataset.contact !== select.value; });
}

function resetSignerDelivery() {
  document.querySelectorAll('.signer-delivery').forEach(select => {
    select.value = 'email';
    syncSignerDelivery(select);
  });
}

function signerFromFields(prefix, role) {
  const delivery = $(`#signer-${prefix}-delivery`).value;
  return { role, name: $(`#signer-${prefix}-name`).value.trim(), delivery, email: $(`#signer-${prefix}-email`).value.trim(), phone: $(`#signer-${prefix}-phone`).value.trim() };
}

function comparablePersonName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function syncSupervisorWithAdvisor() {
  const checkbox = $('#supervisor-is-advisor');
  const card = $('#supervisor-signer-card');
  const delivery = $('#signer-supervisor-delivery');
  if (checkbox.checked) {
    $('#signer-supervisor-name').value = $('#signer-advisor-name').value;
    $('#signer-supervisor-email').value = $('#signer-advisor-email').value;
    $('#signer-supervisor-phone').value = $('#signer-advisor-phone').value;
    delivery.value = $('#signer-advisor-delivery').value;
  } else {
    $('#signer-supervisor-name').value = card.dataset.originalName || '';
    $('#signer-supervisor-email').value = card.dataset.originalEmail || '';
    $('#signer-supervisor-phone').value = card.dataset.originalPhone || '';
    delivery.value = card.dataset.originalDelivery || 'email';
  }
  delivery.disabled = checkbox.checked;
  $('#signer-supervisor-email').disabled = checkbox.checked;
  $('#signer-supervisor-phone').disabled = checkbox.checked;
  card.classList.toggle('linked-signer', checkbox.checked);
  syncSignerDelivery(delivery);
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

function reportDeadlineReached(record, type) {
  const date = type === 'partial' ? record.partial_report_date : record.final_report_date;
  const days = daysFromToday(date);
  return days !== null && days <= 0;
}

function belongsToSentList(record) {
  if (record.academic_status === 'Finalizado') return false;
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

async function showAuthenticatedSession(session) {
  if (!session) { setView(false); return; }
  const { data: isAdmin, error: roleError } = await supabase.rpc('is_coeri_admin');
  if (roleError || !isAdmin) {
    setView(false);
    await supabase.auth.signOut();
    loginMessage.textContent = 'Esta conta não possui acesso ao painel da COERI. Entre com o usuário administrativo; o acesso das coordenações deve ser feito na área própria.';
    return;
  }
  setView(true, session.user.email || '');
  dashboardMessage.hidden = true;
  dashboardMessage.textContent = '';
  try {
    await loadRecords();
  } catch (error) {
    console.error('Falha ao carregar o painel:', error);
    dashboardMessage.textContent = 'A sessão foi iniciada, mas os dados não puderam ser carregados agora. Atualize a página; se persistir, verifique a conexão com o Supabase.';
    dashboardMessage.hidden = false;
  }
}

async function loadRecords() {
  const [internshipsResult, requestsResult, reportsResult, statusesResult, agreementsResult, advisorsResult, availabilityResult, notificationsResult, signatureSettingsResult] = await Promise.all([
    supabase.from('internships').select('*').order('created_at', { ascending: false }),
    supabase.from('tce_requests').select('*').order('created_at', { ascending: true }),
    supabase.from('internship_report_submissions').select('*,internships(student_name,student_email,student_cpf,course,internship_number)').order('submitted_at', { ascending: false }),
    supabase.from('tce_protocol_statuses').select('*').order('updated_at', { ascending: false }),
    supabase.from('internship_agreements').select('*').order('external_institution'),
    supabase.from('internship_advisors').select('*').order('display_order').order('name'),
    supabase.rpc('get_advisor_availability', { p_start_date: new Date().toISOString().slice(0,10) }),
    supabase.from('email_notifications').select('*').is('archived_at', null).order('created_at', { ascending: false }).limit(500),
    supabase.from('coeri_signature_settings').select('*').eq('id', 'default').maybeSingle()
  ]);
  if (internshipsResult.error) throw internshipsResult.error;
  records = internshipsResult.data || [];
  tceRequests = requestsResult.error ? [] : (requestsResult.data || []);
  reportSubmissions = reportsResult.error ? [] : (reportsResult.data || []);
  protocolStatuses = statusesResult.error ? [] : (statusesResult.data || []);
  agreements = agreementsResult.error ? [] : (agreementsResult.data || []);
  advisors = advisorsResult.error ? [] : (advisorsResult.data || []);
  advisorAvailability = availabilityResult.error ? [] : (availabilityResult.data || []);
  emailNotifications = notificationsResult.error ? [] : (notificationsResult.data || []);
  signatureSettings = signatureSettingsResult.error || !signatureSettingsResult.data ? { director_name: '', director_email: '' } : signatureSettingsResult.data;
  $('#director-name').value = signatureSettings.director_name || '';
  $('#director-email').value = signatureSettings.director_email || '';
  render();
  renderTceRequests();
  renderReportSubmissions();
  renderAdvisors();
  renderEmailNotifications();
  renderOverview();
}

const notificationTypeLabels = {
  tce_recebido: 'Solicitação de TCE recebida',
  tce_gerado: 'TCE enviado para assinaturas',
  tce_correcao: 'Correção da solicitação de TCE',
  estagio_concluido: 'Estágio concluído',
  previsao_termino: 'Previsão de término atingida',
  relatorio_parcial: 'Entrega do relatório parcial',
  orientador_pendencias: 'Aviso sobre orientandos com entregas em atraso',
  relatorios_recebidos: 'Documentação recebida',
  relatorio_correcao: 'Correção de documento solicitada'
};

function hasIncompleteContact(record) {
  return !record.student_cpf || !record.student_email || !record.student_sex;
}

function renderOverview() {
  const activeRecords = records.filter(record => record.status === 'em_andamento');
  const inbox = tceRequests.length + reportSubmissions.filter(report => report.status !== 'aceito').length;
  const failures = emailNotifications.filter(item => item.status !== 'enviado').length;
  $('#inbox-count').textContent = inbox;
  $('#overview-inbox').textContent = inbox;
  $('#overview-due').textContent = activeRecords.filter(record => recordState(record) === 'due').length;
  $('#overview-notification-failures').textContent = failures;
  $('#overview-active').textContent = activeRecords.length;
  $('#overview-incomplete').textContent = activeRecords.filter(hasIncompleteContact).length;
  $('#overview-finalized').textContent = activeRecords.filter(record => record.academic_status === 'Finalizado').length;
  $('#overview-updated').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  renderOverviewCharts(activeRecords);
}

function appendLegendItem(container, label, value, className) {
  const item = document.createElement('div');
  item.className = 'legend-item';
  const marker = document.createElement('span');
  marker.className = `legend-marker ${className}`;
  const text = document.createElement('span');
  text.textContent = label;
  const count = document.createElement('strong');
  count.textContent = value;
  item.append(marker, text, count);
  container.append(item);
}

function compactCourseName(value) {
  return String(value || 'Curso não informado')
    .replace(/^\s*\d+\s*-\s*/, '')
    .replace(/^Tecnologia em\s+/i, '')
    .replace(/^Técnico(?: Integrado)? em\s+/i, '')
    .replace(/^Bacharelado em\s+/i, '')
    .trim();
}

function renderOverviewCharts(activeRecords) {
  const finalized = activeRecords.filter(record => record.academic_status === 'Finalizado').length;
  const due = activeRecords.filter(record => record.academic_status !== 'Finalizado' && recordState(record) === 'due').length;
  const soon = activeRecords.filter(record => record.academic_status !== 'Finalizado' && recordState(record) === 'soon').length;
  const regular = Math.max(0, activeRecords.length - finalized - due - soon);
  const total = Math.max(activeRecords.length, 1);
  const dueEnd = due / total * 100;
  const soonEnd = dueEnd + soon / total * 100;
  const regularEnd = soonEnd + regular / total * 100;
  const chart = $('#overview-status-chart');
  chart.style.background = activeRecords.length
    ? `conic-gradient(#d82935 0 ${dueEnd}%, #f2ae2e ${dueEnd}% ${soonEnd}%, #13864b ${soonEnd}% ${regularEnd}%, #7357b7 ${regularEnd}% 100%)`
    : 'conic-gradient(#dfe8e2 0 100%)';
  chart.setAttribute('aria-label', `${due} com prazo atingido, ${soon} próximos do prazo, ${regular} no prazo e ${finalized} finalizados no sistema acadêmico`);
  $('#overview-chart-total').textContent = activeRecords.length;
  const legend = $('#overview-status-legend');
  legend.replaceChildren();
  appendLegendItem(legend, 'Prazo atingido', due, 'danger');
  appendLegendItem(legend, 'Próximos 7 dias', soon, 'warning');
  appendLegendItem(legend, 'No prazo', regular, 'success');
  appendLegendItem(legend, 'Finalizado no acadêmico', finalized, 'academic');

  const courseCounts = new Map();
  activeRecords.forEach(record => {
    const name = compactCourseName(record.course);
    courseCounts.set(name, (courseCounts.get(name) || 0) + 1);
  });
  const courses = [...courseCounts.entries()].sort((a, b) => b[1] - a[1]);
  const visibleCourses = courses.slice(0, 6);
  if (courses.length > 6) visibleCourses.push(['Outros cursos', courses.slice(6).reduce((sum, item) => sum + item[1], 0)]);
  const maxCourse = Math.max(...visibleCourses.map(item => item[1]), 1);
  const courseChart = $('#overview-course-chart');
  courseChart.replaceChildren();
  if (!visibleCourses.length) {
    const empty = document.createElement('p'); empty.className = 'chart-empty'; empty.textContent = 'Nenhum estágio ativo para exibir.'; courseChart.append(empty);
  }
  visibleCourses.forEach(([name, value]) => {
    const row = document.createElement('div'); row.className = 'horizontal-bar-row';
    const label = document.createElement('span'); label.textContent = name; label.title = name;
    const track = document.createElement('div'); track.className = 'horizontal-bar-track';
    const bar = document.createElement('i'); bar.style.width = `${Math.max(5, value / maxCourse * 100)}%`; track.append(bar);
    const count = document.createElement('strong'); count.textContent = value;
    row.append(label, track, count); courseChart.append(row);
  });

  const monthChart = $('#overview-month-chart');
  monthChart.replaceChildren();
  const base = today();
  base.setDate(1);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(base.getFullYear(), base.getMonth() + index, 1);
    const count = activeRecords.filter(record => {
      const end = localDate(record.expected_end_date);
      return end && end.getFullYear() === date.getFullYear() && end.getMonth() === date.getMonth();
    }).length;
    return { date, count };
  });
  const maxMonth = Math.max(...months.map(item => item.count), 1);
  months.forEach(({ date, count }) => {
    const item = document.createElement('div'); item.className = 'month-bar-item';
    const countLabel = document.createElement('strong'); countLabel.textContent = count;
    const track = document.createElement('div'); track.className = 'month-bar-track';
    const bar = document.createElement('i'); bar.style.height = `${count ? Math.max(12, count / maxMonth * 100) : 3}%`; track.append(bar);
    const label = document.createElement('span'); label.textContent = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    item.append(countLabel, track, label); monthChart.append(item);
  });
  renderOverdueInsights(activeRecords);
}

function reportWasDelivered(record, type) {
  if (type === 'parcial' && record.partial_report_received_at) return true;
  return reportSubmissions.some(report => report.internship_id === record.id && report.document_type === type);
}

function overdueReportData(record) {
  const pending = [];
  const partialDays = daysFromToday(record.partial_report_date);
  const finalDays = daysFromToday(record.final_report_date);
  if (partialDays !== null && partialDays < 0 && !reportWasDelivered(record, 'parcial')) pending.push({ label: 'Parcial', days: Math.abs(partialDays) });
  if (finalDays !== null && finalDays < 0 && !reportWasDelivered(record, 'final')) pending.push({ label: 'Final', days: Math.abs(finalDays) });
  if (!pending.length) return null;
  return { record, pending, maxDays: Math.max(...pending.map(item => item.days)) };
}

function appendRankingRow(container, position, label, detail, value, secondary = '') {
  const row = document.createElement('div'); row.className = 'ranking-row';
  const order = document.createElement('span'); order.className = 'ranking-position'; order.textContent = position;
  const copy = document.createElement('div');
  const name = document.createElement('strong'); name.textContent = label;
  const note = document.createElement('small'); note.textContent = detail;
  if (secondary) {
    note.className = 'ranking-action';
    const context = document.createElement('small'); context.className = 'ranking-context'; context.textContent = secondary;
    copy.append(name, note, context);
  } else copy.append(name, note);
  const metric = document.createElement('b'); metric.textContent = value;
  row.append(order, copy, metric); container.append(row);
}

function renderEmptyRanking(container) {
  const empty = document.createElement('p');
  empty.className = 'ranking-empty';
  empty.textContent = 'Nenhum atraso identificado.';
  container.append(empty);
}

function renderOverdueInsights(activeRecords) {
  const overdue = activeRecords.map(overdueReportData).filter(Boolean).sort((a, b) => b.maxDays - a.maxDays);
  $('#overview-overdue-total').textContent = overdue.length;

  const studentRanking = $('#overview-student-ranking');
  studentRanking.replaceChildren();
  overdue.slice(0, 5).forEach((item, index) => {
    const reports = item.pending.map(report => report.label).join(' e ');
    appendRankingRow(studentRanking, index + 1, item.record.student_name || 'Estudante sem nome', `Falta entregar: ${reports.toLocaleLowerCase('pt-BR')}`, `${item.maxDays} dias`, compactCourseName(item.record.course));
  });
  if (!overdue.length) renderEmptyRanking(studentRanking);

  const aggregate = field => {
    const groups = new Map();
    overdue.forEach(item => {
      const key = String(item.record[field] || 'Não informado').trim() || 'Não informado';
      const current = groups.get(key) || { count: 0, maxDays: 0 };
      current.count += 1;
      current.maxDays = Math.max(current.maxDays, item.maxDays);
      groups.set(key, current);
    });
    return [...groups.entries()].sort((a, b) => b[1].count - a[1].count || b[1].maxDays - a[1].maxDays).slice(0, 5);
  };

  const courseRanking = $('#overview-course-ranking');
  courseRanking.replaceChildren();
  aggregate('course').forEach(([name, data], index) => appendRankingRow(courseRanking, index + 1, compactCourseName(name), `Maior atraso: ${data.maxDays} dias`, `${data.count}`));
  if (!overdue.length) renderEmptyRanking(courseRanking);

  const advisorRanking = $('#overview-advisor-ranking');
  advisorRanking.replaceChildren();
  aggregate('advisor_name').forEach(([name, data], index) => appendRankingRow(advisorRanking, index + 1, name, `Maior atraso: ${data.maxDays} dias`, `${data.count}`));
  if (!overdue.length) renderEmptyRanking(advisorRanking);
}

function renderEmailNotifications() {
  notificationList.replaceChildren();
  const attentionCount = emailNotifications.filter(item => item.status !== 'enviado').length;
  $('#notification-count').textContent = attentionCount;
  $('#notification-empty-state').hidden = emailNotifications.length > 0;
  emailNotifications.forEach(item => {
    const card = document.createElement('article');
    card.className = `notification-card status-${item.status}`;
    card.dataset.id = item.id;
    const content = document.createElement('div');
    content.className = 'notification-content';
    const heading = document.createElement('div');
    heading.className = 'notification-heading';
    const status = document.createElement('span');
    status.className = 'notification-status';
    status.textContent = item.status === 'enviado' ? 'Enviado pelo Gmail' : item.status === 'falhou' ? 'Falhou' : 'Pendente';
    const title = document.createElement('h3');
    title.textContent = `${notificationTypeLabels[item.event_type] || 'Notificação'} · ${item.student_name}`;
    heading.append(status, title);
    const destination = document.createElement('p');
    destination.textContent = item.recipient_email;
    const meta = document.createElement('p');
    meta.className = 'notification-meta';
    meta.textContent = `${item.attempts} tentativa${item.attempts === 1 ? '' : 's'} · ${item.sent_at ? `enviado em ${new Date(item.sent_at).toLocaleString('pt-BR')}` : `criado em ${new Date(item.created_at).toLocaleString('pt-BR')}`}`;
    content.append(heading, destination, meta);
    if (item.error_message) {
      const error = document.createElement('p');
      error.className = 'notification-error';
      error.textContent = item.error_message;
      content.append(error);
    }
    const actions = document.createElement('div');
    actions.className = 'notification-actions';
    if (item.status !== 'enviado') {
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'admin-button ghost notification-retry'; retry.textContent = 'Tentar novamente';
      actions.append(retry);
    }
    card.append(content, actions);
    notificationList.append(card);
  });
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
  tce_gerado: 'TCE gerado e encaminhado para assinaturas',
  pendente_correcao: 'Pendente de correção',
  tce_negado: 'TCE negado — consulte a COERI'
};

const generatedTceNote = 'TCE gerado e encaminhado para assinaturas. O Autentique enviará os links individuais pelos canais escolhidos pela COERI (e-mail ou WhatsApp). Confira suas mensagens e, no caso do e-mail, também as pastas de spam e lixo eletrônico.';

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

const reportTypeLabels = {
  parcial: 'Relatório parcial',
  final: 'Relatório final',
  avaliacao_supervisor: 'Avaliação pelo supervisor'
};

function formatFileSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return '—';
  return Number(bytes) < 1048576 ? `${Math.ceil(Number(bytes) / 1024)} KB` : `${(Number(bytes) / 1048576).toFixed(1)} MB`;
}

function renderReportSubmissions() {
  reportList.replaceChildren();
  $('#report-count').textContent = reportSubmissions.length;
  $('#report-empty-state').hidden = reportSubmissions.length > 0;
  reportSubmissions.forEach(report => {
    const student = report.internships || {};
    const card = document.createElement('article');
    card.className = 'report-admin-card';
    card.dataset.id = report.id;
    const heading = document.createElement('div');
    heading.className = 'report-admin-heading';
    const info = document.createElement('div');
    const tag = document.createElement('span');
    tag.className = `status-pill report-status-${report.status}`;
    tag.textContent = report.status === 'aceito' ? 'Conferido' : report.status === 'correcao_solicitada' ? 'Correção solicitada' : 'Novo';
    const title = document.createElement('h3');
    title.textContent = `${reportTypeLabels[report.document_type] || 'Documento'} · ${student.student_name || 'Estudante'}`;
    const summary = document.createElement('p');
    summary.textContent = `${student.course || 'Curso não informado'} · Estágio ${student.internship_number || 'sem número'}`;
    const received = document.createElement('small');
    received.textContent = `Recebido em ${new Date(report.submitted_at).toLocaleString('pt-BR')}`;
    info.append(tag, title, summary);
    heading.append(info, received);
    const details = document.createElement('div');
    details.className = 'report-admin-details';
    [
      ['Turma', report.student_class],
      ['Período do estágio', report.internship_period],
      ['Carga horária', `${report.total_workload} horas`],
      ['Arquivo', `${report.original_filename} · ${formatFileSize(report.file_size)}`],
      ['E-mail', report.contact_email || student.student_email],
      ['WhatsApp', report.contact_whatsapp || 'Não informado'],
      ['CPF', student.student_cpf]
    ].forEach(([label, value]) => details.append(detailItem(label, value)));
    if (report.admin_note) details.append(detailItem('Orientação enviada', report.admin_note));
    const actions = document.createElement('div');
    actions.className = 'report-admin-actions';
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'admin-button primary report-download';
    download.textContent = 'Baixar documento';
    const accepted = document.createElement('button');
    accepted.type = 'button';
    accepted.className = 'admin-button ghost report-accept';
    accepted.textContent = report.status === 'aceito' ? 'Conferido' : 'Marcar como conferido';
    accepted.disabled = report.status === 'aceito';
    const correction = document.createElement('button');
    correction.type = 'button';
    correction.className = 'admin-button reminder report-correction';
    correction.textContent = report.status === 'correcao_solicitada' ? 'Solicitar nova alteração' : 'Solicitar alteração';
    correction.disabled = report.status === 'aceito';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'admin-button danger-outline report-delete';
    remove.textContent = 'Apagar documento';
    actions.append(download, accepted, correction, remove);
    card.append(heading, details, actions);
    reportList.append(card);
  });
}

function openTceDialog(request) {
  $('#tce-request-id').value = request.id;
  $('#tce-dialog-title').textContent = request.student_name;
  $('#tce-internship-number').value = '';
  $('#tce-partial-date').value = '';
  $('#tce-final-date').value = request.expected_end_date || '';
  $('#tce-insurance-provider').value = request.insurance_provider || '';
  $('#tce-process-message').textContent = '';
  $('#tce-status-message').textContent = '';
  $('#autentique-message').textContent = '';
  $('#tce-pdf').value = '';
  const internal = request.request_type === 'interno';
  const selectedAdvisor = advisors.find(advisor => advisor.name.trim().toLocaleLowerCase('pt-BR') === String(request.advisor_name || '').trim().toLocaleLowerCase('pt-BR'));
  $('#signer-company-name').value = internal ? (signatureSettings.director_name || '') : '';
  $('#signer-company-email').value = internal ? (signatureSettings.director_email || '') : (request.company_email || '');
  $('#signer-company-phone').value = formatPhone(request.company_phone || '');
  $('#signer-student-name').value = request.student_name || '';
  $('#signer-student-email').value = request.student_email || '';
  $('#signer-student-phone').value = formatPhone(request.student_phone || '');
  $('#signer-advisor-name').value = request.advisor_name || '';
  $('#signer-advisor-email').value = selectedAdvisor?.email || '';
  $('#signer-advisor-phone').value = formatPhone(selectedAdvisor?.phone || '');
  $('#signer-supervisor-name').value = request.supervisor_name || '';
  $('#signer-supervisor-email').value = request.supervisor_email || '';
  $('#signer-supervisor-phone').value = formatPhone(request.supervisor_phone || '');
  const supervisorCard = $('#supervisor-signer-card');
  supervisorCard.dataset.originalName = request.supervisor_name || '';
  supervisorCard.dataset.originalEmail = request.supervisor_email || '';
  supervisorCard.dataset.originalPhone = formatPhone(request.supervisor_phone || '');
  supervisorCard.dataset.originalDelivery = 'email';
  $('#signer-guardian-name').value = request.guardian_name || '';
  $('#signer-guardian-email').value = request.guardian_email || '';
  $('#signer-guardian-phone').value = formatPhone(request.guardian_phone || '');
  $('#guardian-signer-fields').hidden = !request.is_minor;
  resetSignerDelivery();
  $('#supervisor-is-advisor').checked = Boolean(comparablePersonName(request.supervisor_name) && comparablePersonName(request.supervisor_name) === comparablePersonName(request.advisor_name));
  syncSupervisorWithAdvisor();
  $('#autentique-sandbox').checked = false;
  $('#send-to-autentique').textContent = 'Gerar e enviar pelo Autentique';
  const currentStatus = protocolStatus(request);
  $('#tce-public-status').value = currentStatus?.status || 'recebido';
  $('#tce-public-note').value = currentStatus?.public_note || '';
  $('#tce-document-url').value = currentStatus?.document_url || '';
  syncTceStatusFields();
  $('#generate-tce-button').textContent = currentStatus?.status === 'tce_gerado' ? 'Registrar no acompanhamento' : 'Gerar TCE';
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
    ['Seguro', request.insurance_provider], ['Seguradora', request.insurance_company_name], ['Número da apólice', request.insurance_policy_number],
    ['Capital segurado', request.insurance_coverage_amount ? `R$ ${Number(request.insurance_coverage_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null],
    ['Horário semanal', request.weekly_schedule], ['Início', formatDate(request.start_date)], ['Previsão de término', formatDate(request.expected_end_date)],
    ['Setor', request.internship_sector], ['Plano de atividades', request.activity_plan], ['Supervisor', request.supervisor_name],
    ['E-mail do supervisor', request.supervisor_email], ['WhatsApp do supervisor', request.supervisor_phone], ['Formação do supervisor', request.supervisor_education], ['Formação/experiência', request.supervisor_experience],
    ['Necessita de EPI', request.requires_epi ? 'Sim' : 'Não'], ['EPIs', request.epi_types]
  ];
  fields.filter(([, value]) => value !== null && value !== '').forEach(([label, value]) => details.append(detailItem(label, value)));
  tceDialog.showModal();
}

$('#autentique-sandbox').addEventListener('change', event => {
  $('#send-to-autentique').textContent = event.target.checked ? 'Criar teste no Autentique' : 'Gerar e enviar pelo Autentique';
});

document.querySelectorAll('.signer-delivery').forEach(select => select.addEventListener('change', () => {
  syncSignerDelivery(select);
  if (select.id === 'signer-advisor-delivery' && $('#supervisor-is-advisor').checked) syncSupervisorWithAdvisor();
}));
document.querySelectorAll('.mask-phone').forEach(input => input.addEventListener('input', () => {
  input.value = formatPhone(input.value);
  if (input.id === 'signer-advisor-phone' && $('#supervisor-is-advisor').checked) syncSupervisorWithAdvisor();
}));
$('#signer-advisor-email').addEventListener('input', () => { if ($('#supervisor-is-advisor').checked) syncSupervisorWithAdvisor(); });
$('#supervisor-is-advisor').addEventListener('change', syncSupervisorWithAdvisor);

$('#send-to-autentique').addEventListener('click', async () => {
  const request = tceRequests.find(item => item.id === $('#tce-request-id').value);
  const file = $('#tce-pdf').files?.[0];
  const message = $('#autentique-message');
  const button = $('#send-to-autentique');
  if (!request?.public_protocol) { message.textContent = 'A solicitação não possui protocolo público.'; return; }
  if (!file || file.type !== 'application/pdf' || file.size > 10 * 1024 * 1024) { message.textContent = 'Selecione o TCE em PDF, com no máximo 10 MB.'; return; }
  const signers = [signerFromFields('company', 'concedente'), signerFromFields('coeri', 'coeri'), signerFromFields('student', 'estudante'), signerFromFields('advisor', 'orientador'), signerFromFields('supervisor', 'supervisor')];
  if (request.is_minor) signers.push(signerFromFields('guardian', 'responsavel'));
  const invalidSigner = signers.find(signer => !signer.name || (signer.delivery === 'email' ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signer.email) : !validBrazilianPhone(signer.phone)));
  if (invalidSigner) { message.textContent = `Confira o nome e o ${invalidSigner.delivery === 'whatsapp' ? 'WhatsApp com DDD' : 'e-mail'} do signatário “${invalidSigner.name || invalidSigner.role}”.`; return; }
  const whatsappCount = signers.filter(signer => signer.delivery === 'whatsapp').length;
  const channelSummary = whatsappCount ? `${whatsappCount} convite${whatsappCount === 1 ? '' : 's'} por WhatsApp e ${signers.length - whatsappCount} por e-mail` : 'todos os convites por e-mail';
  if (!$('#autentique-sandbox').checked && !confirm(`Confirmar o envio REAL deste TCE (${channelSummary})? Os signatários receberão os convites do Autentique e o documento passará a integrar o fluxo oficial de assinaturas.`)) return;
  const body = new FormData();
  body.append('file', file); body.append('request_id', request.id); body.append('protocol', request.public_protocol);
  body.append('sandbox', String($('#autentique-sandbox').checked)); body.append('signers', JSON.stringify(signers));
  button.disabled = true; message.textContent = 'Enviando o documento ao Autentique…';
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch(`${config.url}/functions/v1/create-autentique-document`, { method: 'POST', headers: { Authorization: `Bearer ${sessionData.session?.access_token || ''}`, apikey: config.anonKey }, body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || 'Não foi possível criar o documento.');
    $('#tce-public-status').value = 'tce_gerado';
    $('#tce-public-note').value = result.sandbox ? 'TCE criado no ambiente de testes do Autentique.' : generatedTceNote;
    $('#tce-document-url').value = result.student_link || '';
    syncTceStatusFields();
    const currentStatus = protocolStatus(request);
    if (currentStatus) Object.assign(currentStatus, {
      status: 'tce_gerado',
      public_note: result.sandbox ? 'TCE criado no ambiente de testes do Autentique.' : generatedTceNote,
      document_url: result.student_link || null
    });
    $('#generate-tce-button').textContent = 'Registrar no acompanhamento';
    message.textContent = result.sandbox ? 'Teste criado com sucesso no Autentique. Confira os canais escolhidos.' : 'TCE criado e encaminhado aos signatários pelos canais escolhidos.';
    button.textContent = 'Documento enviado';
  } catch (error) { message.textContent = error.message || 'Não foi possível enviar o TCE ao Autentique.'; }
  finally { button.disabled = false; }
});

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
  const academicFinalized = record.status === 'em_andamento' && record.academic_status === 'Finalizado';
  const suspended = record.status === 'suspenso';
  card.classList.add(suspended ? 'status-suspended' : academicFinalized ? 'status-academic-finalized' : `status-${state}`);
  $('.status-pill', card).textContent = suspended ? 'Acompanhamento suspenso' : record.status === 'concluido' ? 'Concluído' : academicFinalized ? 'Finalizado no Sistema Acadêmico — revisar encerramento' : state === 'due' ? 'Prazo atingido' : state === 'soon' ? 'Prazo próximo' : 'Em andamento';
  const incompleteBadge = $('.incomplete-badge', card);
  if (record.status === 'em_andamento' && hasIncompleteContact(record)) {
    const missing = [!record.student_cpf && 'CPF', !record.student_email && 'e-mail', !record.student_sex && 'sexo'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' e $1');
    incompleteBadge.hidden = false;
    incompleteBadge.textContent = `⚠ ${missing} pendente — complemente o cadastro`;
  } else {
    incompleteBadge.hidden = true;
  }
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
  if (suspended) {
    partialCheck.disabled = true;
    finalCheck.disabled = true;
    const note = $('.suspension-note', card);
    note.hidden = false;
    const date = record.suspended_at ? new Date(record.suspended_at).toLocaleString('pt-BR') : 'data não registrada';
    note.textContent = `Suspenso em ${date}${record.suspension_reason ? ` · Motivo: ${record.suspension_reason}` : ''}`;
    $('.partial-reminder', card).hidden = true;
    $('.final-reminder', card).hidden = true;
    $('.complete-button', card).hidden = true;
    $('.suspend-button', card).textContent = 'Reativar acompanhamento';
  }
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
  const activeRecords = records.filter(record => record.status === 'em_andamento');
  const filtered = activeRecords.filter(record => {
    const haystack = `${record.internship_number} ${record.student_name} ${record.course} ${record.company_name}`.toLocaleLowerCase('pt-BR');
    const state = recordState(record);
    return (!query || haystack.includes(query)) && (deadline === 'all' || (deadline === 'due' && state === 'due') || (deadline === 'soon' && state === 'soon') || (deadline === 'ok' && state === 'active') || (deadline === 'incomplete' && hasIncompleteContact(record)));
  });

  $('#stat-active').textContent = records.filter(record => record.status === 'em_andamento').length;
  $('#stat-due').textContent = activeRecords.filter(record => recordState(record) === 'due').length;
  $('#stat-soon').textContent = activeRecords.filter(record => recordState(record) === 'soon').length;
  const suspended = records.filter(record => record.status === 'suspenso' && (!query || `${record.internship_number} ${record.student_name} ${record.course} ${record.company_name}`.toLocaleLowerCase('pt-BR').includes(query)));
  $('#stat-suspended').textContent = records.filter(record => record.status === 'suspenso').length;
  const pending = filtered.filter(record => !belongsToSentList(record)).sort((a, b) => Number(b.academic_status === 'Finalizado') - Number(a.academic_status === 'Finalizado'));
  const sent = filtered.filter(belongsToSentList);
  list.replaceChildren();
  sentList.replaceChildren();
  suspendedList.replaceChildren();
  emptyState.hidden = filtered.length > 0 || suspended.length > 0;
  $('#pending-list-count').textContent = pending.length;
  $('#sent-list-count').textContent = sent.length;
  $('#sent-group').hidden = sent.length === 0;
  $('#suspended-list-count').textContent = suspended.length;
  $('#suspended-group').hidden = suspended.length === 0;
  pending.forEach(record => renderCard(record, list));
  sent.forEach(record => renderCard(record, sentList));
  suspended.forEach(record => renderCard(record, suspendedList));
}


function renderAdvisors() {
  const container = $('#advisor-admin-list');
  container.replaceChildren();
  $('#advisor-count').textContent = advisors.filter(advisor => advisor.is_active).length;
  $('#advisor-empty-state').hidden = advisors.length > 0;
  advisors.forEach(advisor => {
    const card = document.createElement('article');
    card.className = `advisor-admin-card${advisor.is_active ? '' : ' inactive'}`;
    card.dataset.id = advisor.id;
    const content = document.createElement('div');
    const heading = document.createElement('div');
    heading.className = 'advisor-admin-heading';
    const name = document.createElement('h3');
    name.textContent = advisor.name;
    const status = document.createElement('span');
    status.className = `advisor-status${advisor.is_active ? '' : ' inactive'}`;
    status.textContent = advisor.is_active ? 'Público' : 'Oculto';
    heading.append(name, status);
    const areas = document.createElement('p');
    areas.textContent = advisor.areas;
    const email = document.createElement('p');
    email.textContent = [advisor.email, advisor.phone ? `WhatsApp: ${formatPhone(advisor.phone)}` : ''].filter(Boolean).join(' · ') || 'Contatos de assinatura ainda não cadastrados';
    const order = document.createElement('small');
    const availability = advisorAvailability.find(item => item.id === advisor.id);
    const occupied = Number(availability?.current_selections || 0);
    const limit = Number(advisor.max_selections || 5);
    const remaining = Math.max(limit - occupied, 0);
    order.textContent = `Ordem de exibição: ${advisor.display_order} · ${occupied} de ${limit} orientações no semestre atual · ${remaining} vaga${remaining === 1 ? '' : 's'} ${remaining === 1 ? 'disponível' : 'disponíveis'}`;
    content.append(heading, areas, email, order);
    const actions = document.createElement('div');
    actions.className = 'advisor-admin-actions';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'admin-button ghost advisor-toggle';
    toggle.textContent = advisor.is_active ? 'Ocultar' : 'Publicar';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'admin-button ghost advisor-edit';
    edit.textContent = 'Editar';
    actions.append(toggle, edit);
    card.append(content, actions);
    container.append(card);
  });
}

const coordinationCourseLabels = {
  ads: 'Análise e Desenvolvimento de Sistemas', engenharia_computacao: 'Engenharia de Computação',
  engenharia_controle_automacao: 'Engenharia de Controle e Automação', tecnico_eletrotecnica: 'Técnico em Eletrotécnica',
  tecnico_informatica: 'Técnico em Informática', tecnologia_automacao_industrial: 'Tecnologia em Automação Industrial',
  especializacao_docencia_epct: 'Especialização em Docência para EPCT', tecnico_administracao: 'Técnico em Administração'
};

function renderCoordinationUsers() {
  const container = $('#coordination-user-list');
  container.replaceChildren();
  $('#coordination-users-empty').hidden = coordinationUsers.length > 0;
  coordinationUsers.forEach(user => {
    const card = document.createElement('article'); card.className = `coordination-user-card${user.is_active ? '' : ' inactive'}`; card.dataset.email = user.email;
    const copy = document.createElement('div');
    const heading = document.createElement('div'); heading.className = 'coordination-user-heading';
    const name = document.createElement('h3'); name.textContent = user.coordination_name;
    const status = document.createElement('span'); status.textContent = user.is_active ? 'Ativo' : 'Bloqueado';
    heading.append(name, status);
    const email = document.createElement('p'); email.textContent = user.email;
    const courses = document.createElement('small'); courses.textContent = user.courses.map(course => coordinationCourseLabels[course] || course).join(' · ');
    const auth = document.createElement('small'); auth.className = user.auth_exists ? 'auth-ok' : 'auth-missing'; auth.textContent = user.auth_exists ? `Conta criada${user.last_sign_in_at ? ` · Último acesso: ${new Date(user.last_sign_in_at).toLocaleString('pt-BR')}` : ' · Ainda não acessou'}` : 'Conta ainda não criada no Authentication';
    copy.append(heading, email, courses, auth);
    const actions = document.createElement('div'); actions.className = 'coordination-user-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'admin-button ghost coordination-user-edit'; edit.textContent = 'Editar';
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'admin-button ghost coordination-user-reset'; reset.textContent = user.auth_exists ? 'Nova senha temporária' : 'Criar conta';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'admin-button ghost coordination-user-toggle'; toggle.textContent = user.is_active ? 'Bloquear acesso' : 'Reativar acesso';
    actions.append(edit, reset, toggle); card.append(copy, actions); container.append(card);
  });
}

async function loadCoordinationUsers() {
  const message = $('#coordination-users-message');
  message.textContent = 'Carregando usuários…';
  const { data, error } = await supabase.functions.invoke('manage-coordination-users', { body: { action: 'list' } });
  if (error || data?.error) { message.textContent = data?.error || 'Não foi possível carregar os usuários.'; return; }
  coordinationUsers = data.users || [];
  message.textContent = '';
  renderCoordinationUsers();
}

function openCoordinationUserDialog(user = null) {
  coordinationUserForm.reset();
  $('#coordination-user-dialog-title').textContent = user ? 'Editar usuário' : 'Novo usuário';
  $('#coordination-user-name').value = user?.coordination_name || '';
  $('#coordination-user-email').value = user?.email || '';
  $('#coordination-user-email').readOnly = Boolean(user);
  $('#coordination-user-active').checked = user?.is_active ?? true;
  $('#coordination-user-form-message').textContent = '';
  document.querySelectorAll('.coordination-course-options input').forEach(input => { input.checked = Boolean(user?.courses?.includes(input.value)); });
  coordinationUserDialog.showModal();
}

function showTemporaryPassword(email, password) {
  if (!password) return;
  navigator.clipboard?.writeText(password).catch(() => {});
  prompt(`Senha temporária de ${email}. Ela também foi copiada para a área de transferência. Envie-a por um canal seguro:`, password);
}

function openAdvisorDialog(advisor = null) {
  advisorForm.reset();
  $('#advisor-message').textContent = '';
  $('#advisor-id').value = advisor?.id || '';
  $('#advisor-dialog-title').textContent = advisor ? 'Editar orientador' : 'Novo orientador';
  $('#advisor-name').value = advisor?.name || '';
  $('#advisor-email').value = advisor?.email || '';
  $('#advisor-phone').value = formatPhone(advisor?.phone || '');
  $('#advisor-areas').value = advisor?.areas || '';
  $('#advisor-order').value = advisor?.display_order ?? (advisors.length + 1) * 10;
  $('#advisor-limit').value = advisor?.max_selections ?? 5;
  $('#advisor-active').checked = advisor?.is_active ?? true;
  $('#delete-advisor-button').hidden = !advisor;
  advisorDialog.showModal();
}

function maintenanceDate(value) {
  if (!value) return 'Nenhuma movimentação registrada';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

async function loadMaintenanceMetrics() {
  const button = $('#refresh-maintenance');
  const status = $('#maintenance-status');
  button.disabled = true;
  status.textContent = 'Consultando o Supabase…';
  $('#maintenance-connection').textContent = 'Verificando';
  try {
    const { data, error } = await supabase.rpc('get_maintenance_metrics');
    if (error) throw error;
    const metrics = typeof data === 'string' ? JSON.parse(data) : data;
    const percent = Math.max(0, Number(metrics.database_percent || 0));
    $('#maintenance-db-size').textContent = `${metrics.database_pretty} de 500 MB`;
    $('#maintenance-db-percent').textContent = `${percent.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% do limite gratuito do banco`;
    $('#maintenance-db-bar').style.width = `${Math.min(percent, 100)}%`;
    const dbCard = $('.database-usage');
    dbCard.classList.toggle('warning', percent >= 70 && percent < 90);
    dbCard.classList.toggle('danger', percent >= 90);
    $('#maintenance-last-change').textContent = maintenanceDate(metrics.last_change_at);
    $('#maintenance-connection').textContent = 'Operacional';
    $('#maintenance-internships').textContent = metrics.active_internships;
    $('#maintenance-requests').textContent = metrics.new_tce_requests;
    $('#maintenance-protocols').textContent = metrics.protocol_statuses;
    $('#maintenance-agreements').textContent = metrics.agreements;
    $('#maintenance-advisors').textContent = metrics.advisors;
    $('#maintenance-assignments').textContent = metrics.advisor_assignments;
    status.textContent = percent >= 90 ? 'Atenção: o banco está próximo do limite gratuito.' : 'Sistema consultado com sucesso.';
    $('#maintenance-updated').textContent = `Última verificação: ${maintenanceDate(metrics.checked_at)}`;
  } catch (error) {
    console.error('Falha na consulta de manutenção:', error);
    $('#maintenance-connection').textContent = 'Falha na consulta';
    status.textContent = 'Não foi possível atualizar os indicadores. Tente novamente.';
  } finally {
    button.disabled = false;
  }
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
  const cpf = formattedCpf($('#student-cpf').value);
  if (!cpf) {
    internshipMessage.textContent = 'Informe um CPF com 11 dígitos.';
    $('#student-cpf').focus();
    return;
  }
  button.disabled = true;
  internshipMessage.textContent = 'Salvando…';
  const id = $('#internship-id').value;
  const payload = {
    internship_number: $('#internship-number').value.trim() || null, student_name: $('#student-name').value.trim().toLocaleUpperCase('pt-BR'), student_cpf: cpf, student_sex: $('#student-sex').value || null, student_birth_date: $('#student-birth-date').value || null, student_email: $('#student-email').value.trim() || null, student_whatsapp: $('#student-whatsapp').value.trim() || null, course: $('#student-course').value,
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
  if (event.target.closest('.suspend-button')) {
    const suspending = record.status !== 'suspenso';
    let reason = null;
    if (suspending) {
      reason = prompt(`Informe o motivo da suspensão de ${record.student_name} (opcional):`, '');
      if (reason === null) return;
      if (!confirm(`Suspender o acompanhamento de ${record.student_name}? Os avisos automáticos serão interrompidos, mas o estágio não será concluído.`)) return;
    } else if (!confirm(`Reativar o acompanhamento de ${record.student_name}? Os prazos e avisos automáticos voltarão a ser considerados.`)) return;
    const { error } = await supabase.rpc('set_internship_suspension', { p_internship_id: record.id, p_suspend: suspending, p_reason: reason || null });
    if (error) { alert(`Não foi possível ${suspending ? 'suspender' : 'reativar'} o acompanhamento. ${error.message || ''}`); return; }
    await loadRecords();
    return;
  }
  if (event.target.closest('.complete-button')) {
    if (!confirm(`Concluir e excluir permanentemente o cadastro de ${record.student_name}? Esta ação não poderá ser desfeita.`)) return;
    const { data: result, error } = await supabase.functions.invoke('manage-email-notification', {
      body: { action: 'complete_internship', internship_id: record.id }
    });
    if (error || !result?.completed) {
      const detail = result?.error || error?.context?.error || error?.message || 'Tente novamente.';
      alert(`Não foi possível concluir e excluir o cadastro. ${detail}`);
      return;
    }
    await loadRecords();
    alert(result.sent
      ? `O estágio de ${record.student_name} foi concluído e a notificação foi enviada.`
      : `O estágio de ${record.student_name} foi concluído. O e-mail ficou pendente na Central de notificações.`);
  }
}

list.addEventListener('click', handleCardAction);
sentList.addEventListener('click', handleCardAction);
suspendedList.addEventListener('click', handleCardAction);

tceList.addEventListener('click', event => {
  const card = event.target.closest('.tce-request-card');
  if (!card) return;
  const request = tceRequests.find(item => item.id === card.dataset.id);
  if (request) openTceDialog(request);
});

reportList.addEventListener('click', async event => {
  const card = event.target.closest('.report-admin-card');
  const button = event.target.closest('button');
  if (!card || !button) return;
  const report = reportSubmissions.find(item => item.id === card.dataset.id);
  if (!report) return;
  if (button.classList.contains('report-download')) {
    button.disabled = true;
    button.textContent = 'Preparando…';
    const { data, error } = await supabase.storage.from('internship-reports').download(report.storage_path);
    button.disabled = false;
    button.textContent = 'Baixar documento';
    if (error) { alert('Não foi possível baixar o documento. Tente novamente.'); return; }
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = report.original_filename || `${report.document_type}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (button.classList.contains('report-correction')) {
    $('#report-correction-id').value = report.id;
    $('#report-correction-note').value = report.admin_note || '';
    $('#report-correction-message').textContent = '';
    reportCorrectionDialog.showModal();
    $('#report-correction-note').focus();
    return;
  }
  if (button.classList.contains('report-accept')) {
    button.disabled = true;
    if (report.document_type === 'avaliacao_supervisor') {
      const studentName = report.internships?.student_name || 'o estudante';
      if (!confirm(`Ao marcar a avaliação do supervisor como conferida, o estágio de ${studentName} será concluído e removido do acompanhamento. Todos os documentos enviados desse estágio também serão apagados.\n\nBaixe os arquivos necessários antes de continuar. Deseja concluir o estágio?`)) {
        button.disabled = false;
        return;
      }
      const { data: result, error } = await supabase.functions.invoke('manage-email-notification', {
        body: { action: 'complete_internship', report_id: report.id }
      });
      if (error || !result?.completed) {
        button.disabled = false;
        alert('Não foi possível conferir a avaliação e concluir o estágio. Tente novamente.');
        return;
      }
      await loadRecords();
      const completionNotice = result.sent
        ? `A avaliação foi conferida, o estágio de ${studentName} foi concluído e a notificação foi enviada.`
        : `A avaliação foi conferida e o estágio de ${studentName} foi concluído. O e-mail ficou pendente na Central de notificações.`;
      alert(result.cleanup_pending
        ? `${completionNotice}\n\nAtenção: os registros foram concluídos, mas alguns PDFs não puderam ser removidos do armazenamento. Consulte os logs da função manage-email-notification antes de encerrar a conferência.`
        : completionNotice);
      return;
    }
    const { error } = await supabase.from('internship_report_submissions').update({ status: 'aceito', reviewed_at: new Date().toISOString() }).eq('id', report.id);
    if (error) { button.disabled = false; alert('Não foi possível atualizar o documento.'); return; }
    await loadRecords();
    return;
  }
  if (button.classList.contains('report-delete')) {
    const studentName = report.internships?.student_name || 'o estudante';
    if (!confirm(`Apagar definitivamente o ${reportTypeLabels[report.document_type]} de ${studentName}?\n\nBaixe o documento antes de continuar. Esta ação libera espaço no armazenamento e não poderá ser desfeita.`)) return;
    button.disabled = true;
    button.textContent = 'Apagando…';
    const { error: storageError } = await supabase.storage.from('internship-reports').remove([report.storage_path]);
    if (storageError) { button.disabled = false; button.textContent = 'Apagar documento'; alert('Não foi possível apagar o arquivo. Tente novamente.'); return; }
    const { error } = await supabase.rpc('delete_internship_report', { p_report_id: report.id });
    if (error) alert('O arquivo foi apagado, mas o registro não pôde ser removido. Atualize a página e tente novamente.');
    await loadRecords();
  }
});

reportCorrectionForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = reportCorrectionForm.querySelector('[type="submit"]');
  const message = $('#report-correction-message');
  const correctionNote = $('#report-correction-note').value.trim();
  if (correctionNote.length < 5) {
    message.textContent = 'Descreva o que o estudante deve corrigir.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Enviando…';
  message.textContent = '';
  const { data, error } = await supabase.functions.invoke('manage-email-notification', {
    body: {
      action: 'request_report_correction',
      report_id: $('#report-correction-id').value,
      correction_note: correctionNote
    }
  });
  button.disabled = false;
  button.textContent = 'Registrar e enviar e-mail';
  if (error || !data?.updated) {
    message.textContent = data?.error || 'Não foi possível solicitar a alteração. Tente novamente.';
    return;
  }
  reportCorrectionDialog.close();
  await loadRecords();
  alert(data.sent
    ? 'A solicitação de alteração foi registrada e enviada ao estudante.'
    : 'A solicitação foi registrada, mas o e-mail ficou com falha na Central de notificações.');
});

$('#clear-sent-notifications').addEventListener('click', async () => {
  const sentCount = emailNotifications.filter(item => item.status === 'enviado').length;
  if (!sentCount) {
    alert('Não há notificações enviadas para limpar. As pendentes e as que falharam são preservadas.');
    return;
  }
  if (!confirm(`Retirar da Central ${sentCount} notificação${sentCount === 1 ? '' : 'ões'} já enviada${sentCount === 1 ? '' : 's'}?\n\nElas serão arquivadas para preservar o controle dos envios automáticos. Notificações pendentes ou com falha permanecerão visíveis.`)) return;
  const button = $('#clear-sent-notifications');
  button.disabled = true;
  button.textContent = 'Limpando…';
  const { data, error } = await supabase.functions.invoke('manage-email-notification', { body: { action: 'clear_sent' } });
  if (error || !data?.cleared) alert(data?.error || 'Não foi possível limpar as notificações enviadas. Tente novamente.');
  button.disabled = false;
  button.textContent = 'Limpar notificações enviadas';
  await loadRecords();
});

notificationList.addEventListener('click', async event => {
  const button = event.target.closest('.notification-retry');
  const card = event.target.closest('.notification-card');
  if (!button || !card) return;
  button.disabled = true;
  button.textContent = 'Enviando…';
  const { data, error } = await supabase.functions.invoke('manage-email-notification', {
    body: { action: 'retry', notification_id: card.dataset.id }
  });
  if (error || !data?.sent) alert(data?.error || 'Não foi possível enviar a notificação. Confira a configuração do Google Apps Script.');
  await loadRecords();
});

function activateAdminView(view) {
  document.querySelectorAll('[data-admin-view]').forEach(tab => tab.classList.toggle('active', tab.dataset.adminView === view));
  $('#overview-view').hidden = view !== 'overview';
  $('#tracking-view').hidden = view !== 'tracking';
  $('#requests-view').hidden = view !== 'inbox';
  $('#reports-view').hidden = view !== 'inbox';
  $('#notifications-view').hidden = view !== 'automation';
  $('#records-tools-view').hidden = view !== 'records';
  $('#advisors-view').hidden = view !== 'records';
  $('#coordination-users-view').hidden = view !== 'records';
  $('#maintenance-view').hidden = view !== 'maintenance';
  if (view === 'maintenance') loadMaintenanceMetrics();
  if (view === 'records') loadCoordinationUsers();
  document.querySelector('.admin-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.querySelectorAll('[data-admin-view]').forEach(button => button.addEventListener('click', () => activateAdminView(button.dataset.adminView)));
document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => activateAdminView(button.dataset.openView)));

tceProcessForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#generate-tce-button');
  const message = $('#tce-process-message');
  const request = tceRequests.find(item => item.id === $('#tce-request-id').value);
  if (!request?.public_protocol) {
    message.textContent = 'Esta solicitação antiga não possui protocolo público. Entre em contato com o suporte antes de continuar.';
    return;
  }
  if ($('#tce-public-status').value !== 'tce_gerado') {
    $('#tce-public-status').value = 'tce_gerado';
    $('#tce-public-note').value = generatedTceNote;
    syncTceStatusFields();
    button.disabled = true;
    message.textContent = 'Atualizando o status público…';
    const { error: generatedStatusError } = await supabase.from('tce_protocol_statuses').update({
      status: 'tce_gerado',
      public_note: generatedTceNote,
      document_url: null
    }).eq('protocol', request.public_protocol);
    button.disabled = false;
    if (generatedStatusError) {
      $('#tce-public-status').value = protocolStatus(request)?.status || 'recebido';
      syncTceStatusFields();
      message.textContent = 'Não foi possível atualizar o status público.';
      return;
    }
    const currentStatus = protocolStatus(request);
    if (currentStatus) Object.assign(currentStatus, { status: 'tce_gerado', public_note: generatedTceNote, document_url: null });
    button.textContent = 'Confirmar TCE gerado';
    message.textContent = 'O estudante já verá “TCE gerado e encaminhado para assinaturas”. Informe agora o link do documento e clique em “Confirmar TCE gerado”.';
    $('#tce-document-url').focus();
    return;
  }
  const documentUrl = $('#tce-document-url').value.trim();
  if (!/^https:\/\//i.test(documentUrl)) {
    message.textContent = 'Informe o link completo do documento para assinatura.';
    $('#tce-document-url').focus();
    return;
  }
  if (!$('#tce-insurance-provider').value) {
    message.textContent = 'Selecione quem fornece o seguro do estagiário.';
    $('#tce-insurance-provider').focus();
    return;
  }
  button.disabled = true;
  message.textContent = 'Salvando o status e registrando no acompanhamento…';
  const { error: reservationError } = await supabase.rpc('reserve_advisor_slot', {
    p_advisor_name: request.advisor_name,
    p_protocol: request.public_protocol,
    p_start_date: request.start_date
  });
  if (reservationError) {
    button.disabled = false;
    message.textContent = reservationError.message?.includes('ADVISOR_CAPACITY_REACHED') ? 'Este professor já atingiu cinco orientações no semestre. Selecione outro orientador no cadastro antes de continuar.' : 'Não foi possível reservar a vaga deste orientador.';
    return;
  }
  const { error: statusError } = await supabase.from('tce_protocol_statuses').update({
    status: 'tce_gerado',
    public_note: generatedTceNote,
    document_url: documentUrl
  }).eq('protocol', request.public_protocol);
  if (statusError) {
    button.disabled = false;
    message.textContent = 'Não foi possível salvar o status público e o link do documento.';
    return;
  }
  const { error } = await supabase.rpc('process_tce_request', {
    p_request_id: $('#tce-request-id').value,
    p_internship_number: $('#tce-internship-number').value.trim() || null,
    p_partial_report_date: $('#tce-partial-date').value || null,
    p_final_report_date: $('#tce-final-date').value || null,
    p_insurance_provider: $('#tce-insurance-provider').value
  });
  if (error) {
    button.disabled = false;
    message.textContent = 'O status e o link foram salvos, mas não foi possível registrar o acompanhamento. Verifique os campos e tente novamente.';
    return;
  }
  await supabase.from('tce_protocol_statuses').update({
    public_note: generatedTceNote,
    document_url: documentUrl
  }).eq('protocol', request.public_protocol);
  const { data: notificationResult } = await supabase.functions.invoke('manage-email-notification', {
    body: { action: 'tce_generated', protocol: request.public_protocol, document_url: documentUrl }
  });
  if (!notificationResult?.sent) {
    alert('O TCE foi registrado, mas o e-mail não foi enviado. Ele aparece como pendente na Central de notificações.');
  }
  button.disabled = false;
  tceDialog.close();
  await loadRecords();
});

$('#delete-tce-request').addEventListener('click', async () => {
  const request = tceRequests.find(item => item.id === $('#tce-request-id').value);
  if (!request || !confirm(`Excluir permanentemente a solicitação de ${request.student_name}?`)) return;
  const { error } = await supabase.from('tce_requests').delete().eq('id', request.id);
  if (error) { $('#tce-process-message').textContent = 'Não foi possível excluir a solicitação.'; return; }
  if (request.public_protocol) {
    await supabase.rpc('release_advisor_slot', { p_protocol: request.public_protocol });
    await supabase.from('tce_protocol_statuses').delete().eq('protocol', request.public_protocol);
  }
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
  if (status !== 'tce_negado') {
    const { error: reservationError } = await supabase.rpc('reserve_advisor_slot', { p_advisor_name: request.advisor_name, p_protocol: request.public_protocol, p_start_date: request.start_date });
    if (reservationError) {
      button.disabled = false;
      message.textContent = reservationError.message?.includes('ADVISOR_CAPACITY_REACHED') ? 'Este professor já atingiu cinco orientações no semestre. Selecione outro orientador no cadastro antes de continuar.' : 'Não foi possível reservar a vaga deste orientador.';
      return;
    }
  }
  const { error } = await supabase.from('tce_protocol_statuses').update({ status, public_note: publicNote || null, document_url: status === 'tce_gerado' ? documentUrl : null }).eq('protocol', request.public_protocol);
  button.disabled = false;
  if (error) { message.textContent = 'Não foi possível atualizar o status.'; return; }
  if (status === 'tce_negado') await supabase.rpc('release_advisor_slot', { p_protocol: request.public_protocol });
  if (status === 'pendente_correcao') {
    message.textContent = 'Status atualizado. Enviando a orientação ao estudante…';
    const { data: notificationResult, error: notificationError } = await supabase.functions.invoke('manage-email-notification', {
      body: { action: 'request_tce_correction', protocol: request.public_protocol, correction_note: publicNote }
    });
    if (notificationError) {
      message.textContent = 'Status público atualizado, mas não foi possível preparar o e-mail. Tente salvar novamente ou consulte a Central de notificações.';
    } else if (!notificationResult?.sent) {
      message.textContent = 'Status público atualizado. O e-mail ficou pendente na Central de notificações.';
    } else {
      message.textContent = 'Status público atualizado e orientação enviada ao e-mail do estudante.';
    }
  } else {
    message.textContent = 'Status público atualizado.';
  }
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
  const pending = records.filter(record => record.status === 'em_andamento' && reportDeadlineReached(record, type));
  const recordsWithEmail = pending.filter(record => record.student_email?.trim());
  const emails = [...new Set(recordsWithEmail.map(record => record.student_email.trim()))];
  const missingEmail = pending.filter(record => !record.student_email?.trim()).length;
  const reportName = type === 'partial' ? 'relatório parcial' : 'relatório final';
  if (!emails.length) {
    alert(`Não há e-mails cadastrados para estudantes com prazo atingido do ${reportName}.`);
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
function agreementPayload(row){return {academic_agreement_id:csvValue(row,'ID'),description:csvValue(row,'Descrição','Descricao'),start_date:csvDate(csvValue(row,'Data Inicio','Data de início','Data Início')),end_date:csvDate(csvValue(row,'Data Fim','Data de fim')),agreement_number:csvValue(row,'Numero','Número'),external_institution:csvValue(row,'Instituição Externa','Instituicao Externa'),imported_at:new Date().toISOString(),updated_at:new Date().toISOString()};}
function classifyAgreementRows(rows){const seen=new Set();return rows.map((row,index)=>{const payload=agreementPayload(row);if(!payload.academic_agreement_id||!payload.description||!payload.external_institution)return {action:'review',reason:'Faltam ID, descrição ou instituição',payload,row:index+2};if(seen.has(payload.academic_agreement_id))return {action:'review',reason:'ID repetido no arquivo',payload,row:index+2};seen.add(payload.academic_agreement_id);const existing=agreements.find(item=>String(item.academic_agreement_id)===payload.academic_agreement_id);if(!existing)return {action:'new',reason:'Novo convênio',payload,row:index+2,selected:true};const comparable={...payload};delete comparable.imported_at;delete comparable.updated_at;const changed=Object.entries(comparable).some(([key,value])=>String(existing[key]??'')!==String(value??''));return {action:changed?'update':'skip',reason:changed?'Atualizar convênio':'Sem alterações',payload,existing,row:index+2,selected:changed};});}
function updateAgreementImportButton(){const selected=pendingAgreementImport.filter(item=>item.selected&&(item.action==='new'||item.action==='update')).length;$('#confirm-agreement-import').disabled=selected===0;$('#confirm-agreement-import').textContent=selected?`Confirmar ${selected} alteração${selected===1?'':'ões'}`:'Nada selecionado';}
function renderAgreementImport(items){pendingAgreementImport=items;const counts=Object.fromEntries(['new','update','skip','review'].map(action=>[action,items.filter(item=>item.action===action).length]));const summary=$('#agreement-import-summary');summary.replaceChildren(...[['new','Novos'],['update','Atualizações'],['skip','Sem alteração'],['review','Revisar']].map(([key,label])=>{const item=document.createElement('div'),strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=counts[key];span.textContent=label;item.append(strong,span);return item;}));summary.hidden=false;const body=$('#agreement-import-preview-body');body.replaceChildren();items.forEach((item,index)=>{const tr=document.createElement('tr'),selectCell=document.createElement('td'),check=document.createElement('input');check.type='checkbox';check.className='agreement-import-select';check.dataset.index=index;check.checked=item.action==='new'||item.action==='update';check.disabled=!(item.action==='new'||item.action==='update');item.selected=check.checked;selectCell.append(check);tr.append(selectCell);[item.reason,item.payload.academic_agreement_id,item.payload.agreement_number,item.payload.external_institution,formatDate(item.payload.start_date),formatDate(item.payload.end_date)].forEach((value,cellIndex)=>{const td=document.createElement('td');if(cellIndex===0){const badge=document.createElement('span');badge.className=`import-action ${item.action}`;badge.textContent=value;td.append(badge);}else td.textContent=value||'—';tr.append(td);});body.append(tr);});$('#agreement-import-preview-wrap').hidden=false;updateAgreementImportButton();}
$('#import-agreements-button').addEventListener('click',()=>{$('#agreement-csv-file').value='';$('#agreement-import-message').textContent='';$('#agreement-import-summary').hidden=true;$('#agreement-import-preview-wrap').hidden=true;pendingAgreementImport=[];updateAgreementImportButton();agreementImportDialog.showModal();});
$('#agreement-csv-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;const message=$('#agreement-import-message');message.textContent='Analisando o arquivo…';try{const rows=parseCsv(await readAcademicCsv(file)),headers=Object.keys(rows[0]||{}),has=(...aliases)=>aliases.some(alias=>headers.includes(normalizeHeader(alias)));if(!has('ID')||!has('Descrição','Descricao')||!has('Instituição Externa','Instituicao Externa'))throw new Error('As colunas ID, Descrição e Instituição Externa não foram reconhecidas.');renderAgreementImport(classifyAgreementRows(rows));message.textContent=`${rows.length} convênio${rows.length===1?'':'s'} analisado${rows.length===1?'':'s'}. Confira antes de confirmar.`;}catch(error){pendingAgreementImport=[];$('#agreement-import-summary').hidden=true;$('#agreement-import-preview-wrap').hidden=true;updateAgreementImportButton();message.textContent=error.message||'Não foi possível ler o CSV.';}});
$('#agreement-import-preview-body').addEventListener('change',event=>{const check=event.target.closest('.agreement-import-select');if(!check)return;pendingAgreementImport[Number(check.dataset.index)].selected=check.checked;updateAgreementImportButton();});
$('#confirm-agreement-import').addEventListener('click',async()=>{const selected=pendingAgreementImport.filter(item=>item.selected&&(item.action==='new'||item.action==='update'));if(!selected.length||!confirm(`Atualizar ${selected.length} convênio${selected.length===1?'':'s'} na página pública?`))return;const button=$('#confirm-agreement-import'),message=$('#agreement-import-message');button.disabled=true;message.textContent='Atualizando convênios…';let completed=0;for(const item of selected){const query=item.action==='new'?supabase.from('internship_agreements').insert(item.payload):supabase.from('internship_agreements').update(item.payload).eq('academic_agreement_id',item.payload.academic_agreement_id);const {error}=await query;if(error){message.textContent=`${completed} convênio${completed===1?'':'s'} atualizado${completed===1?'':'s'}. A operação parou na linha ${item.row}: ${error.message}`;await loadRecords();return;}completed++;}await loadRecords();message.textContent=`${completed} convênio${completed===1?'':'s'} publicado${completed===1?'':'s'} com sucesso.`;button.textContent='Importação concluída';pendingAgreementImport=[];});
$('#new-advisor-button').addEventListener('click', () => openAdvisorDialog());
$('#advisor-admin-list').addEventListener('click', async event => {
  const card = event.target.closest('.advisor-admin-card');
  if (!card) return;
  const advisor = advisors.find(item => item.id === card.dataset.id);
  if (!advisor) return;
  if (event.target.closest('.advisor-edit')) { openAdvisorDialog(advisor); return; }
  if (event.target.closest('.advisor-toggle')) {
    const { error } = await supabase.from('internship_advisors').update({ is_active: !advisor.is_active }).eq('id', advisor.id);
    if (error) { alert('Não foi possível alterar a publicação deste orientador.'); return; }
    await loadRecords();
  }
});
advisorForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = advisorForm.querySelector('[type="submit"]');
  const message = $('#advisor-message');
  const id = $('#advisor-id').value;
  const limit = Number($('#advisor-limit').value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    message.textContent = 'Informe um limite entre 1 e 100 orientações por semestre.';
    return;
  }
  const advisorPhone = $('#advisor-phone').value.trim();
  if (advisorPhone && !validBrazilianPhone(advisorPhone)) { message.textContent = 'Informe um WhatsApp válido com DDD ou deixe o campo vazio.'; return; }
  const payload = { name: $('#advisor-name').value.trim(), email: $('#advisor-email').value.trim().toLowerCase(), phone: advisorPhone || null, areas: $('#advisor-areas').value.trim(), display_order: Number($('#advisor-order').value || 0), max_selections: limit, is_active: $('#advisor-active').checked };
  button.disabled = true;
  message.textContent = 'Salvando…';
  const query = id ? supabase.from('internship_advisors').update(payload).eq('id', id) : supabase.from('internship_advisors').insert(payload);
  const { error } = await query;
  button.disabled = false;
  if (error) { message.textContent = 'Não foi possível salvar o orientador. Verifique os dados e tente novamente.'; return; }
  advisorDialog.close();
  await loadRecords();
});

$('#signature-settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#signature-settings-message');
  const button = event.currentTarget.querySelector('[type="submit"]');
  const directorName = $('#director-name').value.trim();
  const directorEmail = $('#director-email').value.trim().toLowerCase();
  if (!directorName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(directorEmail)) {
    message.textContent = 'Informe o nome completo e um e-mail institucional válido.';
    return;
  }
  button.disabled = true;
  message.textContent = 'Salvando…';
  const { data, error } = await supabase.from('coeri_signature_settings').upsert({
    id: 'default',
    director_name: directorName,
    director_email: directorEmail
  }).select().single();
  button.disabled = false;
  if (error) {
    message.textContent = 'Não foi possível salvar o representante institucional.';
    return;
  }
  signatureSettings = data;
  message.textContent = 'Representante institucional atualizado.';
});
$('#delete-advisor-button').addEventListener('click', async () => {
  const id = $('#advisor-id').value;
  const advisor = advisors.find(item => item.id === id);
  if (!advisor || !confirm(`Excluir permanentemente ${advisor.name} da lista de orientadores?`)) return;
  const { error } = await supabase.from('internship_advisors').delete().eq('id', id);
  if (error) { $('#advisor-message').textContent = 'Não foi possível excluir o orientador.'; return; }
  advisorDialog.close();
  await loadRecords();
});
$('#refresh-maintenance').addEventListener('click', loadMaintenanceMetrics);
$('#new-internship-button').addEventListener('click', () => openInternshipDialog());
$('#new-coordination-user').addEventListener('click', () => openCoordinationUserDialog());
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
document.querySelectorAll('[data-close-agreement-import]').forEach(button=>button.addEventListener('click',()=>agreementImportDialog.close()));
document.querySelectorAll('[data-close-advisor]').forEach(button=>button.addEventListener('click',()=>advisorDialog.close()));
document.querySelectorAll('[data-close-coordination-user]').forEach(button=>button.addEventListener('click',()=>coordinationUserDialog.close()));
document.querySelectorAll('[data-close-report-correction]').forEach(button=>button.addEventListener('click',()=>reportCorrectionDialog.close()));
$('#copy-message').addEventListener('click', async () => { await navigator.clipboard.writeText($('#message-text').value); $('#copy-message').textContent = 'Copiado!'; setTimeout(() => $('#copy-message').textContent = 'Copiar texto', 1500); });

coordinationUserForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const message = $('#coordination-user-form-message');
  const courses = [...document.querySelectorAll('.coordination-course-options input:checked')].map(input => input.value);
  if (!courses.length) { message.textContent = 'Selecione ao menos um curso.'; return; }
  button.disabled = true; message.textContent = 'Salvando…';
  const email = $('#coordination-user-email').value.trim().toLowerCase();
  const { data, error } = await supabase.functions.invoke('manage-coordination-users', { body: { action: 'save', email, coordination_name: $('#coordination-user-name').value.trim(), courses, is_active: $('#coordination-user-active').checked } });
  button.disabled = false;
  if (error || data?.error) { message.textContent = data?.error || 'Não foi possível salvar o usuário.'; return; }
  coordinationUserDialog.close();
  await loadCoordinationUsers();
  showTemporaryPassword(email, data.temporary_password);
});

$('#coordination-user-list').addEventListener('click', async event => {
  const card = event.target.closest('.coordination-user-card');
  const button = event.target.closest('button');
  if (!card || !button) return;
  const user = coordinationUsers.find(item => item.email === card.dataset.email);
  if (!user) return;
  if (button.classList.contains('coordination-user-edit')) { openCoordinationUserDialog(user); return; }
  button.disabled = true;
  if (button.classList.contains('coordination-user-toggle')) {
    const active = !user.is_active;
    if (!confirm(`${active ? 'Reativar' : 'Bloquear'} o acesso de ${user.email}?`)) { button.disabled = false; return; }
    const { data, error } = await supabase.functions.invoke('manage-coordination-users', { body: { action: 'toggle', email: user.email, is_active: active } });
    if (error || data?.error) alert(data?.error || 'Não foi possível alterar o acesso.');
  }
  if (button.classList.contains('coordination-user-reset')) {
    if (!user.auth_exists) { openCoordinationUserDialog(user); button.disabled = false; return; }
    if (!confirm(`Gerar uma nova senha temporária para ${user.email}? A senha atual deixará de funcionar.`)) { button.disabled = false; return; }
    const { data, error } = await supabase.functions.invoke('manage-coordination-users', { body: { action: 'reset_password', email: user.email } });
    if (error || data?.error) alert(data?.error || 'Não foi possível redefinir a senha.'); else showTemporaryPassword(user.email, data.temporary_password);
  }
  await loadCoordinationUsers();
});


document.querySelectorAll('.action-menu').forEach(menu => {
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    document.querySelectorAll('.action-menu[open]').forEach(other => { if (other !== menu) other.open = false; });
  });
  menu.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { if (!button.disabled) menu.open = false; }));
});
document.addEventListener('click', event => {
  if (event.target.closest('.action-menu')) return;
  document.querySelectorAll('.action-menu[open]').forEach(menu => { menu.open = false; });
});
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
  supabase = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'coeri-admin-auth' } });
  const { data } = await supabase.auth.getSession();
  await showAuthenticatedSession(data.session);
  if (data.session) {
    if (arrivedFromInvite) passwordDialog.showModal();
  }
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    window.setTimeout(() => showAuthenticatedSession(session), 0);
  });
}

initialize();
