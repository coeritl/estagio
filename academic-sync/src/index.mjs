import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://academico.ifms.edu.br/administrativo';
const args = new Set(process.argv.slice(2));
const assistedLogin = args.has('--login');
const dryRun = args.has('--dry-run');
const fromPreview = args.has('--from-preview');
const agreementsOnly = args.has('--agreements-only');
const allowedStatuses = new Set(['iniciado', 'suspenso', 'em edicao']);
const cnpjPattern = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;

async function loadEnv() {
  try {
    const source = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function isoDate(value) {
  const match = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function formatCnpj(value) {
  const number = String(value || '').replace(/\D/g, '').slice(0, 14);
  return number.length === 14 ? `${number.slice(0, 2)}.${number.slice(2, 5)}.${number.slice(5, 8)}/${number.slice(8, 12)}-${number.slice(12)}` : '';
}

function canonicalCourse(value) {
  const withoutCode = clean(value).replace(/^\d+\s*-\s*/, '').replace(/^Curso Superior de\s+/i, '');
  const aliases = {
    'tecnologia em analise e desenvolvimento de sistemas': 'Análise e Desenvolvimento de Sistemas',
    'tecnologia em automacao industrial': 'Automação Industrial',
    'tecnico em eletrotecnica': 'Técnico Integrado em Eletrotécnica',
    'tecnico em informatica': 'Técnico Integrado em Informática',
    'tecnico em administracao': 'Técnico Integrado em Administração (EJA-EPT)'
  };
  return aliases[normalize(withoutCode)] || withoutCode;
}

async function waitForTable(page, selector) {
  await page.waitForFunction(selector => window.jQuery && window.jQuery.fn?.dataTable?.isDataTable(selector), selector, { timeout: 30000 });
  await page.waitForFunction(selector => !document.querySelector(`${selector}_processing`)?.offsetParent, selector, { timeout: 30000 });
}

async function drawTable(page, selector, search = '', length = -1) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await waitForTable(page, selector);
      await page.evaluate(({ selector, search, length }) => new Promise((resolve, reject) => {
        const table = window.jQuery(selector).DataTable();
        const timer = setTimeout(() => reject(new Error(`Tempo excedido ao consultar ${selector}`)), 60000);
        table.one('draw.dt', () => { clearTimeout(timer); resolve(); });
        table.search(search).page.len(length).draw();
      }), { selector, search, length });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await page.waitForTimeout(1500 * attempt);
    }
  }
  throw lastError;
}

async function tableRows(page, selector) {
  return page.locator(`${selector} tbody tr`).evaluateAll(rows => rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent.replace(/\s+/g, ' ').trim())));
}

async function gotoWithRetry(page, url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await page.waitForTimeout(2000 * attempt);
    }
  }
  throw lastError;
}

async function ensureAuthenticated(page) {
  await gotoWithRetry(page, `${BASE_URL}/`);
  if (!/\/usuarios\/login/.test(page.url())) return;
  if (!assistedLogin) throw new Error('Sessão do Sistema Acadêmico expirada. Execute npm run login.');
  console.log('Faça o login manual no navegador. O sincronizador continuará automaticamente.');
  await page.waitForURL(url => !url.pathname.includes('/usuarios/login'), { timeout: 5 * 60 * 1000 });
}

async function collectAgreements(page) {
  await gotoWithRetry(page, `${BASE_URL}/convenio_exts/panorama`);
  await drawTable(page, '#lista_elemento_curricular_por_campus');
  const rows = await tableRows(page, '#lista_elemento_curricular_por_campus');
  const agreements = rows.filter(row => row.length >= 10).map(row => ({
    academic_agreement_id: row[0], description: row[1], start_date: isoDate(row[2]), end_date: isoDate(row[3]),
    agreement_number: row[4], external_institution: row[9]
  })).filter(item => item.academic_agreement_id && item.description && item.external_institution);
  const unique = [...new Map(agreements.map(item => [item.academic_agreement_id, item])).values()];
  const missingCnpj = unique.filter(item => !cnpjPattern.test(`${item.description} ${item.external_institution}`)
    && !normalize(item.description).includes('estagio interno'));
  if (missingCnpj.length) console.log(`Complementando CNPJ de ${missingCnpj.length} convênio(s)…`);
  for (const item of missingCnpj) {
    try {
      await gotoWithRetry(page, `${BASE_URL}/convenio_exts/visualizar/${encodeURIComponent(item.academic_agreement_id)}`);
      const body = await page.locator('body').innerText();
      const match = body.match(new RegExp(`CNPJ\\s*\\n?\\s*(${cnpjPattern.source})`, 'i'));
      const cnpj = formatCnpj(match?.[1]);
      if (cnpj) item.description = `CNPJ ${cnpj} - ${item.description}`;
    } catch (error) {
      console.warn(`CNPJ do convênio ${item.academic_agreement_id} não pôde ser complementado: ${error.message || error}`);
    }
  }
  return unique;
}

