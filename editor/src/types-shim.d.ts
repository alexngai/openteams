// Type shim consumed by the library build.
//
// The full `.d.ts` emit isn't viable in v1 because the editor imports
// types from the openteams parent package (`@openteams/template/types`),
// which TS refuses to inline under a clean `rootDir`. Rather than fight
// the build, the library ships JS-only and consumers either:
//
//   - Use the editor as untyped (`any`), or
//   - Declare a thin module shim (see openhive's `src/web/types/openteams-editor.d.ts`).
//
// This file exists so the editor's own dev build still typechecks the
// new exports without requiring the consumer to pull in openteams types.
