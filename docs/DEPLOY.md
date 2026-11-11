# Deploying Baize

The editor is a static site. It is hosted on Cloudflare Pages through Cloudflare's own Git integration: Cloudflare builds and publishes on every push. GitHub Actions only runs checks and holds no Cloudflare secrets.

Running cost is zero. The Pages free plan covers static sites, works with private GitHub repositories, and includes 500 builds a month.

## One-time setup (project owner, about five minutes)

1. Sign in at <https://dash.cloudflare.com> (a free account is enough).
2. Go to **Workers & Pages**, choose **Create**, then the **Pages** tab, then **Connect to Git**.
3. Authorise the Cloudflare GitHub app. Grant it access to the `baize` repository only, not all repositories.
4. Select the repository and enter these build settings:

| Setting | Value |
|---|---|
| Project name | `baize` (this becomes `baize.pages.dev` if the name is free) |
| Production branch | `main` |
| Framework preset | None |
| Build command | `pnpm --filter web build` |
| Build output directory | `apps/web/dist` |
| Root directory | leave empty (repository root) |

5. Under **Environment variables**, add `NODE_VERSION` = `24` for both Production and Preview. The repo also has a `.node-version` file, but setting the variable removes any doubt.
6. Save and deploy.

Cloudflare detects pnpm from `pnpm-lock.yaml` and takes the pnpm version from the `packageManager` field in the root `package.json`. It runs the install step itself, so the build command does not include `pnpm install`.

The dashboard wording changes from time to time. If a label above does not match, the values in the table are what matter.

## What happens after setup

- Every push to `main` builds and publishes the production site.
- Every pull request gets its own preview URL, posted on the pull request by Cloudflare.
- A failed build leaves the previous deployment live.

## Checking it works

- Open the `*.pages.dev` URL shown on the project page. The placeholder page shows the title "Baize".
- If the build fails, open the deployment's build log. The usual causes are a wrong output directory or a Node version older than 22.

## Keeping the cost at zero

- Do not add Pages Functions, Workers, KV, R2 or analytics products to this project. None are needed: the app has no backend.
- A custom domain is optional and is the only thing here that could cost money (the domain itself).
- If preview builds ever approach the 500 a month limit, turn off preview deployments for non-production branches in the project's build settings.
