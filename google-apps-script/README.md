# Notificações da COERI pelo Google Apps Script

## Acesso local à API com clasp

As dependências do CLI estão em `package.json` e `package-lock.json`.
Execute `npm ci` nesta pasta em uma nova instalação. Neste computador,
`./clasp.ps1` usa o Node disponível no PATH e o clasp instalado localmente.

1. Ative a Apps Script API em https://script.google.com/home/usersettings na conta da COERI.
2. Execute `./clasp.ps1 login` e conclua o OAuth no navegador.
3. Configure `.clasp.json` localmente com o `scriptId` do projeto existente e `rootDir` igual a `.`.
4. Use `./clasp.ps1 list-deployments` para conferir a implantação em uso.
5. Antes de um push, salve um backup remoto em pasta separada e compare os arquivos.
6. Confira `./clasp.ps1 show-file-status`: somente `Code.gs` e `appsscript.json` devem ser enviados.
7. Use `./clasp.ps1 push` para enviar o código. Se o manifesto exigir confirmação,
   compare-o com o remoto antes de usar `push --force`.
8. Publique com `./clasp.ps1 create-deployment --deploymentId ID_EXISTENTE --description "Descrição"`
   para manter a URL `/exec`. Confira novamente com `list-deployments`.

O OAuth fica no perfil local do usuário. Credenciais, configuração local,
dependências instaladas e backups não entram no Git. Não use `pull` na pasta
principal para não sobrescrever mudanças locais ainda não publicadas.

## Configuração inicial pelo editor

1. Acesse `https://script.google.com` usando `coeri.tl@ifms.edu.br`.
2. Crie um projeto e substitua o conteúdo de `Code.gs` pelo arquivo desta pasta.
3. Em **Configurações do projeto > Propriedades do script**, crie `WEBHOOK_SECRET` com um segredo forte.
4. Em **Implantar > Nova implantação > Aplicativo da web**, escolha **Executar como: eu** e permita o acesso necessário para receber as chamadas do Supabase.
5. Copie a URL terminada em `/exec`.
6. Cadastre a URL e o mesmo segredo no Supabase como `GOOGLE_APPS_SCRIPT_URL` e `GOOGLE_APPS_SCRIPT_SECRET`.

O script envia pela conta que criou a implantação. A central registra “Enviado pelo Gmail” quando `GmailApp.sendEmail` termina sem erro; isso não é confirmação de leitura nem garantia de entrega na caixa de entrada.

O acionador diário também consulta as pendências dos orientandos. A função do Supabase agrupa os casos por professor e emite no máximo um resumo por mês, incluindo em cópia as coordenações dos cursos envolvidos.

## Propostas manuais de renovação

Atualize o conteúdo de `Code.gs` no projeto existente e publique uma nova versão em
**Implantar > Gerenciar implantações > Editar > Nova versão**, mantendo a URL `/exec`.
O novo modelo `convenio_renovacao` envia a mensagem revisada pela COERI e direciona
as respostas para `coeri.tl@ifms.edu.br`. Não crie acionadores para essa comunicação.
A Edge Function verifica a capacidade do script antes de enviar; se a implantação
não foi atualizada, registra falha na central e não dispara a proposta.
O coordenador deve revisar e confirmar cada envio pelo painel. A mensagem não
renova o convênio nem atualiza os cadastros automaticamente.
