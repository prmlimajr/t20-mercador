/**
 * Transações (compra e venda). Quem executa é sempre o mestre ativo: o jogador não pode mexer no
 * estoque do mercador, então o pedido vai por socket e o mestre valida preço, estoque e dinheiro.
 */
import { carregarCatalogo } from "./catalogo.js";
import {
	MODULE_ID, atualizacaoPagamento, atualizacaoRecebimento, carrinhoDe, carteiraTC, descontoDe,
	formatarTC, lerConfig, normalizar, qtdItem, salvarCarrinho
} from "./comum.js";
import { itensVendaveis, idEstoque, totalCarrinho } from "./ofertas.js";

const CANAL = `module.${MODULE_ID}`;
const pendentes = new Map();

/** Tipos que se empilham no inventário (somam quantidade em vez de criar outro item). */
const EMPILHAVEIS = new Set(["consumivel", "tesouro"]);

export function registrarSocket() {
	game.socket.on(CANAL, async (msg) => {
		if (msg?.tipo === "pedido") {
			if (!game.user.isActiveGM) return;
			let resposta;
			try {
				resposta = await executar(msg.acao, { ...msg.dados, userId: msg.userId });
			} catch (err) {
				console.error(`${MODULE_ID} |`, err);
				resposta = { ok: false, erro: err.message };
			}
			game.socket.emit(CANAL, { tipo: "resposta", id: msg.id, userId: msg.userId, ...resposta });
		} else if (msg?.tipo === "resposta" && msg.userId === game.user.id) {
			pendentes.get(msg.id)?.(msg);
			pendentes.delete(msg.id);
		}
	});
}

/** Envia um pedido ao mestre (ou executa direto, se quem pede é o mestre ativo). */
export async function pedir(acao, dados) {
	if (game.user.isActiveGM) return executar(acao, { ...dados, userId: game.user.id });
	if (!game.users.activeGM) return { ok: false, erro: "É preciso que o mestre esteja conectado para negociar com o mercador." };
	const id = foundry.utils.randomID();
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			pendentes.delete(id);
			resolve({ ok: false, erro: "O mestre não respondeu. Tente de novo." });
		}, 20000);
		pendentes.set(id, (msg) => {
			clearTimeout(timer);
			resolve(msg);
		});
		game.socket.emit(CANAL, { tipo: "pedido", id, userId: game.user.id, acao, dados });
	});
}

async function executar(acao, dados) {
	if (acao === "comprar") return comprar(dados);
	if (acao === "vender") return vender(dados);
	return { ok: false, erro: `Ação desconhecida: ${acao}` };
}

/* ---------------- Validação comum ---------------- */

function partes({ lojaUuid, atorUuid, userId }) {
	const loja = fromUuidSync(lojaUuid);
	const cfg = lerConfig(loja);
	if (!loja || !cfg.ativo) throw new Error("Esta loja está fechada.");
	const user = game.users.get(userId);
	const ator = fromUuidSync(atorUuid);
	if (!user || !ator) throw new Error("Personagem não encontrado.");
	if (!ator.testUserPermission(user, "OWNER")) throw new Error(`${user.name} não controla ${ator.name}.`);
	if (ator === loja) throw new Error("O mercador não pode negociar consigo mesmo.");
	return { loja, cfg, user, ator };
}

/** Dados para criar um item no inventário do comprador (sem id, desequipado). */
function dadosNovoItem(doc, qtd) {
	const data = doc.toObject();
	delete data._id;
	delete data.folder;
	delete data.sort;
	data.system ??= {};
	data.system.qtd = qtd;
	if ("equipado" in data.system) data.system.equipado = typeof data.system.equipado === "number" ? 0 : false;
	if (doc.pack) foundry.utils.setProperty(data, "_stats.compendiumSource", doc.uuid);
	return data;
}

/** Acrescenta itens ao inventário de um ator, somando a pilhas existentes quando der. */
async function adicionarItens(ator, entradas) {
	const criar = [];
	const atualizar = new Map();
	for (const { doc, qtd } of entradas) {
		const existente = EMPILHAVEIS.has(doc.type)
			&& ator.items.find((i) => i.type === doc.type && normalizar(i.name) === normalizar(doc.name));
		if (existente) {
			const atual = atualizar.get(existente.id)?.["system.qtd"] ?? qtdItem(existente);
			atualizar.set(existente.id, { _id: existente.id, "system.qtd": atual + qtd });
		} else {
			const igual = criar.find((c) => c.name === doc.name && c.type === doc.type && EMPILHAVEIS.has(doc.type));
			if (igual) igual.system.qtd += qtd;
			else criar.push(dadosNovoItem(doc, qtd));
		}
	}
	if (atualizar.size) await ator.updateEmbeddedDocuments("Item", [...atualizar.values()]);
	if (criar.length) await ator.createEmbeddedDocuments("Item", criar);
}

/** Tira `qtd` unidades de itens de um ator (apaga o item quando acaba). */
async function removerItens(ator, entradas) {
	const apagar = [];
	const atualizar = [];
	for (const { item, qtd } of entradas) {
		const resta = qtdItem(item) - qtd;
		if (resta > 0) atualizar.push({ _id: item.id, "system.qtd": resta });
		else apagar.push(item.id);
	}
	if (atualizar.length) await ator.updateEmbeddedDocuments("Item", atualizar);
	if (apagar.length) await ator.deleteEmbeddedDocuments("Item", apagar);
}

