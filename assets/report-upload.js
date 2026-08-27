const form = document.querySelector('#report-upload-form');
const message = document.querySelector('#report-upload-message');
const cpfInput = document.querySelector('#report-cpf');
const whatsappInput = document.querySelector('#report-whatsapp');
const config = window.SUPABASE_CONFIG || {};
const maxFileSize = 10 * 1024 * 1024;
const maxRequestSize = 15 * 1024 * 1024;
let captchaToken = '';
let widgetId;
let storageClient;

async function getStorageClient() {
  if (storageClient) return storageClient;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  storageClient = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
  return storageClient;
}

async function callUploadFunction(payload) {
  const response = await fetch(`${config.url}/functions/v1/submit-internship-reports`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir o envio. Tente novamente ou escreva para coeri.tl@ifms.edu.br.');
  return result;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Redes de campus/dados móveis derrubam upload de PDF grande com alguma
// frequência. Antes de desistir e cancelar a sessão inteira (o que obrigava o
// estudante a reselecionar tudo e refazer o CAPTCHA), tenta de novo só o
// arquivo que falhou algumas vezes.
async function uploadFileWithRetry(client, upload, file, onProgress, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { error } = await client.storage
      .from('internship-reports')
      .uploadToSignedUrl(upload.path, upload.token, file, { contentType: 'application/pdf' });
    if (!error) return;
    // Se a resposta se perdeu depois de o Storage concluir o upload, uma nova
    // tentativa recebe 409 porque o caminho único já existe. Nesse caso o
    // arquivo chegou e a etapa de finalização fará a conferência de tamanho.
    const errorText = `${error.statusCode || ''} ${error.message || ''}`;
    if (/\b409\b|already exists|resource already exists|duplicate/i.test(errorText)) return;
    lastError = error;
    if (attempt < attempts) {
      onProgress(`Falha ao transferir ${file.name}. Tentando novamente (${attempt + 1}/${attempts})…`);
      await wait(1500 * attempt);
    }
  }
  throw lastError;
}

function maskCpf(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}
cpfInput.addEventListener('input', () => { cpfInput.value = maskCpf(cpfInput.value); });

function maskWhatsapp(value) {
  let digits = value.replace(/\D/g, '');
  // Quem cola o número a partir dos contatos do celular costuma trazer o DDI
  // (ex.: "+55 67 99999-9999"). Sem isso, os 2 dígitos do "55" empurram o
  // número para fora do limite e o campo fica com um valor sem sentido.
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits ? '(' + digits : '';
  if (digits.length <= 7) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2);
  return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
}
whatsappInput.addEventListener('input', () => { whatsappInput.value = maskWhatsapp(whatsappInput.value); });

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
let captchaWaited = 0;
const captchaTimer = setInterval(() => {
  if (window.turnstile) {
    clearInterval(captchaTimer);
    renderCaptcha();
    return;
  }
  captchaWaited += 150;
  // Se o script do Turnstile não carregar (bloqueador de anúncios, rede da
  // escola/empresa restringindo o domínio da Cloudflare etc.), o formulário
  // ficava esperando para sempre sem avisar o estudante do motivo.
  if (captchaWaited >= 12000) {
    clearInterval(captchaTimer);
    message.textContent = 'Não foi possível carregar a verificação de segurança (CAPTCHA). Tente em outra rede, desative bloqueadores de anúncio/rastreamento ou escreva para coeri.tl@ifms.edu.br.';
  }
}, 150);

form.addEventListener('submit', async event => {
  event.preventDefault();
  message.className = 'form-message';
  const files = [...form.querySelectorAll('input[type=file]')].map(input => input.files[0]).filter(Boolean);
  if (!/^\(\d{2}\) \d{5}-\d{4}$/.test(whatsappInput.value)) {
    message.textContent = 'Informe o WhatsApp no padrão (XX) XXXXX-XXXX.';
    whatsappInput.focus();
    return;
  }
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
  let uploadSession = '';
  let finalizing = false;
  try {
    const values = new FormData(form);
    const selected = [...form.querySelectorAll('input[type=file]')]
      .filter(input => input.files[0])
      .map(input => ({ input, file: input.files[0] }));
    const authorization = await callUploadFunction({
      action: 'init',
      token: captchaToken,
      cpf: values.get('cpf'),
      email: values.get('email'),
      whatsapp: values.get('whatsapp'),
      student_class: values.get('student_class'),
      internship_period: values.get('internship_period'),
      total_workload: values.get('total_workload'),
      documents: selected.map(({ input, file }) => ({ field: input.name, name: file.name, size: file.size }))
    });
    uploadSession = authorization.session;
    const client = await getStorageClient();
    for (let index = 0; index < authorization.uploads.length; index += 1) {
      const upload = authorization.uploads[index];
      const selectedFile = selected.find(item => item.input.name === upload.field)?.file;
      if (!selectedFile) throw new Error('Um dos arquivos selecionados não está mais disponível. Selecione-o novamente.');
      message.textContent = `Enviando arquivo ${index + 1} de ${authorization.uploads.length}: ${selectedFile.name}`;
      await uploadFileWithRetry(client, upload, selectedFile, text => { message.textContent = text; });
    }
    message.textContent = 'Arquivos transferidos. Registrando a entrega na COERI…';
    finalizing = true;
    const result = await callUploadFunction({ action: 'finalize', session: uploadSession });
    message.className = 'form-message success';
    const emailNotice = result.email_sent
      ? 'Uma confirmação foi enviada ao e-mail institucional informado.'
      : 'O envio foi registrado, mas a confirmação por e-mail pode demorar. Monitore sua caixa de entrada.';
    message.textContent = `${result.message} Comprovante do envio: ${result.receipt}. ${emailNotice}`;
    form.reset();
  } catch (error) {
    if (uploadSession && !finalizing) {
      callUploadFunction({ action: 'cancel', session: uploadSession }).catch(() => {});
    }
    const connectionFailed = error instanceof TypeError || error.message === 'Failed to fetch';
    message.textContent = connectionFailed
      ? 'A conexão foi interrompida durante a transferência. Os documentos não foram registrados. Mantenha esta página aberta, confira sua conexão e tente novamente. Se o problema persistir, escreva para coeri.tl@ifms.edu.br.'
      : error.message || 'Não foi possível concluir o envio. Tente novamente ou escreva para coeri.tl@ifms.edu.br.';
  } finally {
    button.disabled = false;
    button.textContent = 'Enviar documentos';
    window.turnstile?.reset(widgetId);
    captchaToken = '';
  }
});
