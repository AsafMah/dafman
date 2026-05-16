# Security Policy
## Supported versions
Dafman is in early development. Only the latest commit on `main` and the most recent tagged release receive security updates.
## Reporting a vulnerability
**Please do not open a public GitHub issue for security vulnerabilities.**
Report privately via [GitHub Security Advisories](https://github.com/AsafMah/dafman/security/advisories/new), or contact the maintainers through the contact email listed on the repository profile.
Include:
- A clear description of the issue.
- Reproduction steps or a proof-of-concept.
- The affected version (commit SHA or release tag).
- The impact you anticipate (data exfiltration, code execution, privilege escalation, etc.).
You should expect an acknowledgement within 72 hours. We will work with you on a fix and a coordinated disclosure timeline.
## Scope
Dafman is a desktop application that spawns the GitHub Copilot CLI subprocess and runs agent-issued tools on the user''s machine. Areas we care most about:
- Sandbox escape from tools (file system, shell, network).
- Unauthorized URL opens or OAuth flow tampering.
- Permission policy bypass.
- Secrets leaking from logs or session state on disk.
- MCP server lifecycle (process injection, untrusted config).
Issues in upstream dependencies (Tauri, the Copilot SDK, etc.) should be reported to those projects directly; we''ll coordinate where it makes sense.
## Hall of fame
Credit is given (with consent) once a fix ships.
