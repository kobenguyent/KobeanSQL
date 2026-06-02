/**
 * English (default) locale strings for KobeanSQL.
 *
 * Keys are dot-separated namespace.key paths, e.g. "sidebar.connections".
 * Add new entries here and provide matching keys in other locale files when
 * additional languages are introduced.
 */
const en = {
  // ── App-level ─────────────────────────────────────────────────
  'app.name': 'KobeanSQL',
  'app.version': 'Version',

  // ── Sidebar ───────────────────────────────────────────────────
  'sidebar.connections': 'Connections',
  'sidebar.noConnections': 'No connections',
  'sidebar.noConnectionsSub': 'Click + to add a database connection',
  'sidebar.addConnection': 'Add Connection',
  'sidebar.newConnection': 'New Connection',
  'sidebar.importConnections': 'Import Connections',
  'sidebar.exportConnections': 'Export Connections',
  'sidebar.templates': 'SQL Templates',
  'sidebar.savedQueries': 'Saved Queries',
  'sidebar.noSavedQueries': 'No saved queries yet',
  'sidebar.noSavedQueriesSub': 'Save a query from the editor using Ctrl/Cmd+S',

  // ── Connection Modal ───────────────────────────────────────────
  'connection.newTitle': 'New Connection',
  'connection.editTitle': 'Edit Connection',
  'connection.dbType': 'Database Type',
  'connection.name': 'Connection Name',
  'connection.category': 'Category (optional)',
  'connection.categoryPlaceholder': 'e.g. Production, Staging, Local…',
  'connection.method': 'Connection Method',
  'connection.manual': 'Manual',
  'connection.uri': 'Connection URI',
  'connection.host': 'Host',
  'connection.port': 'Port',
  'connection.user': 'User',
  'connection.password': 'Password',
  'connection.database': 'Database',
  'connection.file': 'Database File',
  'connection.ssl': 'Use SSL',
  'connection.color': 'Color',
  'connection.test': 'Test Connection',
  'connection.testing': 'Testing…',
  'connection.connect': 'Connect & Save',
  'connection.update': 'Update',
  'connection.connecting': 'Connecting…',
  'connection.success': 'Connected successfully',
  'connection.nameRequired': 'Connection name is required',
  'connection.uriRequired': 'Connection URI is required',

  // ── Query Editor ──────────────────────────────────────────────
  'editor.run': 'Run',
  'editor.stop': 'Stop',
  'editor.running': 'Running…',
  'editor.save': 'Save Query',
  'editor.saveQueryTooltip': 'Save query',
  'editor.beautify': 'Beautify SQL',
  'editor.buildSql': 'Build SQL',
  'editor.aiGenerate': 'AI: Generate SQL',
  'editor.aiExplain': 'AI: Explain SQL',
  'editor.aiOptimize': 'AI: Optimize SQL',
  'editor.placeholder': 'Write SQL here…',
  'editor.noConnection': 'Select a connection',
  'editor.selectConnection': 'Select connection…',
  'editor.queryName': 'Query name',
  'editor.queryCategory': 'Category (optional)',
  'editor.saveTitle': 'Save Query',
  'editor.cancel': 'Cancel',
  'editor.insert': 'Insert',
  'editor.generate': 'Generate',
  'editor.aiPromptLabel': 'Describe what query you want',
  'editor.aiLocalOnly': 'Local-only AI: prompts are sent only to your local provider',

  // ── Settings Modal ─────────────────────────────────────────────
  'settings.title': 'Settings',
  'settings.queryLimit': 'Default Query Row Limit',
  'settings.queryLimitHelp': 'Rows returned when browsing a table (e.g. SELECT * FROM …). Default: 100. Max: 10,000.',
  'settings.updateChecks': 'Enable update checks',
  'settings.updateChecksHelp': 'Checks GitHub releases for newer versions. You can disable this anytime.',
  'settings.updateInterval': 'Update Check Interval (hours)',
  'settings.language': 'Interface Language',
  'settings.languageHelp': 'Choose your preferred language for the application interface.',
  'settings.aiProvider': 'AI Provider',
  'settings.aiBaseUrl': 'AI Base URL',
  'settings.aiModel': 'AI Model',
  'settings.aiModelFetch': 'Fetch Models',
  'settings.aiModelFetching': 'Fetching…',
  'settings.aiModelPlaceholder': 'e.g. llama3.1',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.cancel': 'Cancel',

  // ── Buttons / common ──────────────────────────────────────────
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.rename': 'Rename',
  'common.edit': 'Edit',
  'common.copy': 'Copy',
  'common.open': 'Open',
  'common.search': 'Search…',
  'common.confirm': 'Confirm',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.loading': 'Loading…',

  // ── App titlebar ──────────────────────────────────────────────
  'app.queryHistory': 'Query History',
  'app.schemaVisualizer': 'Schema Visualizer',
  'app.settings': 'Settings',
  'app.checkForUpdates': 'Check for Updates',
  'app.openLogs': 'Open Logs Folder',
  'app.documentation': 'Documentation',
  'app.hideSidebar': 'Hide Sidebar',
  'app.showSidebar': 'Show Sidebar',

  // ── Theme ─────────────────────────────────────────────────────
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.system': 'System',
  'theme.matrix': 'Matrix',
  'theme.cyberpunk': 'Cyberpunk',

  // ── Status / feedback ─────────────────────────────────────────
  'status.rowCount': '{count} row{plural} in {ms}ms',
  'status.querySaved': 'Query saved: {name}',
  'status.templateInserted': 'SQL template inserted',
  'status.logsOpened': 'Opened logs folder',
  'status.upToDate': 'You are up to date',
  'status.updateAvailable': 'Update available: v{version}',

  // ── Privacy / About ───────────────────────────────────────────
  'about.title': 'About KobeanSQL',
  'privacy.title': 'Privacy & Security',

  // ── Language names (always shown in their own language) ───────
  'lang.en': 'English',
  'lang.de': 'Deutsch',
  'lang.es': 'Español',
  'lang.fr': 'Français',
  'lang.ja': '日本語',
  'lang.vi': 'Tiếng Việt',

  // ── Tips & Tricks ─────────────────────────────────────────────
  'tips.title': 'SQL Tips & Tricks',
  'tips.footer': 'Hover over a table or column in the sidebar to inspect its schema.',
  'app.tipsAndTricks': 'SQL Tips & Tricks',

  // ── Update download ───────────────────────────────────────────
  'updates.downloadUpdate': 'Download Update',
  'updates.viewRelease': 'View release',
  'updates.downloading': 'Downloading… {progress}%',
  'updates.downloadingUnknown': 'Downloading…',
  'updates.installAndRestart': 'Install & Restart',
  'updates.remindLater': 'Remind me later',
  'updates.ignoreVersion': 'Ignore this version',
  'updates.available': 'Update available: v{version}',
  'updates.availableSub': 'A newer version of KobeanSQL is available on GitHub Releases.',
  'updates.downloadError': 'Download failed: {error}',
} as const

export type TranslationKey = keyof typeof en
export default en
