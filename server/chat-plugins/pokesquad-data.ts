/**
 * PokeSquad Battler: /dt and /data show the game's own data (the owner's ask, 2026-10-21), not Showdown's: each Pokémon's types,
 * base stats and Abilities; each move's type, category, power, accuracy, slot (where Showdown shows PP) and the game's text; each
 * Ability's and held item's text (Super Luck is +2 critical-hit stages here). It all comes from the game's own engine
 * (server/pokesquad.ts, dataOf); what the game doesn't have keeps Showdown's own row. The rows are Showdown's (Chat.getDataPokemonHTML
 * and the like in server/chat.ts), drawn from the game's data, without the links to Showdown's Pokédex (it has Showdown's numbers).
 */
import { Utils } from '../../lib';
import * as PokeSquad from '../pokesquad';

const esc = (s: unknown) => Utils.escapeHTML(String(s ?? ''));
const typeImg = (t: string) => `<img src="//${Config.routes.client}/sprites/types/${encodeURIComponent(t)}.png" alt="${esc(t)}" width="32" height="14">`;
const row = (inner: string) => `<ul class="utilichart"><li class="result">${inner}</li><li style="clear:both"></li></ul>`;

function pokemonHTML(species: AnyObject) {
	const d = PokeSquad.dataOf('pokemon', species.name);
	if (!d) return null;
	const [hp, atk, def, spa, spd, spe] = d.stats;
	const regular = d.abilities.filter((a: AnyObject) => !a.hidden).map((a: AnyObject) => esc(a.name));
	const hidden = d.abilities.filter((a: AnyObject) => a.hidden).map((a: AnyObject) => esc(a.name));
	let buf = `<span class="col numcol"></span> `;
	buf += `<span class="col iconcol"><psicon pokemon="${esc(species.id)}"/></span> `;
	buf += `<span class="col pokemonnamecol" style="white-space:nowrap">${esc(d.name)}</span> `;
	buf += `<span class="col typecol">${d.types.map(typeImg).join('')}</span> `;
	buf += `<span style="float:left;min-height:26px"><span class="col twoabilitycol">${regular.join('<br />')}</span>`;
	buf += `<span class="col ${hidden.length > 1 ? 'twoabilitycol' : 'abilitycol'}"><em>${hidden.join('<br />')}</em></span></span>`;
	buf += `<span style="float:left;min-height:26px">`;
	for (const [label, v] of [['HP', hp], ['Atk', atk], ['Def', def], ['SpA', spa], ['SpD', spd], ['Spe', spe]]) {
		buf += `<span class="col statcol"><em>${label}</em><br />${v}</span> `;
	}
	buf += `<span class="col bstcol"><em>BST<br />${hp + atk + def + spa + spd + spe}</em></span> </span>`;
	return `<div class="message">${row(buf)}</div>`;
}

function moveHTML(move: AnyObject, options: AnyObject) {
	const d = PokeSquad.dataOf('move', move.id);
	if (!d) return null;
	let buf = `<span class="col movenamecol">${esc(d.name)}</span> `;
	buf += `<span class="col typecol">${typeImg(d.type)}<img src="//${Config.routes.client}/sprites/categories/${d.category}.png" alt="${d.category}" width="32" height="14"></span> `;
	if (d.power) buf += `<span class="col labelcol"><em>Power</em><br>${esc(d.power)}</span> `;
	buf += `<span class="col widelabelcol"><em>Accuracy</em><br>${esc(d.accuracy)}</span> `;
	// (its slot where Showdown shows PP: S1 has no cooldown, S2 and S3 wait their cooldown between uses)
	buf += `<span class="col pplabelcol"><em>Slot</em><br>S${d.slot}</span> `;
	if (!options.hideShortDescription) {
		const extra = [d.cooldown ? `Cooldown: ${d.cooldown}.` : '', d.priority ? `Priority ${d.priority > 0 ? '+' : ''}${d.priority}.` : ''].filter(Boolean).join(' ');
		buf += `<span class="col movedesccol">${esc(d.text)}${extra ? ' ' + esc(extra) : ''}</span> `;
	}
	return row(buf);
}

function abilityHTML(ability: AnyObject, options: AnyObject) {
	const d = PokeSquad.dataOf('ability', ability.id);
	if (!d) return null;
	let buf = `<span class="col namecol">${esc(d.name)}</span> `;
	if (!options.hideShortDescription) buf += `<span class="col abilitydesccol">${esc(d.text)}</span> `;
	return row(buf);
}

function itemHTML(item: AnyObject, options: AnyObject) {
	const d = PokeSquad.dataOf('item', item.id);
	if (!d) return null;
	let buf = `<span class="col itemiconcol"><psicon item="${esc(item.id)}"></span> <span class="col namecol">${esc(d.name)}</span> `;
	if (!options.hideShortDescription) buf += `<span class="col itemdesccol">${esc(d.text)}</span> `;
	return row(buf);
}

// the game's row first, Showdown's for what the game doesn't have (each wrapped once, a hotpatch included)
const RENDER: { [fn: string]: (thing: AnyObject, options: AnyObject) => string | null } = {
	getDataPokemonHTML: pokemonHTML, getDataMoveHTML: moveHTML, getDataAbilityHTML: abilityHTML, getDataItemHTML: itemHTML,
};
for (const fn in RENDER) {
	const orig = (Chat as AnyObject)[fn];
	if (!orig || orig.pokesquad) continue;
	const wrapped = function (this: unknown, thing: AnyObject, options: AnyObject = {}) {
		try {
			const html = RENDER[fn](thing, options);
			if (html) return html;
		} catch (err: any) {
			Monitor.crashlog(err, 'PokeSquad /dt');
		}
		return orig.call(this, thing, options);
	};
	(wrapped as AnyObject).pokesquad = true;
	(Chat as AnyObject)[fn] = wrapped;
}

export const commands: Chat.ChatCommands = {};
