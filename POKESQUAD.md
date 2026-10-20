# PokeSquad Battler on Pokémon Showdown

This is a fork of [Pokémon Showdown's server](https://github.com/smogon/pokemon-showdown) (MIT; based on its commit `9b136a8`)
for **PokeSquad Battler** ([Mikale4/PokeSquadBattler](https://github.com/Mikale4/PokeSquadBattler)).

Its format **[Gen 9] PokeSquad** plays PokeSquad Battler's own battles, run by the game's own engine: three Pokémon on the
field a side, a turn meter instead of turns (one Pokémon acts at a time), three moves each, one per slot (S1 has no cooldown,
S2 and S3 do), and the game's house rules. Lv 100; one Legendary, one Mythical, one Ultra Beast and one Paradox Pokémon, the
Item Clause. Showdown's own formats stay in the code, unlisted.

- `pokesquad/engine.js`: the game's engine and its translator to Showdown's battle protocol, **generated** by the game's
  build (`tools/build_engine.js` and `tools/showdown_adapter.js` there). Never edit it here: change the game, rebuild, copy.
- `server/pokesquad.ts`: loads it in a sandbox, maps species to Showdown's names, checks teams by the game's rules.
- `server/room-battle.ts`: starts a PokeSquad battle for the format instead of Showdown's simulator.
- `config/formats.ts`: the format, and the only one the server lists (Showdown's own stay in the file, unlisted: `AllFormats`). `config/config-example.js`: `noguestsecurity` (no login server: players pick a name),
  one process (`subprocesses: 0`), the port from `$PORT`.
- `render.yaml`: the free Render web service this runs on.
- `server/pokesquad-db.ts`: the database. Render's free plan wipes the disk whenever the server sleeps or redeploys, so with
  `DATABASE_URL` set (a free Postgres, such as Neon: its connection string goes in Render's Environment settings, never in
  this repo) the ladder lives in its `pokesquad_ladder` table (`server/ladders-local.ts` reads and writes it there; without
  `DATABASE_URL`, or while it can't be reached, the ladder stays in `config/ladders/*.tsv`). `pg` is a regular dependency for it.
- Registered names (no login server here): `pokesquad_names` keeps each registered name's password as a salted scrypt hash,
  `pokesquad_sessions` the remembered logins (SHA-256 hashes of their tokens, 30 days from last use). `server/users.ts`
  (`validateToken`) asks `checkName`: a registered name needs `/trn name,0,pspw:<URL-encoded password>` or `psst:<token>`, and
  a right one gets `|pokesquadsession|userid|token|name` back. `server/chat-plugins/pokesquad-names.ts`: `/pokesquadregister`,
  `/pokesquadpassword`, `/pokesquadforget` (the site's Register, Password and Log out send them). Without a database, or while
  it can't be reached, names are open as before.

Players use the PokeSquad Showdown client ([Mikale4/PokeSquad-Showdown-Client](https://github.com/Mikale4/PokeSquad-Showdown-Client)).
Showdown's ladder never pairs two players from the same IP address: on the same Wi-Fi, challenge each other instead.
