# WALEVA — Analisador de Vendas

Aplicação web responsiva em português de Portugal para registo e análise de quantidades vendidas nas lojas WALEVA. Os dados operacionais são guardados no Cloud Firestore e o acesso é feito por Firebase Authentication. Não existem vendas de demonstração.

## Funcionalidades implementadas

- Autenticação por e-mail e palavra-passe, recuperação por e-mail e perfis `admin`, `store_manager` e `viewer`.
- Regras de segurança do Firestore para perfil ativo, papel e lojas autorizadas.
- Lojas iniciais criadas pelo primeiro administrador; gestão de lojas sem apagar o respetivo histórico.
- Registo, pesquisa, filtro, paginação, edição auditada e anulação administrativa de vendas.
- Painel e análise por intervalo, loja e produto, calculados apenas a partir de quantidades.
- Importação validada de CSV/Excel e exportação CSV compatível com Excel.
- Revisão e fecho semanal domingo–sábado, com prevenção atómica de fechos duplicados, responsável e correções auditadas.
- PWA com shell em cache e cache persistente do Firestore para pedidos offline. O estado local pendente não é apresentado como sincronizado.

## Requisitos

- Projeto Firebase com **Authentication (E-mail/palavra-passe)** e **Cloud Firestore** ativados.
- Navegador moderno. Para PWA e service worker, publicar em HTTPS (GitHub Pages e Firebase Hosting suportam HTTPS).
- Node.js 20.11+ e npm para preparar a publicação e executar testes de regras.
- Java 21+ para executar o emulador Firestore.
- Google Cloud CLI para autenticar o bootstrap administrativo por Application Default Credentials.

## Preparar, testar e executar

Na raiz deste repositório, instala as ferramentas, valida as regras contra o emulador local e prepara a pasta estática `dist/`:

```powershell
npm install
npm test
npm run build
```

Antes de compilar, cria o ficheiro `.env` a partir do exemplo. Não publiques `.env`:

```powershell
Copy-Item .env.example .env
```

Preenche os quatro campos Firebase no `.env` após criares a aplicação Web na consola. A configuração Web é pública por desenho e não concede acesso aos dados; as regras Firestore aplicam a autorização. Não coloques chaves de conta de serviço nem palavras-passe neste ficheiro.

Para pré-visualizar a aplicação:

```powershell
npm run dev
```

Abre `http://127.0.0.1:4173`. Os testes das regras correm num emulador com o projeto fictício `waleva-rules-test`; não ligam nem alteram dados Firebase. Java 21+ é necessário para o emulador Firestore.

## Configuração do Firebase

