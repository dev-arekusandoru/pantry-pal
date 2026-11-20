# Landing page

The landing page is a static Astro site in `landing/`. It is not part of the
Rakumi app. Self-hosters do not need it. This page shows how to publish it to
Cloudflare Pages.

## Edit the page

| What | Where |
| --- | --- |
| Prices, trial length, links, waitlist URL | `landing/src/config.ts` |
| Comparison rows, FAQ, how-it-works steps | `landing/src/data/` |
| Site URL, sitemap | `landing/astro.config.mjs` |

Run `pnpm landing:dev` to preview. Run `pnpm landing:build` to build into
`landing/dist/`.

## Publish to Cloudflare Pages

1. Build the page: `pnpm landing:build`.
2. Sign in: `pnpm dlx wrangler login`.
3. Create the project, one time only:
   `pnpm dlx wrangler pages project create rakumi --production-branch main`.
4. Deploy: `pnpm dlx wrangler pages deploy landing/dist --project-name rakumi`.
   Run steps 1 and 4 again for each update.
5. In the Cloudflare dashboard, open **Workers & Pages**, then **rakumi**, then
   **Custom domains**. Add `rakumi.app`. Cloudflare creates the DNS record when
   the domain is in the same account.
6. Optional: add `www.rakumi.app` the same way. Add a redirect rule from `www`
   to `rakumi.app`.

The waitlist form needs the Worker to allow the site origin. See
[Waitlist](waitlist.md).
