# Astrolune Admin CLI

Admin command-line tool for `admin-api-service` built with Node.js + TypeScript.

## Features

- Fast commands for health, users, servers, logs, analytics, and webhooks
- Local config storage (`~/.astrolune/admin-cli.json`)
- Token support via config, CLI flags, or env
- Colorful table output and JSON mode for scripting

## Install

```bash
cd tools/admin-cli
npm install
npm run build
```

Run locally:

```bash
node dist/index.js --help
```

Or via package bin:

```bash
npx . --help
```

## Configuration

Set base URL and token once:

```bash
node dist/index.js config set-url http://localhost:5007
node dist/index.js auth set-token <JWT_TOKEN>
```

Or use environment variables:

- `ASTROLUNE_ADMIN_URL`
- `ASTROLUNE_ADMIN_TOKEN`
- `ASTROLUNE_AUTH_API_URL`
- `ASTROLUNE_AUTH_BROWSER_URL`

Browser auth (deeplink-like callback flow):

```bash
node dist/index.js auth login
```

This opens auth page in browser, receives callback on local `http://127.0.0.1:<port>/callback`,
validates `/api/auth/me`, and saves token only for `admin`/`super_admin` roles.

## Main commands

```bash
node dist/index.js doctor
node dist/index.js health
node dist/index.js auth login
node dist/index.js users list --take 50
node dist/index.js users id alice
node dist/index.js users id alice --id-only
node dist/index.js users ban <userId> --reason "spam" --duration 60
node dist/index.js users notify <userId> --title "Notice" --message "Please verify your email"
node dist/index.js users notify-many --ids "<id1>,<id2>" --title "Maintenance" --message "Planned restart"
node dist/index.js users notify-all --title "Maintenance" --message "Planned restart"
node dist/index.js servers trust <serverId> --score 700 --reason "manual review"
node dist/index.js logs audit --take 100
node dist/index.js analytics overview
node dist/index.js webhooks list
```

Use `--json` on any command for raw output.

Quick lookup for moderation flows:

```bash
node dist/index.js users id <username-or-display-name>
node dist/index.js users id <query> --all
node dist/index.js users id <query> --id-only
```

## Development

```bash
npm run check
npm run build
```
