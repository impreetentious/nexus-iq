# vendor/

Mirrored third-party tarballs used for supply-chain hardening.

- `xlsx-0.20.3.tgz` — SheetJS Community Edition, fetched from the official
  SheetJS CDN (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`). The
  package.json dependency is `file:./vendor/xlsx-0.20.3.tgz` so installs do
  not depend on the live CDN at `npm ci` time. Integrity is recorded in
  `package-lock.json`. Re-vendor by re-downloading the same URL and refreshing
  the lockfile when SheetJS publishes a newer pin.
