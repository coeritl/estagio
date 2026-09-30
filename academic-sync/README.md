# Sincronizador do Sistema Acadêmico

Agente local, somente leitura no Sistema Acadêmico, para sincronizar com o painel da COERI:

- convênios;
- estágios com situação **Iniciado**, **Suspenso** ou **Em edição**, de estudantes cuja situação no curso seja **Em curso** ou **Integralizado em fase escolar**;
- dados pessoais somente dos estudantes vinculados a esses estágios.

O agente não altera nada no Sistema Acadêmico e não conclui nem exclui registros do painel.
Quando um acompanhamento existente aparece como **Finalizado** no Sistema Acadêmico, ele é destacado no topo do painel para revisão e encerramento pelo coordenador.

## Primeira configuração

1. Execute `npm install` nesta pasta.
2. Copie `.env.example` para `.env` e preencha o segredo entregue pela COERI.
3. Execute `powershell -ExecutionPolicy Bypass -File .\setup-credentials.ps1` e informe o login e a senha do Sistema Acadêmico.
4. Execute `npm run login` para criar o primeiro perfil do navegador e aguarde a coleta de teste terminar.
5. Confira os arquivos de `preview/`. Nenhum dado é enviado no modo de teste.
6. Execute `npm run sync` para sincronizar.

As credenciais são protegidas pelo DPAPI do Windows no arquivo `credentials.dpapi.json`. A senha não fica em texto aberto, não é incluída no Git e somente o mesmo usuário do Windows, neste computador, consegue descriptografá-la.

## Execuções seguintes

O perfil autenticado fica em `browser-profile/`, fora do Git. Quando a sessão expirar, `run-sync.ps1` detecta a tela de login, recupera as credenciais protegidas pelo Windows, renova a sessão e continua a sincronização. Se a senha institucional for alterada, execute `setup-credentials.ps1` novamente.

## Agendamento no Windows

Neste computador, a tarefa `COERI - Sincronizar Sistema Academico` executa `run-sync.ps1`. A tarefa deve usar a mesma conta do Windows que cadastrou as credenciais. O arquivo `logs/latest.json` registra o resultado mais recente e informa se a autenticação foi renovada automaticamente.
