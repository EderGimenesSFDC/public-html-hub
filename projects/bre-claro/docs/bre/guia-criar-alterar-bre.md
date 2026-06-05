# Guia técnico — Criar e alterar um BRE (Salesforce Industries / Revenue Cloud)

> **Tipo:** Tech Spec / Runbook (base de conhecimento ADP)
> **Domínio:** Business Rules Engine nativo — Expression Set + Decision Matrix
> **Status:** Validado em org real (`org-demo`, API v60.0) em jun/2026
> **Aplicação de referência:** decomposição da Pricing Matrix monolítica da Claro BR em pipeline de matrizes

---

## 1. Contexto

O **BRE (Business Rules Engine)** do Salesforce Industries permite expressar regras de
decisão/cálculo de forma **declarativa**, sem Apex "dono" das regras. Os dois blocos centrais são:

| Bloco | Metadata | Runtime (objeto) | Papel |
|---|---|---|---|
| **Decision Matrix** | `DecisionMatrixDefinition` | `CalculationMatrix` / `CalculationMatrixVersion` / `CalculationMatrixRow` | Tabela de lookup: chave(s) de entrada → valor(es) de saída |
| **Expression Set** | `ExpressionSetDefinition` | `ExpressionSet` / `ExpressionSetVersion` | Orquestrador: encadeia lookups e cálculos, mantém contexto compartilhado |

> **Mental model:** a *Definition* é a metadata (versionável por deploy). As **linhas** da matriz
> são **dados** (`CalculationMatrixRow`), carregados em runtime via API/Bulk — **não** vão no deploy.

O Expression Set "navega" entre matrizes sem relacionamento físico entre elas: ele mantém um
**contexto** de variáveis e a saída de um step alimenta o próximo (ex.: `preço base → política →
fidelidade → bundle → preço final`).

---

## 2. Pré-requisitos

- **BRE habilitado** na org (feature Salesforce Industries / Revenue Cloud).
- **Salesforce CLI** (`sf`) autenticado na org alvo:
  ```bash
  sf org login web -a org-demo
  sf org display -o org-demo
  ```
- Projeto SFDX com a pasta `force-app/main/default/{decisionMatrixDefinition,expressionSetDefinition}`.

---

## 3. PARTE A — Criar um BRE do zero (via metadata / CLI)

### Passo 1 — Definir a Decision Matrix

Crie `force-app/main/default/decisionMatrixDefinition/<Nome>.decisionMatrixDefinition-meta.xml`.
Cada coluna é `Input` (chave) ou `Output` (resultado). Os `name` das colunas serão as chaves do
JSON das linhas.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<DecisionMatrixDefinition xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Real Preco Matrix</label>
    <type>Standard</type>
    <versions>
        <fullName>RealPrecoMatrix_V1</fullName>
        <columns>
            <columnType>Input</columnType>
            <dataType>Text</dataType>
            <displaySequence>1</displaySequence>
            <isWildcardColumn>false</isWildcardColumn>
            <name>PRODUTO</name>
        </columns>
        <!-- ... demais colunas de Input (MODALIDADE, DURACAO, CANAL) ... -->
        <columns>
            <columnType>Output</columnType>
            <dataType>Currency</dataType>
            <displaySequence>5</displaySequence>
            <isWildcardColumn>false</isWildcardColumn>
            <name>PRECO_BASE</name>
        </columns>
        <decisionMatrixDefinition>RealPrecoMatrix</decisionMatrixDefinition>
        <label>Real Preco Matrix V1</label>
        <rank>1</rank>
        <startDate>2026-06-02T00:00:00.000Z</startDate>
        <status>Active</status>
        <versionNumber>1</versionNumber>
    </versions>
