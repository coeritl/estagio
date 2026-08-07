/**
 * COERI — notificações automáticas do acompanhamento de estágios.
 * Publique como aplicativo da web, executando como a conta da COERI.
 * Em Configurações do projeto > Propriedades do script, crie WEBHOOK_SECRET.
 */
function doPost(e) {
  try {
    var input = JSON.parse(e.postData.contents || '{}');
    var expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!expected || input.secret !== expected) return output_({ success: false, error: 'Não autorizado.' });
    if (!input.notificationId || !input.to || !input.type) return output_({ success: false, error: 'Dados incompletos.' });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var properties = PropertiesService.getScriptProperties();
      var key = 'SENT_' + input.notificationId;
      var previous = properties.getProperty(key);
      if (previous) return output_({ success: true, duplicate: true, sentAt: previous });

      var model = emailModel_(input.type, input.studentName || 'estudante', input.data || {});
      GmailApp.sendEmail(input.to, input.subject || model.subject, model.plainText, {
        htmlBody: model.html,
        name: 'COERI · IFMS Campus Três Lagoas',
        replyTo: 'coeri.tl@ifms.edu.br'
      });
      var sentAt = new Date().toISOString();
      properties.setProperty(key, sentAt);
      return output_({ success: true, sentAt: sentAt });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return output_({ success: false, error: String(error && error.message || error) });
  }
}

/** Executada diariamente por um acionador baseado em tempo. */
function checkEndingInternships() {
  var properties = PropertiesService.getScriptProperties();
  var url = properties.getProperty('SUPABASE_DUE_CHECK_URL');
  var secret = properties.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('Configuração da verificação diária incompleta.');
  var response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ secret: secret })
  });
  var result = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() >= 300 || !result.success) throw new Error(result.error || 'Falha na verificação diária.');
  return result;
}

/** Execute uma vez para criar ou substituir o acionador diário das 8h. */
function installDailyEndingTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'checkEndingInternships') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('checkEndingInternships')
    .timeBased().atHour(8).everyDays(1).inTimezone('America/Cuiaba').create();
}

