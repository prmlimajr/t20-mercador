/**
 * T20 — Mercador
 *
 * Transforma atores/tokens em mercadores com loja: os jogadores compram (carrinho) e vendem seus
 * itens; o mestre configura a loja, vê os carrinhos e aplica descontos.
 *
 * - Duplo clique no token de um mercador abre a loja (o mestre segura Alt para abrir a ficha).
 * - Botão no HUD do token (mestre): configurar o mercador.
 * - Botões no cabeçalho da ficha e no menu de contexto do diretório de atores.
 * - API: game.modules.get("t20-mercador").api.abrirLoja(actorOuToken)
 */
import { carregarCatalogo, invalidarCatalogo } from "./catalogo.js";
import { MODULE_ID, SUPLEMENTO_ID, ehMercador, lerConfig } from "./comum.js";
import { LojaMercador, abrirLoja, configurarLoja } from "./loja.js";
import { registrarSocket } from "./transacoes.js";

/* ---------------- Configurações ---------------- */

Hooks.once("init", () => {
	game.settings.register(MODULE_ID, "suplementos", {
		name: "T20MC.Config.suplementos.Nome",
		hint: "T20MC.Config.suplementos.Dica",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
		onChange: () => {
			invalidarCatalogo();
			renderizarLojas(() => true);
		}
	});
	foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/loja.hbs`]);
});

Hooks.once("ready", () => {
	registrarSocket();
	patchDuploClique();
	patchFichaDoMercador();
	game.modules.get(MODULE_ID).api = { abrirLoja, configurarLoja, ehMercador, lerConfig, invalidarCatalogo };
	// carrega o catálogo em segundo plano para a loja abrir rápido
	setTimeout(() => carregarCatalogo().catch((err) => console.error(`${MODULE_ID} |`, err)), 2000);
	if (game.settings.get(MODULE_ID, "suplementos") && !game.modules.get(SUPLEMENTO_ID)?.active) {
		console.info(`${MODULE_ID} | Suplementos de Arton não está ativo: só os itens do sistema entram no catálogo.`);
	}
});

/* ---------------- Duplo clique no token ---------------- */

function patchDuploClique() {
	const alvo = "CONFIG.Token.objectClass.prototype._onClickLeft2";
	const wrapper = function (wrapped, event, ...args) {
		const alt = event?.altKey ?? event?.nativeEvent?.altKey;
		if (ehMercador(this.document) && !(game.user.isGM && alt)) {
			abrirLoja(this.actor);
			return;
		}
		return wrapped(event, ...args);
	};
	if (game.modules.get("lib-wrapper")?.active) {
		libWrapper.register(MODULE_ID, alvo, wrapper, "MIXED");
		return;
	}
	const proto = CONFIG.Token.objectClass.prototype;
	const original = proto._onClickLeft2;
	proto._onClickLeft2 = function (event, ...args) {
		return wrapper.call(this, (...a) => original.apply(this, a), event, ...args);
	};
}

/**
 * Jogador sem posse do mercador nunca vê a ficha dele (no T20, a ficha "Limitada", com as
 * Anotações): ao tentar abri-la — duplo clique no token, diretório de atores etc. — abre a loja.
 * Cobre os caminhos em que o Foundry abre a ficha sem passar por Token#_onClickLeft2.
 */
function patchFichaDoMercador() {
	if (game.user.isGM) return;
	const alvo = "foundry.appv1.sheets.ActorSheet.prototype.render";
	const wrapper = function (wrapped, force, ...args) {
		const actor = this.actor;
		if (force && actor && !actor.isOwner && ehMercador(actor)) {
			abrirLoja(actor);
			return this;
		}
		return wrapped(force, ...args);
	};
	if (game.modules.get("lib-wrapper")?.active) {
		libWrapper.register(MODULE_ID, alvo, wrapper, "MIXED");
		return;
	}
	const proto = foundry.appv1.sheets.ActorSheet.prototype;
	const original = proto.render;
	proto.render = function (force, ...args) {
		return wrapper.call(this, (...a) => original.apply(this, a), force, ...args);
	};
}

/* ---------------- HUD do token (mestre) ---------------- */

Hooks.on("renderTokenHUD", (hud, html) => {
	if (!game.user.isGM) return;
	const root = html instanceof HTMLElement ? html : html?.[0];
	const token = hud.object?.document;
	if (!root || !token?.actor) return;
	const coluna = root.querySelector(".col.right") ?? root.querySelector(".col.left");
	if (!coluna) return;
	const ativo = ehMercador(token.actor);
	const botao = document.createElement("button");
	botao.type = "button";
	botao.className = `control-icon t20-mercador-hud${ativo ? " ativo" : ""}`;
	botao.dataset.tooltip = ativo ? "Loja do mercador (clique: abrir · botão direito: configurar)" : "Transformar em mercador";
	botao.innerHTML = `<i class="fa-solid fa-store"></i>`;
	botao.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		if (ativo) abrirLoja(token.actor);
		else configurarLoja(token.actor);
	});
	botao.addEventListener("contextmenu", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		configurarLoja(token.actor);
	});
	coluna.append(botao);
});

/* ---------------- Ficha e diretório de atores ---------------- */

Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
	const actor = sheet.document ?? sheet.actor;
	if (!actor) return;
	if (game.user.isGM) {
		controls.unshift({
			icon: "fa-solid fa-store",
			label: ehMercador(actor) ? "Configurar mercador" : "Transformar em mercador",
			action: "t20mcConfigurar",
			onClick: () => configurarLoja(actor)
		});
	}
	if (ehMercador(actor)) {
		controls.unshift({
			icon: "fa-solid fa-cart-shopping",
			label: "Abrir loja",
			action: "t20mcAbrir",
			onClick: () => abrirLoja(actor)
		});
	}
});

function opcoesDiretorio(app, options) {
	const ator = (li) => {
		const el = li instanceof HTMLElement ? li : li?.[0];
		const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
		return game.actors.get(id);
	};
	options.push(
		{
			name: "Abrir loja do mercador",
			label: "Abrir loja do mercador",
			icon: `<i class="fa-solid fa-cart-shopping"></i>`,
			condition: (li) => ehMercador(ator(li)),
			callback: (li) => abrirLoja(ator(li))
		},
		{
			name: "Configurar mercador",
			label: "Configurar mercador",
			icon: `<i class="fa-solid fa-store"></i>`,
			condition: () => game.user.isGM,
			callback: (li) => configurarLoja(ator(li))
		}
	);
}
Hooks.on("getActorContextOptions", opcoesDiretorio);
Hooks.on("getActorDirectoryEntryContext", opcoesDiretorio);

/* ---------------- Atualização das janelas abertas ---------------- */

function lojasAbertas() {
	return [...foundry.applications.instances.values()].filter((app) => app instanceof LojaMercador && app.rendered);
}

const pendentes = new Set();
const renderizar = foundry.utils.debounce(() => {
	for (const app of pendentes) if (app.rendered) app.render();
	pendentes.clear();
}, 50);

function renderizarLojas(filtro) {
	for (const app of lojasAbertas()) if (filtro(app)) pendentes.add(app);
	if (pendentes.size) renderizar();
}

const tocaAtor = (app, actor) => !!actor && (actor.uuid === app.loja.uuid || actor.uuid === app.atorUuid
	|| (app.loja.isToken && actor === app.loja));

Hooks.on("updateActor", (actor) => renderizarLojas((app) => tocaAtor(app, actor)));
Hooks.on("updateToken", (token) => renderizarLojas((app) => app.loja.isToken && app.loja.token === token));
for (const evento of ["createItem", "updateItem", "deleteItem"]) {
	Hooks.on(evento, (item) => renderizarLojas((app) => tocaAtor(app, item.parent)));
}
// carrinhos ficam nas flags do usuário: o mestre acompanha os de todos; cada jogador, o seu
Hooks.on("updateUser", (user) => renderizarLojas(() => game.user.isGM || user.id === game.user.id));
Hooks.on("userConnected", () => {
	if (game.user.isGM) renderizarLojas(() => true);
});
Hooks.on("deleteActor", (actor) => {
	for (const app of lojasAbertas()) if (app.loja.uuid === actor.uuid) app.close();
});
Hooks.on("deleteToken", (token) => {
	for (const app of lojasAbertas()) if (app.loja.isToken && app.loja.token === token) app.close();
});