async function collectInternships(page) {
  await gotoWithRetry(page, `${BASE_URL}/estagios/relatorio`);
  const byId = new Map();
  for (const status of ['Iniciado', 'Suspenso', 'Em edição']) {
    await drawTable(page, '#lista_elemento_curricular_por_campus', status);
    const rows = await tableRows(page, '#lista_elemento_curricular_por_campus');
    for (const row of rows) {
      if (row.length < 14
        || normalize(row[1]) !== 'tl'
        || !allowedStatuses.has(normalize(row[12]))
        || normalize(row[13]) !== 'em curso') continue;
      byId.set(row[0], {
        academic_system_id: row[0], campus: row[1], course: canonicalCourse(row[2]), student_name: row[3].toLocaleUpperCase('pt-BR'),
        advisor_name: row[4], company_name: row[5] || 'NÃO INFORMADA NO SISTEMA ACADÊMICO', internship_type: row[6],
        start_date: isoDate(row[7]), expected_end_date: isoDate(row[8]), academic_activity_status: row[9], closure_date: isoDate(row[10]),
        academic_workload: row[11], academic_status: row[12], course_status: row[13]
      });
    }
  }
  return [...byId.values()];
}

async function prepareStudentTable(page) {
  await gotoWithRetry(page, `${BASE_URL}/alunos/panorama`);
  await waitForTable(page, '#lista_por_campus');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const select = document.querySelector('#situacao_id');
    const table = window.jQuery('#lista_por_campus').DataTable();
    if (!select) return resolve();
    const option = [...select.options].find(item => item.textContent
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('mostrar todos'));
    if (!option || select.value === option.value) return resolve();
    const timer = setTimeout(() => reject(new Error('Tempo excedido ao exibir todas as situações acadêmicas')), 30000);
    table.one('draw.dt', () => { clearTimeout(timer); resolve(); });
    select.value = option.value;
    window.jQuery(select).trigger('chosen:updated').trigger('change');
  }));
}

async function collectStudent(page, internship) {
  await drawTable(page, '#lista_por_campus', internship.student_name, 50);
  const tableData = await page.evaluate(() => {
    const table = window.jQuery('#lista_por_campus').DataTable();
    const headers = table.columns().header().toArray().map(header => header.textContent.replace(/\s+/g, ' ').trim());
    const rows = table.rows({ search: 'applied' }).data().toArray().map(row => Array.from(row).map(value => {
      const holder = document.createElement('div');
      holder.innerHTML = String(value ?? '');
      return (holder.textContent || '').replace(/\s+/g, ' ').trim();
    }));
    return { headers, rows };
  });
  const headerIndex = Object.fromEntries(tableData.headers.map((header, index) => [normalize(header), index]));
  const field = (row, ...labels) => {
    for (const label of labels) {
      const index = headerIndex[normalize(label)];
      if (index !== undefined) return clean(row[index]);
    }
    return '';
  };
  const exact = tableData.rows.filter(row => normalize(field(row, 'Estudante')) === normalize(internship.student_name)
    && normalize(field(row, 'Campus')) === 'tl');
  const candidates = exact.length === 1 ? exact : exact.filter(row => normalize(canonicalCourse(field(row, 'Curso'))) === normalize(internship.course));
  if (candidates.length !== 1) return { error: candidates.length ? 'Mais de uma ficha correspondente' : 'Ficha única não localizada' };
  const row = candidates[0];
  const email = field(row, 'Email', 'E-mail', 'Email Institucional');
  return {
    academic_ra: field(row, 'RA'),
    academic_enrollment: field(row, 'Matrícula'),
    student_cpf: field(row, 'CPF'),
    student_birth_date: isoDate(field(row, 'Data de Nascimento', 'Nascimento')),
    student_email: /@(?:estudante\.)?ifms\.edu\.br$/i.test(email) ? email.toLowerCase() : '',
    student_whatsapp: field(row, 'Telefone', 'Celular')
  };
}