</DecisionMatrixDefinition>
```

> **Dica:** use uma **coluna wildcard** (`isWildcardColumn=true`) para linhas "default/catch-all" e
> evitar o *no-match silencioso* (ver §5). A coluna wildcard **exige** o elemento `<wildcardValue>`
> (ex.: `*` ou `ALL`), declarado **depois** de `<name>`; a linha catch-all grava esse mesmo valor na
> célula daquela coluna. O motor sempre devolve o **match mais específico** (valor exato vence o
> wildcard). **Limite:** **apenas UMA coluna wildcard por matriz** — logo, uma matriz só dá **2 níveis**
> de fallback (valor exato → catch-all). Hierarquia mais profunda (ex.: cidade > UF > nacional) se faz
> com **lookups em camadas + COALESCE** no ES (uma matriz wildcard por nível), nunca empilhando colunas
> wildcard. Exemplo de coluna:
>
> ```xml
> <columns>
>     <columnType>Input</columnType>
>     <dataType>Text</dataType>
>     <displaySequence>2</displaySequence>
>     <isWildcardColumn>true</isWildcardColumn>
>     <name>CIDADE</name>
>     <wildcardValue>*</wildcardValue>
> </columns>
> ```

> ⚠️ **Tipo numérico — atenção ao enum:** na **coluna** da matriz, `dataType` aceita `Number`
> (recomendado para valor monetário "cru", sem rótulo de moeda). **Cuidado:** a **variável do ES**
> usa outro enum (`ExpsSetDataType`) que **não** aceita `Number` — só `Text`/`Currency` (ver §5 #11).
> Padrão validado: **coluna da matriz `Number` + variável do ES `Currency`**. O valor trafega
> numérico puro (ex.: `309.9`, não um objeto de moeda).

### Passo 2 — Definir o Expression Set (orquestrador)

Crie `.../expressionSetDefinition/<Nome>.expressionSetDefinition-meta.xml`. Três partes importantes:

- **`steps`**: a sequência. `GetOutputsFromDecisionMatrix` faz o lookup numa matriz;
  `AssignParameterValues` calcula/expõe uma variável.
- **`variables`**: o contexto. `input=true` são as entradas; as `<lookupName>` ligam a variável à
  matriz que a consome (entradas casam por **nome** com as colunas). Saídas de matriz aparecem como
  `<NomeMatriz>__<Coluna>`.
- A saída de uma matriz pode ser usada como entrada/expressão do próximo step.

> **Input compartilhado entre matrizes:** se a **mesma entrada** alimenta várias matrizes (ex.:
> `PRODUTO` em 3 matrizes, `DURACAO` em 2), declare a variável de input **uma única vez** (com um
> único `<lookupName>` apontando para qualquer uma das matrizes). O casamento para as demais matrizes
> é feito **por nome de coluna** em runtime — **não** declare a variável repetida por matriz.
>
> **Tipo das variáveis numéricas:** outputs de matriz (`<Matriz>__<Coluna>`) e resultados calculados
> devem usar `<dataType>Currency</dataType>` (o enum do ES não aceita `Number`; ver §5 #11),
> mesmo que a coluna de origem na matriz seja `Number`.

```xml
<steps>
    <actionType>GetOutputsFromDecisionMatrix</actionType>
    <decisionTable>
        <decisionTableName>RealPrecoMatrix</decisionTableName>
        <type>DecisionMatrix</type>
    </decisionTable>
    <name>Step1_Base</name>
    <sequenceNumber>1</sequenceNumber>
    <stepType>BusinessKnowledgeModel</stepType>
</steps>
<steps>
    <actionType>AssignParameterValues</actionType>
    <assignment>
        <assignedParameter>PRECO_POS_POLITICA</assignedParameter>
        <expression>RealPrecoMatrix__PRECO_BASE * RealPoliticaMatrix__FATOR</expression>
    </assignment>
    <name>Step_Calculo</name>
    <sequenceNumber>3</sequenceNumber>
    <resultIncluded>true</resultIncluded>
    <stepType>BusinessKnowledgeModel</stepType>
</steps>
```

> **Limite rígido:** **máximo de 200 steps por versão de Expression Set** (201 falha no deploy).
> Cada lookup e cada cálculo conta como 1 step. Ver §5.

### Passo 3 — Deploy da metadata

```bash
sf project deploy start -o org-demo \
  -d force-app/main/default/decisionMatrixDefinition/RealPrecoMatrix.decisionMatrixDefinition-meta.xml \
  -d force-app/main/default/expressionSetDefinition/RealPreco.expressionSetDefinition-meta.xml
```

### Passo 4 — Carregar as linhas da matriz (dados)

As linhas vivem em `CalculationMatrixRow` (`InputData`/`OutputData` como JSON). Primeiro pegue o Id da
versão:

```bash
sf data query -o org-demo \
  -q "SELECT Id, CalculationMatrix.Name FROM CalculationMatrixVersion WHERE CalculationMatrix.Name LIKE 'Real%'"
