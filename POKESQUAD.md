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
- Shared replays: Upload and share replay (`savereplay` in `server/chat-plugins/pokesquad-names.ts`, replacing Showdown's, which
  needs its replay server) saves the battle's spectator log in `pokesquad_replays` under a random id and gives a link to the
  site's replay page (`POKESQUAD_SITE`/replay.html#id), which reads it from `GET /pokesquad-replay/<id>` (`httpResponse`, called by
  `Config.customhttpresponse` in `config/config-example.js`).
- Administrators: the names in `POKESQUAD_ADMINS` (`render.yaml`; "admin" if it isn't set) get the `~` rank once logged in
  with their password (`isAdmin`, `server/users.ts` `updateGroup`). `render.yaml` also lists `DATABASE_URL` with `sync: false`:
  its value is set by hand in Render and a Blueprint sync never touches it.

- PokeSquad Bot: `server/chat-plugins/pokesquad-bot.ts` connects to the server's own websocket a few seconds after it starts
  and logs in as PokeSquad Bot (`botToken` in `server/pokesquad-db.ts`, made fresh at each start; `server/users.ts`
  `validateToken` turns the name down for anyone else). It accepts every [Gen 9] PokeSquad challenge (`/utm` then `/accept`),
  turns down other formats, picks a random team from `pokesquad/bot-teams.json` (top Trainer teams, **generated** by the
  game's `tools/build_bot_teams.js`: never edit it here), and answers every request with `default`, which the game's engine
  plays with its own AI (the balanced one). It says which plan it brought, gg at the end, and leaves the room.

- The battle log: the engine's `RULE_LINES` (the format's clauses, as `|rule|` lines), an attack's `-damage` lines unsilenced so
  Showdown writes "(... lost 45% of its health!)", and every HP line `|split|` (exact for its own player and the full log, a
  percentage for the other player, spectators and shared replays: HP Percentage Mod).

Players use the PokeSquad Showdown client ([Mikale4/PokeSquad-Showdown-Client](https://github.com/Mikale4/PokeSquad-Showdown-Client)).
Showdown's ladder never pairs two players from the same IP address: on the same Wi-Fi, challenge each other instead.
