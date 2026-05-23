/// Session-scoped commands shared between the composer's slash-typeahead
/// menu and the global command palette. Each entry knows how to execute
/// against a target sessionId.
///
/// Why one shared list: typing `/clear` in the composer and running
/// "Clear conversation" from Ctrl+K should be the same action. Keeping
/// these in one place avoids drift between the two surfaces.
///
/// The SDK has its OWN built-in CLI commands (/agent, /model, /mcp,
/// /skills, …) that are handled internally when the user sends a
/// message starting with "/". We don't duplicate those here — if the
/// slash menu doesn't match a typed prefix, the text just falls
/// through to `sendMessage` and the SDK's command resolver picks it up.

import { useLayoutStore } from "../stores/layoutStore";
import { useSessionsStore } from "../stores/sessionsStore";
import { useToastStore } from "../stores/toastStore";
import { invokeCommand } from "../ipc/invoke";

export interface SessionCommand {
	/// Slash form (with leading "/"). What the user types in the
	/// composer to trigger it via the typeahead.
	slash: string;
	/// Human label used by both the palette row and the slash menu's
	/// item title fallback.
	label: string;
	/// Short description for the row's secondary line.
	description: string;
	/// PrimeIcons class (e.g. `pi-eraser`). Optional — the renderer
	/// falls back to a generic glyph.
	icon?: string;
	/// Extra search corpus for the palette's fuzzy filter (the slash
	/// name + label + description are always included; this is
	/// additive). Typed synonyms go here.
	keywords?: string[];
	/// Group header in the palette.
	group: string;
	/// Execute the command against `sessionId`. May return a promise;
	/// the palette closes optimistically.
	run(sessionId: string, args?: string): void | Promise<void>;
	/// SDK-owned slash commands should appear in the composer menu but
	/// still be sent through to the CLI instead of executed locally.
	passthrough?: boolean;
}

