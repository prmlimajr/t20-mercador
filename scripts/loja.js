/**
 * Janela da loja do mercador: comprar (com carrinho), vender (sacola de venda) e, para o mestre,
 * os carrinhos dos jogadores (com desconto) e a configuração do mercador.
 */
import { ESTRUTURA_LOJA, PERFIS, carregarCatalogo, fichaItem } from "./catalogo.js";
import {
	MODULE_ID, carrinhoDe, carteiraTC, chaveLoja, descontoDe, ehMercador, formatarTC, lerConfig,
	normalizar, qtdItem, salvarCarrinho
} from "./comum.js";
import { itensVendaveis, listarOfertas, resolverOferta, totalCarrinho } from "./ofertas.js";
import { pedir } from "./transacoes.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TPL = `modules/${MODULE_ID}/templates`;

/** Abre (ou traz para frente) a loja de um ator mercador. */
export function abrirLoja(doc) {
	const loja = doc?.actor ?? doc;
	if (!loja) return null;
	if (!ehMercador(loja) && !game.user.isGM) {
		ui.notifications.warn(`${loja.name} não é um mercador.`);
		return null;
	}
	const id = `t20-mercador-${chaveLoja(loja)}`;
	const existente = foundry.applications.instances.get(id);
	if (existente) {
		existente.render({ force: true });
		existente.bringToFront?.();
		return existente;
	}
	return new LojaMercador(loja, { id }).render({ force: true });
}

/** Abre a loja já na tela de configuração (mestre). */
export function configurarLoja(doc) {
	const app = abrirLoja(doc);
	if (app) {
		app.modo = "config";
		app.render();
	}
	return app;
}

