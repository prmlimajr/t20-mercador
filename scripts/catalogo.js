/**
 * Catálogo de itens que os mercadores podem vender: compêndio de equipamentos do sistema Tormenta20
 * (e, opcionalmente, os itens dos Suplementos de Arton), organizado por tipo → categoria.
 * As categorias são as mesmas da loja do T20 — Construtor de Ficha.
 */
import { MODULE_ID, SUPLEMENTO_ID, normalizar } from "./comum.js";

const PACK_SISTEMA = "tormenta20.equipamentos";

/** Organização da loja: tipo → categorias, na ordem de exibição. */
export const ESTRUTURA_LOJA = [
	{ tipo: "Armas e munições", categorias: ["Armas simples", "Armas marciais", "Armas exóticas", "Armas de fogo", "Munições"] },
	{ tipo: "Armaduras e escudos", categorias: ["Armaduras leves", "Armaduras pesadas", "Escudos"] },
	{ tipo: "Itens gerais", categorias: ["Equipamento de aventura", "Ferramentas", "Vestuário", "Esotérico", "Alquímicos", "Alimentação", "Animais", "Veículos"] }
];

export const TODAS_CATEGORIAS = ESTRUTURA_LOJA.flatMap((t) => t.categorias);

/** Perfis prontos de mercador: atalhos para marcar as categorias na configuração. */
export const PERFIS = [
	{ id: "aventureiro", nome: "Itens de aventureiro", icone: "fa-solid fa-campground", categorias: ["Equipamento de aventura", "Ferramentas", "Vestuário", "Alimentação", "Munições"] },
	{ id: "armeiro", nome: "Armas e armaduras", icone: "fa-solid fa-shield-halved", categorias: ["Armas simples", "Armas marciais", "Armas exóticas", "Armas de fogo", "Munições", "Armaduras leves", "Armaduras pesadas", "Escudos"] },
	{ id: "alquimista", nome: "Alquimista", icone: "fa-solid fa-flask", categorias: ["Alquímicos"] },
	{ id: "esoterico", nome: "Esotérico", icone: "fa-solid fa-hat-wizard", categorias: ["Esotérico"] },
	{ id: "estabulo", nome: "Estábulo e veículos", icone: "fa-solid fa-horse", categorias: ["Animais", "Veículos"] },
	{ id: "emporio", nome: "Empório (tudo)", icone: "fa-solid fa-store", categorias: TODAS_CATEGORIAS }
];

/** Tipos de item físicos (os que podem ser comprados e vendidos). */
export const TIPOS_FISICOS = new Set(["arma", "equipamento", "consumivel", "tesouro"]);

/** Pastas do compêndio do sistema que não entram na loja. */
const FORA_DA_LOJA = new Set(["Tesouro", "Itens de Origem"]);
/** Pastas dos suplementos que não são itens comuns de loja (mágicos, artefatos...). */
const PASTAS_FORA_SUPLEMENTO = /m[aá]gic|artefato|lit[uú]rgic|espec[ií]fic|avatar|distin[cç]|b[eê]n[cç][aã]o|extras/i;

const ARMAS_POR_PROFICIENCIA = { simples: "Armas simples", marcial: "Armas marciais", exotica: "Armas exóticas", fogo: "Armas de fogo" };
const ARMADURAS_POR_TIPO = { leve: "Armaduras leves", pesada: "Armaduras pesadas", escudo: "Escudos" };
const GERAIS_POR_PASTA = {
	"Equipamento de Aventura": "Equipamento de aventura",
	Ferramentas: "Ferramentas",
	Vestuários: "Vestuário",
	Esotérico: "Esotérico",
	Animais: "Animais",
	Veículos: "Veículos"
};

