// Pagination constants matching the Rust PDF generator (src-tauri/src/pdf/mod.rs)
// Keep these in sync with the Rust constants!

// Page dimensions in points (72 points = 1 inch)
export const PAGE_WIDTH_PT = 612; // 8.5 inches
export const PAGE_HEIGHT_PT = 792; // 11 inches

// Margins in points
export const MARGIN_TOP_PT = 72; // 1 inch
export const MARGIN_BOTTOM_PT = 72; // 1 inch
export const MARGIN_LEFT_PT = 108; // 1.5 inches
export const MARGIN_RIGHT_PT = 72; // 1 inch

// Typography
export const FONT_SIZE_PT = 12;
export const LINE_HEIGHT_PT = 12; // Single-spaced Courier
export const CHAR_WIDTH_PT = 7.2; // Approximate width of Courier character at 12pt

// Element indents (from left margin)
export const CHARACTER_INDENT_PT = 144; // 2 inches from margin
export const DIALOGUE_INDENT_PT = 72; // 1 inch from margin
export const DIALOGUE_WIDTH_PT = 252; // 3.5 inches
export const PARENTHETICAL_INDENT_PT = 108; // 1.5 inches from margin
export const PARENTHETICAL_WIDTH_PT = 144; // 2 inches

// Derived values
export const CONTENT_WIDTH_PT = PAGE_WIDTH_PT - MARGIN_LEFT_PT - MARGIN_RIGHT_PT; // 432pt = 6 inches
export const CONTENT_HEIGHT_PT = PAGE_HEIGHT_PT - MARGIN_TOP_PT - MARGIN_BOTTOM_PT; // 648pt = 9 inches
export const LINES_PER_PAGE = Math.floor(CONTENT_HEIGHT_PT / LINE_HEIGHT_PT); // 54 lines

// Pixel conversions (96 DPI for screen)
export const PT_TO_PX = 96 / 72; // 1.333...
export const PAGE_WIDTH_PX = PAGE_WIDTH_PT * PT_TO_PX; // ~816px
export const PAGE_HEIGHT_PX = PAGE_HEIGHT_PT * PT_TO_PX; // ~1056px
export const PAGE_GAP_PX = 40; // Visual gap between pages
