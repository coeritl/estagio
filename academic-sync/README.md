# Sincronizador do Sistema Acadêmico

Agente local, somente leitura no Sistema Acadêmico, para sincronizar com o painel da COERI:

- convênios;
- estágios com situação **Iniciado**, **Suspenso** ou **Em edição**;
- dados pessoais somente dos estudantes vinculados a esses estágios.

O agente não altera nada no Sistema Acadêmico e não conclui nem exclui registros do painel.

## Primeira configuração

1. Execute `npm install` nesta pasta.
2. Copie `.env.example` para `.env` e preencha o segredo entregue pela COERI.
3. Execute `npm run login`.
4. Faça o login manual no navegador aberto e aguarde a coleta de teste terminar.
5. Confira os arquivos de `preview/`. Nenhum dado é enviado no modo de teste.
6. Execute `npm run sync` para sincronizar.

## Execuções seguintes

O perfil autenticado fica em `browser-profile/`, fora do Git. Quando a sessão expirar, `npm run sync` terminará sem transmitir dados. Execute novamente `npm run login` para renovar a sessão.

## Agendamento no Windows

Neste computador, a tarefa `COERI - Sincronizar Sistema Academico` executa `run-sync.ps1` semanalmente. O arquivo `logs/latest.json` registra o resultado mais recente. Quando a sessão expirar, execute novamente `npm run login` para renová-la.
