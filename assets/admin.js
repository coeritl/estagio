const $ = (selector, root = document) => root.querySelector(selector);
const loginScreen = $('#login-screen');
const dashboard = $('#dashboard');
const loginForm = $('#login-form');
const loginMessage = $('#login-message');
const setupNotice = $('#setup-notice');
const list = $('#internship-list');
const emptyState = $('#empty-state');
const internshipDialog = $('#internship-dialog');
const internshipForm = $('#internship-form');
const internshipMessage = $('#internship-message');
const messageDialog = $('#message-dialog');
const passwordDialog = $('#password-dialog');
const passwordForm = $('#password-form');
const arrivedFromInvite = /(?:^|[&#])type=(?:invite|recovery)(?:&|$)/.test(window.location.hash);

let supabase;
let records = [];

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
  const states = [record.partial_report_date, record.final_report_date, record.expected_end_date].map(deadlineState);
  if (states.some(state => state.className === 'due')) return 'due';
  if (states.some(state => state.className === 'soon')) return 'soon';
  return 'active';
}

function emailMessage(record, type) {
  const isPartial = type === 'partial';
  const report = isPartial ? 'Relatório Parcial de Estágio' : 'Relatório Final de Estágio e a Ficha de Avaliação do Estagiário pelo Supervisor';
  const dueDate = isPartial ? record.partial_report_date : record.final_report_date;
  const firstName = record.student_name.trim().split(/\s+/)[0];
  return `Olá, ${firstName}!\n\nConforme o cronograma do seu estágio, chegou o momento de entregar o ${report}. A data prevista para essa entrega é ${formatDate(dueDate)}.\n\nConfira se o documento está totalmente preenchido e com as assinaturas necessárias. Encaminhe-o para coeri.tl@ifms.edu.br.\n\nEm caso de dúvida, entre em contato com a COERI.\n\nAtenciosamente,\nCoordenação de Extensão e Relações Institucionais\nIFMS Campus Três Lagoas`;
}

function setView(authenticated, email = '') {
  loginScreen.hidden = authenticated;
  dashboard.hidden = !authenticated;
  $('#admin-email').textContent = email;
}

async function loadRecords() {
  const { data, error } = await supabase.from('internships').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  records = data || [];
  render();
}

function renderDeadline(container, value) {
  const state = deadlineState(value);
  container.classList.remove('due', 'soon');
  if (state.className) container.classList.add(state.className);
  $('strong', container).textContent = formatDate(value);
  $('small', container).textContent = state.label;
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
  list.replaceChildren();
  emptyState.hidden = filtered.length > 0;

  filtered.forEach(record => {
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
    $('.notes', card).textContent = record.notes || '';
    list.append(card);
  });
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

list.addEventListener('click', async event => {
  const card = event.target.closest('.internship-card');
  if (!card) return;
  const record = records.find(item => item.id === card.dataset.id);
  if (event.target.closest('.menu-action')) openInternshipDialog(record);
  if (event.target.closest('.partial-reminder')) openMessage(record, 'partial');
  if (event.target.closest('.final-reminder')) openMessage(record, 'final');
  if (event.target.closest('.complete-button')) {
    if (!confirm(`Concluir e excluir permanentemente o cadastro de ${record.student_name}? Esta ação não poderá ser desfeita.`)) return;
    const { error } = await supabase.from('internships').delete().eq('id', record.id);
    if (!error) await loadRecords();
  }
});

function exportIfmsInsuranceList() {
  const now = new Date();
  const firstDayOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const eligible = records
    .filter(record => record.status === 'em_andamento' && record.insurance_provider === 'IFMS' && record.expected_end_date && localDate(record.expected_end_date) >= firstDayOfNextMonth)
    .sort((a, b) => a.student_name.localeCompare(b.student_name, 'pt-BR'));
  if (!eligible.length) { alert('Nenhum estagiário atende aos critérios da lista do seguro IFMS.'); return; }
  const csvCell = value => `"${String(value || '').replaceAll('"', '""')}"`;
  const rows = [['CPF', 'Nome', 'Sexo', 'Data de nascimento'], ...eligible.map(record => [record.student_cpf, record.student_name, record.student_sex, formatDate(record.student_birth_date)])];
  const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `estagiarios-seguro-ifms-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

$('#new-internship-button').addEventListener('click', () => openInternshipDialog());
$('#export-ifms-button').addEventListener('click', exportIfmsInsuranceList);
$('#logout-button').addEventListener('click', () => supabase.auth.signOut());
$('#search-input').addEventListener('input', render);
$('#deadline-filter').addEventListener('change', render);
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => internshipDialog.close()));
document.querySelectorAll('[data-close-message]').forEach(button => button.addEventListener('click', () => messageDialog.close()));
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
