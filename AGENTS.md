# AGENTS.md

This file tells coding agents how to work in this repo.
Keep changes small, follow existing patterns, and document assumptions.

## Project summary
- Static site for GameDevHobby.com devlog.
- Built with Hugo and the Blowfish theme.
- Uses git submodules for themes:
  - themes/blowfish
  - themes/hugo-shortcodes

## Repo layout
- content/ posts, pages, and project pages.
- assets/ site-wide images and media.
- config/_default/ site configuration in TOML.
- themes/ theme submodules and theme assets.
- .github/workflows/ CI build for GitHub Pages.

## Key config files
- config/_default/hugo.toml (baseURL, theme list, taxonomies).
- config/_default/params.toml (theme settings).
- config/_default/menus.en.toml (navigation menus).
- config/_default/markup.toml (Markdown renderer settings).
- config/_default/module.toml (Hugo module config).

## Submodules
- Themes are git submodules; keep them in sync when cloning.
- Update intentionally, not casually, since theme updates can be large.
- Prefer adjusting config over editing theme source.

## Shortcodes
- Extra shortcodes live in themes/hugo-shortcodes/layouts/shortcodes/.
- Use Hugo shortcode syntax: {{< shortcode >}}.

## Prerequisites
- Hugo Extended (see CI version below).
- Node.js + npm (used for Blowfish tools).
- Git submodules initialized.
- Optional: Dart Sass if you work on theme assets.

## Setup
- Initialize submodules after clone:
  - git submodule update --init --recursive
- Install Node tooling only if you need Blowfish tools or theme assets.

## Common commands (root)
- Dev server with drafts:
  - npm run start
  - runs: hugo server --buildDrafts -p 1313
- Blowfish config tooling:
  - npm run config
  - runs: npx blowfish-tools
- Local production build (closest to CI):
  - hugo --gc --minify
- Clean build cache if needed:
  - hugo --gc --minify --cacheDir <temp>

## CI build (GitHub Pages)
- Workflow: .github/workflows/hugo.yml
- Uses Hugo Extended 0.148.0 and Dart Sass 1.89.2.
- Build command:
  - hugo --gc --minify --baseURL <pages-url>/ --cacheDir <temp>

## Tests
- No test framework configured in the root site.
- Single test command: not applicable.

## Linting and formatting
- No root lint or format scripts.
- Do not introduce new linters without approval.

## Content authoring (Hugo)
- Content uses page bundles:
  - Example: content/posts/draft-devlog/index.md
  - Example: content/projects/Clone-Station/index.md
- Place per-page images next to the index.md in the bundle.
- Use relative image links like: ![Alt](image.png)
- Avoid leading slashes in asset paths unless required by Hugo.

## Front matter conventions
- Existing content uses YAML front matter (--- blocks).
- Archetype uses TOML (+++), but follow the folder you are editing.
- Common fields used:
  - title
  - date
  - draft
  - summary
  - description
  - topics
  - showHero
  - showAuthor
  - showDate
- Keep titles in Title Case when consistent with existing pages.
- Use draft: true for in-progress posts.

## Markdown style
- Keep headings in logical order (##, ###, etc.).
- Prefer short paragraphs and clear lists.
- Keep links relative when pointing to site pages.

## Images and assets
- Site-wide branding assets live in assets/.
- Content-specific images live in the page bundle folder.
- If you add new assets, use descriptive filenames.
- Keep filenames consistent with existing patterns (kebab-case or existing style).

## Theme edits (only if required)
- themes/blowfish is a git submodule.
- Avoid editing theme files unless the change must be theme-level.
- If you do edit the theme:
  - Use 2 spaces for indentation.
  - Use LF line endings and final newline.
  - Trim trailing whitespace (except Markdown).
  - Follow Prettier rules in themes/blowfish/.prettierrc.
  - Follow conventions in themes/blowfish/CONTRIBUTING.md.
  - Prefer partials to avoid template duplication.
  - Use i18n for static text in theme templates.

## Theme commands (only if editing theme)
- Run in themes/blowfish/:
  - npm run dev (Tailwind watch)
  - npm run build (Tailwind production)
  - npm run dev-windows / npm run build-windows
  - npm run example (theme example site)

## Types, imports, and error handling
- This repo is primarily Markdown and Hugo templates.
- For theme JS/TS files, follow Blowfish conventions.
- Avoid introducing new runtime dependencies in the root unless needed.
- Handle errors by surfacing them in logs or CI output.

## CI and deployment notes
- CI installs submodules and builds Hugo for GitHub Pages.
- Do not change baseURL without updating config and CI if needed.
- Keep hugo.toml in config/_default/ as the source of truth.

## Cursor and Copilot rules
- No .cursorrules or .github/copilot-instructions.md found.
- No .cursor/rules/ directory found.

## Quick checklist for changes
- Update content under content/ only.
- Keep front matter consistent with existing pages.
- Use relative asset paths and keep images in bundles.
- Run hugo server to verify content renders.
- If editing theme, run theme build commands in themes/blowfish/.
