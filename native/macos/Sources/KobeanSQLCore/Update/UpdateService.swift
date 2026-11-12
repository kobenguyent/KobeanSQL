import Foundation

public struct UpdateSettings: Codable, Hashable, Sendable {
    public static let dismissTTL: TimeInterval = 24 * 60 * 60

    public var autoCheckEnabled: Bool
    public var checkIntervalHours: Int
    public var ignoredVersion: String?
    public var dismissedVersion: String?
    public var dismissedAt: Date?
    public var lastCheckedAt: Date?
    public var cachedLatestVersion: String?
    public var cachedReleaseName: String?
    public var cachedReleaseNotes: String?
    public var cachedReleaseURL: String?
    public var cachedDownloadURL: String?
    public var cachedAssetName: String?
    public var cachedAssetSize: Int64?
    public var cachedETag: String?

    public init(
        autoCheckEnabled: Bool = true,
        checkIntervalHours: Int = 24,
        ignoredVersion: String? = nil,
        dismissedVersion: String? = nil,
        dismissedAt: Date? = nil,
        lastCheckedAt: Date? = nil,
        cachedLatestVersion: String? = nil,
        cachedReleaseName: String? = nil,
        cachedReleaseNotes: String? = nil,
        cachedReleaseURL: String? = nil,
        cachedDownloadURL: String? = nil,
        cachedAssetName: String? = nil,
        cachedAssetSize: Int64? = nil,
        cachedETag: String? = nil
    ) {
        self.autoCheckEnabled = autoCheckEnabled
        self.checkIntervalHours = min(max(checkIntervalHours, 1), 168)
        self.ignoredVersion = ignoredVersion
        self.dismissedVersion = dismissedVersion
        self.dismissedAt = dismissedAt
        self.lastCheckedAt = lastCheckedAt
        self.cachedLatestVersion = cachedLatestVersion
        self.cachedReleaseName = cachedReleaseName
        self.cachedReleaseNotes = cachedReleaseNotes
        self.cachedReleaseURL = cachedReleaseURL
        self.cachedDownloadURL = cachedDownloadURL
        self.cachedAssetName = cachedAssetName
        self.cachedAssetSize = cachedAssetSize
        self.cachedETag = cachedETag
    }
}

/// Semantic version comparison matching `src/main/update/version.ts`.
public enum SemanticVersion {
    public static let fallbackVersion = "1.34.0"

    public static func currentAppVersion(bundle: Bundle = .main) -> String {
        if let v = bundle.infoDictionary?["CFBundleShortVersionString"] as? String,
           !v.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !v.contains("__APP_VERSION__") {
            return normalize(v)
        }
        return fallbackVersion
    }

    public static func normalize(_ v: String) -> String {
        var s = v.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("v") || s.hasPrefix("V") {
            s.removeFirst()
        }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func compare(_ a: String, _ b: String) -> Int {
        let na = normalize(a)
        let nb = normalize(b)
        if na == nb { return 0 }
        guard let firstA = na.first, firstA.isNumber,
              let firstB = nb.first, firstB.isNumber else {
            return 0
        }

        let partsA = na.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let partsB = nb.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let coreA = String(partsA[0])
        let coreB = String(partsB[0])
        let preA = partsA.count > 1 ? String(partsA[1]) : nil
        let preB = partsB.count > 1 ? String(partsB[1]) : nil

        var segA = coreA.split(separator: ".").map(String.init)
        var segB = coreB.split(separator: ".").map(String.init)
        while segA.count < segB.count { segA.append("0") }
        while segB.count < segA.count { segB.append("0") }

        for (sa, sb) in zip(segA, segB) {
            let cmp = sa.compare(sb, options: [.numeric, .caseInsensitive])
            if cmp == .orderedAscending { return -1 }
            if cmp == .orderedDescending { return 1 }
        }

        // Stable release is newer than pre-release of the same core version
        if preA == nil && preB != nil { return 1 }
        if preA != nil && preB == nil { return -1 }
        if let pa = preA, let pb = preB {
            let cmp = pa.compare(pb, options: [.numeric, .caseInsensitive])
            if cmp == .orderedAscending { return -1 }
            if cmp == .orderedDescending { return 1 }
        }
        return 0
    }

    public static func isNewerVersion(_ candidate: String, than current: String) -> Bool {
        compare(candidate, current) > 0
    }
}

public struct GitHubReleaseAsset: Codable, Hashable, Sendable {
    public var name: String
    public var browser_download_url: String
    public var size: Int64

