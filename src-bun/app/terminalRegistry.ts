import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type {
	TerminalCreateParams,
	TerminalEventPayload,
	TerminalSummary,
} from "../rpc";
import { AppError } from "./errors";
import { log } from "./logging";

type TerminalStatus = TerminalSummary["status"];

interface TerminalEntry {
	id: string;
	title: string;
	cwd: string;
	sessionId?: string;
	shell: string;
	args: string[];
	status: TerminalStatus;
	createdAt: string;
	proc: Bun.Subprocess;
	terminal: NonNullable<Bun.Subprocess["terminal"]>;
	cols: number;
	rows: number;
	outputQueue: string[];
	flushTimer: ReturnType<typeof setTimeout> | null;
	exitCode?: number | null;
	signal?: string | null;
}

type EmitTerminal = (payload: TerminalEventPayload) => void;

const OUTPUT_FLUSH_MS = 8;
const MAX_QUEUED_CHUNKS = 256;

function commandExists(command: string): boolean {
	if (command.includes("\\") || command.includes("/")) return existsSync(command);
	const lookup = process.platform === "win32" ? "where.exe" : "which";
	const result = Bun.spawnSync([lookup, command], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return result.exitCode === 0;
}

function defaultShell(): { shell: string; args: string[] } {
	if (process.platform === "win32") {
		if (commandExists("pwsh.exe")) return { shell: "pwsh.exe", args: ["-NoLogo"] };
		if (commandExists("powershell.exe")) {
			return { shell: "powershell.exe", args: ["-NoLogo"] };
		}
		return { shell: "cmd.exe", args: ["/d", "/q"] };
	}
	const shell = process.env.SHELL;
	if (shell && existsSync(shell)) return { shell, args: [] };
	if (commandExists("bash")) return { shell: "bash", args: [] };
	return { shell: "sh", args: [] };
}

function toSummary(entry: TerminalEntry): TerminalSummary {
	return {
		id: entry.id,
		title: entry.title,
		cwd: entry.cwd,
		shell: entry.shell,
		args: entry.args,
		status: entry.status,
		createdAt: entry.createdAt,
		cols: entry.cols,
		rows: entry.rows,
		...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
		...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
		...(entry.signal !== undefined ? { signal: entry.signal } : {}),
	};
}

export class TerminalRegistry {
	private readonly entries = new Map<string, TerminalEntry>();

	constructor(private readonly emit: EmitTerminal) {}

	create(params: TerminalCreateParams): TerminalSummary {
		const id = randomUUID();
		const cwd = params.cwd?.trim() || process.cwd();
		const profile = defaultShell();
		const shell = params.shell?.trim() || profile.shell;
		const args = params.args ?? profile.args;
		const title = params.title?.trim() || shell.split(/[\\/]/).pop() || "Terminal";
		const cols = Math.max(10, Math.floor(params.cols ?? 80));
		const rows = Math.max(3, Math.floor(params.rows ?? 24));
		const createdAt = new Date().toISOString();
		let entry: TerminalEntry;
		try {
			const proc = Bun.spawn([shell, ...args], {
				cwd,
				env: {
					...process.env,
					TERM: "xterm-256color",
				},
				terminal: {
					cols,
					rows,
					name: "xterm-256color",
					data: (_terminal, data) => {
						this.enqueueOutput(id, Buffer.from(data).toString("utf8"));
					},
					exit: (_terminal, exitCode, signal) => {
						this.markExited(id, exitCode, signal);
					},
				},
				onExit: (_proc, exitCode, signalCode, error) => {
					if (error) {
						log.warn("terminal child exited with error", {
							terminalId: id,
							error: error.message,
						});
					}
					this.markExited(id, exitCode, signalCode);
				},
			});
			if (!proc.terminal) throw new Error("Bun did not return a terminal handle");
			entry = {
				id,
				title,
				cwd,
				...(params.sessionId ? { sessionId: params.sessionId } : {}),
				shell,
				args,
				status: "running",
				createdAt,
				proc,
				terminal: proc.terminal,
				cols,
				rows,
				outputQueue: [],
				flushTimer: null,
			};
		} catch (err) {
			throw AppError.sdk(err instanceof Error ? err.message : String(err));
		}
		this.entries.set(id, entry);
		const summary = toSummary(entry);
		this.emit({ terminalId: id, kind: "status", summary });
		log.info("terminal created", { terminalId: id, shell, cwd });
		return summary;
	}

	list(): TerminalSummary[] {
		return [...this.entries.values()].map(toSummary);
	}

	write(id: string, data: string): boolean {
		const entry = this.entries.get(id);
		if (!entry || entry.status !== "running") return false;
		entry.terminal.write(data);
		return true;
	}

	resize(id: string, cols: number, rows: number): boolean {
		const entry = this.entries.get(id);
		if (!entry || entry.status === "exited" || entry.status === "failed") return false;
		const nextCols = Math.max(10, Math.floor(cols));
		const nextRows = Math.max(3, Math.floor(rows));
		entry.cols = nextCols;
		entry.rows = nextRows;
		entry.terminal.resize(nextCols, nextRows);
		this.emit({ terminalId: id, kind: "status", summary: toSummary(entry) });
		return true;
	}

	kill(id: string): boolean {
		const entry = this.entries.get(id);
		if (!entry) return false;
		if (entry.status === "running") {
			entry.status = "exiting";
			try {
				entry.proc.kill();
			} catch {
				// fall through to terminal close
			}
		}
		try {
			entry.terminal.close();
		} catch {
			// already closed
		}
		this.markExited(id, entry.exitCode ?? null, entry.signal ?? null);
		return true;
	}

	shutdownAll(): void {
		for (const id of [...this.entries.keys()]) this.kill(id);
	}

	private enqueueOutput(id: string, data: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.outputQueue.push(data);
		if (entry.outputQueue.length > MAX_QUEUED_CHUNKS) {
			entry.outputQueue.splice(0, entry.outputQueue.length - MAX_QUEUED_CHUNKS);
			entry.outputQueue.unshift("\r\n[terminal output truncated]\r\n");
		}
		if (entry.flushTimer) return;
		entry.flushTimer = setTimeout(() => this.flushOutput(id), OUTPUT_FLUSH_MS);
	}

	private flushOutput(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.flushTimer = null;
		const data = entry.outputQueue.join("");
		entry.outputQueue = [];
		if (data) this.emit({ terminalId: id, kind: "output", data });
	}

	private markExited(id: string, exitCode: number | null, signal: string | null): void {
		const entry = this.entries.get(id);
		if (!entry || entry.status === "exited") return;
		this.flushOutput(id);
		entry.status = "exited";
		entry.exitCode = exitCode;
		entry.signal = signal;
		this.emit({ terminalId: id, kind: "exit", summary: toSummary(entry) });
		log.info("terminal exited", { terminalId: id, exitCode, signal });
	}
}
