# Placar MasterChef

Web app estático (HTML + JS, sem build) com classificação, evolução e previsão de vencedor. Suporta várias edições (MC-2026, MC-2027…), cada uma com seus participantes, episódios e resultados.

Site: https://gomes-code.github.io/placar-masterchef-2026/

## De onde vêm os dados

- **Planilha do Google (recomendado):** uma aba por edição (`MC-2026`, `MC-2027`…). O site lê direto dela, sem publicar nada. Configuração em [GOOGLE_SHEETS.md](GOOGLE_SHEETS.md).
- **`data.js`:** cópia de segurança de todas as edições. É a fonte quando o `config.js` está sem o endereço da planilha, ou quando a planilha não responde.

## Telas

- **Placar:** pódio, resumo do último episódio, classificação com o resultado de cada prova e a posição a cada episódio, e o gráfico de evolução.
- **Estatísticas:** chance de vencer (simulação Monte Carlo), desempenho × consistência e detalhes do modelo.
- **Lançar resultados:** escolha o episódio e clique nas células para lançar os códigos. Com a planilha ligada, **Salvar na planilha** grava no Google Sheets.
- **Edições:** criar edição nova (gera a aba modelo vazia na planilha), escolher a edição padrão, participantes, episódios, baixar em Excel.
- **Regras:** tabela de pontuação.

O seletor ao lado do título troca de edição. O link `?edicao=MC-2026` abre direto numa edição.

## Modelo de planilha (por edição)

Linha 1: `SEMANA 01`, `SEMANA 02`… (2 colunas por episódio). Linha 2: `FOTO | COMPETIDOR | 1ª PROVA 1 | 2ª PROVA 1 | …`. A partir da linha 3: foto, nome e o código de cada prova. Vazio = não disputou, `-` = fora da competição. Exemplo: [Dados/MC-2026.xlsx](Dados/MC-2026.xlsx).

## Sem a planilha do Google (modo arquivo)

- **Pelo app:** lance em *Lançar resultados* → **Baixar data.js** → substitua o arquivo no projeto → commit e push.
- **Pelo Excel:** cada `Dados/MC-AAAA.xlsx` (modelo acima) ou `Dados/TABELA MASTERCHEF AAAA.xlsx` (formato antigo) vira a edição `MC-AAAA`. Preencha, salve e feche o Excel, e dê dois cliques em `publicar.bat`: ele lê todas as planilhas de `Dados/`, atualiza o `data.js`, faz o commit e envia. Se duas planilhas derem o mesmo código, vale a modificada por último.

> O que é lançado no app sem salvar na planilha (ou sem publicar o data.js) fica só naquele navegador.

## Regras de cálculo

- Pontos = soma dos pontos de cada código, nunca abaixo de 0.
- Pins = quantidade de `V` (vitória individual).
- Vitórias em equipe = `VDP` + `VLE` + `VE` + `VD`.
- Desempate: pontos → pins → vitórias em equipe → nome.
