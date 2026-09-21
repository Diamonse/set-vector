# Working agreements

These preferences were explicitly requested by the repository owner.

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

- The owner selected a Python library and CLI with interactive charts as the first interface for SetVector.
- Read `README.md` and `docs/architecture.md` before architectural changes. The design and `docs/implementation-plan.md` are proposals; their open questions are not settled requirements.