/** Categoria de um item do compêndio do sistema (pela pasta e, quando ela não basta, pelo tipo). */
function categoriaSistema(doc, pasta) {
	const s = doc.system ?? {};
	if (pasta === "Armas") {
		if (doc.type === "arma") return ARMAS_POR_PROFICIENCIA[s.proficiencia] ?? "Armas exóticas";
		return "Munições";
	}
	if (pasta === "Armaduras & Escudos") return ARMADURAS_POR_TIPO[s.tipo] ?? "Armaduras leves";
	if (pasta === "Consumíveis") {
		if (s.tipo === "food") return "Alimentação";
		if (s.tipo === "material") return "Esotérico";
		return "Alquímicos";
	}
	return GERAIS_POR_PASTA[pasta] ?? "Equipamento de aventura";
}

/**
 * Categoria de um item qualquer (suplementos, inventário do mercador): pelo nome da pasta e pelo tipo.
 * Devolve null quando não dá para classificar (ex.: arma sem proficiência).
 */
export function categoriaGenerica(doc, pasta = "") {
	const s = doc.system ?? {};
	const p = normalizar(pasta);
	if (doc.type === "arma") return ARMAS_POR_PROFICIENCIA[s.proficiencia] ?? null;
	if (/aliment/.test(p) || s.tipo === "food") return "Alimentação";
	if (/alquim|catali|venen|prepara/.test(p) || ["alchemy", "alquimico", "potion"].includes(s.tipo)) return "Alquímicos";
	if (/muni/.test(p) || s.tipo === "ammo") return "Munições";
	if (/armadura|escudo/.test(p) && ARMADURAS_POR_TIPO[s.tipo]) return ARMADURAS_POR_TIPO[s.tipo];
	if (doc.type === "equipamento" && ["leve", "pesada", "escudo"].includes(s.tipo) && !/anima|vestu|ferrament/.test(p)) return ARMADURAS_POR_TIPO[s.tipo];
	if (/anima/.test(p)) return "Animais";
	if (/vestu/.test(p) || s.tipo === "traje") return "Vestuário";
	if (/ferrament|instrument/.test(p) || s.tipo === "ferramenta") return "Ferramentas";
	if (/esot/.test(p) || s.tipo === "esoterico" || s.tipo === "material") return "Esotérico";
	if (/veicul/.test(p)) return "Veículos";
	return "Equipamento de aventura";
}

export function tipoDaCategoria(categoria) {
	return ESTRUTURA_LOJA.find((t) => t.categorias.includes(categoria))?.tipo ?? "Itens gerais";
}

/** Nome da pasta de primeiro nível de um documento de compêndio. */
function pastaRaiz(doc, pack) {
	let f = doc.folder ?? null;
	if (typeof f === "string") f = pack?.folders?.get(f) ?? null;
	while (f?.folder) f = typeof f.folder === "string" ? pack?.folders?.get(f.folder) : f.folder;
	return f?.name ?? "Outros";
}

/** Nome completo das pastas (todos os níveis), para reconhecer pastas de itens mágicos aninhadas. */
function caminhoPastas(doc, pack) {
	const nomes = [];
	let f = doc.folder ?? null;
	if (typeof f === "string") f = pack?.folders?.get(f) ?? null;
	while (f) {
		nomes.unshift(f.name);
		f = typeof f.folder === "string" ? pack?.folders?.get(f.folder) : f.folder;
	}
	return nomes.join(" / ");
}

let cache = null;
let emAndamento = null;

export function invalidarCatalogo() {
	cache = null;
	emAndamento = null;
}

/**
 * Carrega o catálogo (uma vez por sessão). Cada entrada: { uuid, doc, categoria, tipo, pacote, fonte }.
 * pacote: quantos itens vêm por compra (ex.: flechas ×20); o preço do compêndio é o do pacote.
 */
export async function carregarCatalogo() {
	if (cache) return cache;
	emAndamento ??= montar().then((c) => (cache = c)).catch((err) => {
		emAndamento = null;
		throw err;
	});
	return emAndamento;
}

