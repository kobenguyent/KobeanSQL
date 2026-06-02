/**
 * Spanish locale strings for KobeanSQL.
 */
const es = {
  // ── App-level ─────────────────────────────────────────────────
  'app.name': 'KobeanSQL',
  'app.version': 'Versión',

  // ── Sidebar ───────────────────────────────────────────────────
  'sidebar.connections': 'Conexiones',
  'sidebar.noConnections': 'Sin conexiones',
  'sidebar.noConnectionsSub': 'Haga clic en + para agregar una conexión de base de datos',
  'sidebar.addConnection': 'Agregar conexión',
  'sidebar.newConnection': 'Nueva conexión',
  'sidebar.importConnections': 'Importar conexiones',
  'sidebar.exportConnections': 'Exportar conexiones',
  'sidebar.templates': 'Plantillas SQL',
  'sidebar.savedQueries': 'Consultas guardadas',
  'sidebar.noSavedQueries': 'Aún no hay consultas guardadas',
  'sidebar.noSavedQueriesSub': 'Guarde una consulta desde el editor con Ctrl/Cmd+S',

  // ── Connection Modal ───────────────────────────────────────────
  'connection.newTitle': 'Nueva conexión',
  'connection.editTitle': 'Editar conexión',
  'connection.dbType': 'Tipo de base de datos',
  'connection.name': 'Nombre de la conexión',
  'connection.category': 'Categoría (opcional)',
  'connection.categoryPlaceholder': 'ej. Producción, Staging, Local…',
  'connection.method': 'Método de conexión',
  'connection.manual': 'Manual',
  'connection.uri': 'URI de conexión',
  'connection.host': 'Host',
  'connection.port': 'Puerto',
  'connection.user': 'Usuario',
  'connection.password': 'Contraseña',
  'connection.database': 'Base de datos',
  'connection.file': 'Archivo de base de datos',
  'connection.ssl': 'Usar SSL',
  'connection.color': 'Color',
  'connection.test': 'Probar conexión',
  'connection.testing': 'Probando…',
  'connection.connect': 'Conectar y guardar',
  'connection.update': 'Actualizar',
  'connection.connecting': 'Conectando…',
  'connection.success': 'Conectado correctamente',
  'connection.nameRequired': 'El nombre de la conexión es obligatorio',
  'connection.uriRequired': 'La URI de conexión es obligatoria',

  // ── Query Editor ──────────────────────────────────────────────
  'editor.run': 'Ejecutar',
  'editor.stop': 'Detener',
  'editor.running': 'Ejecutando…',
  'editor.save': 'Guardar consulta',
  'editor.saveQueryTooltip': 'Guardar consulta',
  'editor.beautify': 'Embellecer SQL',
  'editor.buildSql': 'Construir SQL',
  'editor.aiGenerate': 'IA: Generar SQL',
  'editor.aiExplain': 'IA: Explicar SQL',
  'editor.aiOptimize': 'IA: Optimizar SQL',
  'editor.placeholder': 'Escriba SQL aquí…',
  'editor.noConnection': 'Seleccione una conexión',
  'editor.selectConnection': 'Seleccionar conexión…',
  'editor.queryName': 'Nombre de la consulta',
  'editor.queryCategory': 'Categoría (opcional)',
  'editor.saveTitle': 'Guardar consulta',
  'editor.cancel': 'Cancelar',
  'editor.insert': 'Insertar',
  'editor.generate': 'Generar',
  'editor.aiPromptLabel': 'Describe la consulta que deseas',
  'editor.aiLocalOnly': 'IA solo local: los mensajes se envían únicamente a tu proveedor local',

  // ── Settings Modal ─────────────────────────────────────────────
  'settings.title': 'Configuración',
  'settings.queryLimit': 'Límite de filas predeterminado',
  'settings.queryLimitHelp': 'Filas devueltas al explorar una tabla. Predeterminado: 100. Máx: 10.000.',
  'settings.updateChecks': 'Habilitar comprobaciones de actualizaciones',
  'settings.updateChecksHelp': 'Comprueba las versiones más recientes en GitHub. Puede desactivarlo en cualquier momento.',
  'settings.updateInterval': 'Intervalo de comprobación de actualizaciones (horas)',
  'settings.aiProvider': 'Proveedor de IA',
  'settings.aiBaseUrl': 'URL base de IA',
  'settings.aiModel': 'Modelo de IA',
  'settings.aiModelFetch': 'Obtener modelos',
  'settings.aiModelFetching': 'Obteniendo…',
  'settings.aiModelPlaceholder': 'ej. llama3.1',
  'settings.save': 'Guardar',
  'settings.saving': 'Guardando…',
  'settings.cancel': 'Cancelar',

  // ── Buttons / common ──────────────────────────────────────────
  'common.close': 'Cerrar',
  'common.delete': 'Eliminar',
  'common.rename': 'Renombrar',
  'common.edit': 'Editar',
  'common.copy': 'Copiar',
  'common.open': 'Abrir',
  'common.search': 'Buscar…',
  'common.confirm': 'Confirmar',
  'common.yes': 'Sí',
  'common.no': 'No',
  'common.loading': 'Cargando…',

  // ── App titlebar ──────────────────────────────────────────────
  'app.queryHistory': 'Historial de consultas',
  'app.schemaVisualizer': 'Visualizador de esquema',
  'app.settings': 'Configuración',
  'app.checkForUpdates': 'Buscar actualizaciones',
  'app.openLogs': 'Abrir carpeta de registros',
  'app.documentation': 'Documentación',
  'app.hideSidebar': 'Ocultar barra lateral',
  'app.showSidebar': 'Mostrar barra lateral',

  // ── Theme ─────────────────────────────────────────────────────
  'theme.dark': 'Oscuro',
  'theme.light': 'Claro',
  'theme.system': 'Sistema',
  'theme.matrix': 'Matrix',
  'theme.cyberpunk': 'Cyberpunk',

  // ── Status / feedback ─────────────────────────────────────────
  'status.rowCount': '{count} fila{plural} en {ms}ms',
  'status.querySaved': 'Consulta guardada: {name}',
  'status.templateInserted': 'Plantilla SQL insertada',
  'status.logsOpened': 'Carpeta de registros abierta',
  'status.upToDate': 'Está actualizado',
  'status.updateAvailable': 'Actualización disponible: v{version}',

  // ── Privacy / About ───────────────────────────────────────────
  'about.title': 'Acerca de KobeanSQL',
  'privacy.title': 'Privacidad y seguridad',

  // ── Language names ────────────────────────────────────────────
  'lang.en': 'English',
  'lang.de': 'Deutsch',
  'lang.es': 'Español',
  'lang.fr': 'Français',
  'lang.ja': '日本語',
  'lang.vi': 'Tiếng Việt',

  // ── Update download ───────────────────────────────────────────
  'tips.title': 'SQL Tips & Tricks',
  'tips.footer': 'Hover over a table or column in the sidebar to inspect its schema.',
  'app.tipsAndTricks': 'SQL Tips & Tricks',

  // ── Update download ───────────────────────────────────────────
  'updates.downloadUpdate': 'Descargar actualización',
  'updates.viewRelease': 'Ver versión',
  'updates.downloading': 'Descargando… {progress}%',
  'updates.downloadingUnknown': 'Descargando…',
  'updates.installAndRestart': 'Instalar y reiniciar',
  'updates.remindLater': 'Recordarme más tarde',
  'updates.ignoreVersion': 'Ignorar esta versión',
  'updates.available': 'Actualización disponible: v{version}',
  'updates.availableSub': 'Una versión más nueva de KobeanSQL está disponible en GitHub Releases.',
  'updates.downloadError': 'Error de descarga: {error}',

  // ── Settings – new keys ───────────────────────────────────────
  'settings.language': 'Idioma de la interfaz',
  'settings.languageHelp': 'Elige tu idioma preferido para la interfaz de la aplicación.',
} as const

export default es