async function sendToSupabase(payload) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const secret = process.env.ACADEMIC_SYNC_SECRET;
  if (!url || !anon || !secret) throw new Error('Configure SUPABASE_URL, SUPABASE_ANON_KEY e ACADEMIC_SYNC_SECRET no arquivo .env.');
  const response = await fetch(`${url}/functions/v1/sync-academic-system`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}`, 'x-academic-sync-secret': secret },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Supabase respondeu com HTTP ${response.status}.`);
  return result;
}

await loadEnv();
await fs.mkdir(path.join(ROOT, 'logs'), { recursive: true });
await fs.mkdir(path.join(ROOT, 'preview'), { recursive: true });
if (fromPreview) {
  const preview = JSON.parse(await fs.readFile(path.join(ROOT, 'preview', 'latest.json'), 'utf8'));
  const agreements = [...new Map(preview.agreements.map(item => [String(item.academic_agreement_id), item])).values()];
  const payload = { collected_at: preview.collected_at, agreements, internships: preview.internships };
  const result = await sendToSupabase(payload);
  const log = {
    started_at: new Date().toISOString(), finished_at: new Date().toISOString(), source: 'preview',
    agreements: payload.agreements.length, internships: payload.internships.length,
    student_errors: preview.student_errors || [], result
  };
  await fs.writeFile(path.join(ROOT, 'logs', 'latest.json'), JSON.stringify(log, null, 2), 'utf8');
  console.log('Prévia sincronizada.', result);
  process.exit(0);
}
const context = await chromium.launchPersistentContext(path.join(ROOT, 'browser-profile'), {
  channel: 'msedge', headless: !assistedLogin, viewport: { width: 1440, height: 900 }, acceptDownloads: false
});
const page = context.pages()[0] || await context.newPage();
const startedAt = new Date().toISOString();
try {
  await ensureAuthenticated(page);
  console.log('Consultando convênios…');
  const agreements = await collectAgreements(page);
  if (agreementsOnly) {
    const payload = { collected_at: new Date().toISOString(), agreements, internships: [] };
    const result = dryRun ? { dry_run: true } : await sendToSupabase(payload);
    const log = { started_at: startedAt, finished_at: new Date().toISOString(), dry_run: dryRun, agreements: agreements.length, internships: 0, student_errors: [], result };
    await fs.writeFile(path.join(ROOT, 'preview', 'agreements-latest.json'), JSON.stringify(payload, null, 2), 'utf8');
    await fs.writeFile(path.join(ROOT, 'logs', 'latest.json'), JSON.stringify(log, null, 2), 'utf8');
    console.log(dryRun ? 'Prévia de convênios concluída.' : 'Convênios sincronizados.', result);
    process.exit(0);
  }
  console.log('Consultando estágios iniciados, suspensos e em edição…');
  const internships = await collectInternships(page);
  console.log(`Complementando ${internships.length} estudante(s)…`);
  await prepareStudentTable(page);
  const studentErrors = [];
  for (let index = 0; index < internships.length; index++) {
    const internship = internships[index];
    console.log(`[${index + 1}/${internships.length}] ${internship.student_name}`);
    try {
      const student = await collectStudent(page, internship);
      if (student.error) studentErrors.push({ academic_system_id: internship.academic_system_id, student_name: internship.student_name, error: student.error });
      else internship.student = student;
    } catch (error) {
      studentErrors.push({ academic_system_id: internship.academic_system_id, student_name: internship.student_name, error: error.message || String(error) });
    }
  }
  const payload = { collected_at: new Date().toISOString(), agreements, internships };
  const previewPath = path.join(ROOT, 'preview', 'latest.json');
  await fs.writeFile(previewPath, JSON.stringify({ ...payload, student_errors: studentErrors }, null, 2), 'utf8');
  const result = dryRun ? { dry_run: true } : await sendToSupabase(payload);
  const log = { started_at: startedAt, finished_at: new Date().toISOString(), dry_run: dryRun, agreements: agreements.length, internships: internships.length, student_errors: studentErrors, result };
  await fs.writeFile(path.join(ROOT, 'logs', 'latest.json'), JSON.stringify(log, null, 2), 'utf8');
  console.log(dryRun ? `Prévia concluída em ${previewPath}` : 'Sincronização concluída.', log);
} catch (error) {
  const log = { started_at: startedAt, finished_at: new Date().toISOString(), error: error.message || String(error) };
  await fs.writeFile(path.join(ROOT, 'logs', 'latest.json'), JSON.stringify(log, null, 2), 'utf8');
  console.error(log.error);
  process.exitCode = 1;
} finally {
  await context.close();
}
