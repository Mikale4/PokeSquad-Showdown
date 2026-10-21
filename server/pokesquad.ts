/**
 * PokeSquad Battler on Pokémon Showdown
 *
 * PokeSquad Battler's battles are its own: three Pokémon on the field a side, a turn meter instead of turns, S1/S2/S3 move
 * cooldowns and the game's house rules. This server runs them with the game's own engine, unchanged:
 * `pokesquad/engine.js` is generated from the game's source by its build (tools/build_engine.js in Mikale4/PokeSquadBattler),
 * the engine plus a translator that takes Showdown's battle-stream commands and answers in Showdown's battle protocol.
 * It runs in a sandbox (the game was written for a browser: these are the stand-ins it needs).
 *
 * The formats are "[Gen 9] PokeSquad" and its two Random Battles (config/formats.ts); RoomBattleStream (room-battle.ts) starts a
 * PokeSquad battle for them instead of Showdown's own simulator. A Random Battle's teams come from pools the game's own team builder
 * makes ahead of time (pokesquad/random-teams.json and random-trainer-teams.json, from tools/build_random_teams.js in
 * Mikale4/PokeSquadBattler): each player gets one, drawn by the battle's seed.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { Dex, toID } from '../sim/dex';
import { Teams } from '../sim/teams';

export const FORMAT = 'gen9pokesquad';
/** The Random Battles: each format's pool of teams */
export const RANDOM_FORMATS: { [formatid: string]: string } = {
	gen9pokesquadrandombattle: 'random-teams.json',
	gen9pokesquadrandomtrainerbattle: 'random-trainer-teams.json',
};
export const isPokeSquad = (formatid: string) => toID(formatid) === FORMAT || toID(formatid) in RANDOM_FORMATS;

let ctx: AnyObject | null = null;
function engine(): AnyObject {
	if (ctx) return ctx;
	const file = [path.resolve(__dirname, '../../pokesquad/engine.js'), path.resolve(__dirname, '../pokesquad/engine.js')]
		.find(f => fs.existsSync(f));
	if (!file) throw new Error(`PokeSquad: no pokesquad/engine.js (build it with the game's tools/build_engine.js)`);
	const dummy = (): any => new Proxy(function () {}, {
		get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : dummy(),
		apply: () => dummy(), construct: () => dummy(), set: () => true,
	});
	const blank = () => new Proxy({} as AnyObject, { get: (t, k: string) => t[k] || (t[k] = {}) });
	const c: AnyObject = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, performance, Math, JSON, Date, URLSearchParams,
		document: dummy(), localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
		navigator: { userAgent: 'node' }, location: { search: '', href: '' },
		RES_DATA: blank(), SPR_DATA: blank(), Image() {}, Audio() {}, requestAnimationFrame: () => 0,
		matchMedia: () => ({ matches: false, addEventListener() {} }),
	};
	c.window = c; c.globalThis = c; c.self = c;
	vm.createContext(c);
	vm.runInContext(fs.readFileSync(file, 'utf8'), c, { filename: 'pokesquad/engine.js' });
	vm.runInContext('TEXT_TOKENS = true', c);
	// species: the game's keys and Showdown's names (the client finds its sprites by them)
	const ops: AnyObject = vm.runInContext('OPS', c), names: { [k: string]: string } = {}, keys: { [id: string]: string } = {};
	for (const k in ops) {
		const sp = Dex.species.get(k);
		names[k] = sp.exists ? sp.name : ops[k].n;
		keys[toID(names[k])] = k; keys[k] = k;
	}
	c.PokeSquad.setNames({
		name: (k: string) => names[k] || (ops[k] ? ops[k].n : k),
		key: (s: string) => keys[toID(s)] || keys[toID(Dex.species.get(s).name)] || null,
	});
	ctx = c;
	return c;
}

const slim = (s: PokemonSet) => ({ name: s.name, species: s.species, item: s.item, ability: s.ability, nature: s.nature, moves: s.moves });

type PoolTeam = { name: string, team: PokemonSet[] };
const pools: { [file: string]: PoolTeam[] } = {};
function pool(file: string): PoolTeam[] {
	if (pools[file]) return pools[file];
	const f = [path.resolve(__dirname, '../../pokesquad', file), path.resolve(__dirname, '../pokesquad', file)].find(x => fs.existsSync(x));
	return (pools[file] = f ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
}
/** Which plan a Random Battle team is (its pool's name for it: "Random" for six random Pokémon), from its species' ids */
export function poolPlan(species: string) {
	for (const file of Object.values(RANDOM_FORMATS)) {
		const t = pool(file).find(x => x.team.map(s => toID(s.species)).sort().join() === species);
		if (t) return t.name;
	}
	return '';
}
/** A Random Battle team: one from its format's pool, by the battle's seed (the same battle draws the same teams; never both the same) */
export function randomTeam(formatid: string, seed: unknown, slot: string): PokemonSet[] {
	const teams = pool(RANDOM_FORMATS[toID(formatid)] || '');
	if (!teams.length) return [];
	const index = (side: string) => {
		const key = `${Array.isArray(seed) ? seed.join(',') : String(seed)}:${side}`;
		let h = 7;
		for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
		// (mixed, so the two sides' draws don't sit next to each other in the pool)
		h = Math.imul((h ^ (h >>> 16)) >>> 0, 0x45d9f3b) >>> 0;
		h = (h ^ (h >>> 16)) >>> 0;
		return h % teams.length;
	};
	let i = index(slot);
	if (slot === 'p2' && i === index('p1')) i = (i + 1) % teams.length;
	return teams[i].team;
}

/** A PokeSquad battle, with the methods Showdown's BattleStream calls. */
export function newBattle(options: AnyObject) {
	const b = new (engine().PokeSquad.Battle)(options);
	const setPlayer = b.setPlayer.bind(b);
	b.setPlayer = (slot: string, o: AnyObject) => {
		let team: PokemonSet[] = typeof o.team === 'string' ? Teams.unpack(o.team) || [] : o.team || [];
		// (a Random Battle's team, drawn by the battle's own seed: the battle keeps it in its input log)
		if (!team.length && RANDOM_FORMATS[toID(options.formatid)]) team = randomTeam(options.formatid, b.seed, slot);
		return setPlayer(slot, { ...o, team: team.map(slim) });
	};
	return b;
}

/** The game's own data for /dt (server/chat-plugins/pokesquad-data.ts): a Pokémon, move, Ability or held item, or null */
export function dataOf(kind: 'pokemon' | 'move' | 'ability' | 'item', q: string): AnyObject | null {
	return engine().PokeSquad.dataOf(kind, q) || null;
}

/** The Stadium's rules (the game's team config), one move per slot: problems, or null. */
export function validateTeam(team: PokemonSet[] | null) {
	if (!team) return null;
	return engine().PokeSquad.validateTeam(team.map(slim));
}
