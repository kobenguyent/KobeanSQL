import CryptoKit
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
    public var cachedChecksumURL: String?
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
        cachedChecksumURL: String? = nil,
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
        self.cachedChecksumURL = cachedChecksumURL
        self.cachedAssetName = cachedAssetName
        self.cachedAssetSize = cachedAssetSize
        self.cachedETag = cachedETag
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.autoCheckEnabled = (try? c.decode(Bool.self, forKey: .autoCheckEnabled)) ?? true
        let hours = (try? c.decode(Int.self, forKey: .checkIntervalHours)) ?? 24
        self.checkIntervalHours = min(max(hours, 1), 168)
        self.ignoredVersion = try? c.decode(String.self, forKey: .ignoredVersion)
        self.dismissedVersion = try? c.decode(String.self, forKey: .dismissedVersion)
        self.dismissedAt = try? c.decode(Date.self, forKey: .dismissedAt)
        self.lastCheckedAt = try? c.decode(Date.self, forKey: .lastCheckedAt)
        self.cachedLatestVersion = try? c.decode(String.self, forKey: .cachedLatestVersion)
        self.cachedReleaseName = try? c.decode(String.self, forKey: .cachedReleaseName)
        self.cachedReleaseNotes = try? c.decode(String.self, forKey: .cachedReleaseNotes)
        self.cachedReleaseURL = try? c.decode(String.self, forKey: .cachedReleaseURL)
        self.cachedDownloadURL = try? c.decode(String.self, forKey: .cachedDownloadURL)
        self.cachedChecksumURL = try? c.decode(String.self, forKey: .cachedChecksumURL)
        self.cachedAssetName = try? c.decode(String.self, forKey: .cachedAssetName)
        self.cachedAssetSize = try? c.decode(Int64.self, forKey: .cachedAssetSize)
        self.cachedETag = try? c.decode(String.self, forKey: .cachedETag)
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
        checksumAsset: GitHubReleaseAsset?,
        etag: String?
    )
}

