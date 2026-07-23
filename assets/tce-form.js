const $ = (selector, root = document) => root.querySelector(selector);
const form = $('#tce-form');
const config = window.SUPABASE_CONFIG || {};
const previewMode = new URLSearchParams(location.search).get('preview') === '1';
let captchaToken = '';
let widgetId;

function addBusinessDays(date, count) {
  const result = new Date(date);
  let added = 0;
  while (added < count) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) added++;
  }
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

function setConditional(name, expected, container, fields, requiredWhenVisible = true) {
  const sync = () => {
    const visible = form.elements[name]?.value === expected;
    container.hidden = !visible;
    fields.forEach(field => {
      field.disabled = !visible;
      field.required = visible && requiredWhenVisible;
      if (!visible) field.value = '';
    });
  };
  form.addEventListener('change', event => { if (event.target.name === name) sync(); });
  sync();
  return sync;
}

function buildWeeklySchedule() {
  const selected = [...document.querySelectorAll('.weekday-row')].filter(row => $('.weekday-check', row).checked);
  const scheduleMessage = $('#schedule-message');
  if (!selected.length) {
    scheduleMessage.textContent = 'Marque pelo menos um dia da semana.';
    return '';
  }
  const schedule = [];
  for (const row of selected) {
    const start = $('.time-start', row).value;
    const end = $('.time-end', row).value;
    if (!start || !end) {
      scheduleMessage.textContent = `Informe os horários de entrada e saída de ${row.dataset.weekday.toLowerCase()}.`;
      return '';
    }
    const [startHour, startMinute] = start.split(':').map(Number);
    const [endHour, endMinute] = end.split(':').map(Number);
    const duration = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
    if (duration <= 0) {
      scheduleMessage.textContent = `O horário de saída de ${row.dataset.weekday.toLowerCase()} deve ser posterior ao de entrada.`;
      return '';
    }
    if (duration > 360) {
      scheduleMessage.textContent = `${row.dataset.weekday} ultrapassa o limite de 6 horas diárias.`;
      return '';
    }
    schedule.push(`${row.dataset.weekday}: ${start} / ${end}`);
  }
  scheduleMessage.textContent = '';
  return schedule.join('\n');
}

const digits = value => value.replace(/\D/g, '');

