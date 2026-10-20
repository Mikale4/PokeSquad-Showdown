# PokeSquad Battler on Pokémon Showdown

This is a fork of [Pokémon Showdown's server](https://github.com/smogon/pokemon-showdown) (MIT; based on its commit `9b136a8`)
for **PokeSquad Battler** ([Mikale4/PokeSquadBattler](https://github.com/Mikale4/PokeSquadBattler)).

Its format **[Gen 9] PokeSquad** plays PokeSquad Battler's own battles, run by the game's own engine: three Pokémon on the
field a side, a turn meter instead of turns (one Pokémon acts at a time), three moves each, one per slot (S1 has no cooldown,
S2 and S3 do), and the game's house rules. Lv 100; one Legendary, one Mythical, one Ultra Beast and one Paradox Pokémon, the
Item Clause. Every other format is Showdown's own, unchanged.

- `pokesquad/engine.js`: the game's engine and its translator to Showdown's battle protocol, **generated** by the game's
  build (`tools/build_engine.js` and `tools/showdown_adapter.js` there). Never edit it here: change the game, rebuild, copy.
- `server/pokesquad.ts`: loads it in a sandbox, maps species to Showdown's names, checks teams by the game's rules.
- `server/room-battle.ts`: starts a PokeSquad battle for the format instead of Showdown's simulator.
- `config/formats.ts`: the format. `config/config-example.js`: `noguestsecurity` (no login server: players pick a name),
  one process (`subprocesses: 0`), the port from `$PORT`.
- `render.yaml`: the free Render web service this runs on.

Players use the PokeSquad Showdown client ([Mikale4/PokeSquad-Showdown-Client](https://github.com/Mikale4/PokeSquad-Showdown-Client)).
Showdown's ladder never pairs two players from the same IP address: on the same Wi-Fi, challenge each other instead.
