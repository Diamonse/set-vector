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

## Documentation

- Use plain document titles and focus on the technical content.
- Omit status, date, author/decider fields, and conversation history unless they serve a specific project need. Keep relevant technical limitations and unresolved requirements clear.
