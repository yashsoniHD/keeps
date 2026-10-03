# Mobile API URL (pending cutover)

The mobile app still points at the old Cloud Run backend, which is being retired in favour of Vercel.
After cutover, change the URL in `mobile/src/lib/config.ts` (`PROD_API_URL`) and in
`mobile/plugins/share-extension/ShareViewController.swift` (`apiURL`) to the Vercel production URL.
The upload and voice endpoints (`/api/ingest/upload`, voice ingest) no longer exist; links and text only.