export class LojaMercador extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(loja, options = {}) {
		super(options);
		this.lojaUuid = loja.uuid;
		this._loja = loja;
		this.modo = ehMercador(loja) ? "comprar" : "config";
		this.tipo = null;
		this.categoria = null;
		this.foco = null;
		this.filtro = "";
		/** Venda em montagem: id do item → quantidade. */
		this.sacola = new Map();
		this.atorUuid = null;
		this.ocupado = false;
		this._html = new Map();
	}

	static DEFAULT_OPTIONS = {
		classes: ["t20-mercador"],
		tag: "div",
		window: { icon: "fa-solid fa-store", resizable: true },
		position: { width: 1000, height: 740 },
		actions: {
			modo: LojaMercador.#modo,
			tipo: LojaMercador.#tipo,
			categoria: LojaMercador.#categoria,
			focar: LojaMercador.#focar,
			carrinho: LojaMercador.#carrinho,
			esvaziar: LojaMercador.#esvaziar,
			finalizar: LojaMercador.#finalizar,
			sacola: LojaMercador.#sacola,
			sacolaTudo: LojaMercador.#sacolaTudo,
			limparSacola: LojaMercador.#limparSacola,
			vender: LojaMercador.#vender,
			escolherImagem: LojaMercador.#escolherImagem,
			perfil: LojaMercador.#perfil,
			salvarConfig: LojaMercador.#salvarConfig,
			abrirFicha: LojaMercador.#abrirFicha
		}
	};

	static PARTS = {
		main: {
			template: `${TPL}/loja.hbs`,
			scrollable: [".mc-lista", ".mc-info", ".mc-config", ".mc-carrinhos-lista"]
		}
	};

	/** O ator do mercador (relido pelo uuid: o ator sintético de um token pode ser recriado). */
	get loja() {
		const atual = fromUuidSync(this.lojaUuid);
		if (atual) this._loja = atual;
		return this._loja;
	}

	get title() {
		return lerConfig(this.loja).nome;
	}

	get cfg() {
		return lerConfig(this.loja);
	}

	/* ---------------- Comprador ---------------- */

	/** Personagens com que este usuário pode negociar. */
	candidatos() {
		const naoMercador = (a) => a && a !== this.loja && a.uuid !== this.loja.uuid && !ehMercador(a);
		if (game.user.isGM) {
			return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner && naoMercador(a));
		}
		const lista = game.actors.filter((a) => a.isOwner && naoMercador(a));
		// personagens primeiro
		return lista.sort((a, b) => (a.type === "character" ? 0 : 1) - (b.type === "character" ? 0 : 1) || a.name.localeCompare(b.name, "pt-BR"));
	}

	get comprador() {
		const candidatos = this.candidatos();
		const valido = (uuid) => candidatos.find((a) => a.uuid === uuid);
		const escolhido = valido(this.atorUuid)
			?? valido(carrinhoDe(game.user, this.loja).ator)
			?? valido(game.user.character?.uuid)
			?? canvas?.tokens?.controlled?.map((t) => t.actor).find((a) => valido(a?.uuid))
			?? candidatos[0]
			?? null;
		this.atorUuid = escolhido?.uuid ?? null;
		return escolhido;
	}

	/* ---------------- Contexto ---------------- */

	async _prepareContext() {
		const cfg = this.cfg;
		const gm = game.user.isGM;
		if (!cfg.ativo && !gm) return { fechada: true, cfg };
		if (!cfg.ativo) this.modo = "config";
		if (this.modo === "vender" && !cfg.compra) this.modo = "comprar";
		const catalogo = await carregarCatalogo();
		const ator = this.comprador;
		const carteira = ator ? carteiraTC(ator) : 0;
		const ctx = {
			cfg, gm,
			modo: this.modo,
			comprar: this.modo === "comprar",
			vender: this.modo === "vender",
			config: this.modo === "config",
			abas: [
				{ id: "comprar", nome: "Comprar", icone: "fa-solid fa-cart-shopping", mostrar: cfg.ativo },
				{ id: "vender", nome: "Vender", icone: "fa-solid fa-hand-holding-dollar", mostrar: cfg.ativo && cfg.compra },
				{ id: "config", nome: "Configurar", icone: "fa-solid fa-gear", mostrar: gm }
			].filter((a) => a.mostrar).map((a) => ({ ...a, selecionado: a.id === this.modo })),
			comprador: ator ? { uuid: ator.uuid, nome: ator.name, img: ator.img } : null,
			candidatos: this.candidatos().map((a) => ({ uuid: a.uuid, nome: a.name, selecionado: a.uuid === ator?.uuid })),
			carteira: formatarTC(carteira),
			filtro: this.filtro,
			ocupado: this.ocupado
		};
		if (this.modo === "config") Object.assign(ctx, this.#ctxConfig(cfg));
		else if (this.modo === "vender") Object.assign(ctx, await this.#ctxVender(cfg, catalogo, ator, carteira));
		else Object.assign(ctx, await this.#ctxComprar(cfg, catalogo, ator, carteira));
		return ctx;
	}

	async #ctxComprar(cfg, catalogo, ator, carteira) {
		const ofertas = listarOfertas(this.loja, cfg, catalogo);
		const carrinho = carrinhoDe(game.user, this.loja);
		const desconto = descontoDe(this.loja, game.user.id);
		const conta = totalCarrinho(this.loja, cfg, catalogo, carrinho, desconto);
		const noCarrinho = new Map(carrinho.itens.map((i) => [i.uuid, i.qtd]));
		const disponivel = carteira - conta.total;

		// tipo → categorias com itens (o estoque próprio entra em "Estoque do mercador")
		const temEstoque = ofertas.some((o) => o.origem === "estoque");
		const presentes = new Set(ofertas.filter((o) => o.origem === "catalogo").map((o) => o.categoria));
		const tipos = [
			...(temEstoque ? [{ tipo: "Estoque do mercador", categorias: [] }] : []),
			...ESTRUTURA_LOJA.map((t) => ({ ...t, categorias: t.categorias.filter((c) => presentes.has(c)) })).filter((t) => t.categorias.length)
		];
		const tipo = tipos.find((t) => t.tipo === this.tipo) ?? tipos[0];
		this.tipo = tipo?.tipo ?? null;
		if (tipo && tipo.categorias.length && !tipo.categorias.includes(this.categoria)) this.categoria = tipo.categorias[0];
		const visiveis = this.tipo === "Estoque do mercador"
			? ofertas.filter((o) => o.origem === "estoque")
			: ofertas.filter((o) => o.origem === "catalogo" && o.categoria === this.categoria);

		const cards = visiveis.map((o) => {
			const f = fichaItem(o.doc);
			const qtd = noCarrinho.get(o.uuid) ?? 0;
			const extras = [
				o.pacote > 1 ? `pacote ×${o.pacote}` : "",
				o.estoque !== null ? `estoque ${o.estoque}` : "",
				f.sub
			];
			return {
				uuid: o.uuid, nome: o.nome, img: o.img, qtd,
				sub: [formatarTC(o.precoTC), ...extras].filter(Boolean).join(" · "),
				caro: o.precoTC > disponivel && !qtd,
				esgotado: o.estoque !== null && qtd >= o.estoque,
				foco: o.uuid === this.foco,
				busca: `${o.nome} ${f.sub} ${o.categoria}`
			};
		});

		let info = null;
		const foco = this.foco ? resolverOferta(this.loja, cfg, catalogo, this.foco) : null;
		if (foco) {
			const f = fichaItem(foco.doc);
			const qtd = noCarrinho.get(foco.uuid) ?? 0;
			const precoTabela = Number(foco.doc.system?.preco) || 0;
			info = {
				uuid: foco.uuid, nome: foco.nome, img: foco.img,
				preco: formatarTC(foco.precoTC),
				pacote: foco.pacote > 1 ? foco.pacote : null,
				estoque: foco.estoque,
				qtd,
				podeAdicionar: foco.precoTC <= disponivel && (foco.estoque === null || qtd < foco.estoque),
				motivo: foco.estoque !== null && qtd >= foco.estoque ? "Sem mais unidades em estoque" : "Tibares insuficientes",
				podeRemover: qtd > 0,
				stats: [
					...(cfg.margem !== 100 && foco.origem === "catalogo" ? [{ rotulo: "Preço de tabela", valor: formatarTC(Math.round(precoTabela * 10)) }] : []),
					...(foco.fonte ? [{ rotulo: "Fonte", valor: foco.fonte }] : []),
					...f.stats.map(([rotulo, valor]) => ({ rotulo, valor }))
				],
				descricao: await this.#descricao(foco.doc)
			};
		}

		return {
			tipos: tipos.map((t) => ({ nome: t.tipo, selecionado: t.tipo === this.tipo })),
			categorias: this.tipo === "Estoque do mercador" ? [] : (tipo?.categorias ?? []).map((c) => ({
				nome: c, selecionado: c === this.categoria,
				qtd: ofertas.filter((o) => o.origem === "catalogo" && o.categoria === c).length
			})),
			cards,
			semItens: !ofertas.length,
			info,
			carrinho: conta.linhas.map((l) => ({
				uuid: l.oferta.uuid, nome: l.oferta.nome, qtd: l.qtd, multiplo: l.qtd > 1, total: formatarTC(l.totalTC)
			})),
			removidos: carrinho.itens.length - conta.linhas.length,
			desconto,
			subtotal: formatarTC(conta.subtotal),
			valorDesconto: formatarTC(conta.desconto),
			total: formatarTC(conta.total),
			restante: formatarTC(disponivel),
			negativo: disponivel < 0,
			totalTC: conta.total,
			podeFinalizar: !!ator && conta.linhas.length > 0 && disponivel >= 0 && !this.ocupado,
			carrinhosJogadores: game.user.isGM ? this.#carrinhosJogadores(cfg, catalogo) : null
		};
	}

	/** Mestre: carrinhos dos jogadores nesta loja, com o campo de desconto. */
	#carrinhosJogadores(cfg, catalogo) {
		return game.users.filter((u) => !u.isGM).map((u) => {
			const carrinho = carrinhoDe(u, this.loja);
			const desconto = descontoDe(this.loja, u.id);
			if (!carrinho.itens.length && !u.active && !desconto) return null;
			const conta = totalCarrinho(this.loja, cfg, catalogo, carrinho, desconto);
			const ator = carrinho.ator ? fromUuidSync(carrinho.ator) : u.character;
			const carteira = ator ? carteiraTC(ator) : null;
			return {
				id: u.id, nome: u.name, cor: u.color?.css ?? u.color, ativo: u.active,
				ator: ator?.name ?? "—",
				itens: conta.linhas.map((l) => `${l.oferta.nome}${l.qtd > 1 ? ` ×${l.qtd}` : ""}`).join(", "),
				vazio: !conta.linhas.length,
				desconto,
				subtotal: formatarTC(conta.subtotal),
				total: formatarTC(conta.total),
				carteira: carteira === null ? "—" : formatarTC(carteira),
				semDinheiro: carteira !== null && carteira < conta.total
			};
		}).filter(Boolean);
	}

	async #ctxVender(cfg, catalogo, ator, carteira) {
		const vendaveis = itensVendaveis(ator, cfg, catalogo);
		const porId = new Map(vendaveis.map((v) => [v.item.id, v]));
		// tira da sacola o que não existe mais (ou passou da quantidade)
		for (const [id, n] of this.sacola) {
			const v = porId.get(id);
			if (!v) this.sacola.delete(id);
			else if (n > qtdItem(v.item)) this.sacola.set(id, qtdItem(v.item));
		}
		const cards = vendaveis.map(({ item, precoTC }) => {
			const f = fichaItem(item);
			const tem = qtdItem(item);
			const qtd = this.sacola.get(item.id) ?? 0;
			const equipado = !!item.system?.equipado;
			return {
				id: item.id, nome: item.name, img: item.img, qtd, tem,
				sub: [`${formatarTC(precoTC)} cada`, tem > 1 ? `tem ${tem}` : "", equipado ? "equipado" : "", f.sub].filter(Boolean).join(" · "),
				foco: item.id === this.foco,
				busca: `${item.name} ${f.sub}`
			};
		});
		const total = [...this.sacola].reduce((t, [id, n]) => t + (porId.get(id)?.precoTC ?? 0) * n, 0);
		let info = null;
		const v = porId.get(this.foco);
		if (v) {
			const f = fichaItem(v.item);
			const qtd = this.sacola.get(v.item.id) ?? 0;
			info = {
				id: v.item.id, nome: v.item.name, img: v.item.img,
				preco: formatarTC(v.precoTC),
				tem: qtdItem(v.item),
				multiplo: qtdItem(v.item) > 1,
				qtd,
				podeAdicionar: qtd < qtdItem(v.item),
				podeRemover: qtd > 0,
				equipado: !!v.item.system?.equipado,
				stats: [
					{ rotulo: "Preço de tabela", valor: formatarTC(Math.round((Number(v.item.system.preco) || 0) * 10)) },
					...f.stats.map(([rotulo, valor]) => ({ rotulo, valor }))
				],
				descricao: await this.#descricao(v.item)
			};
		}
		const itensSacola = [...this.sacola].filter(([, n]) => n > 0).map(([id, n]) => {
			const vv = porId.get(id);
			return { id, nome: vv.item.name, qtd: n, multiplo: n > 1, total: formatarTC(vv.precoTC * n) };
		});
		return {
			cards, info,
			semItens: !vendaveis.length,
			sacola: itensSacola,
			totalVenda: formatarTC(total),
			totalTC: total,
			depois: formatarTC(carteira + total),
			taxa: cfg.taxaCompra,
			podeVender: !!ator && itensSacola.length > 0 && !this.ocupado
		};
	}

	#ctxConfig(cfg) {
		const marcadas = new Set(cfg.categorias);
		return {
			grupos: ESTRUTURA_LOJA.map((t) => ({
				tipo: t.tipo,
				categorias: t.categorias.map((c) => ({ nome: c, marcada: marcadas.has(c) }))
			})),
			perfis: PERFIS.map((p) => ({ id: p.id, nome: p.nome, icone: p.icone })),
			ator: this.loja.name,
			sintetico: this.loja.isToken,
			jogadoresVeem: (this.#atorBase().ownership?.default ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED,
			suplementos: game.settings.get(MODULE_ID, "suplementos")
		};
	}

	/** Ator base (para tokens não vinculados, as permissões ficam no ator do diretório). */
	#atorBase() {
		return this.loja.isToken ? (this.loja.token?.baseActor ?? this.loja) : this.loja;
	}

	async #descricao(doc) {
		if (this._html.has(doc.uuid)) return this._html.get(doc.uuid);
		const bruto = doc.system?.description?.value ?? "";
		const TE = foundry.applications.ux?.TextEditor?.implementation ?? TextEditor;
		const html = bruto ? await TE.enrichHTML(bruto, { relativeTo: doc, secrets: false }) : "";
		this._html.set(doc.uuid, html);
		return html;
	}

	/* ---------------- Render ---------------- */

	_onRender(context, options) {
		super._onRender?.(context, options);
		const el = this.element;
		const filtro = el.querySelector(".mc-filtro");
		if (filtro) {
			const aplicar = () => {
				this.filtro = filtro.value;
				const termo = normalizar(filtro.value);
				for (const card of el.querySelectorAll(".mc-lista .mc-card")) {
					card.hidden = !!termo && !normalizar(card.dataset.busca).includes(termo);
				}
			};
			filtro.addEventListener("input", aplicar);
			aplicar();
		}
		el.querySelector(".mc-seletor-ator")?.addEventListener("change", (ev) => this.#trocarComprador(ev.target.value));
		for (const input of el.querySelectorAll("input[data-desconto]")) {
			input.addEventListener("change", (ev) => this.#definirDesconto(ev.target.dataset.desconto, ev.target.value));
		}
	}

	async #trocarComprador(uuid) {
		this.atorUuid = uuid;
		this.sacola.clear();
		const carrinho = carrinhoDe(game.user, this.loja);
		await salvarCarrinho(game.user, this.loja, { ...carrinho, ator: uuid });
		this.render();
	}

	async #definirDesconto(userId, valor) {
		const v = Math.min(100, Math.max(0, Math.round(Number(valor) || 0)));
		await this.loja.update({ [`flags.${MODULE_ID}.descontos.${userId}`]: v });
	}

	/* ---------------- Ações ---------------- */

	static #modo(event, target) {
		this.modo = target.dataset.valor;
		this.foco = null;
		this.filtro = "";
		this.render();
	}

	static #tipo(event, target) {
		this.tipo = target.dataset.valor;
		this.categoria = null;
		this.render();
	}

	static #categoria(event, target) {
		this.categoria = target.dataset.valor;
		this.render();
	}

	static #focar(event, target) {
		this.foco = target.dataset.uuid ?? target.dataset.id;
		this.render();
	}

	/** +1/−1 de um item no carrinho. */
	static async #carrinho(event, target) {
		const uuid = target.dataset.uuid;
		const delta = Number(target.dataset.delta);
		const catalogo = await carregarCatalogo();
		const cfg = this.cfg;
		const oferta = resolverOferta(this.loja, cfg, catalogo, uuid);
		const carrinho = carrinhoDe(game.user, this.loja);
		const itens = carrinho.itens.map((i) => ({ ...i }));
		let linha = itens.find((i) => i.uuid === uuid);
		if (delta > 0) {
			if (!oferta) return ui.notifications.warn("Este item não está mais à venda.");
			const atual = linha?.qtd ?? 0;
			if (oferta.estoque !== null && atual + delta > oferta.estoque) {
				return ui.notifications.warn(`O mercador só tem ${oferta.estoque} ${oferta.nome}.`);
			}
			if (!linha) itens.push(linha = { uuid, qtd: 0 });
			linha.qtd += delta;
			const ator = this.comprador;
			const conta = totalCarrinho(this.loja, cfg, catalogo, { itens }, descontoDe(this.loja, game.user.id));
			if (ator && conta.total > carteiraTC(ator)) {
				return ui.notifications.warn(`Tibares insuficientes para comprar ${oferta.nome}.`);
			}
		} else if (linha) {
			linha.qtd = Math.max(0, linha.qtd + delta);
		}
		this.foco = uuid;
		await salvarCarrinho(game.user, this.loja, { ator: this.atorUuid, itens: itens.filter((i) => i.qtd > 0) });
	}

	static async #esvaziar() {
		await salvarCarrinho(game.user, this.loja, { ator: this.atorUuid, itens: [] });
	}

	static async #finalizar(event, target) {
		const ator = this.comprador;
		if (!ator || this.ocupado) return;
		const carrinho = carrinhoDe(game.user, this.loja);
		const totalEsperado = Number(target.dataset.total);
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: this.cfg.nome },
			content: `<p>Comprar os itens do carrinho para <strong>${ator.name}</strong> por <strong>${formatarTC(totalEsperado)}</strong>?</p>`
		});
		if (!ok) return;
		this.ocupado = true;
		this.render();
		const r = await pedir("comprar", { lojaUuid: this.loja.uuid, atorUuid: ator.uuid, itens: carrinho.itens, totalEsperado });
		this.ocupado = false;
		if (r.ok) ui.notifications.info(`Compra concluída: ${formatarTC(r.total)}.`);
		else ui.notifications.warn(r.erro);
		this.render();
	}

	/** +1/−1 de um item na sacola de venda. */
	static #sacola(event, target) {
		const id = target.dataset.id;
		const item = this.comprador?.items.get(id);
		if (!item) return;
		const atual = this.sacola.get(id) ?? 0;
		const novo = Math.min(qtdItem(item), Math.max(0, atual + Number(target.dataset.delta)));
		if (novo) this.sacola.set(id, novo);
		else this.sacola.delete(id);
		this.foco = id;
		this.render();
	}

	/** Coloca na sacola todas as unidades do item (ou tira todas, se já estavam). */
	static #sacolaTudo(event, target) {
		const id = target.dataset.id;
		const item = this.comprador?.items.get(id);
		if (!item) return;
		if (this.sacola.get(id) === qtdItem(item)) this.sacola.delete(id);
		else this.sacola.set(id, qtdItem(item));
		this.foco = id;
		this.render();
	}

	static #limparSacola() {
		this.sacola.clear();
		this.render();
	}

	static async #vender(event, target) {
		const ator = this.comprador;
		if (!ator || this.ocupado || !this.sacola.size) return;
		const totalEsperado = Number(target.dataset.total);
		const equipados = [...this.sacola.keys()].map((id) => ator.items.get(id)).filter((i) => i?.system?.equipado);
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: this.cfg.nome },
			content: `<p>Vender os itens marcados de <strong>${ator.name}</strong> por <strong>${formatarTC(totalEsperado)}</strong>?</p>`
				+ (equipados.length ? `<p><i class="fa-solid fa-triangle-exclamation"></i> Itens equipados: ${equipados.map((i) => i.name).join(", ")}.</p>` : "")
		});
		if (!ok) return;
		this.ocupado = true;
		this.render();
		const itens = [...this.sacola].map(([id, qtd]) => ({ id, qtd }));
		const r = await pedir("vender", { lojaUuid: this.loja.uuid, atorUuid: ator.uuid, itens, totalEsperado });
		this.ocupado = false;
		if (r.ok) {
			this.sacola.clear();
			this.foco = null;
			ui.notifications.info(`Venda concluída: +${formatarTC(r.total)}.`);
		} else ui.notifications.warn(r.erro);
		this.render();
	}

	/* ---------------- Configuração (mestre) ---------------- */

	static #escolherImagem(event, target) {
		const input = this.element.querySelector("input[name=imagem]");
		const FP = foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;
		new FP({
			type: "image",
			current: input.value,
			callback: (caminho) => {
				input.value = caminho;
				const img = this.element.querySelector(".mc-config-retrato");
				if (img) img.src = caminho;
			}
		}).render(true);
	}

	/** Marca as categorias de um perfil pronto (sem salvar ainda). */
	static #perfil(event, target) {
		const perfil = PERFIS.find((p) => p.id === target.dataset.perfil);
		if (!perfil) return;
		const somar = event.shiftKey;
		for (const cb of this.element.querySelectorAll("input[name=categoria]")) {
			const dentro = perfil.categorias.includes(cb.value);
			cb.checked = somar ? cb.checked || dentro : dentro;
		}
	}

	static async #salvarConfig() {
		const el = this.element;
		const valor = (n) => el.querySelector(`[name=${n}]`);
		const numero = (n, padrao, max) => {
			const v = Math.round(Number(valor(n)?.value));
			return Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : padrao;
		};
		const config = {
			ativo: valor("ativo").checked,
			nome: valor("nome").value.trim(),
			imagem: valor("imagem").value.trim(),
			saudacao: valor("saudacao").value.trim(),
			categorias: [...el.querySelectorAll("input[name=categoria]:checked")].map((cb) => cb.value),
			margem: numero("margem", 100, 1000),
			taxaCompra: numero("taxaCompra", 50, 100),
			compra: valor("compra").checked,
			revender: valor("revender").checked
		};
		await this.loja.update({ [`flags.${MODULE_ID}.config`]: config });
		// jogadores precisam de permissão Limitada para dar duplo clique no token
		const base = this.#atorBase();
		const LIMITED = CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
		if (valor("liberar")?.checked && (base.ownership?.default ?? 0) < LIMITED) {
			await base.update({ "ownership.default": LIMITED });
		}
		ui.notifications.info(config.ativo ? `${config.nome || this.loja.name}: loja aberta.` : `${config.nome || this.loja.name}: loja fechada.`);
		if (config.ativo) this.modo = "comprar";
		this.render();
	}

	static #abrirFicha() {
		this.loja.sheet?.render(true);
	}
}
