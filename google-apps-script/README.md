# Notificações da COERI pelo Google Apps Script

1. Acesse `https://script.google.com` usando `coeri.tl@ifms.edu.br`.
2. Crie um projeto e substitua o conteúdo de `Code.gs` pelo arquivo desta pasta.
3. Em **Configurações do projeto > Propriedades do script**, crie `WEBHOOK_SECRET` com um segredo forte.
4. Em **Implantar > Nova implantação > Aplicativo da web**, escolha **Executar como: eu** e permita o acesso necessário para receber as chamadas do Supabase.
5. Copie a URL terminada em `/exec`.
6. Cadastre a URL e o mesmo segredo no Supabase como `GOOGLE_APPS_SCRIPT_URL` e `GOOGLE_APPS_SCRIPT_SECRET`.

O script envia pela conta que criou a implantação. A central registra “Enviado pelo Gmail” quando `GmailApp.sendEmail` termina sem erro; isso não é confirmação de leitura nem garantia de entrega na caixa de entrada.
