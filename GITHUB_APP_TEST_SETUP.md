# GitHub App Test Harness

This Tauri build now includes a focused test screen for proving a GitHub App can be used through a DigitalOcean-hosted broker instead of storing the GitHub App private key in the desktop app.

## Desktop configuration

Set these environment variables before starting the Tauri app:

- `GITHUB_APP_BROKER_BASE_URL`
  Example: `https://your-digitalocean-app.ondigitalocean.app`
- `GITHUB_APP_BROKER_TOKEN` (optional)
  If your broker requires a bearer token for API calls from the desktop app.

The desktop app will always expect the browser callback to come back to:

- `http://127.0.0.1:45873/github/app/setup`

## Broker routes

The test screen assumes your DigitalOcean service exposes these routes:

- `GET /github-app/install/start`
  Query params:
  - `state`
  - `desktop_redirect_uri`
  Behavior:
  - Redirect the browser to the GitHub App installation URL for your app.
  - Preserve `state`.
  - After GitHub finishes installation, redirect the browser back to `desktop_redirect_uri` with `installation_id` and `state`.

- `GET /api/github-app/installations/{installation_id}`
  Return JSON shaped like:

```json
{
  "installationId": 123,
  "accountLogin": "example-org",
  "accountType": "Organization",
  "accountAvatarUrl": "https://avatars.githubusercontent.com/u/1?v=4",
  "accountHtmlUrl": "https://github.com/example-org"
}
```

- `GET /api/github-app/installations/{installation_id}/repositories`
  Return JSON shaped like:

```json
[
  {
    "id": 1,
    "name": "repo-name",
    "fullName": "example-org/repo-name",
    "htmlUrl": "https://github.com/example-org/repo-name",
    "private": true,
    "description": "Repository description"
  }
]
```

## What this proves

When the test flow works end to end, we know the production app can follow the same model:

- Tauri opens the broker instead of talking to GitHub App secrets directly.
- The broker handles GitHub App setup and token minting.
- The desktop app only receives an installation ID and uses broker APIs for follow-up GitHub calls.