async function montar() {
	const itens = [];
	const nomes = new Set();
	const entrada = (doc, categoria, fonte) => {
		if (!categoria || !(Number(doc.system?.preco) > 0)) return;
		nomes.add(normalizar(doc.name));
		itens.push({
			uuid: doc.uuid, doc, categoria, tipo: tipoDaCategoria(categoria),
			pacote: Math.max(1, Number(doc.system?.qtd) || 1), fonte
		});
	};

	const pack = game.packs.get(PACK_SISTEMA);
	if (pack) {
		for (const doc of await pack.getDocuments()) {
			const pasta = pastaRaiz(doc, pack);
			if (FORA_DA_LOJA.has(pasta) || !TIPOS_FISICOS.has(doc.type)) continue;
			entrada(doc, categoriaSistema(doc, pasta), null);
		}
	} else {
		console.warn(`${MODULE_ID} | compêndio ${PACK_SISTEMA} não encontrado`);
	}

	// Suplementos de Arton: itens comuns (sem os mágicos); em nomes repetidos vale o do livro básico
	if (game.settings.get(MODULE_ID, "suplementos") && game.modules.get(SUPLEMENTO_ID)?.active) {
		for (const p of game.packs.filter((p) => p.metadata.packageName === SUPLEMENTO_ID && p.documentName === "Item")) {
			for (const doc of await p.getDocuments()) {
				if (!TIPOS_FISICOS.has(doc.type) || nomes.has(normalizar(doc.name))) continue;
				const caminho = caminhoPastas(doc, p);
				if (PASTAS_FORA_SUPLEMENTO.test(caminho)) continue;
				entrada(doc, categoriaGenerica(doc, caminho), p.metadata.label);
			}
		}
	}

	itens.sort((a, b) => a.doc.name.localeCompare(b.doc.name, "pt-BR"));
	const porUuid = new Map(itens.map((i) => [i.uuid, i]));
	const porNome = new Map();
	for (const i of itens) if (!porNome.has(normalizar(i.doc.name))) porNome.set(normalizar(i.doc.name), i);
	return { itens, porUuid, porNome };
}

/** Resumo de um item para cards e painel de detalhes: { sub, stats }. */
export function fichaItem(doc) {
	const s = doc.system ?? {};
	const stats = [];
	const nomesProf = { simples: "Simples", marcial: "Marcial", exotica: "Exótica", fogo: "Fogo" };
	const nomesEmp = { leve: "Leve", uma: "Uma mão", duas: "Duas mãos" };
	if (doc.type === "arma") {
		const dano = s.rolls?.find?.((r) => r.type === "dano")?.parts?.[0];
		if (dano?.[0]) {
			const tipo = dano[1] ? game.i18n.localize(CONFIG.T20?.damageTypes?.[dano[1]] ?? dano[1]).toLowerCase() : "";
			stats.push(["Dano", `${dano[0]}${tipo ? ` ${tipo}` : ""}`]);
		}
		if (s.criticoM || s.criticoX) stats.push(["Crítico", `${s.criticoM && s.criticoM < 20 ? `${s.criticoM}/` : ""}x${s.criticoX ?? 2}`]);
		if (s.alcance && s.alcance !== "-") stats.push(["Alcance", s.alcance]);
		if (s.proficiencia) stats.push(["Proficiência", nomesProf[s.proficiencia] ?? s.proficiencia]);
		if (s.empunhadura) stats.push(["Empunhadura", nomesEmp[s.empunhadura] ?? s.empunhadura]);
	}
	if (s.armadura?.value) {
		stats.push(["Defesa", `+${s.armadura.value}`]);
		if (s.armadura.penalidade) stats.push(["Penalidade", `${s.armadura.penalidade}`]);
	}
	if (s.espacos) stats.push(["Espaços", `${s.espacos}`]);
	const sub = stats.filter(([k]) => ["Dano", "Crítico", "Defesa", "Penalidade"].includes(k)).map(([, v]) => v).join(" · ");
	return { sub, stats };
}
