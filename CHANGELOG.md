## [Unreleased]

### Features

* add MongoDB write support (insert, update, delete, replace, findOneAnd* and runCommand), plus inline edit/delete query generation in results table

### Bug Fixes

* fix titlebar modal crashes by hardening portal targets and render guards (Query History / Schema Visualizer)

# [1.14.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.13.6...v1.14.0) (2026-05-28)


### Features

* SQLite-backed local storage for connection logs, query history, and schema cache ([#51](https://github.com/kobenguyent/KobeanSQL/issues/51)) ([3b7761b](https://github.com/kobenguyent/KobeanSQL/commit/3b7761bfe3655af354268022df0f9775f7eb2afd))

## [1.13.6](https://github.com/kobenguyent/KobeanSQL/compare/v1.13.5...v1.13.6) (2026-05-27)


### Bug Fixes

* **table:** remove fixed layout and td overflow clipping to expose full cell content ([#50](https://github.com/kobenguyent/KobeanSQL/issues/50)) ([b7ee058](https://github.com/kobenguyent/KobeanSQL/commit/b7ee0586ebf8950b4a75311fc28b3374815a74c9))

## [1.13.5](https://github.com/kobenguyent/KobeanSQL/compare/v1.13.4...v1.13.5) (2026-05-27)


### Bug Fixes

* Adjust min-width for results and data tables ([69628fb](https://github.com/kobenguyent/KobeanSQL/commit/69628fbb2ffe008bd26340c1001419afa83f7f5d))

## [1.13.4](https://github.com/kobenguyent/KobeanSQL/compare/v1.13.3...v1.13.4) (2026-05-27)


### Bug Fixes

* result table last-column clipping, SQL autocomplete fields, and auto-update install ([#49](https://github.com/kobenguyent/KobeanSQL/issues/49)) ([1100d24](https://github.com/kobenguyent/KobeanSQL/commit/1100d241a8081a6d32f5f1b0bb36165b8f3c869d))

## [1.13.3](https://github.com/kobenguyent/KobeanSQL/compare/v1.13.2...v1.13.3) (2026-05-27)


### Bug Fixes

* renderer crash on SQL queries containing unquoted LIKE patterns ([#48](https://github.com/kobenguyent/KobeanSQL/issues/48)) ([3dbd8e6](https://github.com/kobenguyent/KobeanSQL/commit/3dbd8e6434e9e4d4e704c377f010b2e47a7a5e7f))

## [1.13.2](https://github.com/kobenguyent/KobeanSQL/compare/v1.13.1...v1.13.2) (2026-05-27)


### Bug Fixes

* localization not applied to UI; add matrix and cyberpunk themes ([#47](https://github.com/kobenguyent/KobeanSQL/issues/47)) ([89ab3e6](https://github.com/kobenguyent/KobeanSQL/commit/89ab3e640ffe70d713c22963afee65fa6b46dc8d))

## [1.13.1](https://github.com/kobenguyent/KobeanSQL/compare/v1.13.0...v1.13.1) (2026-05-27)


### Bug Fixes

* quit app after installer handoff to eliminate dual-instance on update ([#46](https://github.com/kobenguyent/KobeanSQL/issues/46)) ([ca8e01c](https://github.com/kobenguyent/KobeanSQL/commit/ca8e01c85bfb7010e9bb9a2fbe3aca9c312967ca))

# [1.13.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.12.3...v1.13.0) (2026-05-27)


### Features

* inline cell edit actions, bulk row operations, and long-cell previews ([#44](https://github.com/kobenguyent/KobeanSQL/issues/44)) ([5263040](https://github.com/kobenguyent/KobeanSQL/commit/5263040d0aeb409e143944722d48916b5b564ab3))

## [1.12.3](https://github.com/kobenguyent/KobeanSQL/compare/v1.12.2...v1.12.3) (2026-05-26)


### Bug Fixes

* force-refresh release assets when downloadUrl is absent from cache ([#43](https://github.com/kobenguyent/KobeanSQL/issues/43)) ([6043602](https://github.com/kobenguyent/KobeanSQL/commit/604360262f139bf70446e22b4715f758c2889f99))

## [1.12.2](https://github.com/kobenguyent/KobeanSQL/compare/v1.12.1...v1.12.2) (2026-05-26)


### Bug Fixes

* tooltip viewport clipping, schema visualizer button targets, data table column resizing ([#42](https://github.com/kobenguyent/KobeanSQL/issues/42)) ([95b0444](https://github.com/kobenguyent/KobeanSQL/commit/95b04447af773205a1c5de6f93173720744598f0))

## [1.12.1](https://github.com/kobenguyent/KobeanSQL/compare/v1.12.0...v1.12.1) (2026-05-26)


### Bug Fixes

* show correct connection state when pool closes unexpectedly ([#41](https://github.com/kobenguyent/KobeanSQL/issues/41)) ([10a4a5f](https://github.com/kobenguyent/KobeanSQL/commit/10a4a5fc57d01fa50728ef8bc6ed3dedc5055974))

# [1.12.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.11.0...v1.12.0) (2026-05-26)


### Features

* in-app update downloads and language selector in settings ([#39](https://github.com/kobenguyent/KobeanSQL/issues/39)) ([cf4dbd1](https://github.com/kobenguyent/KobeanSQL/commit/cf4dbd1240df38d9459595754e22484174e2534c))

# [1.11.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.10.0...v1.11.0) (2026-05-26)


### Features

* MySQL default, icon branding, category autocomplete, theme persistence, i18n, SQL templates, local LLM selection ([#38](https://github.com/kobenguyent/KobeanSQL/issues/38)) ([9cf5a95](https://github.com/kobenguyent/KobeanSQL/commit/9cf5a95fe96190553083a81ef38e887fc4c39cd4))

# [1.10.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.9.1...v1.10.0) (2026-05-25)


### Features

* **ux:** align save behavior and empty-state guardrails ([#37](https://github.com/kobenguyent/KobeanSQL/issues/37)) ([61ba75a](https://github.com/kobenguyent/KobeanSQL/commit/61ba75a8027e764677831a27acedd33d934e98b6))

## [1.9.1](https://github.com/kobenguyent/KobeanSQL/compare/v1.9.0...v1.9.1) (2026-05-25)


### Bug Fixes

* Harden Electron main-process trust boundaries for navigation, external URLs, and IPC ([#36](https://github.com/kobenguyent/KobeanSQL/issues/36)) ([20aafb4](https://github.com/kobenguyent/KobeanSQL/commit/20aafb4e312a508bcbe859fbebbbce327c4c4afb))

# [1.9.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.8.2...v1.9.0) (2026-05-25)


### Features

* Add lightweight Electron update-check service with persisted settings, IPC surface, and in-app notifications ([#35](https://github.com/kobenguyent/KobeanSQL/issues/35)) ([34301e0](https://github.com/kobenguyent/KobeanSQL/commit/34301e0e4961af5d0f508e6736e5df7add77125e))

## [1.8.2](https://github.com/kobenguyent/KobeanSQL/compare/v1.8.1...v1.8.2) (2026-05-25)


### Bug Fixes

* Refresh GitHub Pages docs to reflect current KobeanSQL feature set and privacy model ([#34](https://github.com/kobenguyent/KobeanSQL/issues/34)) ([9cc6082](https://github.com/kobenguyent/KobeanSQL/commit/9cc6082636750086d9f09d91e44aac94c6e59dbf))

## [1.8.1](https://github.com/kobenguyent/KobeanSQL/compare/v1.8.0...v1.8.1) (2026-05-25)


### Bug Fixes

* Refresh README with live app flow screenshots and current feature coverage ([#33](https://github.com/kobenguyent/KobeanSQL/issues/33)) ([6d7982c](https://github.com/kobenguyent/KobeanSQL/commit/6d7982c511a42d22af37f948dec7383b217d3daa))

# [1.8.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.7.1...v1.8.0) (2026-05-24)


### Features

* improve query tab naming and unsaved close flow ([#32](https://github.com/kobenguyent/KobeanSQL/issues/32)) ([b9fe4f4](https://github.com/kobenguyent/KobeanSQL/commit/b9fe4f47cf3b158a59d6b6715fa9229832897709))
* **ui:** add real database logos to connection modal type selector ([#31](https://github.com/kobenguyent/KobeanSQL/issues/31)) ([87568e6](https://github.com/kobenguyent/KobeanSQL/commit/87568e6eb3f50b0ffcb104b099a6b604eb7b0ca9))

## [1.7.1](https://github.com/kobenguyent/KobeanSQL/compare/v1.7.0...v1.7.1) (2026-05-24)


### Bug Fixes

* **branding:** integrate official KobeanSQL logos across app and docs ([#30](https://github.com/kobenguyent/KobeanSQL/issues/30)) ([e469eb7](https://github.com/kobenguyent/KobeanSQL/commit/e469eb70a870283c23828408a7f3a7fa9f618ea8))

# [1.7.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.6.1...v1.7.0) (2026-05-24)


### Features

* **connection:** support database URI/URL connection strings ([#28](https://github.com/kobenguyent/KobeanSQL/issues/28)) ([b6e863e](https://github.com/kobenguyent/KobeanSQL/commit/b6e863e535036759a067470be9eb0d7eb7883795))

## [1.6.1](https://github.com/kobenguyent/KobeanSQL/compare/v1.6.0...v1.6.1) (2026-05-24)


### Bug Fixes

* **sidebar:** prevent header tooltip overlap and clipping ([#26](https://github.com/kobenguyent/KobeanSQL/issues/26)) ([dd87e42](https://github.com/kobenguyent/KobeanSQL/commit/dd87e42afae6810789ba54b2d24243596e150470))

# [1.6.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.5.0...v1.6.0) (2026-05-24)


### Features

* Database Schema Visualizer with interactive ER diagram ([#25](https://github.com/kobenguyent/KobeanSQL/issues/25)) ([22c55ef](https://github.com/kobenguyent/KobeanSQL/commit/22c55ef0103aaa52a0f06e6296257ce3f11f2c80))

# [1.5.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.4.2...v1.5.0) (2026-05-23)


### Features

* Add local AI provider abstraction (Ollama + OpenAI-compatible) and introduce KobeanSQL SQL DSL ([#24](https://github.com/kobenguyent/KobeanSQL/issues/24)) ([6576551](https://github.com/kobenguyent/KobeanSQL/commit/6576551f7da0f2352538604b5c27906b6b8f525c))

## [1.4.2](https://github.com/kobenguyent/KobeanSQL/compare/v1.4.1...v1.4.2) (2026-05-23)


### Bug Fixes

* Update README.md ([f2940b4](https://github.com/kobenguyent/KobeanSQL/commit/f2940b42a60377285f3931b7d81d629d6315cbd7))

## [1.4.1](https://github.com/kobenguyent/KobeanSQL/compare/v1.4.0...v1.4.1) (2026-05-23)


### Bug Fixes

* Rename project identity from PrismSQL to KobeanSQL across app, packaging, and docs ([#23](https://github.com/kobenguyent/KobeanSQL/issues/23)) ([94ae8bd](https://github.com/kobenguyent/KobeanSQL/commit/94ae8bdaa596cc060f3b4268c9c7381a8d67e982))

# [1.4.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.3.0...v1.4.0) (2026-05-23)


### Features

* Add local-only Ollama AI workflow, SQL beautify, secure connection import/export, and structured diagnostics ([#22](https://github.com/kobenguyent/KobeanSQL/issues/22)) ([0a5df6b](https://github.com/kobenguyent/KobeanSQL/commit/0a5df6b0292cd608db3b9c1b7fdd8a4a4e124fe6))

# [1.3.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.2.2...v1.3.0) (2026-05-23)


### Features

* cell viewer, inline editing, connection info, settings, query history ([#19](https://github.com/kobenguyent/KobeanSQL/issues/19)) ([3513887](https://github.com/kobenguyent/KobeanSQL/commit/351388720d2279f86b80a25a1aabf6f8312264cc))

## [1.2.2](https://github.com/kobenguyent/KobeanSQL/compare/v1.2.1...v1.2.2) (2026-05-22)


### Bug Fixes

* connection error handling and status bar persistence ([f6dc441](https://github.com/kobenguyent/KobeanSQL/commit/f6dc4417800a59842676f884c516873f9bbcc7bf))
* semantic-release not triggering on GitHub merge commits ([0bc1316](https://github.com/kobenguyent/KobeanSQL/commit/0bc131666f21680a2d9371bf1a2d0482e8fa3066))
* sidebar resize layout and add knowledge graph ([e6c80dc](https://github.com/kobenguyent/KobeanSQL/commit/e6c80dcd4c6f1ee5524b4986bcc15c56a73907e5))

## [1.2.1](https://github.com/kobenguyent/KobeanSQL/compare/v1.2.0...v1.2.1) (2026-05-22)


### Bug Fixes

* address sidebar/category review feedback ([ca257a8](https://github.com/kobenguyent/KobeanSQL/commit/ca257a8e264a6d728ce167e07f39e396d4ff8cc2))
* harden saved query rename interactions ([9e86c6f](https://github.com/kobenguyent/KobeanSQL/commit/9e86c6fdd5849ba8d01196716dc42b1bc3d7040b))
* trim categories on save and improve rename logging ([603767e](https://github.com/kobenguyent/KobeanSQL/commit/603767e497d895b62152904dc73cc9778f7f49ae))

# [1.2.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.1.0...v1.2.0) (2026-05-22)


### Bug Fixes

* address code review — JSX data-tooltip ampersand, release workflow comment ([681ab84](https://github.com/kobenguyent/KobeanSQL/commit/681ab84530b4621aa966906422b72a2ed79f8dc6))


### Features

* a11y theme fixes, flash screen, version injection, privacy info, docs ([e85ac51](https://github.com/kobenguyent/KobeanSQL/commit/e85ac514df1ce0e96009a2cae3e9710b0357527d))

# [1.1.0](https://github.com/kobenguyent/KobeanSQL/compare/v1.0.0...v1.1.0) (2026-05-22)


### Bug Fixes

* code review issues - safe pop, use hook for theme, fix openSavedQuery connectionId ([16a75a1](https://github.com/kobenguyent/KobeanSQL/commit/16a75a1652b065daa0748ad7622c4498d4fb51c2))
* qualify table name with database when schema is absent (information_schema) ([190038d](https://github.com/kobenguyent/KobeanSQL/commit/190038def1ae0b33fd354df7082e3d27ad9dd75c))


### Features

* themes, saved queries, SQL autocomplete, single-row horizontal view ([4d4c053](https://github.com/kobenguyent/KobeanSQL/commit/4d4c053b96183a72a4284c00c070210514ab211c))

# 1.0.0 (2026-05-22)


### Bug Fixes

* add CSC_FOR_PULL_REQUEST to enable ad-hoc signing in macOS PR builds ([386db98](https://github.com/kobenguyent/KobeanSQL/commit/386db98fd2b7460419f1a9ae50cce26caf9e44d6))
* add GH_TOKEN env var to build step in CI workflow ([1292392](https://github.com/kobenguyent/KobeanSQL/commit/1292392f0e48048932dd0f1f0c94161269342ea9))
* address code review - dialect-aware SQL, identifier quoting, procedure stubs, Postgres specificName, getProcedures tests ([38d90b6](https://github.com/kobenguyent/KobeanSQL/commit/38d90b681963b9c4e1715e56cd7f7e95e0dcc5ef))
* address code review issues - procedure tab, unused params ([2351e2e](https://github.com/kobenguyent/KobeanSQL/commit/2351e2edf83dcbe56923c9680c1641c5056ea564))
* call enableMapSet() for Immer Set support; show name-required error inline in modal ([0dcd6de](https://github.com/kobenguyent/KobeanSQL/commit/0dcd6de983ea9335bfafc31ccb6045ac1fede18e))
* disable macOS code signing and document Gatekeeper workaround ([985950b](https://github.com/kobenguyent/KobeanSQL/commit/985950bf5c180335b9a9140379cf824b1c933e0f))
* encrypt passwords with safeStorage, add dep to handleSave, add xattr note ([a03f3fb](https://github.com/kobenguyent/KobeanSQL/commit/a03f3fb9ffac5646aa64ad39a81763709613d550))
* set CSC_FOR_PULL_REQUEST to true only for macOS, empty string otherwise ([597ac9e](https://github.com/kobenguyent/KobeanSQL/commit/597ac9e42173dc0ee83fe7ff26ca3a612bfa5f81))
* store passwords, surface connect errors, add macOS xattr note ([695b0fd](https://github.com/kobenguyent/KobeanSQL/commit/695b0fdeb613e1e0fe6b65ce7eb21cdf069f5f59))
* switch MySQL adapter to pool, add per-column filters, add semantic-release ([e3cfedf](https://github.com/kobenguyent/KobeanSQL/commit/e3cfedf91cc2c7a62ea16a546e509a406737c448))
* use ad-hoc signing for macOS to resolve "damaged app" Gatekeeper error ([41c65b8](https://github.com/kobenguyent/KobeanSQL/commit/41c65b8d9f17035de0f450485fa760832c4a7365))


### Features

* add procedures support, search in sidebar, click-to-open-results ([4975085](https://github.com/kobenguyent/KobeanSQL/commit/49750855375b2ae5070cd72becb85d1dd02254c1))
