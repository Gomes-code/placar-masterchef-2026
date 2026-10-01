# Ligar o placar a uma planilha do Google

Depois de configurado, o site lê os resultados direto da planilha: você digita os códigos depois do episódio e quem abrir o site já vê atualizado, sem publicar nada no GitHub.

## Como a planilha fica

| Aba | Para que serve |
|---|---|
| `Pontuação` | Código, descrição e pontos de cada resultado (V = 10, PE = −1…). Vale para todas as edições. |
| `Edições` | Código, nome que aparece no site e um `x` na coluna **Padrão** da edição que o site abre. |
| `MC-2026`, `MC-2027`… | Uma aba por edição, no modelo abaixo. |

Modelo de cada edição (o mesmo da aba “Banco de Dados”):

|   | A | B | C | D | E | F | … |
|---|---|---|---|---|---|---|---|
| 1 | | | SEMANA 01 (mesclada) | | SEMANA 02 (mesclada) | | |
| 2 | FOTO | COMPETIDOR | 1ª PROVA 1 | 2ª PROVA 1 | 1ª PROVA 2 | 2ª PROVA 2 | |
| 3 | | Ana | V | | PE | S | |

- **Linha 1:** nome do episódio. Pode trocar “SEMANA 07” por “REPESCAGEM”, por exemplo.
- **Linha 2:** nome das provas. Se ficar “1ª PROVA 1”, o site entende que a prova ainda não tem nome. Troque pelo nome real (ex.: “Duelos”) quando quiser.
- **Resultados:** um código por célula, maiúscula ou minúscula. Vazio = não disputou. `-` = fora da competição.
- **FOTO (opcional):** link da imagem ou `=IMAGE("link")`. A foto aparece no site no lugar das iniciais.
- **Lista e cores:** as células de resultado têm uma lista com os códigos e ficam verdes ou vermelhas como no site.

## Instalação (uma vez, uns 10 minutos)

1. **Crie a planilha.** Em [sheets.new](https://sheets.new), com sua conta Google pessoal, dê o nome **Placar MasterChef**.
2. **Cole o script.** Menu **Extensões → Apps Script**. Apague o que estiver no editor, cole todo o conteúdo de [`google-apps-script/Code.gs`](google-apps-script/Code.gs) e, na linha `const ADMIN_KEY = "troque-esta-senha";`, troque pela sua senha. Clique em 💾 Salvar.
3. **Crie as abas básicas.** No topo do editor, escolha a função **`configurar`** e clique em **▶ Executar**. O Google pede autorização: *Revisar permissões → sua conta → Avançado → Acessar Placar MasterChef (não seguro) → Permitir*. O aviso aparece porque o script é seu e não passou por verificação do Google. Isso cria as abas `Pontuação` e `Edições`.
4. **Publique como app da Web.** **Implantar → Nova implantação → ⚙ → App da Web**:
   - *Executar como:* **Eu**
   - *Quem pode acessar:* **Qualquer pessoa**
   - **Implantar** → copie o **URL do app da Web** (termina em `/exec`).
5. **Ligue o site.** No projeto, abra `config.js`, cole o URL em `sheetsUrl: "..."`, faça commit e push. Em 1–2 minutos o site passa a ler da planilha.
6. **Traga a temporada 2026.** No site, aba **Edições**: a MC-2026 aparece como “só no data.js”. Clique em **Enviar para a planilha** e digite a senha. Isso cria a aba `MC-2026` já com os nomes das provas e a “Repescagem”.

> A planilha não precisa ficar pública. Quem lê é o script, com a sua conta. A senha fica no script (só você vê) e no navegador em que você digitá-la.

## Dia a dia

- **Episódio novo:** abra a aba da edição (ex.: `MC-2026`), digite os códigos e, se quiser, o nome das provas na linha 2. Pronto: o site mostra ao ser aberto ou ao clicar em **Recarregar**.
- **Pelo site:** em **Lançar resultados** também dá para lançar. Aparece o aviso “alterações que ainda não estão na planilha” → **Salvar na planilha**.
- **Nova competição:** no site, **Edições → Nova edição** (ex.: nome “MasterChef 2027”, código `MC-2027`, número de episódios). A aba `MC-2027` é criada vazia no modelo, pronta para você pôr os participantes, nomear os episódios e lançar os resultados.
- **Mudar a edição que o site abre:** **Tornar padrão** no site, ou o `x` na coluna Padrão da aba `Edições`.
- **Excluir uma edição:** apague (ou renomeie, tirando o `MC-`) a aba na planilha e clique em **Recarregar**.

## Se mudar o script depois

Depois de editar o `Code.gs`, publique de novo: **Implantar → Gerenciar implantações → ✏ → Versão: Nova versão → Implantar**. O URL continua o mesmo.

## Se a planilha não responder

O site usa o `data.js` do projeto como cópia de segurança e avisa na barra “Não foi possível ler a planilha”. Para atualizar essa cópia de vez em quando: **Lançar resultados → Baixar data.js**, substitua no projeto e faça o commit.
