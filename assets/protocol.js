const form = document.querySelector('#protocol-form');
const input = document.querySelector('#protocol-input');
const message = document.querySelector('#protocol-message');
const result = document.querySelector('#protocol-result');
const config = window.SUPABASE_CONFIG || {};
let captchaToken = '';
let widgetId;

input.addEventListener('input', () => {
  const raw = input.value.toUpperCase().replace(/^TCE-?/, '').replace(/[^A-F0-9]/g, '').slice(0, 16);
  input.value = raw ? `TCE-${raw.match(/.{1,4}/g).join('-')}` : '';
});

const wait = setInterval(() => {
  if (!window.turnstile || !config.turnstileSiteKey) return;
  clearInterval(wait);
  widgetId = window.turnstile.render('#protocol-turnstile', { sitekey: config.turnstileSiteKey, size: 'flexible', callback: token => { captchaToken = token; }, 'expired-callback': () => { captchaToken = ''; } });
}, 100);

form.addEventListener('submit', async event => {
  event.preventDefault();
  result.hidden = true;
  if (!/^TCE-[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(input.value)) { message.textContent = 'Informe o protocolo completo.'; return; }
  if (!captchaToken) { message.textContent = 'Aguarde a confirmação do CAPTCHA.'; return; }
  const button = form.querySelector('button');
  button.disabled = true;
  message.textContent = 'Consultando…';
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const supabase = createClient(config.url, config.anonKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.functions.invoke('check-tce-status', { body: { protocol: input.value, token: captchaToken } });
    if (error) throw new Error(data?.error || 'Não foi possível localizar o protocolo.');
    document.querySelector('#protocol-result-code').textContent = input.value;
    document.querySelector('#protocol-result-status').textContent = data.label;
    const defaultNotes = {
      recebido: 'Sua solicitação foi registrada e aguarda processamento pela COERI.',
      em_processamento: 'A COERI está conferindo as informações e preparando o seu TCE.',
      pendente_correcao: 'Existem informações que precisam ser corrigidas. Consulte a orientação abaixo.',
      tce_gerado: 'O documento foi gerado e enviado para assinaturas.',
      tce_negado: 'Não foi possível dar continuidade à solicitação. Consulte a COERI.'
    };
    document.querySelector('#protocol-result-note').textContent = data.note || defaultNotes[data.status] || 'Acompanhe esta página para novas atualizações.';
    result.className = `protocol-result status-${data.status}`;
    const completedByStatus = {
      recebido: [],
      em_processamento: ['recebido'],
      pendente_correcao: ['recebido', 'em_processamento'],
      tce_gerado: ['recebido', 'em_processamento'],
      tce_negado: ['recebido', 'em_processamento']
    };
    document.querySelectorAll('.timeline-step').forEach(step => {
      const stepStatus = step.dataset.status;
      step.classList.toggle('is-complete', completedByStatus[data.status]?.includes(stepStatus));
      step.classList.toggle('is-current', stepStatus === data.status);
    });
    const documentLink = document.querySelector('#protocol-document-link');
    const validDocumentUrl = data.status === 'tce_gerado' && /^https:\/\//i.test(data.document_url || '');
    documentLink.hidden = !validDocumentUrl;
    documentLink.href = validDocumentUrl ? data.document_url : '#';
    document.querySelector('#protocol-result-date').textContent = `Atualizado em ${new Date(data.updated_at).toLocaleString('pt-BR')}`;
    result.hidden = false;
    message.textContent = '';
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    window.turnstile?.reset(widgetId);
    captchaToken = '';
  }
});
