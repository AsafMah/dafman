export type TerminalShellProtocol = "osc633" | "osc133";

export type TerminalShellEvent =
  | { kind: "commandStart"; protocol: TerminalShellProtocol }
  | { kind: "commandLine"; command: string; protocol: "osc633"; trusted: boolean }
  | { kind: "commandFinish"; exitCode?: number }
  | { kind: "cwd"; cwd: string };

export interface ParsedTerminalOsc {
  handled: boolean;
  events: TerminalShellEvent[];
}

function tryDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseExitCode(value: string): number | undefined {
  const match = value.match(/(?:^|;)(-?\d+)(?:;|$)/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOsc633(data: string, integrationNonce: string): ParsedTerminalOsc {
  const [kind = "", ...parts] = data.split(";");
  if (kind === "C") {
    return { handled: true, events: [{ kind: "commandStart", protocol: "osc633" }] };
  }
  if (kind === "D") {
    return {
      handled: true,
      events: [{ kind: "commandFinish", exitCode: parseExitCode(parts.join(";")) }],
    };
  }
  if (kind === "E") {
    const nonce = parts[parts.length - 1];
    return {
      handled: true,
      events: [
        {
          kind: "commandLine",
          command: tryDecodeUriComponent(parts.slice(0, -1).join(";")),
          protocol: "osc633",
          trusted: Boolean(integrationNonce && nonce === integrationNonce),
        },
      ],
    };
  }
  if (kind === "P") {
    const cwdPart = parts.find((part) => part.startsWith("Cwd="));
    if (cwdPart) {
      return {
        handled: true,
        events: [{ kind: "cwd", cwd: tryDecodeUriComponent(cwdPart.slice(4)) }],
      };
    }
  }
  return { handled: true, events: [] };
}

function parseOsc133(data: string): ParsedTerminalOsc {
  const [kind = "", ...parts] = data.split(";");
  if (kind === "C") {
    return { handled: true, events: [{ kind: "commandStart", protocol: "osc133" }] };
  }
  if (kind === "D") {
    return {
      handled: true,
      events: [{ kind: "commandFinish", exitCode: parseExitCode(parts.join(";")) }],
    };
  }
  return { handled: true, events: [] };
}

function parseOsc7(data: string): ParsedTerminalOsc {
  if (!data.startsWith("file://")) return { handled: true, events: [] };
  const pathname = data
    .slice("file://".length)
    .replace(/^[^/]*(\/.*)$/, "$1")
    .replace(/^\/([A-Za-z]:\/)/, "$1");
  return {
    handled: true,
    events: [{ kind: "cwd", cwd: tryDecodeUriComponent(pathname) }],
  };
}

export function parseTerminalOsc(
  ident: 7 | 9 | 133 | 633 | 1337,
  data: string,
  integrationNonce = "",
): ParsedTerminalOsc {
  if (ident === 633) return parseOsc633(data, integrationNonce);
  if (ident === 133) return parseOsc133(data);
  if (ident === 7) return parseOsc7(data);
  if (ident === 9 && data.startsWith("9;")) {
    return { handled: true, events: [{ kind: "cwd", cwd: data.slice(2) }] };
  }
  if (ident === 1337 && data.startsWith("CurrentDir=")) {
    return {
      handled: true,
      events: [{ kind: "cwd", cwd: tryDecodeUriComponent(data.slice("CurrentDir=".length)) }],
    };
  }
  return { handled: false, events: [] };
}
