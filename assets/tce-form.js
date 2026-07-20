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

function setConditional(name, expected, container, fields) {
  form.addEventListener('change', event => {
    if (event.target.name !== name) return;
    const visible = event.target.value === expected;
    container.hidden = !visible;
    fields.forEach(field => { field.required = visible; });
  });
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
  setConditional('is_minor', 'true', guardianFields, [...guardianFields.querySelectorAll('input')]);
  setConditional('is_paid', 'true', $('#scholarship-field'), [form.elements.scholarship_amount]);
  form.addEventListener('change', event => {
    if (event.target.name !== 'requires_epi') return;
    const needsEpi = event.target.value === 'true';
    form.elements.epi_types.required = needsEpi;
    if (!needsEpi) form.elements.epi_types.value = '';
  });
  form.elements.activity_plan.addEventListener('input', () => {
    $('#activity-count').textContent = `${form.elements.activity_plan.value.length}/50 caracteres mínimos`;
  });

  const waitForTurnstile = setInterval(() => {
    if (!window.turnstile) return;
    clearInterval(waitForTurnstile);
    widgetId = window.turnstile.render('#turnstile-widget', {
      sitekey: config.turnstileSiteKey || '1x00000000000000000000AA',
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
  if (!captchaToken) { message.textContent = 'Confirme o CAPTCHA antes de enviar.'; return; }

  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  message.classList.remove('success');
  message.textContent = 'Enviando sua solicitação com segurança…';
  const values = Object.fromEntries(new FormData(form).entries());
  const payload = {
    ...values,
    student_email: email,
    is_minor: values.is_minor === 'true',
    is_paid: values.is_paid === 'true',
    requires_epi: values.requires_epi === 'true',
    scholarship_amount: values.scholarship_amount || null,
    privacy_consent: Boolean(values.privacy_consent),
    acknowledgment_start: Boolean(values.acknowledgment_start),
    acknowledgment_reports: Boolean(values.acknowledgment_reports),
    acknowledgment_changes: Boolean(values.acknowledgment_changes)
  };

  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const supabase = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.functions.invoke('submit-tce', { body: { token: captchaToken, payload } });
    if (error) throw new Error(data?.error || error.message);
    form.reset();
    $('#guardian-fields').hidden = true;
    $('#scholarship-field').hidden = true;
    form.elements.start_date.min = addBusinessDays(new Date(), 5);
    window.turnstile.reset(widgetId);
    captchaToken = '';
    message.classList.add('success');
    message.textContent = `Solicitação enviada à COERI. Protocolo: ${data.id.slice(0, 8).toUpperCase()}. Guarde este número.`;
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
