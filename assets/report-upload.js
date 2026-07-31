const form = document.querySelector('#report-upload-form');
const message = document.querySelector('#report-upload-message');
const cpfInput = document.querySelector('#report-cpf');
const config = window.SUPABASE_CONFIG || {};
const maxFileSize = 10 * 1024 * 1024;
const maxRequestSize = 15 * 1024 * 1024;
let captchaToken = '';
let widgetId;

function maskCpf(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}
cpfInput.addEventListener('input', () => { cpfInput.value = maskCpf(cpfInput.value); });

function renderCaptcha() {
  if (!window.turnstile || !config.turnstileSiteKey) return;
  widgetId = window.turnstile.render('#report-turnstile', {
    sitekey: config.turnstileSiteKey,
    size: 'flexible',
    callback: token => { captchaToken = token; },
    'expired-callback': () => { captchaToken = ''; },
    'error-callback': () => { captchaToken = ''; }
  });
}
const captchaTimer = setInterval(() => {
  if (!window.turnstile) return;
  clearInterval(captchaTimer);
  renderCaptcha();
}, 150);

form.addEventListener('submit', async event => {
  event.preventDefault();
  message.className = 'form-message';
  const files = [...form.querySelectorAll('input[type=file]')].map(input => input.files[0]).filter(Boolean);
  if (!files.length) {
    message.textContent = 'Selecione pelo menos um documento para enviar. Em caso de dúvida, escreva para coeri.tl@ifms.edu.br.';
    return;
  }
  const invalidFile = files.some(file => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    return !isPdf || file.size > maxFileSize;
  });
  if (invalidFile) {
    message.textContent = 'Envie somente arquivos PDF de até 10 MB. Se o problema persistir, escreva para coeri.tl@ifms.edu.br.';
    return;
  }
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > maxRequestSize) {
    message.textContent = 'Os arquivos somam mais de 15 MB. Envie os documentos em etapas separadas, preenchendo novamente o formulário para cada envio.';
    return;
  }
  if (!captchaToken) {
    message.textContent = 'Confirme o CAPTCHA antes de enviar. Se não conseguir, escreva para coeri.tl@ifms.edu.br.';
    return;
  }
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  button.textContent = 'Enviando…';
  message.textContent = 'Aguarde enquanto os documentos são enviados.';
  try {
    const data = new FormData(form);
    data.set('token', captchaToken);
    const response = await fetch(`${config.url}/functions/v1/submit-internship-reports`, {
      method: 'POST',
      headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
      body: data
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir o envio. Tente novamente ou escreva para coeri.tl@ifms.edu.br.');
    message.className = 'form-message success';
    message.textContent = `${result.message} Comprovante do envio: ${result.receipt}.`;
    form.reset();
  } catch (error) {
    const connectionFailed = error instanceof TypeError || error.message === 'Failed to fetch';
    message.textContent = connectionFailed
      ? 'A transferência dos arquivos foi interrompida. Confira sua conexão e tente novamente. Se selecionou mais de um PDF, envie um documento por vez. Se o problema persistir, escreva para coeri.tl@ifms.edu.br.'
      : error.message || 'Não foi possível concluir o envio. Tente novamente ou escreva para coeri.tl@ifms.edu.br.';
  } finally {
    button.disabled = false;
    button.textContent = 'Enviar documentos';
    window.turnstile?.reset(widgetId);
    captchaToken = '';
  }
});
