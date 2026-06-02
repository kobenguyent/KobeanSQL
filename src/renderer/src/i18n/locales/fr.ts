/**
 * French locale strings for KobeanSQL.
 */
const fr = {
  // ── App-level ─────────────────────────────────────────────────
  'app.name': 'KobeanSQL',
  'app.version': 'Version',

  // ── Sidebar ───────────────────────────────────────────────────
  'sidebar.connections': 'Connexions',
  'sidebar.noConnections': 'Aucune connexion',
  'sidebar.noConnectionsSub': 'Cliquez sur + pour ajouter une connexion',
  'sidebar.addConnection': 'Ajouter une connexion',
  'sidebar.newConnection': 'Nouvelle connexion',
  'sidebar.importConnections': 'Importer des connexions',
  'sidebar.exportConnections': 'Exporter des connexions',
  'sidebar.templates': 'Modèles SQL',
  'sidebar.savedQueries': 'Requêtes sauvegardées',
  'sidebar.noSavedQueries': 'Aucune requête sauvegardée',
  'sidebar.noSavedQueriesSub': 'Sauvegardez une requête depuis l\'éditeur avec Ctrl/Cmd+S',

  // ── Connection Modal ───────────────────────────────────────────
  'connection.newTitle': 'Nouvelle connexion',
  'connection.editTitle': 'Modifier la connexion',
  'connection.dbType': 'Type de base de données',
  'connection.name': 'Nom de la connexion',
  'connection.category': 'Catégorie (optionnel)',
  'connection.categoryPlaceholder': 'ex. Production, Staging, Local…',
  'connection.method': 'Méthode de connexion',
  'connection.manual': 'Manuel',
  'connection.uri': 'URI de connexion',
  'connection.host': 'Hôte',
  'connection.port': 'Port',
  'connection.user': 'Utilisateur',
  'connection.password': 'Mot de passe',
  'connection.database': 'Base de données',
  'connection.file': 'Fichier de base de données',
  'connection.ssl': 'Utiliser SSL',
  'connection.color': 'Couleur',
  'connection.test': 'Tester la connexion',
  'connection.testing': 'Test en cours…',
  'connection.connect': 'Connecter & Sauvegarder',
  'connection.update': 'Mettre à jour',
  'connection.connecting': 'Connexion en cours…',
  'connection.success': 'Connexion réussie',
  'connection.nameRequired': 'Le nom de la connexion est requis',
  'connection.uriRequired': 'L\'URI de connexion est requise',

  // ── Query Editor ──────────────────────────────────────────────
  'editor.run': 'Exécuter',
  'editor.stop': 'Arrêter',
  'editor.running': 'En cours…',
  'editor.save': 'Sauvegarder la requête',
  'editor.saveQueryTooltip': 'Sauvegarder la requête',
  'editor.beautify': 'Embellir le SQL',
  'editor.buildSql': 'Construire le SQL',
  'editor.aiGenerate': 'IA : Générer le SQL',
  'editor.aiExplain': 'IA : Expliquer le SQL',
  'editor.aiOptimize': 'IA : Optimiser le SQL',
  'editor.placeholder': 'Écrivez le SQL ici…',
  'editor.noConnection': 'Sélectionner une connexion',
  'editor.selectConnection': 'Sélectionner une connexion…',
  'editor.queryName': 'Nom de la requête',
  'editor.queryCategory': 'Catégorie (optionnel)',
  'editor.saveTitle': 'Sauvegarder la requête',
  'editor.cancel': 'Annuler',
  'editor.insert': 'Insérer',
  'editor.generate': 'Générer',
  'editor.aiPromptLabel': 'Décrivez la requête souhaitée',
  'editor.aiLocalOnly': 'IA locale uniquement : les requêtes sont envoyées uniquement à votre fournisseur local',

  // ── Settings Modal ─────────────────────────────────────────────
  'settings.title': 'Paramètres',
  'settings.queryLimit': 'Limite de lignes par défaut',
  'settings.queryLimitHelp': 'Lignes retournées lors de la navigation dans une table. Par défaut : 100. Max : 10 000.',
  'settings.updateChecks': 'Activer les vérifications de mises à jour',
  'settings.updateChecksHelp': 'Vérifie les nouvelles versions sur GitHub. Vous pouvez désactiver cela à tout moment.',
  'settings.updateInterval': 'Intervalle de vérification (heures)',
  'settings.aiProvider': 'Fournisseur IA',
  'settings.aiBaseUrl': 'URL de base IA',
  'settings.aiModel': 'Modèle IA',
  'settings.aiModelFetch': 'Récupérer les modèles',
  'settings.aiModelFetching': 'Récupération…',
  'settings.aiModelPlaceholder': 'ex. llama3.1',
  'settings.save': 'Sauvegarder',
  'settings.saving': 'Sauvegarde…',
  'settings.cancel': 'Annuler',

  // ── Buttons / common ──────────────────────────────────────────
  'common.close': 'Fermer',
  'common.delete': 'Supprimer',
  'common.rename': 'Renommer',
  'common.edit': 'Modifier',
  'common.copy': 'Copier',
  'common.open': 'Ouvrir',
  'common.search': 'Rechercher…',
  'common.confirm': 'Confirmer',
  'common.yes': 'Oui',
  'common.no': 'Non',
  'common.loading': 'Chargement…',

  // ── App titlebar ──────────────────────────────────────────────
  'app.queryHistory': 'Historique des requêtes',
  'app.schemaVisualizer': 'Visualiseur de schéma',
  'app.settings': 'Paramètres',
  'app.checkForUpdates': 'Vérifier les mises à jour',
  'app.openLogs': 'Ouvrir le dossier de logs',
  'app.documentation': 'Documentation',
  'app.hideSidebar': 'Masquer la barre latérale',
  'app.showSidebar': 'Afficher la barre latérale',

  // ── Theme ─────────────────────────────────────────────────────
  'theme.dark': 'Sombre',
  'theme.light': 'Clair',
  'theme.system': 'Système',
  'theme.matrix': 'Matrix',
  'theme.cyberpunk': 'Cyberpunk',

  // ── Status / feedback ─────────────────────────────────────────
  'status.rowCount': '{count} ligne{plural} en {ms}ms',
  'status.querySaved': 'Requête sauvegardée : {name}',
  'status.templateInserted': 'Modèle SQL inséré',
  'status.logsOpened': 'Dossier des journaux ouvert',
  'status.upToDate': 'Vous êtes à jour',
  'status.updateAvailable': 'Mise à jour disponible : v{version}',

  // ── Privacy / About ───────────────────────────────────────────
  'about.title': 'À propos de KobeanSQL',
  'privacy.title': 'Confidentialité et sécurité',

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
  'updates.downloadUpdate': 'Télécharger la mise à jour',
  'updates.viewRelease': 'Voir la version',
  'updates.downloading': 'Téléchargement… {progress}%',
  'updates.downloadingUnknown': 'Téléchargement…',
  'updates.installAndRestart': 'Installer et redémarrer',
  'updates.remindLater': 'Me rappeler plus tard',
  'updates.ignoreVersion': 'Ignorer cette version',
  'updates.available': 'Mise à jour disponible : v{version}',
  'updates.availableSub': 'Une version plus récente de KobeanSQL est disponible sur GitHub Releases.',
  'updates.downloadError': 'Échec du téléchargement : {error}',

  // ── Settings – new keys ───────────────────────────────────────
  'settings.language': "Langue de l'interface",
  'settings.languageHelp': "Choisissez votre langue préférée pour l'interface de l'application.",
} as const

export default fr