```

Monte um CSV com **apenas** estas colunas (ver a armadilha do `Name` em §5):

```csv
CalculationMatrixVersionId,InputData,OutputData
ID_MATRIZ_EXEMPLO,"{""PRODUTO"":""COM_INT_RES_1GB"",""MODALIDADE"":""INDIVIDUAL"",""DURACAO"":""0"",""CANAL"":""DIGITAL""}","{""PRECO_BASE"":199.9}"
```

> ⚠️ **Carregar linhas exige a versão da matriz DESABILITADA** (ver §4, Parte B). Numa matriz recém
> criada e ativa, desabilite a versão antes do load e reabilite depois.

> ✅ **Ordem à prova de trava para POC do zero:** faça o **deploy só das matrizes primeiro**, carregue
> as linhas (desabilita → load → reabilita **uma versão por vez**) e **só então** deploye o
> Expression Set. Enquanto nenhum ES referencia as matrizes, desabilitá-las é livre — isso evita a
> armadilha §5 #5 (não dá pra desabilitar matriz referenciada por ES ativo) já na carga inicial.
> A reabilitação é **uma DML por versão**, mesmo entre matrizes diferentes (§5 #4).

Carga via **Bulk API** (LF como terminador de linha — ver §5):

```bash
sf data import bulk -o org-demo -s CalculationMatrixRow -f real_preco.csv --wait 30
```

### Passo 5 — Ativar e validar

Confirme a versão do ES ativa e invoque via REST Action:

```bash
sf data query -o org-demo \
  -q "SELECT COUNT() FROM ExpressionSetVersion WHERE ExpressionSet.ApiName='RealPreco' AND IsActive=true"

curl -s "$INSTANCE_URL/services/data/v60.0/actions/custom/runExpressionSet/RealPreco" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -X POST -d '{"inputs":[{"PRODUTO":"COM_INT_RES_1GB","MODALIDADE":"INDIVIDUAL","DURACAO":"0","CANAL":"DIGITAL"}]}'
```

Resposta esperada: `isSuccess: true` e `outputValues` com os valores calculados.

---

## 4. PARTE B — Alterar um BRE existente

### Caso 1 — Alterar/atualizar LINHAS de uma matriz (em produção, com downtime curto)

> **Linha é DADO, não estrutura.** Para incluir/editar/excluir **uma ou N linhas** você **NÃO**
> precisa recriar a matriz nem criar uma nova versão — a versão continua a mesma (ex.: `V1`).
> Validado em campo: ao adicionar 1 linha a uma matriz já existente, a `VersionNumber` permaneceu `1`
> e o ES passou a retornar o valor da nova linha imediatamente. Nova **versão** só é necessária para
> mudança **estrutural** (colunas) — ver Caso 2 — ou para trocar linhas **sem downtime** — ver Caso 1-B.

A única regra é: a plataforma **não permite DML em `CalculationMatrixRow` com a versão habilitada**
(`INVALID_INPUT, Row cannot be created/updated/deleted when the associated decision matrix version is
enabled`). O fluxo de manutenção (a matriz fica indisponível por alguns segundos):

```text
1. Desativar a versão do Expression Set que referencia a matriz   (IsActive=false)
2. Deletar a versão do Expression Set                              (não dá pra desabilitar a única versão referenciada)
3. Desabilitar a versão da matriz                                  (IsEnabled=false)
4. Inserir/atualizar/deletar as linhas (Bulk API)
5. Reabilitar a versão da matriz                                   (IsEnabled=true) — UMA POR VEZ (ver §5)
6. Redeployar o Expression Set                                     (recria e reativa a versão)
```

Apex anônimo para os passos 1–3 e 5:

```apex
// 1. desativa versão do ES
List<ExpressionSetVersion> evs = [SELECT Id, IsActive FROM ExpressionSetVersion
                                  WHERE ExpressionSet.ApiName = 'RealPreco'];
for (ExpressionSetVersion v : evs) v.IsActive = false;  update evs;

// 2. deleta versão do ES
delete [SELECT Id FROM ExpressionSetVersion WHERE ExpressionSet.ApiName = 'RealPreco'];

// 3. desabilita versão da matriz
CalculationMatrixVersion mv = [SELECT Id, IsEnabled FROM CalculationMatrixVersion WHERE Id = '0lNak...'];
mv.IsEnabled = false;  update mv;
```

```bash
# 4. carrega as novas linhas
sf data import bulk -o org-demo -s CalculationMatrixRow -f novas_linhas.csv --wait 30