    public init(name: String, browser_download_url: String, size: Int64) {
        self.name = name
        self.browser_download_url = browser_download_url
        self.size = size
    }
}

public struct GitHubLatestRelease: Codable, Hashable, Sendable {
    public var tag_name: String?
    public var name: String?
    public var body: String?
    public var html_url: String?
    public var assets: [GitHubReleaseAsset]?
}

public enum UpdateCheckOutcome: Sendable {
    case notModified(etag: String?)
    case release(
        version: String,
        name: String?,
        notes: String?,
        releaseURL: String,
        asset: GitHubReleaseAsset?,
        etag: String?
    )
}

/// Checks GitHub Releases (`kobenguyent/KobeanSQL`) for new versions, downloads native macOS
/// `.zip` / `.dmg` bundles, and performs in-place updates with Gatekeeper quarantine removal
/// and ad-hoc signing (`codesign --force --deep --sign -`).
public enum UpdateService {
    public static let latestReleaseAPIURL = URL(string: "https://api.github.com/repos/kobenguyent/KobeanSQL/releases/latest")!
    public static let releasesPageURL = URL(string: "https://github.com/kobenguyent/KobeanSQL/releases")!

    private static let allowedDownloadHosts: Set<String> = [
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com"
    ]

    public static var currentArchitecture: String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x86_64"
        #else
        return "arm64"
        #endif
    }

    public static func isAllowedDownloadURL(_ urlString: String?) -> Bool {
        guard let urlString,
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased() else {
            return false
        }
        return allowedDownloadHosts.contains(host)
    }

    public static func isAllowedReleasePageURL(_ urlString: String?) -> Bool {
        guard let urlString,
              let url = URL(string: urlString),
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == "github.com" else {
            return false
        }
        return true
    }

    /// Picks the best macOS release asset for the Native macOS app, preferring `*-macOS-native-*`
    /// `.zip` or `.dmg` matching the active CPU architecture before falling back to generic macOS assets.
    public static func pickBestNativeAsset(
        from assets: [GitHubReleaseAsset]?,
        arch: String = currentArchitecture
    ) -> GitHubReleaseAsset? {
        guard let assets, !assets.isEmpty else { return nil }
        let eligible = assets.filter { asset in
            let lower = asset.name.lowercased()
            return (lower.hasSuffix(".zip") || lower.hasSuffix(".dmg"))
                && !lower.contains("win")
                && !lower.contains("linux")
                && isAllowedDownloadURL(asset.browser_download_url)
        }
        guard !eligible.isEmpty else { return nil }

        let archTokens: [String] = (arch == "arm64" || arch == "aarch64")
            ? ["arm64", "aarch64"]
            : ["x86_64", "x64", "amd64"]

        func matchesArch(_ name: String) -> Bool {
            let lower = name.lowercased()
            return archTokens.contains { lower.contains($0) }
        }

        func hasAnyArchToken(_ name: String) -> Bool {
            let lower = name.lowercased()
            return ["arm64", "aarch64", "x86_64", "x64", "amd64"].contains { lower.contains($0) }
        }

        let nativeAssets = eligible.filter { $0.name.lowercased().contains("macos-native") }
        // 1. Native macOS arch-specific .zip
        if let match = nativeAssets.first(where: { $0.name.lowercased().hasSuffix(".zip") && matchesArch($0.name) }) {
            return match
        }
        // 2. Native macOS universal/generic .zip
        if let match = nativeAssets.first(where: { $0.name.lowercased().hasSuffix(".zip") && !hasAnyArchToken($0.name) }) {
            return match
        }
        // 3. Native macOS arch-specific .dmg
        if let match = nativeAssets.first(where: { $0.name.lowercased().hasSuffix(".dmg") && matchesArch($0.name) }) {
            return match
        }
        // 4. Native macOS universal/generic .dmg
        if let match = nativeAssets.first(where: { $0.name.lowercased().hasSuffix(".dmg") && !hasAnyArchToken($0.name) }) {
            return match
        }
        // 5. Any native macOS asset
        if let match = nativeAssets.first {
            return match
        }
        // 6. Fallback: arch-specific macOS .zip or .dmg
        if let match = eligible.first(where: { $0.name.lowercased().hasSuffix(".zip") && matchesArch($0.name) }) {
            return match
        }
        if let match = eligible.first(where: { $0.name.lowercased().hasSuffix(".dmg") && matchesArch($0.name) }) {
            return match
        }
        if let match = eligible.first(where: { $0.name.lowercased().hasSuffix(".zip") && !hasAnyArchToken($0.name) }) {
            return match
        }
        return eligible.first
    }