function emailModel_(type, studentName, data) {
  var firstName = escapeHtml_(String(studentName).trim().split(/\s+/)[0] || 'estudante');
  var protocol = escapeHtml_(data.protocol || '');
  var documentUrl = safeUrl_(data.documentUrl || '');
  var content;

  if (type === 'tce_recebido') {
    content = {
      subject: 'Solicitação de TCE recebida pela COERI',
      kicker: 'TERMO DE COMPROMISSO DE ESTÁGIO · COERI',
      title: 'Solicitação concluída',
      subtitle: 'Sua solicitação de Termo de Compromisso de Estágio foi registrada com sucesso.',
      greeting: 'Olá, ' + firstName + '!',
      introduction: 'A solicitação do seu <strong>Termo de Compromisso de Estágio — TCE</strong> foi concluída e registrada pela COERI.',
      highlight: protocol ? '<div style="font-size:13px;color:#217346;font-weight:bold;text-transform:uppercase;letter-spacing:.6px">Número do protocolo</div><div style="margin-top:8px;font-size:28px;font-weight:bold;color:#0d633c;letter-spacing:1px">' + protocol + '</div>' : '',
      steps: [
        ['🔎', 'Consulte o protocolo no Portal da COERI', 'Use o número acima na opção <strong>Consultar protocolo</strong> para acompanhar o andamento.'],
        ['📩', 'Aguarde o envio para assinatura', 'Assim que o TCE for emitido, será enviado um link aos contatos informados.'],
        ['✍️', 'Procure pelo remetente Autentique', 'Verifique também as pastas de spam, lixo eletrônico e mensagens arquivadas.']
      ],
      warning: 'O estágio somente poderá ser iniciado após a emissão do TCE e a assinatura do documento por todas as partes envolvidas.',
      closing: 'Guarde o número do protocolo para consultar o andamento da solicitação.'
    };
  } else if (type === 'tce_gerado') {
    content = {
      subject: 'Seu TCE foi gerado e enviado para assinatura',
      kicker: 'TERMO DE COMPROMISSO DE ESTÁGIO · COERI',
      title: 'Seu TCE foi gerado',
      subtitle: 'O documento já foi encaminhado para assinatura eletrônica.',
      greeting: 'Olá, ' + firstName + '!',
      introduction: 'O seu <strong>Termo de Compromisso de Estágio — TCE</strong> foi gerado e enviado para assinatura eletrônica.',
      highlight: '<div style="font-size:18px;font-weight:bold;color:#145d36">Documento enviado para assinatura</div><div style="margin-top:6px;color:#3d5c4b">O convite foi encaminhado aos endereços de e-mail ou números de WhatsApp informados.</div>',
      steps: [
        ['1', 'Verifique seu e-mail e WhatsApp', 'Confira também as pastas de spam, lixo eletrônico e mensagens arquivadas.'],
        ['2', 'Procure pelo remetente Autentique', 'A mensagem de assinatura será enviada pela plataforma <strong>Autentique</strong>.'],
        ['3', 'Assine o documento', documentUrl ? 'Você também pode <a href="' + documentUrl + '" style="color:#0d633c;font-weight:bold">abrir o documento para assinatura</a>.' : 'Acesse o link recebido, confira as informações e conclua sua assinatura.']
      ],
      warning: 'O estágio somente poderá ser iniciado após a assinatura do TCE por todas as partes envolvidas.',
      closing: 'Caso não localize a mensagem, confira os contatos informados e entre em contato com a COERI.'
    };
  } else if (type === 'estagio_concluido') {
    content = {
      subject: 'Confirmação de finalização do estágio',
      kicker: 'CONFIRMAÇÃO DE ESTÁGIO · COERI',
      title: 'Estágio registrado e finalizado',
      subtitle: 'A documentação final foi recebida e os procedimentos de encerramento foram concluídos.',
      greeting: 'Olá, ' + firstName + '!',
      introduction: 'Conforme os relatórios e documentos entregues, seu estágio foi devidamente <strong>registrado e finalizado no sistema</strong>.',
      highlight: '<div style="font-size:18px;font-weight:bold;color:#145d36">✅ Procedimento concluído</div><div style="margin-top:6px;color:#3d5c4b">Não há, neste momento, pendências documentais relacionadas ao encerramento deste estágio junto à COERI.</div>',
      steps: [], warning: '',
      closing: 'Recomendamos que você mantenha uma cópia dos relatórios e documentos assinados para seus registros pessoais.'
    };
  } else if (type === 'previsao_termino') {
    var endingDate = escapeHtml_(data.expectedEndDateFormatted || data.expectedEndDate || '');
    return {
      subject: 'A previsão de término do seu estágio foi atingida',
      plainText: 'A previsão de término do seu estágio foi atingida. Informe à COERI se o estágio foi encerrado ou se haverá continuidade das atividades.',
      html: renderEndingEmail_(firstName, endingDate)
    };
  } else throw new Error('Tipo de mensagem inválido.');

  return { subject: content.subject, plainText: stripHtml_(content.introduction + ' ' + content.closing), html: renderEmail_(content) };
}