# 6. redeploy reativa o ES
sf project deploy start -o org-demo -d force-app/main/default/expressionSetDefinition/RealPreco.expressionSetDefinition-meta.xml
```

> **Atalho:** os passos 1, 2 e 6 só existem porque a matriz é a **única versão habilitada referenciada
> por um ES ativo** (§5 #5). Se a matriz **não** estiver nessa condição (nenhum ES ativo a referencia,
> ou existe outra versão habilitada), é só **desabilitar → DML → reabilitar** a versão da matriz, sem
> tocar no ES.

> **Cuidado ao filtrar a linha a remover:** `InputData`/`OutputData` são *long text* e **não aceitam
> `LIKE` em SOQL**. Para achar uma linha específica, traga as linhas da versão e filtre em Apex
> (`r.InputData.contains('CHAVE')`), depois `delete`.

### Caso 1-B — Trocar linhas SEM downtime (swap de versão / blue-green) — recomendado

Quando você **não quer tirar a matriz do ES nem ter janela de indisponibilidade**, use o
versionamento como blue-green: prepara uma nova versão completa "ao lado" e faz a virada pela
**ativação**.

```text
1. Cria a versão V2 da matriz (desabilitada)        — a V1 segue habilitada servindo o ES
2. Popula a V2 com o conjunto COMPLETO de linhas     — DML livre porque V2 está desabilitada
3. Ativa/habilita a V2                                — a plataforma faz o swap: aposenta a V1 e sobe a V2
                                                        (o ES resolve pela versão habilitada, sem redeploy)
