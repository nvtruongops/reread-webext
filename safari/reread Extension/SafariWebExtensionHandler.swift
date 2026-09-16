//
//  SafariWebExtensionHandler.swift
//  reread Extension
//

import SafariServices

// The native side of `browser.runtime.sendNativeMessage` - which this
// extension never calls. The class has to exist because it is the extension
// point's principal class, so it answers the one thing it could ever be asked
// with an empty response and no logging: nothing a page does should end up in
// the system log.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: nil, completionHandler: nil)
    }

}
