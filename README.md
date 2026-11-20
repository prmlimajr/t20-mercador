# T20 — Mercador

Lojas de mercadores para **Tormenta20** no Foundry VTT (v14). O mestre transforma um ator (ou um token) em mercador; os jogadores abrem a loja com duplo clique no token, montam um carrinho, compram e vendem seus itens. O visual segue o da loja do *T20 — Construtor de Ficha*.

## Para o mestre

**Criar um mercador**
- HUD do token → botão da loja (ícone de barraca). Num token que ainda não é mercador, o botão abre a configuração. Num mercador, o clique abre a loja e o botão direito abre a configuração.
- Também dá pelo cabeçalho da ficha (*Transformar em mercador* / *Configurar mercador*) ou pelo menu de contexto do diretório de atores.

**Configuração**
- **Loja aberta**: liga/desliga o mercador.
- **Nome da loja**, **imagem do vendedor** (retrato redondo no topo da loja) e **fala do vendedor**.
- **O que vende**: categorias da loja do Construtor (armas simples/marciais/exóticas/de fogo, munições, armaduras, escudos, equipamento de aventura, ferramentas, vestuário, esotérico, alquímicos, alimentação, animais, veículos). Há perfis prontos: *Itens de aventureiro*, *Armas e armaduras*, *Alquimista*, *Esotérico*, *Estábulo e veículos* e *Empório*. Use Shift+clique num perfil para somá-lo às categorias já marcadas.
- **Estoque próprio**: os itens no inventário do ator também ficam à venda, em *Estoque do mercador*, com quantidade limitada. Os itens das categorias não têm limite de estoque.
- **Preço de venda** (% do preço de tabela, padrão 100%) e **quanto paga pelos itens** (padrão 50%, ou seja, metade do preço).
- **Compra itens dos jogadores** e **revender o que comprou** (os itens vendidos pelos jogadores vão para o estoque do mercador).
- Ao salvar, o módulo pode dar permissão *Limitada* aos jogadores. Sem ela, eles não conseguem dar duplo clique no token.

**Vínculo com o token**: a configuração fica no ator. Num token vinculado, ela vale para todos os tokens do ator. Num token não vinculado, a configuração e o estoque valem só para aquele token. Assim um mesmo ator "Ferreiro" pode virar várias lojas diferentes.

**Carrinhos e descontos**: na aba *Comprar*, o mestre vê os carrinhos dos jogadores em tempo real (itens, carteira, subtotal e total). Ao lado de cada um há um campo de **desconto (%)**, que o jogador vê na hora. O desconto é usado na compra seguinte e depois volta a zero.

Duplo clique no token de um mercador abre a loja. Para abrir a ficha, segure **Alt** no duplo clique ou use o diretório de atores.

## Para os jogadores

- **Comprar**: escolha o tipo e a categoria, clique num item para ver os detalhes e use *Adicionar*. O carrinho mostra o subtotal, o desconto, o total e quanto restará. *Finalizar compra* desconta os tibares e põe os itens no inventário. Consumíveis e tesouros com o mesmo nome se empilham.
- **Vender**: marque os itens do inventário (e as quantidades) e confirme. O mercador paga a porcentagem configurada (padrão: metade do preço). Itens que no livro vêm em pacote (ex.: flechas ×20) são avaliados por unidade.
- *Negociando como* escolhe o personagem quando você controla mais de um.

## Como funciona

- As transações são feitas pelo **mestre conectado**: o jogador envia o pedido por socket e o mestre confere o preço, o estoque e o dinheiro antes de mexer nos inventários. Sem mestre online, não há negociação.
- O resumo de cada compra ou venda vai para o chat, sussurrado ao jogador e aos mestres.
- Moedas: T$ 1 = 10 TC, TO 1 = T$ 10 e a platina vale T$ 100. Moedas maiores só são trocadas quando é preciso; o troco volta em T$ e TC.
- Catálogo: compêndio `tormenta20.equipamentos`, sem as pastas *Tesouro* e *Itens de Origem*. Com a configuração *Itens dos Suplementos de Arton* ligada e o módulo ativo, entram também os itens comuns (não mágicos) dos suplementos.
- Os carrinhos ficam nas flags do usuário e os descontos e a configuração nas flags do ator (`flags.t20-mercador`).

## API

```js
const api = game.modules.get("t20-mercador").api;
api.abrirLoja(actorOuToken);      // abre a loja
api.configurarLoja(actorOuToken); // abre na configuração (mestre)
api.ehMercador(actorOuToken);
```