```

Pontos de atenção (o que faz dar certo):

- **O ES não muda.** Ele referencia a matriz por nome e usa a **versão habilitada** em runtime; ao
  ativar a V2, ele passa a usar a V2 sozinho.
- **A virada é a ATIVAÇÃO da V2 — nunca desabilite a V1 na mão.** Tentar `IsEnabled=false` na V1
  enquanto ela é a única versão referenciada cai no erro §5 #5. Quem resolve o "só uma versão
  habilitada por vez" (§5 #4) é o próprio processo de ativação da nova versão.
- **A V2 nasce VAZIA pela API/metadata.** As `CalculationMatrixRow` são presas ao `Id` da versão e
  **não migram** sozinhas — você precisa copiar/recarregar o **conjunto inteiro** na V2 (não só o
  delta). Pela **UI do Decision Matrix Designer**, "Criar nova versão" normalmente **clona** as linhas
  da versão atual, então lá você edita só o delta. É o caminho prático para mudanças manuais.
- **Rollback trivial:** se a V2 der problema, reative a V1.

> **Quando usar cada um:** Caso 1 (disable→DML→enable) é mais simples para ajustes pontuais com janela
> curta tolerável; Caso 1-B (swap de versão) é o indicado para **alto volume / produção sem downtime**,
> ao custo de repopular a versão inteira.

### Caso 2 — Alterar a ESTRUTURA (colunas da matriz ou steps/variáveis do ES)

Mudança estrutural = **nova versão**. Edite o `-meta.xml` incrementando `versionNumber` /
`fullName` (`..._V2`), ajuste `rank`/`status` e faça deploy. A versão anterior é preservada
(rollback fácil). Para matrizes, mantenha **apenas uma versão habilitada** por matriz.

### Caso 3 — Versionar/publicar uma nova regra do ES

- Suba a nova `ExpressionSetVersion` com `status>Active</status>` e `versionNumber` maior.
- A versão antiga pode ficar inativa para auditoria/rollback.
- Para remover de vez: `IsActive=false` → `delete` da `ExpressionSetVersion` (nessa ordem; não dá
  pra deletar versão ativa).

---

## 5. Armadilhas conhecidas (lições aprendidas em campo)

| # | Sintoma | Causa | Correção |
|---|---|---|---|
| 1 | Lookup sempre retorna vazio/0 após carga via Bulk | O campo **`Name`** de `CalculationMatrixRow` é o **hash da chave de entrada** usado no match; informá-lo no CSV sobrescreve o hash | **Não inclua a coluna `Name`** na carga — deixe a plataforma calcular |
| 2 | `An expression set version can have a maximum of 200 steps` | Teto rígido de **200 steps** por versão de ES | Decomponha em mais matrizes / múltiplos ES encadeados |
| 3 | `INVALID_INPUT` ao inserir/atualizar linha | Versão da matriz **habilitada** não aceita DML de linhas | Desabilite a versão, faça o DML, reabilite |
| 4 | `Only a single Decision Matrix version can be enabled at a time` | Tentou habilitar várias versões na **mesma transação** — vale **inclusive para matrizes diferentes** (um `update` em lista com 3 matrizes falha e dá rollback total) | Habilite **uma versão por vez** (uma DML por versão, em transações separadas) |
| 5 | `We can't disable this version ... referenced in these expression set versions` | A matriz é a única versão ativa referenciada por um ES ativo | **Delete a versão do ES** antes de desabilitar a matriz; redeploy depois |
| 6 | `You can't delete an active expression set version` | Tentou deletar versão de ES ativa | `IsActive=false` primeiro, depois `delete` |
| 7 | Apex CPU time / DML limit na carga | Inserir >~5k linhas numa transação Apex | Use **Bulk API** (ou lotes de ~5k no Apex) |
| 8 | Bulk: `ClientInputError : LineEnding is invalid` | CSV com CRLF | Gere o CSV com **LF** (`\n`) |
| 9 | SOQL retorna 0 ao filtrar por `ExpressionSet.Name='...'` | `Name` é o label, não a API | Filtre por **`ExpressionSet.ApiName`** |
| 10 | Combinação inexistente "zera" o cálculo seguinte, sem erro | **No-match silencioso** (matriz sem linha default). Confirmado em campo: input sem match retorna a saída **`0.0` com `isSuccess=true`** — em pricing, "venderia de graça" | Adicione **linha/coluna wildcard** de fallback e/ou guarda de nulo no ES; valide o caminho no-match |
| 11 | Deploy do ES falha: `'Number' is not a valid value for the enum 'ExpsSetDataType'` | Os enums divergem: **coluna de matriz** aceita `Number`, mas **variável de ES** só aceita `Text`/`Currency` | Padrão: coluna da matriz = `Number` (valor numérico puro nos dados); variável do ES (outputs `<Matriz>__<Coluna>` e resultados) = `Currency`. O valor continua trafegando numérico |
| 12 | Deploy da matriz falha: `You can specify only one wildcard column` / `Specify a wildcard value` / `Element wildcardColumnValue invalid` | (a) só **1 coluna wildcard por matriz**; (b) wildcard exige `<wildcardValue>`; (c) o elemento certo é `wildcardValue` (não `wildcardColumnValue`), **depois** de `<name>` | Use no máx. 1 coluna wildcard com `<wildcardValue>*</wildcardValue>`; a linha catch-all grava `*` na célula. Hierarquia multi-nível = lookups em camadas + COALESCE (uma matriz wildcard por nível). Validado: cidade específica vence; cidades sem linha caem no `*` |
| 13 | Não consigo **adicionar/alterar coluna** numa matriz existente. Tentar nova versão falha: `all versions ... must have the same column headers`; alterar a versão atual falha: `can't create subsequent versions ... that has no columns` | **As colunas (schema) são fixas por matriz** — todas as versões compartilham as mesmas colunas. Versão só varia **dados de linha**, nunca o schema | Para mudar o schema (ex.: incluir `CANAL`) crie uma **matriz nova**. Se for **recriar com o mesmo nome**, primeiro apague os **registros runtime** via Apex (`delete CalculationMatrixVersion` + `delete CalculationMatrix` pelo `CalculationMatrixId`), senão o metadata fica `referenced elsewhere` e o destrutivo não passa. Depois o destrutivo acusa `No ... found` (já sumiu) e o deploy limpo funciona |
| 14 | `delete` destrutivo da matriz falha: `This decision matrix definition is referenced elsewhere ... Version - X_V1` | A `ExpressionSetDefinition` referencia a matriz **no nível definição** (não só na versão). Apagar só a `ExpressionSetVersion` **não** libera | Apague a `ExpressionSetDefinition` inteira (deploy destrutivo **isolado**, num pacote separado — num pacote conjunto a checagem roda antes do ES sair e ainda falha) e/ou os registros runtime via Apex, **depois** a matriz |
| 15 | Deploy da matriz falha: `Value too long for field: Description maximum length is:255` | O `<description>` da `DecisionMatrixDefinition` tem teto de **255 caracteres** | Mantenha a descrição curta (≤ 255); detalhe o resto no guia/HTML, não no metadata |
| 16 | `sf data import bulk --wait N` parece **travar** (não retorna), mas as linhas **já entraram** | O job da Bulk API insere rápido, mas o **polling do CLI** fica preso aguardando o estado do job (e `\| tail` só imprime no EOF) | Não dependa do retorno: confirme por contagem (`SELECT CalculationMatrixVersionId, COUNT(Id) ... GROUP BY ...`). Rode imports **destacados** (`&`) e valide pela query |
| 17 | Após um deploy destrutivo **que falhou**, o **arquivo local some** mesmo o registro continuando na org | O CLI aplica o *source tracking* (remove o arquivo local) antes do rollback da org; deploy atômico que falha **não** apaga na org, mas o local já foi | Tenha o conteúdo versionado/backup antes de destrutivos; se o local sumir e a org mantiver, **recrie o arquivo** a partir do backup e siga |
| 18 | Preciso de **hierarquia geográfica** (cidade vence UF vence nacional) com **valores absolutos**, mas só posso ter 1 coluna wildcard por matriz | Uma matriz wildcard só dá 2 níveis (específico vs `*`). Geo absoluto multi-nível = **lookups em camadas + COALESCE no ES** | **Confirmado em runtime:** a expressão do ES suporta **`IF(...)` e comparação** (`IF(VAL > 0, VAL, fallback)` → testado: 250→250, 0→999). Modele 1 matriz **esparsa por nível** (`...×CIDADE`, `...×UF`), só com as exceções, e resolva no ES com `IF(cidade>0, cidade, IF(uf>0, uf, nacional))`. O **no-match silencioso retorna 0** — aqui vira **feature**: é o sinal de "não há override neste nível", e o `IF(>0)` cai pro próximo. Validado (12/12): cidade vence, UF é fallback intermediário, nacional é o default |
| 19 | "O BRE reproduz o **preço real** do cliente?" Carregar o catálogo cru direto **não fecha**: a mesma chave devolve **vários preços** | A base de origem é **não-determinística pelas próprias colunas**: no `Pricing_Matrix__c` (RT `Pricing`), **62% das chaves** (`PRODUTO×MODALIDADE×DURACAO×SEGMENTO`) têm ≥2 preços; mesmo com **as 18 colunas** ainda sobram ~110 conflitos (linhas idênticas, preços diferentes — janelas/promoções sobrepostas) | Faça **teste de fidelidade de migração**: (1) **canonize** com regra explícita (preço = **moda** da chave; desempate pela **janela mais recente**, depois **maior valor**); (2) carregue as chaves canônicas na estrutura nova; (3) **replay** chave a chave comparando a saída do BRE com o canônico. Reporte **subconjunto limpo** (1 preço na origem) à parte. Validado na org: **103/103** (39 limpas + 64 canonizadas). A estrutura nova **força 1 preço determinístico por chave** — o que a base legada não garante (vira achado de governança) |
| 20 | Preciso que a regra **troque qual campo de preço usar** conforme a jornada (ex.: jornada base usa `FullPrice`, prospect usa `PricingValue`), mas `IF` confiável só com **comparação numérica** | Comparar string no ES é arriscado; o melhor é decidir por número | Faça a **própria matriz** devolver um **flag numérico** (`IS_BASE` = 1/0) junto do preço e resolva no ES com `IF(IS_BASE > 0, FULLPRICE, PRECO)`. Mesmo princípio do COALESCE (`IF(>0)`). Validado na POC `PrecoAvancado` (cenário 03). Vale para qualquer "switch" de regra: materialize a condição como número na matriz e ramifique no ES |
| 21 | Como **orquestrar vários mecanismos** (base + desconto + bônus + bundle + OTC geo + multa) num ES só, sem virar espaguete | Cada mecanismo é uma matriz independente; o ES só compõe | Padrão validado (`PrecoAvancado`, 13 steps, **11/11**): **N lookups** (um por matriz, cada uma com sua chave) → **steps de composição** declarativos: `IF` de jornada (de/por), `COALESCE` de bundle (`IF(bundle>0, bundle, base)`), aditivos (`base - desconto - bonus`), exposição de OTC e de **multa** (info contratual, exposta mas **não somada** ao preço). Inputs compartilhados (ex.: `UF`, `PERFIL`, `DURACAO`) são **declarados uma vez** e alimentam todas as matrizes que têm aquela coluna. No-match=0 faz desconto/bônus/bundle ausentes **não afetarem** o cálculo |
| 22 | Precisei **adicionar uma linha** numa Decision Matrix que já estava ligada a um Expression Set, e a plataforma **não deixa desabilitar** a versão da matriz (erro: *"only active version… referenced in these expression set versions"*) | Achei que bastava desativar o ES (`ExpressionSetVersion.IsActive=false`) para liberar a matriz | **Não basta**: a matriz fica *referenciada* pelo ES mesmo com o ES inativo, e **não dá pra inserir linha em versão habilitada**. Regra de ouro: **carregue TODOS os dados das matrizes ANTES de ligar o ES**. Para corrigir depois, só há o caminho pesado: destructive-delete do ES → desabilitar matriz → carregar → reabilitar → recriar o ES. Por isso vale superdimensionar a carga inicial (todas as chaves previstas) na primeira passada |
| 23 | Como **expor a multa/fidelização** sem poluir o preço | Tentação de subtrair/somar a multa no recorrente | Multa é **informação contratual** (permanência), não componente de preço. Modele como **matriz própria** (`PRODUTO×DURACAO → PENALTY`) e **exponha como output independente** (`MULTA_FIDELIDADE`), sem entrar na conta do recorrente/OTC. `DURACAO=0` ⇒ sem fidelidade ⇒ 0 (no-match natural). Validado em `PrecoAvancado` (caso 11: 12m → R$240) |

