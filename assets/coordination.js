const $ = selector => document.querySelector(selector);
const config = window.SUPABASE_CONFIG || {};
let supabase;
let internships = [];
let recentSubmissions = [];

function localDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function today() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysFromToday(value) {
  const date = localDate(value);
  return date ? Math.round((date - today()) / 86400000) : null;
}

function formatDate(value) {
  return localDate(value)?.toLocaleDateString('pt-BR') || 'Não informada';
}

function compactCourse(value) {
  return String(value || 'Curso não informado').replace(/^\s*\d+\s*-\s*/, '').replace(/^Tecnologia em\s+/i, '').replace(/^Técnico(?: Integrado)? em\s+/i, '').trim();
}

function finalizationIssue(record) {
  const end = daysFromToday(record.expected_end_date);
  if (record.academic_status === 'Finalizado' || end === null || end >= 0) return null;
  const missing = [];
  if (!record.final_delivered) missing.push('relatório final');
  if (!record.supervisor_evaluation_delivered) missing.push('avaliação do supervisor');
  return missing.length ? { missing, days: Math.abs(end) } : null;
}

function partialIssue(record) {
  const partial = daysFromToday(record.partial_report_date);
  return partial !== null && partial < 0 && !record.partial_delivered
    ? { days: Math.abs(partial) }
    : null;
}

function recordState(record) {
  if (record.academic_status === 'Finalizado') return 'academic';
  if (finalizationIssue(record)) return 'overdue';
  if (partialIssue(record)) return 'partial';
  const end = daysFromToday(record.expected_end_date);
  if (end !== null && end >= 0 && end <= 30) return 'soon';
  return 'regular';
}

function showAuthenticated(authenticated, email = '') {
  $('#coordination-login').hidden = authenticated;
  $('#coordination-dashboard').hidden = !authenticated;
  $('#coordination-account-email').textContent = email;
}

function appendLegend(container, label, value, colorClass = '') {
  const row = document.createElement('div'); row.className = 'legend-row';
  const marker = document.createElement('i'); marker.className = colorClass;
  const text = document.createElement('span'); text.textContent = label;
  const count = document.createElement('strong'); count.textContent = value;
  row.append(marker, text, count); container.append(row);
}

function appendRanking(container, position, title, detail, value) {
  const row = document.createElement('div'); row.className = 'ranking-item';
  const order = document.createElement('span'); order.textContent = position;
  const copy = document.createElement('div');
  const name = document.createElement('strong'); name.textContent = title;
  const note = document.createElement('small'); note.textContent = detail;
  copy.append(name, note);
  const metric = document.createElement('b'); metric.textContent = value;
  row.append(order, copy, metric); container.append(row);
}

function emptyRanking(container, text = 'Nenhum atraso prioritário identificado.') {
  const message = document.createElement('p'); message.className = 'ranking-empty'; message.textContent = text; container.append(message);
}

function renderSubmissionHistory() {
  const container = $('#coordination-history');
  const empty = $('#coordination-history-empty');
  container.replaceChildren();
  empty.hidden = recentSubmissions.length > 0;
  recentSubmissions.forEach(item => {
    const row = document.createElement('article'); row.className = 'coordination-history-item';
    const type = document.createElement('span'); type.textContent = item.item_type === 'tce' ? 'TCE' : 'Documento';
    const copy = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = item.student_name;
    const detail = document.createElement('small'); detail.textContent = item.detail;
    copy.append(name, detail);
    const date = document.createElement('time');
    date.dateTime = item.submitted_at;
    date.textContent = new Date(item.submitted_at).toLocaleString('pt-BR');
    row.append(type, copy, date); container.append(row);
  });
}

