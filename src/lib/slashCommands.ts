/// Baseline slash-command list shown in the composer typeahead when
/// the SDK hasn't emitted a `commands.changed` event yet (built-in
/// CLI commands aren't broadcast; only plugin-registered ones are).
/// Lifted from the @github/copilot CLI's command catalogue —
/// keep in rough sync with what the CLI accepts, but the SDK is
/// the ultimate arbiter at execution time (so it's OK if we list
/// one it doesn't recognize — it'll just error in chat).

export interface BuiltinSlashCommand {
	name: string;
	description?: string;
}

export const BUILTIN_SLASH_COMMANDS: BuiltinSlashCommand[] = [
	{ name: "/help", description: "Show available commands" },
	{ name: "/clear", description: "Clear the conversation" },
	{ name: "/compact", description: "Summarize and compact the history" },
	{ name: "/fork", description: "Fork this session into a new branch" },
	{ name: "/rename", description: "Rename this session" },
	{ name: "/model", description: "Switch the model" },
	{ name: "/agent", description: "Switch agents" },
	{ name: "/mcp", description: "Manage MCP servers" },
	{ name: "/skills", description: "Manage skills" },
	{ name: "/extensions", description: "Manage extensions" },
	{ name: "/tasks", description: "List background tasks" },
	{ name: "/sessions", description: "Browse sessions" },
	{ name: "/cwd", description: "Show or change the working directory" },
	{ name: "/add-dir", description: "Add a directory to context" },
	{ name: "/list-dirs", description: "List context directories" },
	{ name: "/diff", description: "Show changes from the last turn" },
	{ name: "/copy", description: "Copy the last assistant response" },
	{ name: "/undo", description: "Undo the last turn" },
	{ name: "/rewind", description: "Rewind to a previous checkpoint" },
	{ name: "/usage", description: "Show usage and limits" },
	{ name: "/version", description: "Show CLI version" },
	{ name: "/feedback", description: "Send feedback to GitHub" },
	{ name: "/logout", description: "Sign out" },
	{ name: "/exit", description: "Exit the session" },
];