function formatCpf(value) {
  const number = digits(value).slice(0, 11);
  return number.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function formatCnpj(value) {
  const number = digits(value).slice(0, 14);
  return number.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

function formatPhone(value) {
  const number = digits(value).slice(0, 11);
  if (number.length <= 2) return number ? `(${number}` : '';
  if (number.length <= 7) return `(${number.slice(0, 2)}) ${number.slice(2)}`;
  return `(${number.slice(0, 2)}) ${number.slice(2, 7)}-${number.slice(7)}`;
}

function validCpf(value) {
  const number = digits(value);
  if (number.length !== 11 || /^(\d)\1+$/.test(number)) return false;
  const check = size => {
    let sum = 0;
    for (let index = 0; index < size; index++) sum += Number(number[index]) * (size + 1 - index);
    const remainder = (sum * 10) % 11;
    return Number(number[size]) === (remainder === 10 ? 0 : remainder);
  };
  return check(9) && check(10);
}

function validCnpj(value) {
  const number = digits(value);
  if (number.length !== 14 || /^(\d)\1+$/.test(number)) return false;
  const calculate = base => {
    let weight = base.length - 7;
    const sum = [...base].reduce((total, digit) => {
      const result = total + Number(digit) * weight--;
      if (weight < 2) weight = 9;
      return result;
    }, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(number.slice(0, 12));
  const second = calculate(number.slice(0, 12) + first);
  return number.endsWith(`${first}${second}`);
}

function validateDocuments() {
  const cpfFields = [...form.querySelectorAll('.mask-cpf')].filter(field => !field.disabled && field.required);
  for (const field of cpfFields) {
    field.setCustomValidity(validCpf(field.value) ? '' : 'Informe um CPF válido.');
    if (!field.checkValidity()) { field.reportValidity(); field.focus(); return false; }
  }
  const cnpj = form.querySelector('.mask-cnpj');
  if (!cnpj.disabled) {
    cnpj.setCustomValidity(validCnpj(cnpj.value) ? '' : 'Informe um CNPJ válido.');
    if (!cnpj.checkValidity()) { cnpj.reportValidity(); cnpj.focus(); return false; }
  }
  return true;
}

function initializeForm() {
  if ((!config.turnstileSiteKey && !previewMode) || !config.url || !config.anonKey) return;
  $('#legacy-forms').hidden = true;
  form.hidden = false;
  if (previewMode) {
    const notice = document.createElement('div');
    notice.className = 'callout orange preview-notice';
    const title = document.createElement('strong');
    const copy = document.createElement('p');
    title.textContent = 'Modo de visualização';
    copy.textContent = 'Confira todos os campos abaixo. O envio ficará disponível depois da ativação do CAPTCHA no Supabase.';
    notice.append(title, copy);
    form.prepend(notice);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Envio disponível após a ativação';
  }
  const params = new URLSearchParams(location.search);
  if (params.get('tipo') === 'interno') form.elements.request_type.value = 'interno';
  form.elements.start_date.min = addBusinessDays(new Date(), 5);

  const guardianFields = $('#guardian-fields');
  const syncCompanyFields = setConditional('request_type', 'externo', $('#company-fields'), [...$('#company-fields').querySelectorAll('input')]);
  const syncGuardianFields = setConditional('is_minor', 'true', guardianFields, [...guardianFields.querySelectorAll('input')]);
  const syncScholarshipField = setConditional('is_paid', 'true', $('#scholarship-field'), [form.elements.scholarship_amount]);
  const syncOtherBenefitsField = setConditional('is_paid', 'true', $('#other-benefits-field'), [form.elements.other_benefits], false);
  form.addEventListener('change', event => {
    if (event.target.name !== 'requires_epi') return;
    const needsEpi = event.target.value === 'true';
    form.elements.epi_types.required = needsEpi;
    if (!needsEpi) form.elements.epi_types.value = '';
  });
  form.elements.activity_plan.addEventListener('input', () => {
    $('#activity-count').textContent = `${form.elements.activity_plan.value.length}/50 caracteres mínimos`;
  });
  form.querySelectorAll('.mask-cpf').forEach(field => field.addEventListener('input', () => { field.value = formatCpf(field.value); field.setCustomValidity(''); }));
  form.querySelectorAll('.mask-cnpj').forEach(field => field.addEventListener('input', () => { field.value = formatCnpj(field.value); field.setCustomValidity(''); }));
  form.querySelectorAll('.mask-phone').forEach(field => field.addEventListener('input', () => { field.value = formatPhone(field.value); }));
  document.querySelectorAll('.weekday-check').forEach(check => check.addEventListener('change', () => {
    const row = check.closest('.weekday-row');
    const timeFields = [...row.querySelectorAll('input[type="time"]')];
    timeFields.forEach(field => {
      field.disabled = !check.checked;
      field.required = check.checked;
      if (!check.checked) field.value = '';
    });
    $('#schedule-message').textContent = '';
  }));

  const waitForTurnstile = setInterval(() => {
    if (!window.turnstile) return;
    clearInterval(waitForTurnstile);
    widgetId = window.turnstile.render('#turnstile-widget', {
      sitekey: config.turnstileSiteKey || '1x00000000000000000000AA',
      size: 'flexible',
      theme: 'light',
      callback: token => { captchaToken = token; },
      'expired-callback': () => { captchaToken = ''; },
      'error-callback': () => { captchaToken = ''; }
    });
  }, 100);
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const message = $('#tce-form-message');
  const email = form.elements.student_email.value.trim().toLowerCase();
  if (!validateDocuments()) return;
  if (!/^[^@\s]+@estudante\.ifms\.edu\.br$/.test(email)) {
    message.textContent = 'Use seu e-mail institucional @estudante.ifms.edu.br.';
    form.elements.student_email.focus();
    return;
  }
  if (form.elements.start_date.value < form.elements.start_date.min) {
    message.textContent = 'A data de início deve respeitar pelo menos 5 dias úteis de antecedência.';
    form.elements.start_date.focus();
    return;
  }
  const weeklySchedule = buildWeeklySchedule();
  if (!weeklySchedule) {
    $('.weekly-schedule').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  form.elements.weekly_schedule.value = weeklySchedule;
  if (!captchaToken) { message.textContent = 'Confirme o CAPTCHA antes de enviar.'; return; }

  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  message.classList.remove('success');
  message.textContent = 'Enviando sua solicitação com segurança…';
  const values = Object.fromEntries(new FormData(form).entries());
  const payload = {
    ...values,
    student_name: values.student_name.trim().toLocaleUpperCase('pt-BR'),
    weekly_schedule: weeklySchedule,
    student_email: email,
    is_minor: values.is_minor === 'true',
    is_paid: values.is_paid === 'true',
    requires_epi: values.requires_epi === 'true',
    scholarship_amount: values.scholarship_amount || null,
    other_benefits: values.other_benefits?.trim() || null,
    privacy_consent: Boolean(values.privacy_consent),
    acknowledgment_start: Boolean(values.acknowledgment_start),
    acknowledgment_reports: Boolean(values.acknowledgment_reports),
    acknowledgment_changes: Boolean(values.acknowledgment_changes)
  };

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const supabase = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
    const protocolBytes = crypto.getRandomValues(new Uint8Array(8));
    const protocolCode = [...protocolBytes].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
    const requestedProtocol = `TCE-${protocolCode.match(/.{4}/g).join('-')}`;
    const { data, error } = await supabase.functions.invoke('submit-tce', {
      body: { token: captchaToken, protocol: requestedProtocol, payload }
    });
    if (error) throw new Error(data?.error || error.message);
    let responseData = data;
    if (typeof responseData === 'string') {
      try { responseData = JSON.parse(responseData); } catch { responseData = {}; }
    }
    const protocol = responseData?.protocol || responseData?.data?.protocol || responseData?.public_protocol || requestedProtocol;
    if (!protocol) {
      throw new Error('A solicitação foi recebida, mas o protocolo não foi retornado. Entre em contato com a COERI antes de reenviar o formulário.');
    }
    form.reset();
    syncCompanyFields();
    syncGuardianFields();
    syncScholarshipField();
    syncOtherBenefitsField();
    document.querySelectorAll('.weekday-row input[type="time"]').forEach(field => { field.disabled = true; field.required = false; });
    form.elements.start_date.min = addBusinessDays(new Date(), 5);
    window.turnstile.reset(widgetId);
    captchaToken = '';
    message.classList.add('success');
    const confirmationTitle = document.createElement('strong');
    confirmationTitle.textContent = 'Solicitação enviada à COERI.';
    const protocolLine = document.createElement('strong');
    protocolLine.className = 'protocol-number';
    protocolLine.textContent = `PROTOCOLO: ${protocol}`;
    const saveInstruction = document.createElement('strong');
    saveInstruction.textContent = 'Salve este número ou tire uma captura de tela. Ele será necessário para acompanhar sua solicitação.';
    const consultationInstruction = document.createElement('span');
    consultationInstruction.textContent = 'Para consultar posteriormente, acesse “Consultar protocolo” e informe o número acima.';
    const consultationLink = document.createElement('a');
    consultationLink.href = 'consultar-protocolo';
    consultationLink.textContent = 'Consultar protocolo';
    message.replaceChildren(confirmationTitle, protocolLine, saveInstruction, consultationInstruction, consultationLink);
    message.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    message.textContent = error.message || 'Não foi possível enviar. Tente novamente.';
    window.turnstile?.reset(widgetId);
    captchaToken = '';
  } finally {
    submit.disabled = false;
  }
});

initializeForm();
