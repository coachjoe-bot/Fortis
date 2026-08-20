// Server-side alias for the shared feature-flag module — same pattern as
// _grit.js/_units.js. Import flags from here in api/*; never redefine one
// (a hand-copied flag is exactly how client and server drift apart).
export * from "../src/flags.js";
