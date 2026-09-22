# Repository Guidelines

## Clarify the objective

- Ask clarifying questions whenever the task objective is uncertain.
- Resolve uncertainty before making decisions or changes that depend on the answer; continue independent work when useful.

## Local commits

- Help prepare and create local Git commits using Conventional Commits.
- Use the format `<type>[optional scope][optional !]: <description>`.
- Use `feat` for features, `fix` for bug fixes, and an appropriate type such as `docs`, `refactor`, `test`, or `chore` for other changes.
- Keep descriptions concise. An explanatory body may follow a blank line.
- Mark breaking changes with `!` before the colon and explain them in the subject or body.
- Do not add commit trailers or footers, including `Co-authored-by`, `Signed-off-by`, or assistant attribution such as ChatGPT, Codex, or Astra.
- Keep commits local unless the user requests a push or publication.

## Project context

- SetVector starts with a Python library and CLI with interactive charts.
- Read `README.md` and `docs/architecture.md` before architectural changes. Resolve open release-scope decisions before implementing work that depends on them.
- Core analysis must work locally without GPT access, API keys, cloud services, telemetry, or a network connection after dependencies are installed.
- Keep any future hosted or language-model integration optional and isolated from the offline analysis path.

## Delegation

- Delegate independent, bounded work when it improves speed or review quality.
- Select each subagent's model and reasoning effort for the task: use the most capable reasoning model for architecture, numerical work, and final review; a reliable coding model for implementation; and a faster model for narrow mechanical checks.
- Give subagents non-overlapping file ownership and integrate their work through the full project checks.

## Documentation

- Use plain document titles and focus on the technical content.
- Omit status, date, author/decider fields, and conversation history unless they serve a specific project need. Keep relevant technical limitations and unresolved requirements clear.