1. Na [Firebase Console](https://console.firebase.google.com/), cria um projeto separado para o analisador WALEVA. Não uses nem alteres o projeto do website principal.
2. Ativa **Authentication → Sign-in method → Email/Password** e cria as contas autorizadas.
3. Cria a base de dados em **Firestore Database**.
4. Em **Definições do projeto → Geral → As tuas aplicações**, regista uma aplicação Web. Copia os quatro valores oficiais `apiKey`, `authDomain`, `projectId` e `appId` para `.env`. A configuração Web não é uma chave administrativa; as regras abaixo protegem os dados. O `firebase-config.js` incluído no código-fonte contém apenas marcadores; `npm run dev` serve a configuração de `.env` em memória e `npm run build` escreve-a apenas em `dist/`.
5. `.firebaserc` está configurado para o ID de projeto indicado, `waleva-analisador-de-vendas`. Confirma sempre o projeto ativo antes de qualquer comando de publicação; este ficheiro não altera o destino de Hosting.
6. Publica `firestore.rules` e `firestore.indexes.json` antes de guardar dados reais:

   ```powershell
   firebase login
   firebase use --add
   npm run deploy:rules
   ```

   Seleciona o projeto Firebase novo. Confirma o ID antes do deploy.
7. **Bootstrap seguro do primeiro administrador:** cria a conta em **Authentication → Users → Add user**. Na máquina confiável que executará o script, instala o Google Cloud CLI e autentica por ADC:

   ```powershell
   gcloud auth application-default login
   ```

   O utilizador Google autenticado precisa das permissões IAM `roles/firebaseauth.admin` e `roles/datastore.user` no projeto. Um proprietário do projeto pode concedê-las ao endereço Google que usará no login:

   ```powershell
   gcloud projects add-iam-policy-binding waleva-analisador-de-vendas --member="user:TEU_EMAIL_GOOGLE" --role="roles/firebaseauth.admin"
   gcloud projects add-iam-policy-binding waleva-analisador-de-vendas --member="user:TEU_EMAIL_GOOGLE" --role="roles/datastore.user"
   gcloud auth application-default login
   ```

   Substitui `TEU_EMAIL_GOOGLE` pelo endereço real e confirma que a conta ADC é a mesma. A configuração usa ADC e o projeto fixo `waleva-analisador-de-vendas`; não descarregues nem guardes uma chave JSON de conta de serviço no repositório.

   Na raiz do projeto, procura a conta pelo e-mail ou indica o UID obtido em Authentication. O script apresenta o e-mail e UID resolvidos e só continua após confirmação explícita:

   ```powershell
   npm run bootstrap:admin -- --email "endereco-da-conta@exemplo.pt"
   # ou
   npm run bootstrap:admin -- --uid "UID_EXATO_DA_CONTA"
   ```

   Escreve `SIM` apenas depois de confirmares que o e-mail e UID apresentados correspondem à conta correta. O UID é apenas um identificador, nunca uma palavra-passe. O script recusa contas desativadas, contas sem e-mail, perfis já existentes e qualquer projeto onde já exista um perfil `admin`; cria atomicamente o perfil `users/{UID}` e um marcador privado que impede uma segunda execução. Verifica a mensagem final de sucesso antes de iniciar sessão. Não edites manualmente o perfil nem o marcador.

   Este processo não usa Cloud Functions nem cria um endpoint público, pelo que não requer ativar faturação para Functions. As regras do Firestore negam acesso de clientes ao marcador; o Admin SDK escreve a partir do ambiente confiável e não depende de permissões do navegador. Depois do bootstrap, a interface administrativa permite gerir utilizadores e lojas. Cria primeiro cada conta em Authentication; em **Utilizadores**, associa o UID ao perfil e às lojas autorizadas.
8. Para executar localmente, serve a pasta por HTTP em vez de abrir `index.html` diretamente. Por exemplo:

   ```powershell
   npm run dev
   ```

   `npm run build` lê a configuração do `.env` e prepara `dist/firebase-config.js`. Mantém o `.env` fora do Git. O botão de recuperação no ecrã de entrada envia a mensagem do Firebase; configura e testa o modelo de e-mail em **Authentication → Templates**.

## Publicação

### GitHub Pages

1. Cria no GitHub um repositório vazio e independente para este sistema; não uses nem alteres o repositório do website principal.
2. Em **Settings → Pages**, seleciona **GitHub Actions** como origem.
3. Adiciona `WALEVA_FIREBASE_API_KEY`, `WALEVA_FIREBASE_AUTH_DOMAIN`, `WALEVA_FIREBASE_PROJECT_ID` e `WALEVA_FIREBASE_APP_ID` como GitHub Actions Variables do repositório.
4. Faz push para `main`. O workflow `.github/workflows/pages.yml` executa os testes das regras Firestore e publica os ficheiros estáticos.
5. Regista o domínio de publicação em **Firebase Authentication → Settings → Authorized domains**.

Para publicar o repositório, substitui o endereço no exemplo abaixo pelo URL HTTPS apresentado pelo GitHub (não é necessário indicar um nome de utilizador à aplicação) e executa na raiz do projeto:

```powershell
git add .
git commit -m "Preparar analisador de vendas WALEVA"
git remote add origin "https://github.com/UTILIZADOR/REPOSITORIO.git"
git push -u origin main
```

Confirma que `.env` não está incluído no commit; `.gitignore` exclui-o. `.firebaserc` contém inicialmente apenas um marcador e deve receber o ID Firebase correto antes de usar os comandos Firebase. O ID de projeto não é uma credencial secreta. Não coloques configurações de conta de serviço no repositório.

### Firebase Hosting

O `firebase.json` publica apenas a pasta `dist/` deste projeto para o alvo Firebase Hosting `waleva-analisador-vendas`; não usa o site Hosting predefinido:

```powershell
firebase login
firebase use --add
firebase hosting:sites:create ID_UNICO_DO_SITE --project ID_DO_PROJETO
firebase target:apply hosting waleva-analisador-vendas ID_UNICO_DO_SITE --project ID_DO_PROJETO
npm run deploy:hosting
```

Substitui `ID_DO_PROJETO` pelo ID real do projeto dedicado e `ID_UNICO_DO_SITE` pelo site Hosting criado dentro desse projeto. O comando `target:apply` guarda a associação apenas em `.firebaserc`. Confirma com `firebase projects:list` e `firebase use` antes do deploy. Não seleciones o site do website principal. Define os quatro valores Web no `.env`; a compilação de publicação falha de forma explícita se faltar algum.

## Formato CSV

Cabeçalhos obrigatórios: `data`, `loja`, `codigo`, `produto`, `quantidade`. `observacoes` é opcional. A data deve estar em `AAAA-MM-DD`; a loja deve corresponder ao nome inicializado; a quantidade deve ser um inteiro positivo. São aceites separadores `;` e `,`. Linhas inválidas e possíveis duplicados não são guardados.

## Dados, acesso e limitações

- Firestore Rules são a autoridade de acesso; ocultar controlos na interface não substitui as regras. O acesso inicial de administrador é configurado manualmente no Console.
- O SDK Web do Firestore usa cache persistente do navegador e fila de escritas offline. Um registo escrito offline aparece como **Pendente**; um conjunto de dados apenas lido da cache é rotulado como não confirmado. A sincronização exige que o utilizador volte a ligar-se com a sessão ainda válida. Edições/anulações existentes exigem dados atuais do servidor e usam transação para recusar conflitos em vez de sobrescrever alterações alheias.
- `firestore.indexes.json` começa sem índices compostos: as consultas implementadas usam leitura de coleção ou filtro por uma única igualdade. Se forem adicionados filtros compostos no futuro, o Firebase CLI apresentará/criará os índices necessários.
- A aplicação necessita de internet na primeira visita para carregar os módulos Firebase. O service worker guarda os ficheiros da app e os módulos Firebase depois de estes terem sido carregados.
- A exportação é CSV; importação aceita CSV e Excel (`.xlsx`/`.xls`). A leitura Excel usa SheetJS servido pela CDN e, por isso, requer ligação na primeira carga. A exportação PDF usa a função de impressão do navegador.
- A gestão de contas de autenticação (criar palavra-passe/conta) deve ser feita por um administrador no Firebase Authentication; a aplicação apenas autoriza o perfil Firestore. Não armazena nem expõe palavras-passe.
- O bootstrap do primeiro administrador requer criar manualmente a conta no Firebase Authentication e o perfil `users/{UID}` na consola Firestore antes do primeiro login. Isto evita introduzir credenciais administrativas na aplicação pública.
- O fecho semanal é exclusivo de administradores, só corre com confirmação online do Firestore e guarda os totais por loja/produto. As vendas originais não são apagadas nem alteradas pelo fecho. Correções são acrescentadas como eventos imutáveis de auditoria; anulações são preservadas e excluídas dos totais.
- Antes da utilização real, testa regras com contas separadas de administrador, responsável e consulta e valida o acesso a lojas não autorizadas. Não há credenciais Firebase incluídas neste pacote.

## Índices Firestore

`firestore.indexes.json` está intencionalmente vazio. As consultas usadas atualmente são leituras de coleção ou filtro por uma única igualdade (`storeId in [...]`), cobertas pelos índices de campo único geridos pelo Firestore. Se uma alteração futura introduzir consultas compostas, adiciona o índice apresentado pelo erro do Firestore ao ficheiro e publica novamente com `npm run deploy:rules`.
