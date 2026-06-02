/**
 * Vietnamese locale strings for KobeanSQL.
 */
const vi = {
  // ── App-level ─────────────────────────────────────────────────
  'app.name': 'KobeanSQL',
  'app.version': 'Phiên bản',

  // ── Sidebar ───────────────────────────────────────────────────
  'sidebar.connections': 'Kết nối',
  'sidebar.noConnections': 'Chưa có kết nối',
  'sidebar.noConnectionsSub': 'Nhấn + để thêm kết nối cơ sở dữ liệu',
  'sidebar.addConnection': 'Thêm kết nối',
  'sidebar.newConnection': 'Kết nối mới',
  'sidebar.importConnections': 'Nhập kết nối',
  'sidebar.exportConnections': 'Xuất kết nối',
  'sidebar.templates': 'Mẫu SQL',
  'sidebar.savedQueries': 'Truy vấn đã lưu',
  'sidebar.noSavedQueries': 'Chưa có truy vấn được lưu',
  'sidebar.noSavedQueriesSub': 'Lưu truy vấn từ trình soạn thảo bằng Ctrl/Cmd+S',

  // ── Connection Modal ───────────────────────────────────────────
  'connection.newTitle': 'Kết nối mới',
  'connection.editTitle': 'Chỉnh sửa kết nối',
  'connection.dbType': 'Loại cơ sở dữ liệu',
  'connection.name': 'Tên kết nối',
  'connection.category': 'Danh mục (tùy chọn)',
  'connection.categoryPlaceholder': 'VD: Production, Staging, Local…',
  'connection.method': 'Phương thức kết nối',
  'connection.manual': 'Thủ công',
  'connection.uri': 'URI kết nối',
  'connection.host': 'Host',
  'connection.port': 'Cổng',
  'connection.user': 'Người dùng',
  'connection.password': 'Mật khẩu',
  'connection.database': 'Cơ sở dữ liệu',
  'connection.file': 'Tệp cơ sở dữ liệu',
  'connection.ssl': 'Sử dụng SSL',
  'connection.color': 'Màu sắc',
  'connection.test': 'Kiểm tra kết nối',
  'connection.testing': 'Đang kiểm tra…',
  'connection.connect': 'Kết nối & Lưu',
  'connection.update': 'Cập nhật',
  'connection.connecting': 'Đang kết nối…',
  'connection.success': 'Kết nối thành công',
  'connection.nameRequired': 'Tên kết nối là bắt buộc',
  'connection.uriRequired': 'URI kết nối là bắt buộc',

  // ── Query Editor ──────────────────────────────────────────────
  'editor.run': 'Chạy',
  'editor.stop': 'Dừng',
  'editor.running': 'Đang chạy…',
  'editor.save': 'Lưu truy vấn',
  'editor.saveQueryTooltip': 'Lưu truy vấn',
  'editor.beautify': 'Định dạng SQL',
  'editor.buildSql': 'Xây dựng SQL',
  'editor.aiGenerate': 'AI: Tạo SQL',
  'editor.aiExplain': 'AI: Giải thích SQL',
  'editor.aiOptimize': 'AI: Tối ưu SQL',
  'editor.placeholder': 'Viết SQL tại đây…',
  'editor.noConnection': 'Chọn một kết nối',
  'editor.selectConnection': 'Chọn kết nối…',
  'editor.queryName': 'Tên truy vấn',
  'editor.queryCategory': 'Danh mục (tùy chọn)',
  'editor.saveTitle': 'Lưu truy vấn',
  'editor.cancel': 'Hủy',
  'editor.insert': 'Chèn',
  'editor.generate': 'Tạo',
  'editor.aiPromptLabel': 'Mô tả truy vấn bạn muốn',
  'editor.aiLocalOnly': 'AI chỉ nội bộ: câu lệnh chỉ được gửi đến nhà cung cấp nội bộ của bạn',

  // ── Settings Modal ─────────────────────────────────────────────
  'settings.title': 'Cài đặt',
  'settings.queryLimit': 'Giới hạn hàng truy vấn mặc định',
  'settings.queryLimitHelp': 'Số hàng trả về khi duyệt bảng. Mặc định: 100. Tối đa: 10.000.',
  'settings.updateChecks': 'Bật kiểm tra cập nhật',
  'settings.updateChecksHelp': 'Kiểm tra phiên bản mới hơn trên GitHub. Bạn có thể tắt bất cứ lúc nào.',
  'settings.updateInterval': 'Khoảng thời gian kiểm tra cập nhật (giờ)',
  'settings.aiProvider': 'Nhà cung cấp AI',
  'settings.aiBaseUrl': 'URL cơ sở AI',
  'settings.aiModel': 'Mô hình AI',
  'settings.aiModelFetch': 'Tải mô hình',
  'settings.aiModelFetching': 'Đang tải…',
  'settings.aiModelPlaceholder': 'VD: llama3.1',
  'settings.save': 'Lưu',
  'settings.saving': 'Đang lưu…',
  'settings.cancel': 'Hủy',

  // ── Buttons / common ──────────────────────────────────────────
  'common.close': 'Đóng',
  'common.delete': 'Xóa',
  'common.rename': 'Đổi tên',
  'common.edit': 'Chỉnh sửa',
  'common.copy': 'Sao chép',
  'common.open': 'Mở',
  'common.search': 'Tìm kiếm…',
  'common.confirm': 'Xác nhận',
  'common.yes': 'Có',
  'common.no': 'Không',
  'common.loading': 'Đang tải…',

  // ── App titlebar ──────────────────────────────────────────────
  'app.queryHistory': 'Lịch sử truy vấn',
  'app.schemaVisualizer': 'Trình xem lược đồ',
  'app.settings': 'Cài đặt',
  'app.checkForUpdates': 'Kiểm tra cập nhật',
  'app.openLogs': 'Mở thư mục nhật ký',
  'app.documentation': 'Tài liệu',
  'app.hideSidebar': 'Ẩn thanh bên',
  'app.showSidebar': 'Hiện thanh bên',

  // ── Theme ─────────────────────────────────────────────────────
  'theme.dark': 'Tối',
  'theme.light': 'Sáng',
  'theme.system': 'Hệ thống',
  'theme.matrix': 'Ma trận',
  'theme.cyberpunk': 'Cyberpunk',

  // ── Status / feedback ─────────────────────────────────────────
  'status.rowCount': '{count} hàng{plural} trong {ms}ms',
  'status.querySaved': 'Đã lưu truy vấn: {name}',
  'status.templateInserted': 'Đã chèn mẫu SQL',
  'status.logsOpened': 'Đã mở thư mục nhật ký',
  'status.upToDate': 'Bạn đang dùng phiên bản mới nhất',
  'status.updateAvailable': 'Có bản cập nhật: v{version}',

  // ── Privacy / About ───────────────────────────────────────────
  'about.title': 'Giới thiệu KobeanSQL',
  'privacy.title': 'Quyền riêng tư & Bảo mật',

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
  'updates.downloadUpdate': 'Tải xuống bản cập nhật',
  'updates.viewRelease': 'Xem bản phát hành',
  'updates.downloading': 'Đang tải xuống… {progress}%',
  'updates.downloadingUnknown': 'Đang tải xuống…',
  'updates.installAndRestart': 'Cài đặt & Khởi động lại',
  'updates.remindLater': 'Nhắc tôi sau',
  'updates.ignoreVersion': 'Bỏ qua phiên bản này',
  'updates.available': 'Có bản cập nhật: v{version}',
  'updates.availableSub': 'Phiên bản mới hơn của KobeanSQL hiện có trên GitHub Releases.',
  'updates.downloadError': 'Tải xuống thất bại: {error}',

  // ── Settings – new keys ───────────────────────────────────────
  'settings.language': 'Ngôn ngữ giao diện',
  'settings.languageHelp': 'Chọn ngôn ngữ ưa thích của bạn cho giao diện ứng dụng.',
} as const

export default vi
