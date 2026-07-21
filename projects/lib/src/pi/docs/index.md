# pi

Extensions for the [pi](https://pi.dev) coding agent, shipped together as a pi package instead of three separate npm publishes.

## Usage

```sh
pi install npm:@coryrylan/tools
```

Installs to user settings (`~/.pi/agent/settings.json`) - available in every pi session. Add `-l` to install into project settings (`.pi/settings.json`) instead, which scopes the package to (and makes it shareable with) one repo:

```sh
pi install -l npm:@coryrylan/tools
```

Pi resolves the package's `pi` manifest key in `package.json`:

```json
{
  "pi": {
    "extensions": [
      "./dist/pi/greeting/index.js",
      "./dist/pi/audio-summary/index.js",
      "./dist/pi/hooks/index.js"
    ]
  }
}
```

### Cherry-picking extensions

Installing the package pulls in all three extensions by default. Use pi's package-filtering settings to load a subset - for example, only `hooks`:

```json
{
  "packages": [
    {
      "source": "npm:@coryrylan/tools",
      "extensions": ["+dist/pi/hooks/index.js"]
    }
  ]
}
```

`+path`/`-path` force-include/exclude an exact path; an omitted `extensions` key loads everything the manifest declares. See pi's own package docs for the
full filtering syntax.

## Peer dependencies

Pi bundles `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `typebox` and aliases those imports at runtime for every extension it loads. This package declares all three as optional peers with no version floor - there is nothing extra to install; the `pi` CLI itself is the runtime.

## Extensions

### `greeting`

Speaks a short random greeting through macOS `say` when a session starts, and registers a `greet` tool the agent can call directly. Audio is macOS-only; on other platforms the extension degrades to a UI notification instead of failing silently or throwing.

### `audio-summary`

After each agent turn, rephrases the final message for speech using a small model (default `spark/gemma-4-e2b`, falling back to whatever model the session is already using if that one isn't available), then:

- Strips markdown deterministically (no LLM round-trip for formatting).
- Spells out acronyms letter-by-letter so `say` doesn't mangle them.
- Clips the result to a sentence boundary under 300 characters.

`say` reads the clipped, spoken-form text aloud. If other audio is already playing, it chimes and sends a UI notification instead of talking over it. Audio output is macOS-only.

### `hooks`

Claude-Code-style lifecycle hooks, configured from a project's `.agents/hooks.json`:

| Event          | Behavior                                                       |
| -------------- | -------------------------------------------------------------- |
| `SessionStart` | Runs once when a session begins.                               |
| `PreToolUse`   | Runs before a tool call; exit code `2` blocks the call.        |
| `PostToolUse`  | Runs after a tool call; appends failure output to the result.  |
| `Stop`         | Runs when the agent stops; failures queue a follow-up message. |

Each hook matches tool names with a regex, has its own `timeout` in seconds (default 60), and receives a JSON payload on stdin describing the event. The `/hooks` command shows the active configuration or reloads it after an edit.

Example `.agents/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "command": "./scripts/check-command.sh", "timeout": 5 }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "command": "./scripts/lint-changed.sh" }]
      }
    ],
    "Stop": [{ "hooks": [{ "command": "./scripts/summarize-session.sh" }] }]
  }
}
```