function renderDashboard() {
  const overdue = internships.map(record => ({ record, issue: finalizationIssue(record) })).filter(item => item.issue).sort((a, b) => b.issue.days - a.issue.days);
  const partials = internships.map(record => ({ record, issue: partialIssue(record) })).filter(item => item.issue && !finalizationIssue(item.record)).sort((a, b) => b.issue.days - a.issue.days);
  const states = { overdue: 0, partial: 0, soon: 0, academic: 0, regular: 0 };
  internships.forEach(record => states[recordState(record)] += 1);
  $('#metric-active').textContent = internships.length;
  $('#metric-overdue').textContent = overdue.length;
  $('#metric-soon').textContent = internships.filter(record => { const days = daysFromToday(record.expected_end_date); return days !== null && days >= 0 && days <= 30; }).length;
  $('#metric-finalized').textContent = internships.filter(record => record.academic_status === 'Finalizado').length;
  $('#ranking-total').textContent = overdue.length;
  $('#partial-ranking-total').textContent = partials.length;
  $('#donut-total').textContent = internships.length;

  const total = Math.max(internships.length, 1);
  const overdueEnd = states.overdue / total * 100;
  const partialEnd = overdueEnd + states.partial / total * 100;
  const soonEnd = partialEnd + states.soon / total * 100;
  const regularEnd = soonEnd + states.regular / total * 100;
  $('#coordination-donut').style.background = internships.length ? `conic-gradient(#d82935 0 ${overdueEnd}%,#d5a02e ${overdueEnd}% ${partialEnd}%,#efa91f ${partialEnd}% ${soonEnd}%,#087b43 ${soonEnd}% ${regularEnd}%,#7357b7 ${regularEnd}% 100%)` : '#e1e9e3';
  const legend = $('#coordination-legend'); legend.replaceChildren();
  appendLegend(legend, 'Finalização com prazo atingido', states.overdue, 'red');
  appendLegend(legend, 'Relatório parcial a acompanhar', states.partial, 'partial');
  appendLegend(legend, 'Término próximo', states.soon, 'amber');
  appendLegend(legend, 'Sem atraso identificado', states.regular);
  appendLegend(legend, 'Finalizado no acadêmico', states.academic, 'purple');

  const monthsContainer = $('#coordination-months'); monthsContainer.replaceChildren();
  const base = today(); base.setDate(1);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(base.getFullYear(), base.getMonth() + index, 1);
    return { date, count: internships.filter(record => { const end = localDate(record.expected_end_date); return end && end.getFullYear() === date.getFullYear() && end.getMonth() === date.getMonth(); }).length };
  });
  const maxMonth = Math.max(...months.map(month => month.count), 1);
  months.forEach(month => {
    const item = document.createElement('div'); item.className = 'coordination-month';
    const count = document.createElement('strong'); count.textContent = month.count;
    const track = document.createElement('div'); const bar = document.createElement('i'); bar.style.height = `${month.count ? Math.max(12, month.count / maxMonth * 100) : 3}%`; track.append(bar);
    const label = document.createElement('span'); label.textContent = month.date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    item.append(count, track, label); monthsContainer.append(item);
  });

  const studentRanking = $('#student-ranking'); studentRanking.replaceChildren();
  overdue.slice(0, 6).forEach((item, index) => appendRanking(studentRanking, index + 1, item.record.student_name, `Falta ${item.issue.missing.join(' e ')} · ${compactCourse(item.record.course)}`, `${item.issue.days} dias`));
  if (!overdue.length) emptyRanking(studentRanking);

  const advisors = new Map();
  overdue.forEach(item => {
    const name = item.record.advisor_name?.trim() || 'Orientador não informado';
    const current = advisors.get(name) || { count: 0, maxDays: 0 };
    current.count += 1; current.maxDays = Math.max(current.maxDays, item.issue.days); advisors.set(name, current);
  });
  const advisorRanking = $('#advisor-ranking'); advisorRanking.replaceChildren();
  [...advisors.entries()].sort((a, b) => b[1].count - a[1].count || b[1].maxDays - a[1].maxDays).slice(0, 6).forEach(([name, data], index) => appendRanking(advisorRanking, index + 1, name, `Maior atraso entre os orientandos: ${data.maxDays} dias`, `${data.count}`));
  if (!overdue.length) emptyRanking(advisorRanking);
  const partialRanking = $('#partial-ranking'); partialRanking.replaceChildren();
  partials.slice(0, 4).forEach((item, index) => appendRanking(partialRanking, index + 1, item.record.student_name, compactCourse(item.record.course), `${item.issue.days} dias`));
  if (!partials.length) emptyRanking(partialRanking, 'Nenhum relatório parcial aguardando acompanhamento.');
  renderList();
}

