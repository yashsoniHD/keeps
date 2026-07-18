//
//  ShareViewController.swift
//  Clipnote share extension — "Share → Clipnote" from any app (share-and-forget).
//
//  This file is injected verbatim by mobile/plugins/withShareExtension.js at prebuild.
//  It is a hand-written native extension (no React Native runtime): it reads the Personal
//  Access Token the app parks in the shared App Group Keychain, POSTs the shared URL/text
//  to /api/ingest, and shows a compact confirmation card. Keep it dependency-free.
//
import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    // Must match src/lib/shared-credentials.ts and app.json ios.entitlements.
    private let apiURL = "https://clip-note-api-674775099277.us-central1.run.app/api/ingest"
    private let keychainService = "com.goheydigital.clipnote.pat"
    private let keychainAccount = "clipnote"
    private let keychainAccessGroup = "group.com.goheydigital.clipnote"

    private let card = UIView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let messageLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        buildCard()
        process()
    }

    // MARK: - UI

    private func buildCard() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.35)

        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = UIColor.systemBackground
        card.layer.cornerRadius = 20
        view.addSubview(card)

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        card.addSubview(spinner)

        messageLabel.translatesAutoresizingMaskIntoConstraints = false
        messageLabel.text = "Saving to Clipnote…"
        messageLabel.font = UIFont.systemFont(ofSize: 16, weight: .medium)
        messageLabel.textColor = UIColor.label
        messageLabel.numberOfLines = 0
        messageLabel.textAlignment = .center
        card.addSubview(messageLabel)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            card.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -32),

            spinner.topAnchor.constraint(equalTo: card.topAnchor, constant: 28),
            spinner.centerXAnchor.constraint(equalTo: card.centerXAnchor),

            messageLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 16),
            messageLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            messageLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
            messageLabel.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -28),
        ])
    }

    private func finish(_ text: String, success: Bool) {
        DispatchQueue.main.async {
            self.spinner.stopAnimating()
            self.spinner.isHidden = true
            self.messageLabel.text = text
            // Success: auto-dismiss. Failure: linger a moment longer so the message is readable.
            let delay: TimeInterval = success ? 0.9 : 1.8
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            }
        }
    }

    // MARK: - Keychain (shared App Group access group)

    private func readToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecAttrAccessGroup as String: keychainAccessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }

    // MARK: - Extract the shared item

    private func process() {
        guard let token = readToken() else {
            finish("Open Clipnote to reconnect.", success: false)
            return
        }
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let attachments = item.attachments else {
            finish("Nothing to save here.", success: false)
            return
        }

        // Prefer a real URL attachment; fall back to shared text (the backend promotes a URL
        // hidden inside shared text to a full capture on its own).
        let urlType = UTType.url.identifier
        let textType = UTType.plainText.identifier

        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
            provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] value, _ in
                guard let self = self else { return }
                if let url = value as? URL {
                    self.send(token: token, body: ["url": url.absoluteString])
                } else if let s = value as? String, !s.isEmpty {
                    self.send(token: token, body: ["url": s])
                } else {
                    self.finish("Couldn't read what you shared.", success: false)
                }
            }
            return
        }

        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(textType) }) {
            provider.loadItem(forTypeIdentifier: textType, options: nil) { [weak self] value, _ in
                guard let self = self else { return }
                if let s = value as? String, !s.isEmpty {
                    self.send(token: token, body: ["input_type": "text", "text": s, "process_ai": true])
                } else {
                    self.finish("Couldn't read what you shared.", success: false)
                }
            }
            return
        }

        finish("Clipnote can only save links and text.", success: false)
    }

    // MARK: - POST /api/ingest

    private func send(token: String, body: [String: Any]) {
        var payload = body
        payload["source"] = "shortcut"

        guard let url = URL(string: apiURL),
              let data = try? JSONSerialization.data(withJSONObject: payload) else {
            finish("Couldn't save. Please try again.", success: false)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = data
        request.timeoutInterval = 20

        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            guard let self = self else { return }
            if error != nil {
                self.finish("Couldn't save. Check your connection.", success: false)
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            switch status {
            case 200..<300:
                self.finish("Saved to Clipnote", success: true)
            case 401:
                self.finish("Open Clipnote to reconnect.", success: false)
            default:
                self.finish("Couldn't save. Please try again.", success: false)
            }
        }.resume()
    }
}