---

## 6. Checklist de entrega

- [ ] `DecisionMatrixDefinition` por domínio (uma responsabilidade por matriz)
- [ ] `ExpressionSetDefinition` com steps ≤ 200 e variáveis de contexto nomeadas
- [ ] Deploy da metadata OK
- [ ] Linhas carregadas via Bulk (**sem** coluna `Name`, CSV em LF)
- [ ] Versão do ES ativa (`IsActive=true` por `ApiName`)
- [ ] Teste funcional via `runExpressionSet` (match **e** no-match) passando
- [ ] Linha/coluna **wildcard** de fallback prevista
- [ ] Invocação sempre em **bulk** (lista de inputs numa chamada) na integração

---

## 7. Referências (artefatos validados na org `org-demo`)

| Artefato | Tipo | Observação |
|---|---|---|
| `RealPrecoMatrix` / `RealPoliticaMatrix` | Decision Matrix | Dados reais do cliente; 100% de equivalência com o monólito |
| `RealPreco` | Expression Set | Pipeline base + política (chave `PRODUTO × MODALIDADE × DURACAO × CANAL`) |
| `Bench*` | Decision Matrix / ES | Benchmark de performance (latência plana de 5k→154k linhas) |
| `CompostoBaseMatrix` | Decision Matrix | Preço-base nacional (`PRODUTO × MODALIDADE × DURACAO × SEGMENTO × CANAL*`). Coluna `CANAL` atômica + wildcard; `SEGMENTO` = Business Unit (RESIDENCIAL/PME) |
| `CompostoGeoCidadeMatrix` / `CompostoGeoUfMatrix` | Decision Matrix | Override geográfico **absoluto e esparso** (`...×CIDADE` / `...×UF`). Só cidades/UFs com preço diferente têm linha; sem linha → 0 → COALESCE cai pro próximo nível |
| `CompostoPagamentoMatrix` / `CompostoAdesaoMatrix` | Decision Matrix | Ajuste de pagamento (aditivo, R$) e OTC de adesão. Colunas `Number`, input compartilhado entre matrizes |
| `PrecoComposto` | Expression Set | 8 steps: 5 lookups + `PRECO_BASE_RESOLVIDO = IF(cidade>0, cidade, IF(uf>0, uf, nacional))` + `PRECO_RECORRENTE = resolvido + AJUSTE` + `OTC_FINAL`. **12/12 cenários validados** (wildcard, override de canal, SEGMENTO, geo cidade>UF>nacional, pagamento, OTC, duração); promoção/desconto fora do BRE (Promotions nativas no roadmap) |
| `RealBaseMatrix` / `RealBase` | Decision Matrix / Expression Set | **Equivalência com dado real**: 103 chaves canonizadas do `Pricing_Matrix__c` (RT `Pricing`) carregadas e validadas **103/103** via REST (`scripts/test_real_equiv.py`). Canonização: moda da chave → janela mais recente → maior valor. Colapso **28,3×** (2.919 linhas → 103 chaves). Achado: **62% das chaves ambíguas na origem** (≥2 preços) |
| `Avc*` (6 matrizes) / `PrecoAvancado` | Decision Matrix / Expression Set | **POC de extensibilidade** — prova que os cenários fora do núcleo encaixam nos mesmos blocos. `AvcBaseMatrix` (chave estendida `…×REQUESTTYPE×OPERACAO` + saídas PRECO/FULLPRICE/IS_BASE = de/por), `AvcDescontoMatrix` (Política Comercial), `AvcBundleMatrix` (combinação de componentes), `AvcInstalacaoMatrix` (OTC geo por UF, wildcard), `AvcBonusMatrix` (+ restrição de crédito), `AvcMultaMatrix` (**multa de fidelização** `PRODUTO×DURACAO → PENALTY`, espelha `PenaltyAmount__c`; valores reais 240/200; DURACAO 0 = 0). ES de 13 steps (6 lookups + IF de jornada + COALESCE de bundle + desconto/bônus aditivos + OTC + multa exposta como info contratual, **não somada ao preço**). **11/11 cenários** via REST (`scripts/test_avancado.py`). **Dados reais** carregados do diagnóstico `org-fonte`: modalidades reais (`CELULAR+FONE+INTERNET FIXA`, `CELULAR+INTERNET FIXA+TV`, `INDIVIDUAL`, `INTERNET FIXA+TV`), **de/por real** (FullPrice 319,90 → PricingValue 269,90; 159,90 → 139,00), **multa real** (240/200), RequestType/OperationType atomizados, CreditRestriction OK/REST. Magnitudes de desconto/bônus/instalação seguem como proxy (não vieram preenchidas no export — mecanismo e chave são reais). Regen: `data/avancado/gen_rows.py` |