function mensagem(user, loja, ator, html) {
	const destinatarios = [...new Set([user.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)])];
	return ChatMessage.implementation.create({
		speaker: ChatMessage.implementation.getSpeaker({ actor: loja }),
		whisper: destinatarios,
		content: `<div class="t20-mercador-chat">${html}</div>`
	});
}

const lista = (linhas) => `<ul>${linhas.map((l) => `<li>${l}</li>`).join("")}</ul>`;

/* ---------------- Compra (jogador compra do mercador) ---------------- */

async function comprar(dados) {
	const { loja, cfg, user, ator } = partes(dados);
	const catalogo = await carregarCatalogo();
	const itens = (dados.itens ?? []).filter((i) => i?.uuid && Number(i.qtd) > 0).map((i) => ({ uuid: i.uuid, qtd: Math.floor(Number(i.qtd)) }));
	if (!itens.length) return { ok: false, erro: "O carrinho está vazio." };
	const desconto = descontoDe(loja, user.id);
	const conta = totalCarrinho(loja, cfg, catalogo, { itens }, desconto);
	if (conta.linhas.length !== itens.length) return { ok: false, erro: "Algum item do carrinho não está mais à venda. Revise o carrinho." };
	if (Number(dados.totalEsperado) !== conta.total) {
		return { ok: false, erro: `O preço mudou (agora ${formatarTC(conta.total)}). Confira o carrinho e confirme de novo.` };
	}
	for (const l of conta.linhas) {
		if (l.oferta.estoque !== null && l.qtd > l.oferta.estoque) {
			return { ok: false, erro: `${l.oferta.nome}: o mercador só tem ${l.oferta.estoque}.` };
		}
	}
	const pagamento = atualizacaoPagamento(ator, conta.total);
	if (!pagamento) return { ok: false, erro: `${ator.name} não tem tibares suficientes (precisa de ${formatarTC(conta.total)}, tem ${formatarTC(carteiraTC(ator))}).` };

	await ator.update(pagamento);
	await adicionarItens(ator, conta.linhas.map((l) => ({ doc: l.oferta.doc, qtd: l.qtd * l.oferta.pacote })));
	const doEstoque = conta.linhas.filter((l) => l.oferta.origem === "estoque");
	if (doEstoque.length) {
		await removerItens(loja, doEstoque.map((l) => ({ item: loja.items.get(idEstoque(loja, l.oferta.uuid)), qtd: l.qtd })));
	}
	// carrinho esvaziado e desconto usado
	await salvarCarrinho(user, loja, { ator: ator.uuid, itens: [] });
	if (desconto) await loja.update({ [`flags.${MODULE_ID}.descontos.${user.id}`]: 0 });

	const linhas = conta.linhas.map((l) => {
		const n = l.qtd * l.oferta.pacote;
		return `${l.oferta.nome}${n > 1 ? ` ×${n}` : ""} — ${formatarTC(l.totalTC)}`;
	});
	await mensagem(user, loja, ator, `
		<h3><i class="fa-solid fa-cart-shopping"></i> ${ator.name} comprou em ${cfg.nome}</h3>
		${lista(linhas)}
		${desconto ? `<p>Subtotal ${formatarTC(conta.subtotal)} · desconto de ${desconto}% (−${formatarTC(conta.desconto)})</p>` : ""}
		<p><strong>Total pago: ${formatarTC(conta.total)}</strong></p>`);
	return { ok: true, total: conta.total };
}

/* ---------------- Venda (jogador vende ao mercador) ---------------- */

async function vender(dados) {
	const { loja, cfg, user, ator } = partes(dados);
	if (!cfg.compra) return { ok: false, erro: `${cfg.nome} não compra itens.` };
	const catalogo = await carregarCatalogo();
	const vendaveis = new Map(itensVendaveis(ator, cfg, catalogo).map((v) => [v.item.id, v]));
	const entradas = [];
	for (const { id, qtd } of dados.itens ?? []) {
		const v = vendaveis.get(id);
		const n = Math.floor(Number(qtd));
		if (!v || !(n > 0) || n > qtdItem(v.item)) return { ok: false, erro: "Algum item da venda não está mais no inventário. Revise a venda." };
		entradas.push({ ...v, qtd: n, totalTC: v.precoTC * n });
	}
	if (!entradas.length) return { ok: false, erro: "Nenhum item marcado para vender." };
	const total = entradas.reduce((t, e) => t + e.totalTC, 0);
	if (Number(dados.totalEsperado) !== total) {
		return { ok: false, erro: `O valor mudou (agora ${formatarTC(total)}). Confira a venda e confirme de novo.` };
	}

	// o mercador guarda os itens no estoque (com o preço de tabela) antes de saírem do jogador
	if (cfg.revender) await adicionarItens(loja, entradas.map((e) => ({ doc: e.item, qtd: e.qtd })));
	await removerItens(ator, entradas.map((e) => ({ item: e.item, qtd: e.qtd })));
	await ator.update(atualizacaoRecebimento(ator, total));

	const linhas = entradas.map((e) => `${e.item.name}${e.qtd > 1 ? ` ×${e.qtd}` : ""} — ${formatarTC(e.totalTC)}`);
	await mensagem(user, loja, ator, `
		<h3><i class="fa-solid fa-hand-holding-dollar"></i> ${ator.name} vendeu para ${cfg.nome}</h3>
		${lista(linhas)}
		<p><strong>Total recebido: ${formatarTC(total)}</strong></p>`);
	return { ok: true, total };
}
