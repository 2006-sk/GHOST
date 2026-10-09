# LibreChat: "ask your attack data" (ClickHouse Agentic Data Stack)

LibreChat (ClickHouse's chat UI) + the official ClickHouse MCP server (`mcp/clickhouse`),
pointed at our ClickHouse Cloud `ghost.events`. This is the stack from
https://github.com/ClickHouse/agentic-data-stack, slimmed to what the demo needs
(no Langfuse, local ClickHouse or RAG).

**Safety:** MCP connects as `librechat_ro` (`readonly=2`, `GRANT SELECT ON ghost.*`
only). The model can't insert, alter or drop anything; this was verified.

## Run
```bash
cd data/librechat
./setup.sh               # writes .env from the repo-root .env (needs CLICKHOUSE_URL + CLICKHOUSE_RO_*)
docker compose up -d     # LibreChat on http://localhost:3080, MCP on 127.0.0.1:8000
```
1. Put a real `ANTHROPIC_API_KEY` in `.env` (or leave `user_provided` and paste it in the UI).
2. Open http://localhost:3080 and **Sign up**, or create a user:
   `docker compose exec librechat npm run create-user <email> <name> <username> <password> --email-verified=true`
3. **New Chat**: the default **GHOST Analyst** preset (claude-sonnet-4-6, thinking off,
   GHOST-ClickHouse MCP on) is selected automatically.
4. Ask the questions in `demo-questions.md` (rehearsed; all pass).

Don't switch to Claude 5.x models here: LibreChat 0.8.7 breaks on their between-tool
thinking blocks in multi-turn tool use (see `demo-questions.md` → Gotchas).

Schema hints for the model are in `librechat.yaml` (`serverInstructions`), so it
knows what `detected`, `rule`, `payload` labels and `run_demo` mean.

Stop: `docker compose down` (add `-v` to wipe chats/users).
