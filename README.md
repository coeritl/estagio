# Portal de Estágios — COERI/IFMS Três Lagoas

Portal público com orientações sobre estágio obrigatório, estágio não obrigatório, relatórios, empresas conveniadas, formalização de convênios e convalidação de experiência profissional.

## Publicação

O projeto é um site estático compatível com GitHub Pages. O arquivo `index.html` é a página inicial e não há etapa de compilação.

## Formulários de TCE

As solicitações são coletadas pelos formulários institucionais do Google Workspace da COERI. A página apresenta opções separadas para estágio externo e estágio interno.

## Manutenção

- Informações gerais: `index.html`
- Como começar: `como-comecar.html`
- Empresas conveniadas: `empresas.html`
- Relatórios: `relatorios.html`
- Convalidação: `convalidacao.html`
- Orientações para empresas: `para-empresas.html`
- Solicitação de TCE: `formulario-tce.html`
- Painel administrativo: `admin.html`
- Estilos: `assets/styles.css`
- Comportamentos do formulário: `assets/main.js`

## Painel administrativo e Supabase

O painel de acompanhamento fica em `/admin` e não aparece no menu público. Para conectá-lo a um novo projeto Supabase:

1. Crie o projeto na conta institucional escolhida.
2. Execute `supabase/setup.sql` no SQL Editor.
3. Em **Authentication > Users**, crie o login administrativo da COERI.
4. Execute no SQL Editor a última instrução `insert` comentada em `supabase/setup.sql`, usando o e-mail criado.
5. Copie a **Project URL** e a chave pública **anon/publishable** para `assets/supabase-config.js`.

Nunca coloque a chave `service_role` no site. As tabelas usam Row Level Security e só liberam os registros aos usuários incluídos em `admin_users`.
