# Contributing to KobeanSQL

Thank you for your interest in contributing!

## Pull Request Titles

This project uses [Conventional Commits](https://www.conventionalcommits.org/) to drive automatic semantic versioning via [semantic-release](https://semantic-release.gitbook.io/).

**All PR titles must follow the format:**

```
<type>: <short description>
```

or with an optional scope:

```
<type>(<scope>): <short description>
```

### Valid types

| Type | When to use |
|------|-------------|
| `fix` | A bug fix (triggers a **patch** release) |
| `feat` | A new feature (triggers a **minor** release) |
| `ci` | CI/CD configuration changes |
| `chore` | Routine tasks, dependency updates, tooling |
| `docs` | Documentation-only changes |
| `refactor` | Code restructuring with no behaviour change |
| `perf` | Performance improvements |
| `test` | Adding or updating tests |

A `BREAKING CHANGE` footer or `!` suffix (e.g. `feat!: …`) triggers a **major** release.

### Examples

```
fix: prevent connection dialog from closing on network error
feat(query): add multi-tab query editor
docs: update README with new connection types
chore: bump electron to v31
```

## Merge Strategy

PRs must be merged using **squash merge** so that the squashed commit on `main` uses the PR title as its commit message. This is what semantic-release reads to determine whether to publish a new version.

In the repository settings:
- **Allow squash merging** must be enabled.
- The default commit message for squash merges must be set to **Pull request title**.

The CI workflow `.github/workflows/pr-title.yml` automatically validates that every PR title is a valid conventional commit before it can be merged.

## Documentation Updates

If your PR changes user-facing behavior, supported databases, setup steps, or screenshots, update the canonical docs surfaces together:

- `README.md`
- `docs/index.html`
- `CHANGELOG.md` (when the change is release-notable)

Before opening or merging the PR, run:

```bash
npm run docs:sync:check
```

This verifies that key product topics stay aligned between `README.md` and `docs/index.html`.