function renderList() {
  const filter = $('#coordination-filter').value;
  const visible = internships.filter(record => filter === 'all' || recordState(record) === filter);
  const container = $('#coordination-list'); container.replaceChildren();
  $('#coordination-empty').hidden = visible.length > 0;
  visible.sort((a, b) => a.student_name.localeCompare(b.student_name, 'pt-BR')).forEach(record => {
    const state = recordState(record); const finalization = finalizationIssue(record);
    const card = document.createElement('article'); card.className = `student-card ${state}`;
    const identity = document.createElement('div');
    const name = document.createElement('h3'); name.textContent = record.student_name;
    const summary = document.createElement('p'); summary.textContent = `${compactCourse(record.course)} · ${record.company_name || 'Concedente não informada'}`;
    identity.append(name, summary);
    const meta = document.createElement('div'); meta.className = 'student-card-meta';
    const advisor = document.createElement('span'); advisor.textContent = `Orientador: ${record.advisor_name || 'não informado'}`;
    const end = document.createElement('span'); end.textContent = `Previsão de término: ${formatDate(record.expected_end_date)}`;
    meta.append(advisor, end);
    const status = document.createElement('span'); status.className = 'student-card-status';
    status.textContent = state === 'academic' ? 'Finalizado no acadêmico' : state === 'overdue' ? `Finalização: falta ${finalization.missing.join(' e ')}` : state === 'partial' ? 'Relatório parcial a acompanhar' : state === 'soon' ? 'Término próximo' : 'Sem alerta prioritário';
    card.append(identity, meta, status); container.append(card);
  });
}

async function loadDashboard(session) {
  const message = $('#coordination-panel-message');
  message.hidden = true;
  const [profileResult, dashboardResult, submissionsResult] = await Promise.all([
    supabase.rpc('get_coordination_profile'),
    supabase.rpc('get_coordination_dashboard'),
    supabase.rpc('get_coordination_recent_submissions')
  ]);
  if (profileResult.error || !profileResult.data?.length) {
    showAuthenticated(false);
    await supabase.auth.signOut();
    $('#coordination-login-message').textContent = 'Esta conta não possui acesso a uma coordenação cadastrada. Solicite a liberação à COERI.';
    return;
  }
  $('#coordination-name').textContent = profileResult.data[0].coordination_name;
  showAuthenticated(true, session.user.email);
  if (profileResult.data[0].must_change_password) $('#coordination-password-dialog').showModal();
  if (dashboardResult.error) {
    message.textContent = 'Não foi possível carregar os dados agora. Clique em “Atualizar dados” para tentar novamente ou entre em contato com a COERI.';
    message.hidden = false;
    return;
  }
  internships = dashboardResult.data || [];
  recentSubmissions = submissionsResult.error ? [] : (submissionsResult.data || []);
  renderDashboard();
  renderSubmissionHistory();
}

$('#coordination-login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#coordination-login-message');
  const button = event.currentTarget.querySelector('[type="submit"]');
  message.textContent = 'Entrando…';
  button.disabled = true;
  button.textContent = 'Entrando…';
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: $('#coordination-email').value.trim().toLowerCase(), password: $('#coordination-password').value });
    if (error) { message.textContent = 'E-mail ou senha inválidos.'; return; }
    message.textContent = '';
    await loadDashboard(data.session);
  } catch (error) {
    console.error('Falha ao abrir o panorama da coordenação:', error);
    message.textContent = 'A sessão foi iniciada, mas não foi possível abrir o panorama. Atualize a página e tente novamente.';
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
  }
});

$('#coordination-logout').addEventListener('click', () => supabase.auth.signOut());
$('#coordination-refresh').addEventListener('click', async () => { const { data } = await supabase.auth.getSession(); if (data.session) await loadDashboard(data.session); });
$('#coordination-filter').addEventListener('change', renderList);
$('#coordination-password-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#coordination-new-password').value;
  const message = $('#coordination-password-message');
  const button = event.currentTarget.querySelector('[type="submit"]');
  if (password !== $('#coordination-confirm-password').value) { message.textContent = 'As senhas não coincidem.'; return; }
  if (password.length < 8) { message.textContent = 'A nova senha precisa ter pelo menos 8 caracteres.'; return; }
  message.textContent = 'Salvando…';
  button.disabled = true;
  button.textContent = 'Salvando e abrindo…';
  const { error } = await supabase.auth.updateUser({ password });
  if (error) { button.disabled = false; button.textContent = 'Definir senha e abrir dashboard'; message.textContent = 'Não foi possível alterar a senha. Use pelo menos 8 caracteres.'; return; }
  const { error: confirmationError } = await supabase.rpc('confirm_coordination_password_change');
  if (confirmationError) { button.disabled = false; button.textContent = 'Definir senha e abrir dashboard'; message.textContent = 'A senha foi alterada, mas não foi possível concluir o primeiro acesso. Entre novamente.'; return; }
  $('#coordination-password-dialog').close();
  button.disabled = false;
  button.textContent = 'Definir senha e abrir dashboard';
  message.textContent = '';
});

async function initialize() {
  $('#coordination-date').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await supabase.auth.getSession();
  if (data.session) await loadDashboard(data.session);
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (!session) showAuthenticated(false);
  });
}

initialize();