function parseSlashCommand(text: string): { slash: string; args: string } | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return null;
	const match = trimmed.match(/^(\/\S+)(?:\s+([\s\S]*))?$/);
	if (!match) return null;
	return { slash: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

function pushLocalSystem(sessionId: string, text: string): void {
	const sessions = useSessionsStore();
	const record = sessions.sessions.find((s) => s.id === sessionId);
	if (!record) return;
	sessions.appendEvent(record, {
		sessionId,
		eventType: "system.notification",
		data: { content: text },
	});
}

const LIBRARY_TABS = new Set(["mcp", "skills", "agents", "instructions"]);

function openLibraryTab(tab = "mcp"): void {
	const normalized = LIBRARY_TABS.has(tab) ? tab : "mcp";
	try {
		localStorage.setItem("dafman.library.activeTab", normalized);
	} catch {
		/* private mode — ignore */
	}
	window.dispatchEvent(
		new CustomEvent("dafman:library-activate-tab", {
			detail: { tab: normalized },
		}),
	);
	useLayoutStore().openEdgePanel("left", {
		id: "library",
		component: "library",
		tabComponent: "sidebarTab",
		title: "Library — MCP servers + Tools + Skills + Agents + Instructions",
		initialSize: 360,
		minimumSize: 300,
		exclusive: true,
	});
}

/// Runs Dafman's local slash command when the typed text is one of
/// our registered session commands. `/cd` is handled locally because
/// Dafman owns the visible workspace chip and can resume the SDK
/// session with a new `workingDirectory`.
export async function runLocalSlashCommand(
	sessionId: string,
	text: string,
): Promise<boolean> {
	const parsed = parseSlashCommand(text);
	if (!parsed) return false;
	const cmd = SESSION_COMMANDS.find(
		(c) => c.slash.toLowerCase() === parsed.slash,
	);
	if (!cmd) return false;
	if (cmd.passthrough) return false;
	await cmd.run(sessionId, parsed.args);
	return true;
}

const SDK_PASSTHROUGH_COMMANDS: SessionCommand[] = [
	{
		slash: "/mcp",
		label: "MCP servers",
		description: "SDK command for MCP server status and management.",
		icon: "pi-sitemap",
		group: "SDK",
		keywords: ["server", "tools", "oauth"],
		passthrough: true,
		run: () => {},
	},
	{
		slash: "/skill",
		label: "Skills",
		description: "SDK skill command. Also try /skills.",
		icon: "pi-sparkles",
		group: "SDK",
		keywords: ["skills", "library"],
		passthrough: true,
		run: () => {},
	},
	{
		slash: "/skills",
		label: "Skills",
		description: "SDK command for listing and invoking skills.",
		icon: "pi-sparkles",
		group: "SDK",
		keywords: ["skill", "library"],
		passthrough: true,
		run: () => {},
	},
	{
		slash: "/agent",
		label: "Agents",
		description: "SDK command for selecting custom agents.",
		icon: "pi-user",
		group: "SDK",
		keywords: ["subagent", "custom agent"],
		passthrough: true,
		run: () => {},
	},
	{
		slash: "/model",
		label: "Model",
		description: "SDK command for switching model from the CLI.",
		icon: "pi-cpu",
		group: "SDK",
		keywords: ["llm", "reasoning"],
		passthrough: true,
		run: () => {},
	},
	{
		slash: "/autopilot",
		label: "Toggle autopilot",
		description: "SDK command for toggling CLI autopilot mode.",
		icon: "pi-bolt",
		group: "SDK",
		keywords: ["mode", "auto"],
		passthrough: true,
		run: () => {},
	},
];

export const SESSION_COMMANDS: SessionCommand[] = [
	...SDK_PASSTHROUGH_COMMANDS,
	{
		slash: "/compact",
		label: "Compact conversation history",
		description: "Summarize older messages to free up the context window.",
		icon: "pi-database",
		group: "Session",
		keywords: ["summarize", "history", "context", "tokens"],
		run: async (sessionId) => {
			const sessions = useSessionsStore();
			await sessions.compactSessionHistory(sessionId);
		},
	},
	{
		slash: "/fork",
		label: "Fork session here",
		description: "Branch this conversation into a new session.",
		icon: "pi-share-alt",
		group: "Session",
		keywords: ["branch", "copy", "split"],
		run: async (sessionId) => {
			const sessions = useSessionsStore();
			const layout = useLayoutStore();
			const newId = await sessions.forkSession(sessionId);
			layout.addPanel(newId);
			layout.activatePanel(newId);
		},
	},
	{
		slash: "/rename",
		label: "Rename session",
		description: "Set a custom title for this session.",
		icon: "pi-pencil",
		group: "Session",
		keywords: ["title", "name"],
		run: (sessionId) => {
			// Surface the rename popover via a window event that
			// SessionHeaderControls listens for.
			window.dispatchEvent(
				new CustomEvent("dafman:rename-session", { detail: { sessionId } }),
			);
		},
	},
	{
		slash: "/cd",
		label: "Change working directory",
		description: "Display this session's cwd. Type /cd <path> to change it.",
		icon: "pi-folder-open",
		group: "Session",
		keywords: ["workspace", "directory", "path", "change", "cwd"],
		run: async (sessionId, args = "") => {
			const sessions = useSessionsStore();
			const trimmed = args.trim();
			if (!trimmed) {
				const record = sessions.sessions.find((s) => s.id === sessionId);
				pushLocalSystem(
					sessionId,
					record?.workingDirectory
						? `Current working directory: ${record.workingDirectory}`
						: "Current working directory: default Copilot CLI process cwd",
				);
				return;
			}
			await sessions.setSessionWorkingDirectory(sessionId, trimmed);
		},
	},
	{
		slash: "/close",
		label: "Close this panel",
		description: "Remove the session's panel from the workspace (keeps history).",
		icon: "pi-times",
		group: "Session",
		keywords: ["hide", "panel", "tab"],
		run: (sessionId) => {
			const layout = useLayoutStore();
			layout.closePanel(sessionId);
		},
	},
	{
		slash: "/fleet",
		label: "Start a fleet of sub-agents",
		description: "Spawn parallel sub-agents to work on a problem (optional prompt).",
		icon: "pi-users",
		group: "Session",
		keywords: ["parallel", "subagent", "delegate", "fleet"],
		run: async (sessionId, args = "") => {
			const toasts = useToastStore();
			try {
				const prompt = args.trim();
				const started = await invokeCommand("startFleet", {
					sessionId,
					...(prompt.length > 0 ? { prompt } : {}),
				});
				if (started) {
					toasts.success(
						"Fleet started",
						prompt ? `Prompt: ${prompt.slice(0, 60)}` : "Fleet running",
					);
				} else {
					toasts.warn("Fleet not started", "SDK returned false");
				}
			} catch (err) {
				toasts.error(
					"Failed to start fleet",
					err instanceof Error ? err.message : String(err),
				);
			}
		},
	},
	{
		slash: "/library",
		label: "Open Library",
		description:
			"Open Library. Optional tab: /library mcp|skills|agents|instructions.",
		icon: "pi-book",
		group: "Navigation",
		keywords: ["mcp", "skills", "agents", "instructions", "sidebar"],
		run: (_sessionId, args = "") => {
			const tab = args.trim().split(/\s+/)[0]?.toLowerCase() || "mcp";
			openLibraryTab(tab);
		},
	},
	{
		slash: "/plan",
		label: "Create an implementation plan",
		description: "Switch to Plan mode and send a CLI-style planning prompt.",
		icon: "pi-list-check",
		group: "Session",
		keywords: ["mode", "planning", "implementation"],
		run: async (sessionId, args = "") => {
			const sessions = useSessionsStore();
			await sessions.setSessionMode(sessionId, "plan");
			const prompt = args.trim();
			if (!prompt) {
				pushLocalSystem(
					sessionId,
					"Plan mode enabled. Type your request or use /plan <request> to start a planning turn.",
				);
				return;
			}
			await sessions.sendMessage(sessionId, `[[PLAN]] ${prompt}`);
		},
	},
	{
		slash: "/?",
		label: "Show command help",
		description: "Show local and SDK slash commands.",
		icon: "pi-question-circle",
		group: "Session",
		keywords: ["commands", "list", "guide"],
		run: () => {
			const toasts = useToastStore();
			const names = SESSION_COMMANDS.map((c) => c.slash).join(", ");
			toasts.info(
				"dafman slash commands",
				`${names}. SDK commands stay editable and are sent to Copilot CLI.`,
			);
		},
	},
	{
		slash: "/help",
		label: "Show available commands",
		description: "List all slash commands this session understands.",
		icon: "pi-question-circle",
		group: "Session",
		keywords: ["commands", "list", "guide"],
		run: () => {
			const toasts = useToastStore();
			const names = SESSION_COMMANDS.map((c) => c.slash).join(", ");
			toasts.info(
				"dafman slash commands",
				`${names}. Type "/" to autocomplete; or open the command palette with Ctrl+K.`,
			);
		},
	},
];
