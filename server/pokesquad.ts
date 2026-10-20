/**
 * PokeSquad Battler on Pokémon Showdown
 *
 * PokeSquad Battler's battles are its own: three Pokémon on the field a side, a turn meter instead of turns, S1/S2/S3 move
 * cooldowns and the game's house rules. This server runs them with the game's own engine, unchanged:
 * `pokesquad/engine.js` is generated from the game's source by its build (tools/build_engine.js in Mikale4/PokeSquadBattler),
 * the engine plus a translator that takes Showdown's battle-stream commands and answers in Showdown's battle protocol.
 * It runs in a sandbox (the game was written for a browser: these are the stand-ins it needs).
 *
 * The format is "[Gen 9] PokeSquad" (config/formats.ts); RoomBattleStream (room-battle.ts) starts a PokeSquad battle for it
 * instead of Showdown's own simulator.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { Dex, toID } from '../sim/dex';
import { Teams } from '../sim/teams';

export const FORMAT = 'gen9pokesquad';
export const isPokeSquad = (formatid: string) => toID(formatid) === FORMAT;

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

/** A PokeSquad battle, with the methods Showdown's BattleStream calls. */
export function newBattle(options: AnyObject) {
	const b = new (engine().PokeSquad.Battle)(options);
	const setPlayer = b.setPlayer.bind(b);
	b.setPlayer = (slot: string, o: AnyObject) => setPlayer(slot, {
		...o, team: (typeof o.team === 'string' ? Teams.unpack(o.team) || [] : o.team || []).map(slim),
	});
	return b;
}

/** The Stadium's rules (the game's team config), one move per slot: problems, or null. */
export function validateTeam(team: PokemonSet[] | null) {
	if (!team) return null;
	return engine().PokeSquad.validateTeam(team.map(slim));
}
