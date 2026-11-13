# Bucket Storage App

A React web client for the Object Storage Service in `../bucket-storage-service`. It implements the HTTP contract in
[`docs/API-CONTRACT-SYNC.md`](../bucket-storage-service/docs/API-CONTRACT-SYNC.md) directly from the browser, including the service's custom
`OSS-HMAC-SHA256` request signing.

**What you can do**

| Area            | Features                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Credentials     | Create an access key (secret shown once), sign in with an existing key, revoke the current key                                              |
| Buckets         | List, create (with client-side name validation), delete                                                                                     |
| Objects         | Folder-style browsing (`prefix` + `/` delimiter), pagination, filter, multi-select delete, drag-and-drop upload, copy, download            |
| Uploads         | Per-file progress, queue with cancel/retry, user metadata, automatic multipart for files over 8 MiB (aborts the session on failure/cancel) |
| Object details  | Metadata, text/image/audio/video preview, presigned share links (5 min – 7 days), tags, per-key version history                             |
| Versions        | Bucket-wide version list with delete markers, download or permanently delete any version                                                    |
| Bucket settings | Versioning, default encryption, lifecycle rules, stored CORS rules, access policy statements                                               |

## Run it

You need the service running (see its README) — by default on `http://localhost:4000`.

```bash
npm install
npm run dev          # http://localhost:5173
```

Open the app, choose **New credentials**, enter an owner ID, save the secret it shows, and continue. The endpoint defaults to
`http://localhost:4000`; override it for every user with `VITE_OSS_ENDPOINT` (see `.env.example`) or change it on the connect screen.

Other scripts: `npm run build`, `npm run preview`, `npm run lint`, `npm test`.

## How it talks to the service

- **Direct calls, no proxy.** The service enables CORS for all origins, so the browser calls it directly. Requests are signed in the browser
  with Web Crypto (`src/api/sign.ts`), which requires a secure context: `http://localhost` or HTTPS. Opening the dev server through a LAN IP
  over plain HTTP will not work.
- **Signing** matches the service SDK: HMAC-SHA256 over `METHOD \n path \n sorted-query \n host:<host> \n host`. A unit test cross-checks the
  output against the SDK's Node implementation.
- **Presigned links** are used for previews and large downloads because they need no `Authorization` header. They cannot carry a
  `versionId`, so historical versions are fetched with a signed request instead.
- **Response headers are not relied on.** The service exposes no custom headers over CORS, so ETags, version IDs and request IDs always
  come from JSON bodies.
- **Known contract limits** are respected rather than worked around: `maxKeys` is never sent, multipart `Content-Type: application/json` is
  never used as a selector, parts are not retried automatically, and non-ASCII keys get a warning.

## Project layout

```
src/
  api/        client.ts (every endpoint), sign.ts (HMAC), uploader.ts (single/multipart), types.ts (wire shapes), errors.ts
  state/      connection (credentials in localStorage), uploads (global queue), toast, query keys
  components/ Dialog (native <dialog>), ObjectDrawer, UploadDialog/Panel, CopyDialog, PairsEditor, AppShell
  pages/      Connect, Buckets, BucketLayout, Objects, Versions, Settings
  lib/        formatting, validation, download helper
```

## Tests

```bash
npm test                                                   # unit tests
OSS_LIVE_ENDPOINT=http://localhost:4000 npm test           # plus an end-to-end run against a live service
```

The live suite creates its own access key and uniquely named bucket and removes them afterwards.

## Security notes

- The access key and secret are stored in this browser's `localStorage` so a reload keeps you signed in. Anyone with access to the
  browser profile (or any script running on this origin) can read them. Use it on machines you trust, and use **Sign out** or **Revoke key**
  when done. The service has no key-listing or secret-recovery endpoint, so a lost secret means creating a new key.
- The service's bootstrap endpoint accepts any owner ID without authentication. That is a property of the service's current development
  identity model, not something this app can change.
- Only the bucket owner is authorized by the UI's credentials: bucket lists are filtered by owner, and settings screens need an owner key.
