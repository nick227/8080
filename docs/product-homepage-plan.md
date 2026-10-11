# 8080 homepage: business directory

> Historical directory iteration. The current homepage and Reader direction is [Blueprint Catalog and Reader](blueprint-catalog-plan.md); the eight-profile layout below has been superseded.

Updated 10 October 2026. This replaces the initial product landing-page layout.

## Direction

The homepage should feel like browsing a community of businesses. Use the familiar structure of a video directory: persistent navigation, search, category filters, image-led cards, and profiles. Workspaces are the content of the page. Keep the explanation of 8080 short and secondary.

Copy stays pragmatic, literal, and simple. No slogans, abstract benefit headings, promotional statistics, invented activity counts, or claims that examples are real businesses using 8080.

## Implemented layout

- Header: 8080, workspace search, Create workspace, theme selector, account/sign-in.
- Navigation rail: Browse workspaces, Your workspaces, Conversations; signed-in users' workspace shortcuts; Create a workspace; a short explanation of 8080.
- Category filters: All, Food & drink, Design & media, Shops & retail, Spaces & interiors, Services & trades.
- Main heading: Workspaces. One explanatory sentence, then the directory.
- Three cards per row at typical desktop widths, four on wide screens, two on tablets, one on phones.
- Each card has a 16:9 photograph, business mark, name, description, category, and location.
- Profile pages show a larger cover, business description, and examples of records/documents used in that workspace.
- “About 8080 and workspaces” is an expandable section below the directory.

Use existing application theme tokens for the interface, the existing sans family for navigation and descriptions, and mono sparingly for utility labels. Photographs and individual business marks supply the visual variety. Preserve the user's chosen theme.

## Data boundary

The current server API provides membership-only workspace listings. It does not provide a public business directory or a public-listing consent setting.

This implementation uses eight explicitly labeled fictional profiles to make the directory design reviewable. The page says “Example directory,” each card says “Example,” and profile pages repeat that the business is fictional. Search is labeled “Search example workspaces.” Actual memberships are displayed separately and link to the existing private company routes.

Photos are locally stored stock photographs with source URLs in `apps/web/public/workspace-examples/SOURCES.md`. They illustrate business types; they do not identify businesses using 8080.

A real community directory requires a subsequent opt-in public profile feature. It must use explicitly published fields and keep internal company records and membership permissions unchanged. This redesign does not publish existing company information.

## Interactions

- Search matches example business names, descriptions, categories, and locations.
- Search and category filters combine; matching results and count update immediately.
- Search and category state are URL parameters, preserved when opening a profile and returning with Back.
- No results displays a clear explanation and a Clear search and filters action.
- Clicking a card opens its profile through the `example` URL parameter. Focus moves to the profile heading.
- Fieldwork Studio retains the interactive contact/document/conversation example, including keyboard tab navigation.
- Browse workspaces returns to the directory. Your workspaces opens the full membership list.
- Creating a workspace continues to ask for a company name. Guest authentication resumes creation, including the fixed Google return intent.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Browse business workspace examples. |
| `/?q=…&category=…` | Filtered directory. |
| `/?example=…` | Fictional business profile; preserves directory filters. |
| `/workspaces` | The signed-in account's memberships. |
| `/workspaces/new` | Named workspace creation, after authentication when needed. |
| `/conversations` | Existing personal/public conversation discovery and creation. |
| `/c/:workspaceId…` | Existing company destinations. |
| `/room/:roomId…` | Existing conversation destinations and invitations. |
| `/?record=1` | Compatible entry into conversation creation. |

## Verification

TypeScript and focused browser checks cover guest/member/empty/error states; search and category filtering; profile navigation and browser Back; keyboard operation of the example; authentication continuation; workspace creation/retry; conversation entry/cancel; local image loading; reduced motion; and desktop/mobile layouts in dark, light, retro-terminal, and ultra-large themes.

Browser checks use mocked API responses. Live Google sign-in and a public directory backend are outside this implementation. Screenshots are saved in `artifacts/homepage/`.

## Subsequent site-wide decisions

The user adopted this directory layout as the basis of the whole site. [The shared shell contract](8080-redesign-proposal/15-site-shell.md) now fixes common header/navigation geometry and reversible collapse; current route-specific wrappers will be migrated to it. [The Business templates epic](business-templates-epic.md) promotes the fictional business examples into useful, versioned plan/task/document packages, with separate preview data and private operational copies. These are planned follow-ups, not features already implemented by the directory redesign.
