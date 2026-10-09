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
1. Open http://localhost:3080 and **Sign up** (local account, stored in local Mongo).
2. Pick **Anthropic** → a Claude model. First use asks for your API key
   (`ANTHROPIC_API_KEY=user_provided`; or put a real key in `.env` and `docker compose up -d`).
3. In the chat input, enable the **GHOST-ClickHouse** MCP server.
4. Ask the questions in `demo-questions.md`.

Schema hints for the model are in `librechat.yaml` (`serverInstructions`), so it
knows what `detected`, `rule`, `payload` labels and `run_demo` mean.

Stop: `docker compose down` (add `-v` to wipe chats/users).
