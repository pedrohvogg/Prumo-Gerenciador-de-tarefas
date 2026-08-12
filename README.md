# Prumo — Gerenciador de Tarefas

Site pessoal de planejamento (diário, semanal e mensal) que funciona no computador e no celular. É um site estático (PWA): funciona offline, pode ser instalado como app no celular e, opcionalmente, sincroniza seus dados entre aparelhos via Firebase.

## O que ele faz

- **Demandas** com urgência, importância, data prevista, **horário**, tempo estimado e **entregas previstas** (cada entrega com a própria data).
- **Painel de estatísticas**: números do momento com comparativo da semana anterior, gráfico dos últimos 14 dias, melhor dia da semana, distribuição por categoria (com alerta de categorias negligenciadas), sequência atual de dias com conclusão, recorde histórico e mini-calendário de dias ativos.
- **Integração com calendário**: cada demanda pode virar evento no Google Agenda ou arquivo `.ics` (Outlook/calendário do iPhone), com horário, duração e recorrência.
- **Priorização**: ordenação por prioridade, prazo ou tempo, e a **matriz de Eisenhower** — grade 2×2 com os eixos urgente/não urgente e importante/não importante, dividindo as demandas em Fazer, Agendar, Delegar e Eliminar.
- **Planejamento diário, semanal e mensal** com navegação por datas — tocar em um dia da semana ou do mês abre aquele dia.
- **Categorias fixas da rotina**: Trabalho (demandas diárias), Trabalho (projetos), Saúde mental, Exercício, Estudos e Lazer.
- **Recorrência**: tarefas diárias, semanais (escolhendo os dias) ou mensais (dia do mês).
- **Diário**: anotações por dia + registro automático das ações (tarefas e entregas concluídas).
- **Capturar**: cole um texto ou adicione fotos com o contexto de uma demanda; o site monta um prompt, copia e abre um chat novo no **claude.ai** (selecione o modelo **Opus** lá) para o Claude definir as variáveis. Depois, cole a resposta de volta e a demanda é criada já preenchida.
- **Backup**: exportar/importar todos os dados em JSON.
- Tema claro/escuro (automático ou manual).

## Como publicar no GitHub Pages

1. Faça o merge deste branch no `main` (ou copie os arquivos para o `main`).
2. No GitHub, abra **Settings → Pages**.
3. Em **Source**, escolha **Deploy from a branch**, selecione `main` e a pasta `/ (root)`. Salve.
4. Em ~1 minuto o site estará em `https://pedrohvogg.github.io/Prumo-Gerenciador-de-tarefas/`.

No celular, abra esse endereço no navegador e use **“Adicionar à tela inicial”** para instalar como app.

## Como ativar a sincronização entre aparelhos (Firebase)

Sem configurar nada, os dados ficam salvos no navegador de cada aparelho (dá para transferir via exportar/importar em Ajustes). Para sincronizar automaticamente:

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) com sua conta Google e clique em **Criar projeto** (o plano gratuito basta). Pode desativar o Analytics.
2. No projeto, clique no ícone **Web `</>`** para registrar um app web (qualquer apelido). Copie o objeto `firebaseConfig` mostrado.
3. No menu **Criação → Authentication → Começar → Sign-in method**, ative o provedor **Google**.
4. Ainda em Authentication, aba **Settings → Domínios autorizados**, adicione `pedrohvogg.github.io`.
5. No menu **Criação → Firestore Database → Criar banco de dados**, escolha o modo **produção** e a região (ex.: `southamerica-east1`).
6. Na aba **Regras** do Firestore, cole e publique:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

7. No site, abra **⚙ Ajustes**, cole o `firebaseConfig` copiado no passo 2 e clique em **Salvar configuração**; depois **Entrar com Google**.
8. Repita o passo 7 em cada aparelho (computador e celular). Pronto: tudo sincroniza sozinho.

## Desenvolvimento

Sem build e sem dependências — HTML, CSS e JavaScript puros. Para rodar localmente:

```
python3 -m http.server 8000
```

e abra `http://localhost:8000`.

| Arquivo | Papel |
| --- | --- |
| `index.html` | Estrutura das telas (Hoje, Semana, Mês, Demandas, Diário, Capturar, Ajustes) |
| `styles.css` | Estilos, temas claro/escuro e layout responsivo |
| `app.js` | Estado, regras (prioridade, recorrência), renderização e sincronização |
| `sw.js` | Service worker (funcionamento offline) |
| `manifest.webmanifest` | Metadados do PWA (instalação no celular) |
