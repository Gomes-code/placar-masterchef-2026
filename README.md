# Placar MasterChef

Web app estático (HTML + JS, sem build) com classificação, evolução e previsão de vencedor. Suporta várias edições (2026, 2027, …), cada uma com seus participantes, episódios e tabela de pontos.

Site: https://gomes-code.github.io/placar-masterchef-2026/

## Telas

- **Placar**: pódio, resumo do último episódio, classificação com a posição em cada episódio, gráfico de evolução e o quadro de resultados por prova.
- **Estatísticas**: chance de vencer (simulação Monte Carlo), desempenho × consistência e detalhes do modelo.
- **Lançar resultados**: escolha o episódio e clique nas células para lançar os códigos.
- **Edições**: criar edição nova, escolher a edição padrão do site, participantes e número de episódios, baixar a planilha de uma edição.
- **Regras**: tabela de pontuação da edição (editável).

O seletor ao lado do título troca de edição. O link com `?edicao=<id>` abre direto numa edição (ex.: `?edicao=masterchef-2026`).

## Criar uma edição nova

1. Aba **Edições** → **Nova edição**: nome (ex.: “MasterChef 2027”), número de episódios, de qual edição copiar as regras de pontos e a lista de participantes (um por linha).
2. Lance os episódios em **Lançar resultados**.
3. Para publicar: **Lançar resultados** → **Baixar data.js** e substitua o `data.js` do projeto (ele leva todas as edições). Depois, commit e push.

Enquanto não for publicada, a edição aparece como “só neste navegador”.

## Adicionar resultados de novos episódios

**Pelo app** (qualquer edição): lance em *Lançar resultados* → **Baixar data.js** → substitua o arquivo → commit e push (GitHub Desktop ou `git`).

**Pela planilha**: cada arquivo `Dados/TABELA <NOME>.xlsx` vira uma edição (ex.: `TABELA MASTERCHEF 2027.xlsx` → “MasterChef 2027”). Para ter a planilha de uma edição criada no app, use **Edições → Planilha**; ela sai no mesmo formato da de 2026.
Preencha, salve e feche o Excel, e dê dois cliques em `publicar.bat`. Ele lê todas as planilhas de `Dados/`, atualiza o `data.js` (mantendo as edições que não vieram de planilha), faz o commit e envia.

> Não misture os dois jeitos na mesma edição: o `publicar.bat` sobrescreve, com o conteúdo da planilha, as edições que têm planilha em `Dados/`.

> O que é lançado no app sem publicar fica só naquele navegador. Quando um `data.js` novo é publicado, as alterações locais das edições que mudaram são descartadas automaticamente. Edições criadas no navegador e ainda não publicadas são mantidas.

## Regras de cálculo (iguais às da planilha)

- Pontos = soma dos pontos de cada código, nunca abaixo de 0.
- Pins = quantidade de `V` (vitória individual).
- Vitórias em equipe = `VDP` + `VLE` + `VE` + `VD`.
- Desempate: pontos → pins → vitórias em equipe → nome.