> **Observação de arquitetura:** Apex deve ficar na **borda** (integração, bulkificação, montagem de
> contexto). As **regras** ficam declarativas no BRE. Isso reduz drásticamente o "Apex dono de regra"
> e melhora governança e versionamento.

> **Nota de modelagem — fator ❌ → chave + valor absoluto ✅:** uma primeira POC modelou preço como
> **cascata multiplicativa** (`base × fator_canal × fator_fidelidade − desconto`), tratando canal/prazo
> como **fatores**. A análise do Apex (`Solar_PricingPlan*`) + dados (`Pricing_Matrix__c`, 4.877 linhas (sandbox))
> derrubou a premissa: `IsPercentDiscount__c = false` em 100%, `ValueType__c` vazio em 100%, só 60 linhas
> com ajuste e **todas em R$ absoluto**. O canal (`Promotion_Channel__c`, multi-select) **não é fator**:
> entra como **filtro/dimensão da chave** (`INCLUDES`) que **seleciona** a linha de preço absoluto. Padrão
> recomendado: **indexar valores absolutos por uma chave rica** (`PRODUTO × MODALIDADE × DURACAO ×
> OPERACAO × ...`) + ajustes **aditivos em R$**, em vez de multiplicar fatores. Percentual só se os dados
> realmente usarem (no caso da Claro, não usavam).

