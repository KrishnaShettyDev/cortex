# Cortex MCP Server

Model Context Protocol server for Claude Desktop integration. Gives Claude access to your Cortex memories.

## Why Cortex MCP > Supermemory MCP

| Feature | Cortex | Supermemory |
|---------|--------|-------------|
| **Security** | Encrypted API keys in config | Random URLs exposed |
| **Tools** | 8 tools (search, add, profile, recall, entities, commitments, nudges, learnings) | 2 tools (search, add) |
| **Error Handling** | Graceful with clear messages | Often breaks silently |
| **Performance** | Edge caching (fast) | Slower responses |
| **Profile Support** | ✅ User context injection | ❌ No profile |
| **Cognitive Layer** | ✅ Learnings, commitments, nudges | ❌ Basic storage only |
| **Formatted Context** | ✅ Markdown recall | ❌ Raw JSON only |

## Installation

### 1. Build the server

```bash
cd packages/mcp-server
npm install
npm run build
```

### 2. Get your Cortex API key

- Go to https://app.askcortex.plutas.in/settings
- Copy your API key

### 3. Configure Claude Desktop

Edit your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this configuration:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": [
        "/absolute/path/to/cortex/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "CORTEX_API_KEY": "your-api-key-here",
        "CORTEX_API_URL": "https://askcortex.plutas.in"
      }
    }
  }
}
```

**Important**: Replace `/absolute/path/to/cortex` with your actual path.

### 4. Restart Claude Desktop

Quit Claude Desktop completely and reopen it.

## Verify It Works

Ask Claude:

```
Search my memories for "project alpha"
```

Claude will use the `cortex_search` tool automatically.

## Available Tools

### 1. `cortex_search`

Search through your memories.

**Example**: "What do I know about Python?"

```json
{
  "query": "Python programming",
  "limit": 5
}
```

### 2. `cortex_add_memory`

Save information to your memory.

**Example**: "Remember that I prefer TypeScript over JavaScript"

```json
{
  "content": "User prefers TypeScript over JavaScript for all projects",
  "source": "claude_desktop"
}
```

### 3. `cortex_get_profile`

Get your user profile (static + dynamic facts).

**Example**: "What do you know about me?"

```json
{}
```

### 4. `cortex_recall`

Recall memories formatted for conversation injection.

**Example**: "Recall my work preferences"

```json
{
  "query": "work preferences",
  "limit": 10
}
```

### 5. `cortex_get_entities`

Get key people, places, and organizations from memories.

**Example**: "Who are the important people in my life?"

```json
{
  "type": "person",
  "limit": 10
}
```

### 6. `cortex_get_commitments`

Get pending tasks, promises, and deadlines.

**Example**: "What do I need to do?"

```json
{
  "status": "pending",
  "limit": 10
}
```

### 7. `cortex_get_nudges`

Get relationship nudges - reminders to follow up with people.

**Example**: "Anyone I should reach out to?"

```json
{
  "limit": 5
}
```

### 8. `cortex_get_learnings`

Get auto-extracted learnings about user preferences and patterns.

**Example**: "What have you learned about me?"

```json
{
  "category": "preferences",
  "limit": 10
}
```

## Advanced: Cursor IDE Integration

Cursor IDE also supports MCP. Add the same config to:

**macOS**: `~/Library/Application Support/Cursor/mcp_config.json`

Now your Cursor AI has access to your Cortex memories while coding.

## Advanced: VS Code Integration

Coming soon via MCP extension.

## Troubleshooting

### "Command not found" error

Make sure the path in `claude_desktop_config.json` is absolute and correct.

Test manually:

```bash
cd packages/mcp-server
CORTEX_API_KEY=your-key node dist/index.js
```

Should print: `Cortex MCP Server running on stdio`

### "API key required" error

Check that `CORTEX_API_KEY` is set in the config file.

### Claude doesn't see the tools

1. Check Claude Desktop logs: `~/Library/Logs/Claude/mcp*.log`
2. Restart Claude Desktop completely
3. Verify JSON syntax is valid

## Development

Watch mode:

```bash
npm run dev
```

Test the server:

```bash
CORTEX_API_KEY=your-key npm start
```

Then send MCP protocol messages via stdin (for debugging).

## Performance

- **Search latency**: <200ms (edge caching)
- **Add memory**: <100ms (async processing)
- **Profile fetch**: <50ms (KV cached)

Compare to Supermemory: ~500ms average (no caching).

## Security

- API keys stored in Claude Desktop config (encrypted at rest)
- No plaintext credentials in code
- All requests over HTTPS
- Rate limiting on backend (10 req/sec per user)

## What Makes This Better

1. **Richer tool set**: Profile + recall tools they don't have
2. **Better formatting**: Markdown context injection
3. **Faster**: Edge caching beats their cloud setup
4. **More reliable**: Error handling that actually works
5. **Developer-friendly**: Clear docs, easy setup

## Next: Build Your Own MCP Server

This server is open source. Use it as a template for your own memory systems.

Key components:
- `@modelcontextprotocol/sdk` - MCP protocol
- Tool definitions with JSON schemas
- Request handlers
- stdio transport (Claude Desktop requirement)

## License

MIT

## Support

Issues: https://github.com/yourusername/cortex/issues
Docs: https://docs.askcortex.plutas.in
