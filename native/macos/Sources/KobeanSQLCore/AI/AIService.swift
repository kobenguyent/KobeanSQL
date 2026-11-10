import Foundation

/// Local-only AI SQL assistant (Ollama or local OpenAI-compatible server).
/// Mirrors `src/main/ai/service.ts` and enforces the GEMINI.md mandate:
/// only loopback hosts (`localhost`, `127.*`, `::1`) are permitted.
public struct AISettings: Codable, Hashable, Sendable {
    public enum Provider: String, Codable, CaseIterable, Identifiable, Sendable {
        case ollama
        case openAICompatible = "openai-compatible"

        public var id: String { rawValue }
        public var label: String {
            switch self {
            case .ollama: "Ollama (local)"
            case .openAICompatible: "OpenAI-Compatible (LM Studio / llama.cpp)"
            }
        }
    }

    public var provider: Provider
    public var baseURL: String
    public var model: String

    public init(provider: Provider = .ollama, baseURL: String = "http://127.0.0.1:11434", model: String = "llama3.1") {
        self.provider = provider
        self.baseURL = baseURL
        self.model = model
    }
}

public enum AITask: String, CaseIterable, Identifiable, Sendable {
    case generate, explain, optimize
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .generate: "Generate Query"
        case .explain: "Explain Query"
        case .optimize: "Optimize Query"
        }
    }
}

public enum AIService {
    /// Returns `nil` when `urlString` points to a loopback address, or an error message otherwise.
    public static func validateLocalURL(_ urlString: String) -> String? {
        guard let comps = URLComponents(string: urlString),
              let scheme = comps.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = comps.host?.lowercased(), !host.isEmpty else {
            return "Invalid AI base URL"
        }
        let isLoopback = host == "localhost"
            || host == "::1"
            || host == "0:0:0:0:0:0:0:1"
            || (host.hasPrefix("127.") && host.split(separator: ".").count == 4 && host.split(separator: ".").allSatisfy { UInt8($0) != nil })
        return isLoopback ? nil : "Local AI only (localhost / 127.0.0.1 required)"
    }

    public static func run(
        task: AITask,
        prompt: String = "",
        sql: String = "",
        dialect: DatabaseType = .postgres,
        schemaContext: String = "",
        settings: AISettings
    ) async throws -> String {
        if let err = validateLocalURL(settings.baseURL) {
            throw DatabaseError(err)
        }
        let systemPrompt = "You are a senior SQL database expert. Local AI only. Plain text only."
            + (schemaContext.isEmpty ? "" : "\nSCHEMA:\n\(schemaContext)")
        let userContent: String
        switch task {
        case .generate:
            userContent = "Generate \(dialect.rawValue) (\(dialect.languageName)) for: \(prompt)"
        case .explain:
            userContent = "Explain this \(dialect.rawValue):\n\(sql)"
        case .optimize:
            userContent = "Optimize this \(dialect.rawValue):\n\(sql)"
        }

        let trimmedBase = settings.baseURL.replacingOccurrences(of: #"/+$"#, with: "", options: .regularExpression)
        let endpoint: String
        let bodyObj: [String: Any]
        switch settings.provider {
        case .ollama:
            endpoint = "\(trimmedBase)/api/generate"
            bodyObj = [
                "model": settings.model,
                "prompt": "\(systemPrompt)\n\(userContent)",
                "stream": false
            ]
        case .openAICompatible:
            endpoint = "\(trimmedBase)/chat/completions"
            bodyObj = [
                "model": settings.model,
                "messages": [
                    ["role": "system", "content": systemPrompt],
                    ["role": "user", "content": userContent]
                ]
            ]
        }

        guard let url = URL(string: endpoint) else {
            throw DatabaseError("Invalid AI endpoint URL")
        }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: bodyObj)

        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw DatabaseError("AI service returned HTTP \(status)")
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw DatabaseError("Invalid response from local AI service")
        }
        if settings.provider == .ollama, let resp = json["response"] as? String {
            return resp.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let choices = json["choices"] as? [[String: Any]],
           let msg = choices.first?["message"] as? [String: Any],
           let content = msg["content"] as? String {
            return content.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        throw DatabaseError("Empty response from local AI service")
    }
}