function renderEndingEmail_(firstName, endingDate) {
  var dateLine = endingDate ? '<p style="margin:12px 0 0;font-size:15px;line-height:24px"><strong>Data prevista:</strong> ' + endingDate + '</p>' : '';
  return '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#eef2f1;font-family:Arial,Helvetica,sans-serif;color:#26332f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f1"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(20,60,45,.10)"><tr><td style="height:8px;background:#16834b">&nbsp;</td></tr><tr><td style="background:#0d633c;padding:34px 38px 30px"><div style="font-size:13px;color:#d7f3e4;font-weight:bold">ACOMPANHAMENTO DE ESTÁGIO · COERI</div><h1 style="margin:8px 0 10px;font-size:29px;line-height:37px;color:#fff">Previsão de término do estágio</h1><p style="margin:0;font-size:16px;line-height:25px;color:#edf8f2">A data prevista para encerramento do seu estágio foi atingida. Veja como proceder.</p></td></tr><tr><td style="padding:30px 38px 18px"><p style="margin:0;font-size:16px;line-height:26px">Olá, ' + firstName + '!</p><p style="margin:12px 0 0;font-size:16px;line-height:26px">Conforme o período registrado no seu Termo de Compromisso de Estágio, a <strong>previsão de término do estágio foi atingida</strong>.</p><p style="margin:12px 0 0;font-size:16px;line-height:26px">Agora, é necessário informar à COERI se o estágio foi encerrado ou se haverá continuidade das atividades.</p>' + dateLine + '</td></tr><tr><td style="padding:0 38px 14px"><div style="font-size:13px;color:#16834b;font-weight:bold;text-transform:uppercase">Se o estágio foi encerrado</div></td></tr><tr><td style="padding:0 38px 20px"><table role="presentation" width="100%" style="background:#eef9f2;border:1px solid #b9dfc7;border-radius:12px"><tr><td width="58" style="padding:20px 0 20px 20px;font-size:30px">📚</td><td style="padding:19px 20px 19px 12px"><div style="font-size:18px;font-weight:bold;color:#145d36">Envie os documentos finais</div><div style="margin-top:7px;font-size:15px;line-height:23px;color:#3d5c4b">Encaminhe o <strong>Relatório Final de Estágio</strong> e a <strong>Avaliação do Estagiário pelo Supervisor</strong>, devidamente preenchidos e assinados.</div></td></tr></table></td></tr><tr><td align="center" style="padding:0 38px 28px"><a href="https://coeri.tl.ifms.edu.br/relatorios" style="display:inline-block;background:#16834b;color:#fff;text-decoration:none;font-size:15px;font-weight:bold;padding:13px 24px;border-radius:9px">Acessar relatórios e orientações</a></td></tr><tr><td style="padding:0 38px 14px"><div style="font-size:13px;color:#16834b;font-weight:bold;text-transform:uppercase">Se você continuará no estágio</div></td></tr><tr><td style="padding:0 38px 24px"><table role="presentation" width="100%" style="background:#f4f8fb;border:1px solid #cfdde7;border-radius:12px"><tr><td width="58" style="padding:20px 0 20px 20px;font-size:30px">🔄</td><td style="padding:19px 20px 19px 12px"><div style="font-size:18px;font-weight:bold;color:#244d65">Informe a COERI para prorrogação</div><div style="margin-top:7px;font-size:15px;line-height:23px;color:#52615b">Caso continue atuando na unidade concedente, informe a COERI para o registro da prorrogação e os procedimentos necessários à continuidade regular do estágio.</div></td></tr></table></td></tr><tr><td style="padding:0 38px 26px"><table role="presentation" width="100%" style="background:#fff7e8;border-left:5px solid #e5a11a;border-radius:8px"><tr><td style="padding:17px 18px;font-size:15px;line-height:23px;color:#65490f"><strong>Importante:</strong> se houver continuidade após a previsão de término, a situação deve ser informada à COERI para atualização e registro da prorrogação.</td></tr></table></td></tr><tr><td align="center" style="padding:2px 38px 34px"><a href="mailto:coeri.tl@ifms.edu.br" style="display:inline-block;background:#16834b;color:#fff;text-decoration:none;font-size:16px;font-weight:bold;padding:15px 28px;border-radius:9px">Informar a COERI</a><div style="margin-top:14px;font-size:13px;color:#6c7974">coeri.tl@ifms.edu.br</div></td></tr><tr><td style="border-top:1px solid #e6ece9;padding:25px 38px"><p style="margin:0 0 12px;font-size:15px;line-height:23px">Em caso de dúvida, consulte o Portal da COERI.</p><p style="margin:0;font-size:15px;line-height:23px">Atenciosamente,<br><strong>Coordenação de Extensão e Relações Institucionais — COERI</strong><br>IFMS Campus Três Lagoas</p></td></tr><tr><td style="background:#173d2e;padding:23px 38px;text-align:center;font-size:13px;color:#d6e6df"><a href="https://coeri.tl.ifms.edu.br/" style="color:#fff;font-weight:bold">coeri.tl.ifms.edu.br</a> &nbsp;·&nbsp; <a href="mailto:coeri.tl@ifms.edu.br" style="color:#fff;font-weight:bold">coeri.tl@ifms.edu.br</a></td></tr><tr><td style="height:5px;background:#c9303e">&nbsp;</td></tr></table></td></tr></table></body></html>';
}