    public static func fetchLatestRelease(etag: String? = nil, force: Bool = false) async throws -> UpdateCheckOutcome {
        var request = URLRequest(url: latestReleaseAPIURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("KobeanSQL-Native-macOS-Updater", forHTTPHeaderField: "User-Agent")
        if !force, let etag, !etag.isEmpty {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw DatabaseError("Invalid response from GitHub Releases API.")
        }

        let responseETag = http.value(forHTTPHeaderField: "ETag") ?? http.value(forHTTPHeaderField: "etag")
        if http.statusCode == 304 {
            return .notModified(etag: responseETag ?? etag)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw DatabaseError("GitHub Releases API returned HTTP \(http.statusCode).")
        }

        let release = try JSONDecoder().decode(GitHubLatestRelease.self, from: data)
        guard let rawTag = release.tag_name, !rawTag.isEmpty else {
            throw DatabaseError("Latest GitHub release is missing tag_name.")
        }

        let normalizedVersion = SemanticVersion.normalize(rawTag)
        let releaseURL = isAllowedReleasePageURL(release.html_url) ? release.html_url! : releasesPageURL.absoluteString
        let asset = pickBestNativeAsset(from: release.assets)

        return .release(
            version: normalizedVersion,
            name: release.name,
            notes: release.body,
            releaseURL: releaseURL,
            asset: asset,
            etag: responseETag
        )
    }

    public static func downloadAsset(
        from urlString: String,
        assetName: String?,
        onProgress: @escaping @Sendable (Double) -> Void
    ) async throws -> URL {
        guard isAllowedDownloadURL(urlString), let url = URL(string: urlString) else {
            throw DatabaseError("Refused to download update from untrusted URL.")
        }

        let stageDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("kobeansql-native-update", isDirectory: true)
        try FileManager.default.createDirectory(at: stageDir, withIntermediateDirectories: true)

        let rawFileName = assetName ?? url.lastPathComponent
        let safeFileName = (rawFileName as NSString).lastPathComponent.isEmpty ? "KobeanSQL-update.zip" : (rawFileName as NSString).lastPathComponent
        let destURL = stageDir.appendingPathComponent(safeFileName)
        try? FileManager.default.removeItem(at: destURL)

        var request = URLRequest(url: url)
        request.timeoutInterval = 300
        request.setValue("KobeanSQL-Native-macOS-Updater", forHTTPHeaderField: "User-Agent")

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw DatabaseError("Update download failed (HTTP \(code)).")
        }
        if let finalHost = http.url?.host?.lowercased(), !allowedDownloadHosts.contains(finalHost) {
            throw DatabaseError("Redirected to untrusted download host (\(finalHost)).")
        }

        let expectedLength = http.expectedContentLength
        FileManager.default.createFile(atPath: destURL.path, contents: nil)
        let handle = try FileHandle(forWritingTo: destURL)
        defer { try? handle.close() }

        var buffer = Data()
        buffer.reserveCapacity(65_536)
        var downloaded: Int64 = 0
        var lastReported: Double = -1

        for try await byte in bytes {
            try Task.checkCancellation()
            buffer.append(byte)
            if buffer.count >= 65_536 {
                try handle.write(contentsOf: buffer)
                downloaded += Int64(buffer.count)
                buffer.removeAll(keepingCapacity: true)
                if expectedLength > 0 {
                    let pct = min(1.0, max(0.0, Double(downloaded) / Double(expectedLength)))
                    if pct - lastReported >= 0.01 {
                        lastReported = pct
                        onProgress(pct)
                    }
                }
            }
        }

        if !buffer.isEmpty {
            try handle.write(contentsOf: buffer)
            downloaded += Int64(buffer.count)
            buffer.removeAll()
        }
        onProgress(1.0)
        return destURL
    }