/// Checks GitHub Releases (`kobenguyent/KobeanSQL`) for new versions, downloads native macOS
/// `.zip` / `.dmg` bundles, verifies SHA-256 digests when `SHA256SUMS.txt` is published,
/// waits for the current app process to close, atomically replaces `KobeanSQL.app` with
/// rollback safety + Gatekeeper quarantine removal + ad-hoc signing, and relaunches.
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
    /// `.zip` or `.dmg` matching the active CPU architecture (or universal) before falling back.
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

        func isUniversalOrGeneric(_ name: String) -> Bool {
            let lower = name.lowercased()
            if lower.contains("universal") { return true }
            return !["arm64", "aarch64", "x86_64", "x64", "amd64"].contains { lower.contains($0) }
        }

        let nativeAssets = eligible.filter { $0.name.lowercased().contains("macos-native") }
        // 1. Native macOS arch-specific .zip
        if let match = nativeAssets.first(where: { $0.name.lowercased().hasSuffix(".zip") && matchesArch($0.name) }) {
            return match
        }
        // 2. Native macOS universal/generic .zip
        if let match = nativeAssets.first(where: { $0.name.lowercased().hasSuffix(".zip") && isUniversalOrGeneric($0.name) }) {
            return match
        }
        // 3. Native macOS arch-specific .dmg
        if let match = nativeAssets.first(where: { $0.name.lowercased().hasSuffix(".dmg") && matchesArch($0.name) }) {
            return match
        }
        // 4. Native macOS universal/generic .dmg
        if let match = nativeAssets.first(where: { $0.name.lowercased().hasSuffix(".dmg") && isUniversalOrGeneric($0.name) }) {
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
        if let match = eligible.first(where: { $0.name.lowercased().hasSuffix(".zip") && isUniversalOrGeneric($0.name) }) {
            return match
        }
        return eligible.first
    }

    /// Finds the SHA-256 checksum manifest asset published alongside native macOS artifacts.
    public static func pickChecksumAsset(from assets: [GitHubReleaseAsset]?) -> GitHubReleaseAsset? {
        guard let assets, !assets.isEmpty else { return nil }
        let eligible = assets.filter { isAllowedDownloadURL($0.browser_download_url) }
        if let nativeSum = eligible.first(where: {
            let lower = $0.name.lowercased()
            return lower.contains("macos-native") && lower.contains("sha256") && lower.hasSuffix(".txt")
        }) {
            return nativeSum
        }
        return eligible.first(where: {
            let lower = $0.name.lowercased()
            return (lower == "sha256sums.txt" || lower.hasSuffix("sha256sums.txt"))
        })
    }

    /// Computes lowercase hex SHA-256 digest of a file on disk using streaming chunks.
    public static func sha256Hex(of fileURL: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk = try handle.read(upToCount: 65_536) ?? Data()
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Parses a `shasum -a 256` manifest and returns the expected hex digest for `assetName`.
    public static func parseChecksum(from checksumsText: String, forAssetName assetName: String) -> String? {
        let targetName = (assetName as NSString).lastPathComponent
        for rawLine in checksumsText.split(whereSeparator: \.isNewline) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty, !line.hasPrefix("#") else { continue }
            let parts = line.split(maxSplits: 1, omittingEmptySubsequences: true, whereSeparator: { $0 == " " || $0 == "\t" })
            guard parts.count == 2 else { continue }
            let hash = String(parts[0]).lowercased()
            var filePart = String(parts[1]).trimmingCharacters(in: .whitespaces)
            if filePart.hasPrefix("*") { filePart.removeFirst() }
            let baseName = (filePart as NSString).lastPathComponent
            if baseName == targetName && hash.count == 64 && hash.allSatisfy(\.isHexDigit) {
                return hash
            }
        }
        return nil
    }

    /// Verifies `fileURL` against `checksumsText` for `assetName`.
    /// Throws if `assetName` is listed and the digest mismatches.
    @discardableResult
    public static func verifyChecksum(fileURL: URL, assetName: String, checksumsText: String) throws -> Bool {
        guard let expected = parseChecksum(from: checksumsText, forAssetName: assetName) else {
            return false
        }
        let actual = try sha256Hex(of: fileURL)
        guard actual == expected else {
            throw DatabaseError("SHA-256 verification failed for \(assetName) (expected \(expected.prefix(12))…, got \(actual.prefix(12))…).")
        }
        return true
    }

    public static func fetchChecksums(from urlString: String) async throws -> String {
        guard isAllowedDownloadURL(urlString), let url = URL(string: urlString) else {
            throw DatabaseError("Refused to fetch checksums from untrusted URL.")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("KobeanSQL-Native-macOS-Updater", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw DatabaseError("Failed to download SHA256SUMS manifest (HTTP \(code)).")
        }
        if let finalHost = http.url?.host?.lowercased(), !allowedDownloadHosts.contains(finalHost) {
            throw DatabaseError("Redirected to untrusted checksum host (\(finalHost)).")
        }
        guard let text = String(data: data, encoding: .utf8) else {
            throw DatabaseError("Checksum manifest was not valid UTF-8.")
        }
        return text
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
        let checksumAsset = pickChecksumAsset(from: release.assets)

        return .release(
            version: normalizedVersion,
            name: release.name,
            notes: release.body,
            releaseURL: releaseURL,
            asset: asset,
            checksumAsset: checksumAsset,
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

    /// Generates and spawns a detached updater helper script that waits for the current app PID
    /// to close completely, unpacks `.zip` or mounts `.dmg`, clears Gatekeeper quarantine (`xattr -cr`),
    /// applies local ad-hoc signing (`codesign --force --deep --sign -`), atomically replaces
    /// `KobeanSQL.app` (with rollback safety and admin elevation fallback), and relaunches.
    public static func installAndRelaunch(
        downloadedFile: URL,
        currentBundlePath: String = Bundle.main.bundlePath,
        processID: Int32 = ProcessInfo.processInfo.processIdentifier,
        relaunchAfterInstall: Bool = true
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
        let scriptURL = updateDir.appendingPathComponent("kobeansql-updater-\(UUID().uuidString).sh")
        let script = buildInstallerScript(
            downloadedFile: downloadedFile.path,
            targetAppPath: targetAppPath,
            workDir: updateDir.path,
            processID: processID,
            relaunchAfterInstall: relaunchAfterInstall,
            selfScriptPath: scriptURL.path
        )
        try Data(script.utf8).write(to: scriptURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: scriptURL.path)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = [scriptURL.path]
        proc.standardInput = FileHandle.nullDevice

        let logPath = "/tmp/kobeansql-updater.log"
        FileManager.default.createFile(atPath: logPath, contents: nil)
        if let logHandle = FileHandle(forWritingAtPath: logPath) {
            logHandle.seekToEndOfFile()
            proc.standardOutput = logHandle
            proc.standardError = logHandle
        } else {
            proc.standardOutput = FileHandle.nullDevice
            proc.standardError = FileHandle.nullDevice
        }
        try proc.run()
    }

    public static func buildInstallerScript(
        downloadedFile: String,
        targetAppPath: String,
        workDir: String,
        processID: Int32 = ProcessInfo.processInfo.processIdentifier,
        relaunchAfterInstall: Bool = true,
        selfScriptPath: String? = nil
    ) -> String {
        func shQuote(_ s: String) -> String {
            "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
        }
        let selfCleanup = selfScriptPath.map { "  rm -f \(shQuote($0)) 2>/dev/null || true" } ?? ""
        let relaunchBlock = relaunchAfterInstall
            ? """
              sleep 0.2
              open -n "$TARGET_APP" || open "$TARGET_APP"
              """
            : "# Relaunch disabled"

        return """
        #!/usr/bin/env bash
        set -euo pipefail

        APP_PID=\(processID)
        ARCHIVE=\(shQuote(downloadedFile))
        TARGET_APP=\(shQuote(targetAppPath))
        PARENT_DIR="$(dirname "$TARGET_APP")"
        STAGE_DIR=\(shQuote(workDir))/extracted-\(UUID().uuidString)
        STAGED_APP="$STAGE_DIR/KobeanSQL.app"
        BACKUP_APP="$STAGE_DIR/KobeanSQL-previous.app"
        mkdir -p "$STAGE_DIR"

        EXT="${ARCHIVE##*.}"
        EXT_LOWER="$(echo "$EXT" | tr '[:upper:]' '[:lower:]')"
        MOUNT_POINT=""

        cleanup() {
          if [ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ]; then
            hdiutil detach "$MOUNT_POINT" -quiet || hdiutil detach "$MOUNT_POINT" -quiet -force 2>/dev/null || true
          fi
          rm -rf "$STAGE_DIR" 2>/dev/null || true
        \(selfCleanup)
        }
        trap cleanup EXIT

        # 1. Wait for current KobeanSQL process to exit completely (up to 20s)
        if [ "$APP_PID" -gt 0 ]; then
          for _ in $(seq 1 200); do
            if ! kill -0 "$APP_PID" 2>/dev/null; then
              break
            fi
            sleep 0.1
          done
        fi

        # 2. Extract updated app bundle from downloaded archive
        if [ "$EXT_LOWER" = "zip" ]; then
          EXTRACT_DIR="$STAGE_DIR/extract"
          mkdir -p "$EXTRACT_DIR"
          ditto -x -k "$ARCHIVE" "$EXTRACT_DIR"
          NEW_APP="$(find "$EXTRACT_DIR" -maxdepth 2 -name "*.app" | head -n 1)"
          if [ -z "${NEW_APP:-}" ] || [ ! -d "$NEW_APP" ]; then
            echo "No .app bundle found inside ZIP archive" >&2
            exit 1
          fi
          mv "$NEW_APP" "$STAGED_APP"
        elif [ "$EXT_LOWER" = "dmg" ]; then
          MOUNT_POINT="$STAGE_DIR/mnt"
          mkdir -p "$MOUNT_POINT"
          hdiutil attach "$ARCHIVE" -mountpoint "$MOUNT_POINT" -nobrowse -readonly -quiet
          NEW_APP="$(find "$MOUNT_POINT" -maxdepth 2 -name "*.app" | head -n 1)"
          if [ -z "${NEW_APP:-}" ] || [ ! -d "$NEW_APP" ]; then
            echo "No .app bundle found inside DMG image" >&2
            exit 1
          fi
          ditto "$NEW_APP" "$STAGED_APP"
          hdiutil detach "$MOUNT_POINT" -quiet || hdiutil detach "$MOUNT_POINT" -quiet -force 2>/dev/null || true
          MOUNT_POINT=""
        else
          echo "Unsupported update format: $EXT_LOWER" >&2
          exit 1
        fi

        # 3. Strip quarantine & apply local ad-hoc signature before swapping into place
        xattr -cr "$STAGED_APP" 2>/dev/null || true
        codesign --force --deep --sign - "$STAGED_APP" 2>/dev/null || true

        # 4. Atomically replace TARGET_APP (with rollback safety and admin fallback)
        if [ -w "$PARENT_DIR" ] && { [ ! -e "$TARGET_APP" ] || [ -w "$TARGET_APP" ]; }; then
          if [ -e "$TARGET_APP" ]; then
            mv "$TARGET_APP" "$BACKUP_APP"
          fi
          if ! mv "$STAGED_APP" "$TARGET_APP"; then
            if [ -e "$BACKUP_APP" ]; then
              mv "$BACKUP_APP" "$TARGET_APP" 2>/dev/null || true
            fi
            open "$ARCHIVE" 2>/dev/null || true
            exit 1
          fi
          rm -rf "$BACKUP_APP" 2>/dev/null || true
        else
          if ! osascript - "$STAGED_APP" "$TARGET_APP" <<'APPLESCRIPT'
        on run argv
          set stagedApp to quoted form of (item 1 of argv)
          set targetApp to quoted form of (item 2 of argv)
          do shell script "rm -rf " & targetApp & " && mv " & stagedApp & " " & targetApp with administrator privileges
        end run
        APPLESCRIPT
          then
            open "$ARCHIVE" 2>/dev/null || true
            exit 1
          fi
        fi

        # 5. Relaunch updated KobeanSQL.app
        \(relaunchBlock)
        """
    }
}
