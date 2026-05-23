/// Session-scoped commands shared between the composer's slash-typeahead
/// menu and the global command palette. Each entry knows how to execute
/// against a target sessionId.
///
/// Why one shared list: typing `/clear` in the composer and running
/// "Clear conversation" from Ctrl+K should be the same action. Keeping
/// these in one place avoids drift between the two surfaces.
///
/// Commands listed here run locally. We only keep a slash command in
/// this shared palette/menu when Dafman has concrete UI behavior for it;
/// unknown slash text is left alone so manual SDK commands can still be
/// sent intentionally.

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
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("dafman:library-activate-tab", {
				detail: { tab: normalized },
			}),
		);
	}
	useLayoutStore().openEdgePanel("left", {
		id: "library",
		component: "library",
		tabComponent: "sidebarTab",
		title: "Library — MCP servers + Tools + Skills + Agents + Instructions",
		initialSize: 360,
		minimumSize: 320,
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
	await cmd.run(sessionId, parsed.args);
	return true;
}

export const SESSION_COMMANDS: SessionCommand[] = [
	{
		slash: "/mcp",
		label: "Open MCP Library",
		description: "Open Library to the MCP server tab.",
		icon: "pi-sitemap",
		group: "Library",
		keywords: ["server", "tools", "oauth"],
		run: () => openLibraryTab("mcp"),
	},
	{
		slash: "/skill",
		label: "Open Skills Library",
		description: "Open Library to the Skills tab. Also available as /skills.",
		icon: "pi-sparkles",
		group: "Library",
		keywords: ["skills", "library"],
		run: () => openLibraryTab("skills"),
	},
	{
		slash: "/skills",
		label: "Open Skills Library",
		description: "Open Library to the Skills tab.",
		icon: "pi-sparkles",
		group: "Library",
		keywords: ["skill", "library"],
		run: () => openLibraryTab("skills"),
	},
	{
		slash: "/agent",
		label: "Open Agents Library",
		description: "Open Library to the Agents tab.",
		icon: "pi-user",
		group: "Library",
		keywords: ["subagent", "custom agent"],
		run: () => openLibraryTab("agents"),
	},
	{
		slash: "/model",
		label: "Open model controls",
		description: "Open session details where the model selector lives.",
		icon: "pi-cpu",
		group: "Session",
		keywords: ["llm", "reasoning"],
		run: () => useLayoutStore().openSessionDetailsPanel(),
	},
	{
		slash: "/autopilot",
		label: "Toggle autopilot mode",
		description: "Toggle this session between Autopilot and Interactive.",
		icon: "pi-bolt",
		group: "Session",
		keywords: ["mode", "auto"],
		run: async (sessionId) => {
			const sessions = useSessionsStore();
			const record = sessions.sessions.find((s) => s.id === sessionId);
			const next = record?.mode === "autopilot" ? "interactive" : "autopilot";
			await sessions.setSessionMode(sessionId, next);
		},
	},
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