function renderEmail_(content) {
  var steps = content.steps.map(function(step) {
    return '<tr><td style="padding:0 38px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #dce8e2;border-radius:12px;background:#f8fbf9"><tr><td width="52" style="padding:18px 0 18px 18px;font-size:24px">' + step[0] + '</td><td style="padding:17px 18px 17px 12px"><div style="font-size:17px;font-weight:bold;color:#174b35">' + step[1] + '</div><div style="margin-top:5px;font-size:14px;line-height:22px;color:#52615b">' + step[2] + '</div></td></tr></table></td></tr>';
  }).join('');
  var warning = content.warning ? '<tr><td style="padding:8px 38px 26px"><table role="presentation" width="100%" style="background:#fff7e8;border-left:5px solid #e5a11a;border-radius:8px"><tr><td style="padding:17px 18px;font-size:15px;line-height:23px;color:#65490f"><strong>Atenção:</strong> ' + content.warning + '</td></tr></table></td></tr>' : '';
  return '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#eef2f1;font-family:Arial,Helvetica,sans-serif;color:#26332f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f1"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border-radius:18px;overflow:hidden"><tr><td style="height:8px;background:#16834b">&nbsp;</td></tr><tr><td style="background:#0d633c;padding:34px 38px 30px"><div style="font-size:13px;color:#d7f3e4;font-weight:bold">' + content.kicker + '</div><h1 style="margin:8px 0 10px;font-size:29px;line-height:37px;color:#fff">' + content.title + '</h1><p style="margin:0;font-size:16px;line-height:25px;color:#edf8f2">' + content.subtitle + '</p></td></tr><tr><td style="padding:30px 38px 20px"><p style="margin:0;font-size:16px;line-height:26px">' + content.greeting + '</p><p style="margin:12px 0 0;font-size:16px;line-height:26px">' + content.introduction + '</p></td></tr><tr><td style="padding:0 38px 24px"><table role="presentation" width="100%" style="background:#eef9f2;border:1px solid #b9dfc7;border-radius:12px"><tr><td style="padding:20px;text-align:center">' + content.highlight + '</td></tr></table></td></tr>' + steps + warning + '<tr><td align="center" style="padding:2px 38px 34px"><a href="https://coeri.tl.ifms.edu.br/" style="display:inline-block;background:#16834b;color:#fff;text-decoration:none;font-size:16px;font-weight:bold;padding:15px 28px;border-radius:9px">Acessar o Portal da COERI</a></td></tr><tr><td style="border-top:1px solid #e6ece9;padding:25px 38px"><p style="margin:0 0 12px;font-size:15px;line-height:23px">' + content.closing + '</p><p style="margin:0;font-size:15px;line-height:23px">Atenciosamente,<br><strong>Coordenação de Extensão e Relações Institucionais — COERI</strong><br>IFMS Campus Três Lagoas</p></td></tr><tr><td style="background:#173d2e;padding:23px 38px;text-align:center;font-size:13px;color:#d6e6df">Contato: <a href="mailto:coeri.tl@ifms.edu.br" style="color:#fff;font-weight:bold">coeri.tl@ifms.edu.br</a></td></tr><tr><td style="height:5px;background:#c9303e">&nbsp;</td></tr></table></td></tr></table></body></html>';
}

function output_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function escapeHtml_(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function safeUrl_(value) { var url = String(value); return /^https:\/\//i.test(url) ? escapeHtml_(url) : ''; }
function stripHtml_(value) { return String(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
