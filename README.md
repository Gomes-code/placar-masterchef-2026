# Placar MasterChef 2026

Web app estático (HTML + JS, sem build) com a classificação, a evolução e a previsão de vencedor, a partir da planilha `Dados/TABELA MASTERCHEF 2026.xlsx`.

## Como usar

Abra `index.html` no navegador. Precisa de internet para carregar o Chart.js e o SheetJS (CDN).

- **Classificação**: ranking (pontos, pins, vitórias em equipe, variação na semana) e o quadro de provas colorido.
- **Evolução**: pontos acumulados e posição por semana.
- **Previsões**: chance de vencer (simulação Monte Carlo), desempenho × consistência e detalhes do modelo.
- **Lançar resultados**: edite os códigos prova a prova. Fica salvo no navegador (localStorage). Também dá para importar a planilha `.xlsx` atualizada ou exportar/importar `.json`.
- **Regras**: tabela de pontuação (editável).

## Adicionar os resultados de um novo episódio

**Jeito 1 — pela planilha (recomendado):**

1. Preencha os códigos da semana na aba *Placar* de `Dados/TABELA MASTERCHEF 2026.xlsx`, salve e feche o Excel.
2. Dê dois cliques em `publicar.bat`. Ele lê a planilha, gera `data.js`, faz o commit e envia para o GitHub.
3. Em 1–2 minutos o site publicado mostra os novos resultados.

**Jeito 2 — pelo próprio app:**

1. Na aba *Lançar resultados*, escolha os códigos das novas provas.
2. Clique em **Baixar data.js**, substitua o `data.js` da pasta do projeto pelo arquivo baixado.
3. Faça commit e push (GitHub Desktop ou `git commit` + `git push`). Não rode o `publicar.bat` nesse caso, porque ele regeraria o `data.js` a partir da planilha.

> O que é lançado no app sem publicar fica só naquele navegador. Para os visitantes verem, precisa passar pelo `data.js` publicado. Quando um `data.js` novo é publicado, as edições locais antigas são descartadas automaticamente.

## Regras de cálculo (iguais às da planilha)

- Pontos = soma dos pontos de cada código, nunca abaixo de 0.
- Pins = quantidade de `V` (vitória individual).
- Vitórias em equipe = `VDP` + `VLE` + `VE` + `VD`.
- Desempate: pontos → pins → vitórias em equipe → nome.
