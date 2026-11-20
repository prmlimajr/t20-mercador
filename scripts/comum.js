/**
 * Constantes e utilitários compartilhados: configuração do mercador (flags do ator), carrinhos
 * (flags do usuário), descontos e moedas.
 */
export const MODULE_ID = "t20-mercador";
export const SUPLEMENTO_ID = "suplementos-de-arton";

export function normalizar(texto) {
	return String(texto ?? "")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();
}

/* ---------------- Configuração do mercador (flags do ator) ---------------- */

export const CONFIG_PADRAO = {
	ativo: false,
	nome: "",
	imagem: "",
	saudacao: "Bem-vindo, viajante! Dê uma olhada nas minhas mercadorias.",
	categorias: ["Equipamento de aventura", "Ferramentas", "Vestuário", "Alimentação", "Munições"],
	/** Preço cobrado sobre o preço de tabela (100 = preço do livro). */
	margem: 100,
	/** Quanto o mercador paga pelos itens dos jogadores (50 = metade do preço). */
	taxaCompra: 50,
	/** O mercador compra itens dos jogadores? */
	compra: true,
	/** Itens comprados dos jogadores vão para o estoque do mercador (e podem ser revendidos). */
	revender: true
};

/** O ator é um mercador ativo? (aceita Actor, TokenDocument ou Token) */
export function ehMercador(doc) {
	const actor = doc?.actor ?? doc;
	return !!actor?.getFlag?.(MODULE_ID, "config")?.ativo;
}

export function lerConfig(actor) {
	const cfg = { ...CONFIG_PADRAO, ...(actor?.getFlag(MODULE_ID, "config") ?? {}) };
	cfg.nome ||= actor?.name ?? "Mercador";
	cfg.imagem ||= actor?.img ?? "icons/svg/mystery-man.svg";
	cfg.categorias = Array.isArray(cfg.categorias) ? cfg.categorias : [];
	return cfg;
}

/** Desconto (%) que o mestre deu ao carrinho de um usuário nesta loja. */
export function descontoDe(actor, userId) {
	const v = Number(actor?.getFlag(MODULE_ID, "descontos")?.[userId] ?? 0);
	return Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));
}

/* ---------------- Carrinhos (flags do usuário) ---------------- */

/** Chave de uma loja nas flags (uuid sem pontos, que o Foundry trataria como caminho). */
export function chaveLoja(actor) {
	return actor.uuid.replace(/\./g, "_");
}

/** Carrinho de um usuário numa loja: { ator: uuid do comprador, itens: [{uuid, qtd}] }. */
export function carrinhoDe(user, actor) {
	const c = user?.getFlag(MODULE_ID, "carrinhos")?.[chaveLoja(actor)];
	return { ator: c?.ator ?? null, itens: Array.isArray(c?.itens) ? c.itens.filter((i) => i?.uuid && i.qtd > 0) : [] };
}

export function salvarCarrinho(user, actor, carrinho) {
	return user.update({ [`flags.${MODULE_ID}.carrinhos.${chaveLoja(actor)}`]: carrinho });
}

/* ---------------- Moedas ---------------- */
/*
 * Tudo é calculado em tibares de cobre (TC), inteiros: T$ 1 = 10 TC, TO 1 = T$ 10.
 * Platina (campo tl da ficha) vale T$ 100. Moedas maiores só são trocadas quando necessário;
 * o troco volta em prata (T$) e cobre.
 */
const VALOR_TC = { tc: 1, tp: 10, to: 100, tl: 1000 };

export const paraTC = (tibares) => Math.round(Number((Number(tibares) * 10).toFixed(6)));

export function formatarTibares(v) {
	const n = Math.round(Number(v) * 100) / 100;
	return `T$ ${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")}`;
}

export const formatarTC = (tc) => formatarTibares(tc / 10);

export function carteiraTC(actor) {
	const d = actor?.system?.dinheiro ?? {};
	return Object.entries(VALOR_TC).reduce((t, [k, v]) => t + Math.max(0, Math.floor(Number(d[k]) || 0)) * v, 0);
}

/** Atualização das moedas do ator depois de pagar `custo` TC (null se não tiver dinheiro). */
export function atualizacaoPagamento(actor, custo) {
	const d = actor.system?.dinheiro ?? {};
	let resto = carteiraTC(actor) - custo;
	if (resto < 0) return null;
	const novo = {};
	for (const k of ["tl", "to"]) {
		const manter = Math.min(Math.floor(Number(d[k]) || 0), Math.floor(resto / VALOR_TC[k]));
		novo[k] = manter;
		resto -= manter * VALOR_TC[k];
	}
	novo.tp = Math.floor(resto / 10);
	novo.tc = resto % 10;
	return Object.fromEntries(Object.entries(novo).map(([k, v]) => [`system.dinheiro.${k}`, v]));
}

/** Atualização das moedas do ator ao receber `valor` TC (em prata e cobre). */
export function atualizacaoRecebimento(actor, valor) {
	const d = actor.system?.dinheiro ?? {};
	const prataECobre = Math.floor(Number(d.tp) || 0) * 10 + Math.floor(Number(d.tc) || 0) + valor;
	return {
		"system.dinheiro.tp": Math.floor(prataECobre / 10),
		"system.dinheiro.tc": prataECobre % 10
	};
}

/** Quantidade de um item no inventário (sem o campo, conta como 1). */
export function qtdItem(item) {
	const q = Number(item?.system?.qtd);
	return Number.isFinite(q) ? Math.max(0, Math.floor(q)) : 1;
}
