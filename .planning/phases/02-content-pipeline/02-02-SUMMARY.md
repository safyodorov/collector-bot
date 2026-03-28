---
phase: 02-content-pipeline
plan: 02
subsystem: ui
tags: [grammy, inline-keyboard, telegram, navigation]

requires:
  - phase: 02-content-pipeline/01
    provides: "CATEGORY_MAP and CATEGORY_TAGS constants in config.ts"
provides:
  - "5 keyboard builders for two-level category/subcategory/tag navigation"
  - "buildCategoryKeyboard, buildSubcategoryKeyboard, buildTagKeyboard, buildTitleKeyboard, buildDuplicateKeyboard"
affects: [02-content-pipeline/03]

tech-stack:
  added: []
  patterns: ["Two-level drill-down navigation replacing flat multi-select"]

key-files:
  created: [src/keyboards/navigation.ts]
  modified: []

key-decisions:
  - "Callback data prefixes: nav: for navigation, tag: for tags, title: for title, dup: for dedup"
  - "2-column layout for both category and subcategory keyboards"
  - "Tag toggle with checkmark prefix, count shown in Готово button"

patterns-established:
  - "Keyboard builder pattern: pure functions returning InlineKeyboard, no side effects"
  - "Back button pattern: 'Просто в {label}' with _root suffix callback"

requirements-completed: [NAVG-01, NAVG-02, NAVG-03, NAVG-04, TAGS-01, TAGS-02, TAGS-03]

duration: 2min
completed: 2026-03-28
---

# Phase 02 Plan 02: Navigation Keyboards Summary

**Five keyboard builders for two-level category drill-down replacing flat hashtag multi-select, with category-specific tag toggles**

## What Was Built

Created `src/keyboards/navigation.ts` with 5 exported functions:

1. **buildCategoryKeyboard()** -- 8 category buttons in 2-column grid with Cancel row. Iterates CATEGORY_MAP entries, uses `nav:{key}` callback data.

2. **buildSubcategoryKeyboard(categoryKey)** -- Dynamic subcategory buttons for categories that have subs (Бизнес has 7, Ландшафт/ТОС/Рецепты have 3-4, Семья has 2). Includes "Просто в {label}" back button with `nav:{key}_root` callback. Throws if category has no subcategories.

3. **buildTagKeyboard(categoryKey, selectedTags)** -- Category-specific tags from CATEGORY_TAGS with toggle checkmarks. Shows "Готово (N)" when tags selected, plain "Готово" otherwise. Includes "Без тегов" and "Написать свой" options.

4. **buildTitleKeyboard()** -- Single "Пропустить" button (same as old hashtags.ts).

5. **buildDuplicateKeyboard()** -- "Сохранить как новую" / "Отменить" (same as old hashtags.ts).

Old `src/keyboards/hashtags.ts` preserved for current bot.ts until Phase 03 cutover.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 886d85b | All 5 keyboard builders in navigation.ts |

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all keyboard builders are fully functional. They depend on CATEGORY_MAP/CATEGORY_TAGS from config.ts (created by plan 02-01).

## Self-Check: PASSED