> **Nota de modelagem — atacar a explosão em DOIS eixos (linhas e colunas):** o tabelão monolítico cresce
> por dois motivos independentes, e cada um tem um antídoto diferente:
>
> - **Linhas (redundância).** Medido no `Pricing_Matrix__c`: só **5 produtos** e **97 decisões reais**
>   (`produto × modalidade × duração`) viram **2.927 linhas** (~30×). O maior ofensor **não** é geografia
>   (hoje nacional) — é o **multi-select de canal** (`Promotion_Channel__c`, 20 combos) + o **empilhamento
>   por data**. Antídoto: **dimensão atômica + linha wildcard `*`** (1 linha serve "todos", só a exceção
>   vira linha) e **promoção fora da base**. Princípio único: *uma decisão lógica = uma linha; o resto é
>   default/fallback ou outro módulo* — é o mesmo princípio do COALESCE entre camadas.
> - **Colunas (esparsidade).** O objeto tem **29 colunas**, **13 (~45%) com < 10% de preenchimento** e **5
>   100% vazias**. Antídoto **diferente**: **decomposição/normalização** — uma matriz por responsabilidade,
>   cada uma só com as colunas que mudam o *seu* valor. Wildcard/COALESCE **não** reduz colunas (reduz
>   linhas); quem reduz coluna é separar responsabilidades.
>
> **Validado na POC `PrecoComposto` (org `org-demo`):** `CANAL` foi modelado como **coluna atômica +
> wildcard** na `CompostoBaseMatrix` (`PRODUTO × MODALIDADE × DURACAO × SEGMENTO × CANAL*`). Testes REST
> (12/12): canal desconhecido cai no `*` (preço-base padrão, sem no-match silencioso); canal específico
> (`TELEVENDAS`) tem linha própria e **vence** o `*`; e o override **compõe** com o ajuste de pagamento.
> Assim, o multi-select de canal (o ofensor #1 de linhas) colapsa em **1 linha `*` + poucas exceções**.

> **Nota de modelagem — geografia hierárquica com valor absoluto (cidade > UF > nacional):** a base real é
> **nacional** (geo vazia), mas a POC fechou o cenário com **dados sintéticos** para provar o padrão. Em vez
> de uma coluna geo na base (que multiplicaria linhas por cada cidade/UF), a geografia vira **matrizes
> esparsas por nível** — `CompostoGeoCidadeMatrix` e `CompostoGeoUfMatrix` — que **só têm linha onde há
> override**. O ES resolve por **COALESCE via `IF`**: `PRECO_BASE_RESOLVIDO = IF(cidade>0, cidade,
> IF(uf>0, uf, nacional))`. Como o no-match silencioso retorna **0**, ele funciona como "não há override
> neste nível" e o `IF(>0)` cai pro próximo. Resultado validado: Campinas (mais barato) e Rio (mais caro)
> vencem como cidade; **AM sem linha de cidade** cai no override de **UF**; cidades/UFs sem nenhuma linha
> usam o **nacional**. Custo: **2 matrizes + 5 linhas sintéticas** cobrem toda a hierarquia, sem inflar a
> base nacional. (No monólito, geografia por cidade significaria multiplicar **todas** as linhas por cidade.)