    /// Generates and spawns a detached bash installer script that waits for the current app
    /// to exit, unpacks `.zip` or mounts `.dmg`, replaces `/Applications/KobeanSQL.app` (or current bundle),
    /// clears Gatekeeper quarantine (`xattr -cr`), applies local ad-hoc signing (`codesign --force --deep --sign -`),
    /// and relaunches `KobeanSQL.app`.
    public static func installAndRelaunch(
        downloadedFile: URL,
        currentBundlePath: String = Bundle.main.bundlePath
    ) throws {
        guard FileManager.default.fileExists(atPath: downloadedFile.path) else {
            throw DatabaseError("Downloaded update archive not found at \(downloadedFile.path).")
        }

        let targetAppPath: String
        if currentBundlePath.hasSuffix(".app") {
            targetAppPath = currentBundlePath
        } else if FileManager.default.isWritableFile(atPath: "/Applications") {
            targetAppPath = "/Applications/KobeanSQL.app"
        } else {
            let userApps = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path
            try? FileManager.default.createDirectory(atPath: userApps, withIntermediateDirectories: true)
            targetAppPath = "\(userApps)/KobeanSQL.app"
        }

        let updateDir = downloadedFile.deletingLastPathComponent()
        let scriptURL = updateDir.appendingPathComponent("install-update.sh")
        let script = buildInstallerScript(downloadedFile: downloadedFile.path, targetAppPath: targetAppPath, workDir: updateDir.path)
        try Data(script.utf8).write(to: scriptURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = [scriptURL.path]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try proc.run()
    }

    public static func buildInstallerScript(downloadedFile: String, targetAppPath: String, workDir: String) -> String {
        func shQuote(_ s: String) -> String {
            "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
        }
        return """
        #!/usr/bin/env bash
        set -euo pipefail
        sleep 1.5
        ARCHIVE=\(shQuote(downloadedFile))
        TARGET_APP=\(shQuote(targetAppPath))
        STAGE_DIR=\(shQuote(workDir))/extracted-\(UUID().uuidString)
        mkdir -p "$STAGE_DIR"

        EXT="${ARCHIVE##*.}"
        EXT_LOWER="$(echo "$EXT" | tr '[:upper:]' '[:lower:]')"
        MOUNT_POINT=""

        cleanup() {
          if [ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ]; then
            hdiutil detach "$MOUNT_POINT" -quiet -force 2>/dev/null || true
          fi
          rm -rf "$STAGE_DIR" 2>/dev/null || true
        }
        trap cleanup EXIT

        if [ "$EXT_LOWER" = "zip" ]; then
          ditto -x -k "$ARCHIVE" "$STAGE_DIR"
          NEW_APP="$(find "$STAGE_DIR" -maxdepth 2 -name "*.app" | head -n 1)"
        elif [ "$EXT_LOWER" = "dmg" ]; then
          MOUNT_POINT="$STAGE_DIR/mnt"
          mkdir -p "$MOUNT_POINT"
          hdiutil attach "$ARCHIVE" -mountpoint "$MOUNT_POINT" -nobrowse -readonly -quiet
          NEW_APP="$(find "$MOUNT_POINT" -maxdepth 2 -name "*.app" | head -n 1)"
        else
          exit 1
        fi

        if [ -z "${NEW_APP:-}" ] || [ ! -d "$NEW_APP" ]; then
          exit 1
        fi

        rm -rf "$TARGET_APP"
        ditto "$NEW_APP" "$TARGET_APP"
        xattr -cr "$TARGET_APP" 2>/dev/null || true
        codesign --force --deep --sign - "$TARGET_APP" 2>/dev/null || true
        open "$TARGET_APP"
        """
    }
}
