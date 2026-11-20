/**
 * Ofertas de um mercador (o que ele vende e por quanto) e preços de compra dos itens dos jogadores.
 * Usado tanto pela janela da loja quanto pelo mestre ao validar as transações.
 */
import { TIPOS_FISICOS, categoriaGenerica, tipoDaCategoria } from "./catalogo.js";
import { normalizar, paraTC, qtdItem } from "./comum.js";

/**
 * Preço de tabela de UMA unidade de um item de inventário, em T$. Itens que no compêndio vêm em
 * pacote (flechas ×20) têm o preço do pacote; aqui ele é dividido pelo tamanho do pacote.
 */
export function precoUnitario(item, catalogo) {
	const preco = Number(item.system?.preco) || 0;
	const ref = catalogo.porNome.get(normalizar(item.name));
	if (ref && ref.pacote > 1 && Math.abs(Number(ref.doc.system.preco) - preco) < 1e-6) return preco / ref.pacote;
	return preco;
}

/** Item do estoque do mercador (inventário do ator)? Devolve o id do item ou null. */
export function idEstoque(loja, uuid) {
	const prefixo = `${loja.uuid}.Item.`;
	return uuid?.startsWith(prefixo) ? uuid.slice(prefixo.length) : null;
}

/** Itens do inventário do mercador que estão à venda (físicos, com preço e quantidade). */
export function itensEstoque(loja) {
	return loja.items.filter((i) => TIPOS_FISICOS.has(i.type) && Number(i.system?.preco) > 0 && qtdItem(i) > 0);
}

function ofertaEstoque(item, cfg, catalogo) {
	const categoria = catalogo.porNome.get(normalizar(item.name))?.categoria ?? categoriaGenerica(item) ?? "Equipamento de aventura";
	return {
		uuid: item.uuid, doc: item, nome: item.name, img: item.img,
		categoria, tipo: tipoDaCategoria(categoria),
		precoTC: paraTC(precoUnitario(item, catalogo) * cfg.margem / 100),
		pacote: 1,
		estoque: qtdItem(item),
		origem: "estoque"
	};
}

function ofertaCatalogo(entrada, cfg) {
	return {
		uuid: entrada.uuid, doc: entrada.doc, nome: entrada.doc.name, img: entrada.doc.img,
		categoria: entrada.categoria, tipo: entrada.tipo,
		precoTC: paraTC(Number(entrada.doc.system.preco) * cfg.margem / 100),
		pacote: entrada.pacote,
		estoque: null,
		fonte: entrada.fonte,
		origem: "catalogo"
	};
}

/** Tudo o que o mercador vende: estoque próprio primeiro, depois o catálogo das categorias escolhidas. */
export function listarOfertas(loja, cfg, catalogo) {
	const categorias = new Set(cfg.categorias);
	return [
		...itensEstoque(loja).map((i) => ofertaEstoque(i, cfg, catalogo)),
		...catalogo.itens.filter((e) => categorias.has(e.categoria)).map((e) => ofertaCatalogo(e, cfg))
	];
}

/** Uma oferta pelo uuid (null se o mercador não vende esse item). */
export function resolverOferta(loja, cfg, catalogo, uuid) {
	const id = idEstoque(loja, uuid);
	if (id) {
		const item = loja.items.get(id);
		return item && itensEstoque(loja).includes(item) ? ofertaEstoque(item, cfg, catalogo) : null;
	}
	const entrada = catalogo.porUuid.get(uuid);
	return entrada && cfg.categorias.includes(entrada.categoria) ? ofertaCatalogo(entrada, cfg) : null;
}

/** Itens do jogador que o mercador aceita comprar, com o preço por unidade (TC). */
export function itensVendaveis(ator, cfg, catalogo) {
	if (!ator) return [];
	return ator.items
		.filter((i) => TIPOS_FISICOS.has(i.type) && Number(i.system?.preco) > 0 && qtdItem(i) > 0)
		.map((item) => ({ item, precoTC: paraTC(precoUnitario(item, catalogo) * cfg.taxaCompra / 100) }))
		.filter((v) => v.precoTC > 0)
		.sort((a, b) => a.item.name.localeCompare(b.item.name, "pt-BR"));
}

/** Total de um carrinho: { linhas, subtotal, desconto, total } (valores em TC). */
export function totalCarrinho(loja, cfg, catalogo, carrinho, descontoPct) {
	const linhas = [];
	for (const { uuid, qtd } of carrinho.itens) {
		const oferta = resolverOferta(loja, cfg, catalogo, uuid);
		if (oferta) linhas.push({ oferta, qtd, totalTC: oferta.precoTC * qtd });
	}
	const subtotal = linhas.reduce((t, l) => t + l.totalTC, 0);
	const desconto = Math.round(subtotal * descontoPct / 100);
	return { linhas, subtotal, desconto, total: subtotal - desconto };
}
