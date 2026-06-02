/**
 * German locale strings for KobeanSQL.
 */
const de = {
  // ── App-level ─────────────────────────────────────────────────
  'app.name': 'KobeanSQL',
  'app.version': 'Version',

  // ── Sidebar ───────────────────────────────────────────────────
  'sidebar.connections': 'Verbindungen',
  'sidebar.noConnections': 'Keine Verbindungen',
  'sidebar.noConnectionsSub': 'Klicken Sie auf +, um eine Datenbankverbindung hinzuzufügen',
  'sidebar.addConnection': 'Verbindung hinzufügen',
  'sidebar.newConnection': 'Neue Verbindung',
  'sidebar.importConnections': 'Verbindungen importieren',
  'sidebar.exportConnections': 'Verbindungen exportieren',
  'sidebar.templates': 'SQL-Vorlagen',
  'sidebar.savedQueries': 'Gespeicherte Abfragen',
  'sidebar.noSavedQueries': 'Noch keine gespeicherten Abfragen',
  'sidebar.noSavedQueriesSub': 'Speichern Sie eine Abfrage aus dem Editor mit Strg/Cmd+S',

  // ── Connection Modal ───────────────────────────────────────────
  'connection.newTitle': 'Neue Verbindung',
  'connection.editTitle': 'Verbindung bearbeiten',
  'connection.dbType': 'Datenbanktyp',
  'connection.name': 'Verbindungsname',
  'connection.category': 'Kategorie (optional)',
  'connection.categoryPlaceholder': 'z. B. Produktion, Staging, Lokal…',
  'connection.method': 'Verbindungsmethode',
  'connection.manual': 'Manuell',
  'connection.uri': 'Verbindungs-URI',
  'connection.host': 'Host',
  'connection.port': 'Port',
  'connection.user': 'Benutzer',
  'connection.password': 'Passwort',
  'connection.database': 'Datenbank',
  'connection.file': 'Datenbankdatei',
  'connection.ssl': 'SSL verwenden',
  'connection.color': 'Farbe',
  'connection.test': 'Verbindung testen',
  'connection.testing': 'Wird getestet…',
  'connection.connect': 'Verbinden & Speichern',
  'connection.update': 'Aktualisieren',
  'connection.connecting': 'Verbindung wird hergestellt…',
  'connection.success': 'Erfolgreich verbunden',
  'connection.nameRequired': 'Verbindungsname ist erforderlich',
  'connection.uriRequired': 'Verbindungs-URI ist erforderlich',

  // ── Query Editor ──────────────────────────────────────────────
  'editor.run': 'Ausführen',
  'editor.stop': 'Stoppen',
  'editor.running': 'Läuft…',
  'editor.save': 'Abfrage speichern',
  'editor.saveQueryTooltip': 'Abfrage speichern',
  'editor.beautify': 'SQL formatieren',
  'editor.buildSql': 'SQL erstellen',
  'editor.aiGenerate': 'KI: SQL generieren',
  'editor.aiExplain': 'KI: SQL erklären',
  'editor.aiOptimize': 'KI: SQL optimieren',
  'editor.placeholder': 'SQL hier schreiben…',
  'editor.noConnection': 'Verbindung auswählen',
  'editor.selectConnection': 'Verbindung auswählen…',
  'editor.queryName': 'Abfragename',
  'editor.queryCategory': 'Kategorie (optional)',
  'editor.saveTitle': 'Abfrage speichern',
  'editor.cancel': 'Abbrechen',
  'editor.insert': 'Einfügen',
  'editor.generate': 'Generieren',
  'editor.aiPromptLabel': 'Beschreibe die gewünschte Abfrage',
  'editor.aiLocalOnly': 'Nur lokale KI: Anfragen werden nur an deinen lokalen Anbieter gesendet',

  // ── Settings Modal ─────────────────────────────────────────────
  'settings.title': 'Einstellungen',
  'settings.queryLimit': 'Standard-Zeilenlimit für Abfragen',
  'settings.queryLimitHelp': 'Zurückgegebene Zeilen beim Durchsuchen einer Tabelle. Standard: 100. Max: 10.000.',
  'settings.updateChecks': 'Update-Prüfungen aktivieren',
  'settings.updateChecksHelp': 'Prüft GitHub-Releases auf neuere Versionen. Sie können dies jederzeit deaktivieren.',
  'settings.updateInterval': 'Update-Prüfintervall (Stunden)',
  'settings.aiProvider': 'KI-Anbieter',
  'settings.aiBaseUrl': 'KI-Basis-URL',
  'settings.aiModel': 'KI-Modell',
  'settings.aiModelFetch': 'Modelle abrufen',
  'settings.aiModelFetching': 'Wird abgerufen…',
  'settings.aiModelPlaceholder': 'z. B. llama3.1',
  'settings.save': 'Speichern',
  'settings.saving': 'Wird gespeichert…',
  'settings.cancel': 'Abbrechen',

  // ── Buttons / common ──────────────────────────────────────────
  'common.close': 'Schließen',
  'common.delete': 'Löschen',
  'common.rename': 'Umbenennen',
  'common.edit': 'Bearbeiten',
  'common.copy': 'Kopieren',
  'common.open': 'Öffnen',
  'common.search': 'Suchen…',
  'common.confirm': 'Bestätigen',
  'common.yes': 'Ja',
  'common.no': 'Nein',
  'common.loading': 'Laden…',

  // ── App titlebar ──────────────────────────────────────────────
  'app.queryHistory': 'Abfrageverlauf',
  'app.schemaVisualizer': 'Schema-Visualisierer',
  'app.settings': 'Einstellungen',
  'app.checkForUpdates': 'Nach Updates suchen',
  'app.openLogs': 'Protokollordner öffnen',
  'app.documentation': 'Dokumentation',
  'app.hideSidebar': 'Seitenleiste ausblenden',
  'app.showSidebar': 'Seitenleiste einblenden',

  // ── Theme ─────────────────────────────────────────────────────
  'theme.dark': 'Dunkel',
  'theme.light': 'Hell',
  'theme.system': 'System',
  'theme.matrix': 'Matrix',
  'theme.cyberpunk': 'Cyberpunk',

  // ── Status / feedback ─────────────────────────────────────────
  'status.rowCount': '{count} Zeile{plural} in {ms}ms',
  'status.querySaved': 'Abfrage gespeichert: {name}',
  'status.templateInserted': 'SQL-Vorlage eingefügt',
  'status.logsOpened': 'Protokollordner geöffnet',
  'status.upToDate': 'Sie sind auf dem neuesten Stand',
  'status.updateAvailable': 'Update verfügbar: v{version}',

  // ── Privacy / About ───────────────────────────────────────────
  'about.title': 'Über KobeanSQL',
  'privacy.title': 'Datenschutz & Sicherheit',

  // ── Language names ────────────────────────────────────────────
  'lang.en': 'English',
  'lang.de': 'Deutsch',
  'lang.es': 'Español',
  'lang.fr': 'Français',
  'lang.ja': '日本語',
  'lang.vi': 'Tiếng Việt',

  // ── Tips & Tricks ─────────────────────────────────────────────
  'tips.title': 'SQL Tipps & Tricks',
  'tips.footer': 'Bewegen Sie die Maus über eine Tabelle oder Spalte in der Seitenleiste, um ihr Schema zu inspizieren.',
  'app.tipsAndTricks': 'SQL Tipps & Tricks',

  // ── Update download ───────────────────────────────────────────
  'updates.downloadUpdate': 'Update herunterladen',
  'updates.viewRelease': 'Release ansehen',
  'updates.downloading': 'Herunterladen… {progress}%',
  'updates.downloadingUnknown': 'Herunterladen…',
  'updates.installAndRestart': 'Installieren & Neu starten',
  'updates.remindLater': 'Später erinnern',
  'updates.ignoreVersion': 'Diese Version ignorieren',
  'updates.available': 'Update verfügbar: v{version}',
  'updates.availableSub': 'Eine neuere Version von KobeanSQL ist auf GitHub Releases verfügbar.',
  'updates.downloadError': 'Download fehlgeschlagen: {error}',

  // ── Settings – new keys ───────────────────────────────────────
  'settings.language': 'Oberflächensprache',
  'settings.languageHelp': 'Wählen Sie Ihre bevorzugte Sprache für die Anwendungsoberfläche.',
} as const

export default de
