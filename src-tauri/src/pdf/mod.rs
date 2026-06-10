use printpdf::*;
use serde::Deserialize;
use std::fs::File;
use std::io::BufWriter;

// Screenplay formatting constants (in points, 72 points = 1 inch)
const PAGE_WIDTH: f32 = 612.0; // 8.5 inches
const PAGE_HEIGHT: f32 = 792.0; // 11 inches
const MARGIN_TOP: f32 = 72.0; // 1 inch
const MARGIN_BOTTOM: f32 = 72.0; // 1 inch
const MARGIN_LEFT: f32 = 108.0; // 1.5 inches
const MARGIN_RIGHT: f32 = 72.0; // 1 inch
const FONT_SIZE: f32 = 12.0;
const LINE_HEIGHT: f32 = 12.0; // Single-spaced Courier

// Element indents (from left margin)
const CHARACTER_INDENT: f32 = 144.0; // 2 inches from margin
const DIALOGUE_INDENT: f32 = 72.0; // 1 inch from margin
const DIALOGUE_WIDTH: f32 = 252.0; // 3.5 inches
const PARENTHETICAL_INDENT: f32 = 108.0; // 1.5 inches from margin
const PARENTHETICAL_WIDTH: f32 = 144.0; // 2 inches

// Font metrics for line wrapping / centering estimates
const COURIER_CHAR_WIDTH: f32 = 7.2; // Courier at 12pt
const HELVETICA_CHAR_WIDTH_RATIO: f32 = 0.52; // average glyph width per pt of font size

// Free write formatting (1 inch margins, proportional type)
const FW_MARGIN_LEFT: f32 = 72.0;
const FW_MARGIN_RIGHT: f32 = 72.0;
const FW_BODY_SIZE: f32 = 11.0;
const FW_BODY_LINE_HEIGHT: f32 = 16.0;
const FW_TITLE_SIZE: f32 = 22.0;
const FW_TITLE_LINE_HEIGHT: f32 = 27.0;
const FW_HEADING_SIZE: f32 = 15.0;
const FW_HEADING_LINE_HEIGHT: f32 = 20.0;
const FW_LIST_INDENT: f32 = 22.0;
const FW_BLOCK_SPACING: f32 = 5.0;
const FW_LIST_SPACING: f32 = 3.0;
const FW_TITLE_SPACE_BEFORE: f32 = 10.0;
const FW_TITLE_SPACE_AFTER: f32 = 6.0;
const FW_HEADING_SPACE_BEFORE: f32 = 12.0;
const FW_HEADING_SPACE_AFTER: f32 = 2.0;

#[derive(Debug, Deserialize)]
pub struct TitlePageData {
    pub title: Option<String>,
    pub credit: Option<String>,
    pub author: Option<String>,
    pub source: Option<String>,
    #[serde(rename = "draftDate")]
    pub draft_date: Option<String>,
    pub contact: Option<String>,
    pub copyright: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MarkNode {
    #[serde(rename = "type")]
    pub mark_type: String,
}

#[derive(Debug, Deserialize)]
pub struct DocumentNode {
    #[serde(rename = "type")]
    pub node_type: String,
    pub content: Option<Vec<DocumentNode>>,
    pub text: Option<String>,
    pub attrs: Option<serde_json::Value>,
    pub marks: Option<Vec<MarkNode>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct TextStyle {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
}

#[derive(Debug, Clone)]
struct StyledSegment {
    text: String,
    style: TextStyle,
}

// Helvetica AFM glyph widths (per 1000 units of font size) for ASCII 32..=126
const HELVETICA_WIDTHS: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // ' '..'/'
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // '0'..'9'
    278, 278, 584, 584, 584, 556, 1015, // ':'..'@'
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, // 'A'..'P'
    778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // 'Q'..'Z'
    278, 278, 278, 469, 556, 333, // '['..'`'
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, // 'a'..'p'
    556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // 'q'..'z'
    334, 260, 334, 584, // '{'..'~'
];

const HELVETICA_BOLD_WIDTHS: [u16; 95] = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, // ' '..'/'
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // '0'..'9'
    333, 333, 584, 584, 584, 611, 975, // ':'..'@'
    722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, // 'A'..'P'
    778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // 'Q'..'Z'
    333, 278, 333, 584, 556, 333, // '['..'`'
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, // 'a'..'p'
    611, 389, 556, 333, 611, 556, 778, 556, 556, 500, // 'q'..'z'
    389, 280, 389, 584, // '{'..'~'
];

fn helvetica_width_units(c: char, bold: bool) -> u16 {
    let table = if bold {
        &HELVETICA_BOLD_WIDTHS
    } else {
        &HELVETICA_WIDTHS
    };

    let code = c as usize;
    if (32..=126).contains(&code) {
        table[code - 32]
    } else {
        556 // average fallback for characters outside printable ASCII
    }
}

/// Word-wraps styled characters by character count, mirroring `wrap_text`
fn wrap_styled(chars: &[(char, TextStyle)], max_chars: usize) -> Vec<Vec<(char, TextStyle)>> {
    let mut words: Vec<Vec<(char, TextStyle)>> = Vec::new();
    let mut current_word: Vec<(char, TextStyle)> = Vec::new();

    for (c, style) in chars {
        if c.is_whitespace() {
            if !current_word.is_empty() {
                words.push(std::mem::take(&mut current_word));
            }
        } else {
            current_word.push((*c, *style));
        }
    }
    if !current_word.is_empty() {
        words.push(current_word);
    }

    let mut lines: Vec<Vec<(char, TextStyle)>> = Vec::new();
    let mut line: Vec<(char, TextStyle)> = Vec::new();

    for word in words {
        if line.is_empty() {
            line = word;
        } else if line.len() + 1 + word.len() <= max_chars {
            let prev = line.last().map(|(_, s)| *s).unwrap_or_default();
            let next = word.first().map(|(_, s)| *s).unwrap_or_default();
            // Joining spaces keep decorations only when both neighbors share them
            let space_style = TextStyle {
                bold: prev.bold,
                italic: prev.italic,
                underline: prev.underline && next.underline,
                strike: prev.strike && next.strike,
            };
            line.push((' ', space_style));
            line.extend(word);
        } else {
            lines.push(std::mem::take(&mut line));
            line = word;
        }
    }

    if !line.is_empty() {
        lines.push(line);
    }

    if lines.is_empty() {
        lines.push(Vec::new());
    }

    lines
}

/// Groups a wrapped line into runs of identical style
fn to_segments(line: &[(char, TextStyle)]) -> Vec<StyledSegment> {
    let mut segments: Vec<StyledSegment> = Vec::new();

    for (c, style) in line {
        match segments.last_mut() {
            Some(last) if last.style == *style => last.text.push(*c),
            _ => segments.push(StyledSegment {
                text: c.to_string(),
                style: *style,
            }),
        }
    }

    segments
}

#[derive(Debug, Deserialize)]
pub struct ScreenplayContent {
    #[serde(rename = "type")]
    pub doc_type: String,
    pub content: Option<Vec<DocumentNode>>,
}

pub struct PdfGenerator {
    doc: PdfDocumentReference,
    current_page: PdfPageIndex,
    current_layer: PdfLayerIndex,
    font: IndirectFontRef,
    bold_font: IndirectFontRef,
    italic_font: IndirectFontRef,
    bold_italic_font: IndirectFontRef,
    is_sans: bool,
    char_width: f32,
    y_position: f32,
    page_number: i32,
    has_title_page: bool,
}

impl PdfGenerator {
    pub fn new(title: &str, document_mode: &str) -> Result<Self, String> {
        let (doc, page1, layer1) = PdfDocument::new(
            title,
            Mm::from(Pt(PAGE_WIDTH)),
            Mm::from(Pt(PAGE_HEIGHT)),
            "Layer 1",
        );

        // Free write uses a clean proportional font; script modes use Courier
        let is_freewrite = document_mode == "freewrite";
        let (regular, bold, italic, bold_italic) = if is_freewrite {
            (
                BuiltinFont::Helvetica,
                BuiltinFont::HelveticaBold,
                BuiltinFont::HelveticaOblique,
                BuiltinFont::HelveticaBoldOblique,
            )
        } else {
            (
                BuiltinFont::Courier,
                BuiltinFont::CourierBold,
                BuiltinFont::CourierOblique,
                BuiltinFont::CourierBoldOblique,
            )
        };

        let add_font = |builtin: BuiltinFont| {
            doc.add_builtin_font(builtin)
                .map_err(|e| format!("Failed to add font: {}", e))
        };

        let font = add_font(regular)?;
        let bold_font = add_font(bold)?;
        let italic_font = add_font(italic)?;
        let bold_italic_font = add_font(bold_italic)?;

        let char_width = if is_freewrite {
            FONT_SIZE * HELVETICA_CHAR_WIDTH_RATIO
        } else {
            COURIER_CHAR_WIDTH
        };

        Ok(Self {
            doc,
            current_page: page1,
            current_layer: layer1,
            font,
            bold_font,
            italic_font,
            bold_italic_font,
            is_sans: is_freewrite,
            char_width,
            y_position: PAGE_HEIGHT - MARGIN_TOP,
            page_number: 1,
            has_title_page: false,
        })
    }

    fn font_for(&self, style: TextStyle) -> IndirectFontRef {
        match (style.bold, style.italic) {
            (true, true) => self.bold_italic_font.clone(),
            (true, false) => self.bold_font.clone(),
            (false, true) => self.italic_font.clone(),
            (false, false) => self.font.clone(),
        }
    }

    fn glyph_width_pt(&self, c: char, bold: bool, size: f32) -> f32 {
        if self.is_sans {
            helvetica_width_units(c, bold) as f32 * size / 1000.0
        } else {
            size * 0.6 // Courier is monospaced at 0.6em
        }
    }

    fn segment_width_pt(&self, segment: &StyledSegment, size: f32) -> f32 {
        segment
            .text
            .chars()
            .map(|c| self.glyph_width_pt(c, segment.style.bold, size))
            .sum()
    }

    fn new_page(&mut self) {
        let (page, layer) = self.doc.add_page(
            Mm::from(Pt(PAGE_WIDTH)),
            Mm::from(Pt(PAGE_HEIGHT)),
            "Layer 1",
        );
        self.current_page = page;
        self.current_layer = layer;
        self.y_position = PAGE_HEIGHT - MARGIN_TOP;
        self.page_number += 1;

        // Add page number (top right)
        // Skip numbering on pages 1-2 when there's a title page (title page + first content page)
        // Page numbering starts at "2." on the 3rd physical page
        if !self.has_title_page || self.page_number > 2 {
            self.write_page_number();
        }
    }

    fn write_page_number(&self) {
        let layer = self
            .doc
            .get_page(self.current_page)
            .get_layer(self.current_layer);
        // When there's a title page, subtract 1 so 3rd physical page shows "2."
        let display_number = if self.has_title_page {
            self.page_number - 1
        } else {
            self.page_number
        };
        let page_num = format!("{}.", display_number);

        layer.use_text(
            &page_num,
            FONT_SIZE as f32,
            Mm::from(Pt(PAGE_WIDTH - MARGIN_RIGHT - 20.0)),
            Mm::from(Pt(PAGE_HEIGHT - 36.0)), // 0.5 inch from top
            &self.font,
        );
    }

    fn check_page_break(&mut self, lines_needed: i32) {
        let space_needed = lines_needed as f32 * LINE_HEIGHT;
        if self.y_position - space_needed < MARGIN_BOTTOM {
            self.new_page();
        }
    }

    fn write_line(&mut self, text: &str, x_offset: f32) {
        self.write_line_with_font(text, x_offset, self.font.clone());
    }

    fn write_bold_line(&mut self, text: &str, x_offset: f32) {
        self.write_line_with_font(text, x_offset, self.bold_font.clone());
    }

    fn write_line_with_font(&mut self, text: &str, x_offset: f32, font: IndirectFontRef) {
        self.check_page_break(1);

        let layer = self
            .doc
            .get_page(self.current_page)
            .get_layer(self.current_layer);

        layer.use_text(
            text,
            FONT_SIZE,
            Mm::from(Pt(MARGIN_LEFT + x_offset)),
            Mm::from(Pt(self.y_position)),
            &font,
        );

        self.y_position -= LINE_HEIGHT;
    }

    fn write_blank_line(&mut self) {
        self.y_position -= LINE_HEIGHT;
    }

    fn wrap_text(&self, text: &str, max_width: f32) -> Vec<String> {
        self.wrap_text_with_char_width(text, max_width, self.char_width)
    }

    fn wrap_text_with_char_width(&self, text: &str, max_width: f32, char_width: f32) -> Vec<String> {
        let max_chars = (max_width / char_width) as usize;

        let mut lines = Vec::new();
        let mut current_line = String::new();

        for word in text.split_whitespace() {
            if current_line.is_empty() {
                current_line = word.to_string();
            } else if current_line.len() + 1 + word.len() <= max_chars {
                current_line.push(' ');
                current_line.push_str(word);
            } else {
                lines.push(current_line);
                current_line = word.to_string();
            }
        }

        if !current_line.is_empty() {
            lines.push(current_line);
        }

        if lines.is_empty() {
            lines.push(String::new());
        }

        lines
    }

    fn get_node_text(node: &DocumentNode) -> String {
        if let Some(text) = &node.text {
            return text.clone();
        }
        if let Some(content) = &node.content {
            return content
                .iter()
                .map(|n| Self::get_node_text(n))
                .collect::<Vec<_>>()
                .join("");
        }
        String::new()
    }

    fn collect_styled_chars(node: &DocumentNode, base: TextStyle, out: &mut Vec<(char, TextStyle)>) {
        if let Some(text) = &node.text {
            let mut style = base;
            if let Some(marks) = &node.marks {
                for mark in marks {
                    match mark.mark_type.as_str() {
                        "bold" => style.bold = true,
                        "italic" => style.italic = true,
                        "underline" => style.underline = true,
                        "strike" => style.strike = true,
                        _ => {}
                    }
                }
            }

            for c in text.chars() {
                out.push((c, style));
            }
            return;
        }

        if let Some(content) = &node.content {
            for child in content {
                Self::collect_styled_chars(child, base, out);
            }
        }
    }

    /// Extracts text with inline marks resolved against a base style,
    /// wrapped into lines of styled segments.
    fn styled_lines(
        node: &DocumentNode,
        base: TextStyle,
        uppercase: bool,
        max_chars: usize,
    ) -> Vec<Vec<StyledSegment>> {
        let mut chars: Vec<(char, TextStyle)> = Vec::new();
        Self::collect_styled_chars(node, base, &mut chars);

        if uppercase {
            chars = chars
                .into_iter()
                .flat_map(|(c, style)| c.to_uppercase().map(move |upper| (upper, style)))
                .collect();
        }

        wrap_styled(&chars, max_chars)
            .iter()
            .map(|line| to_segments(line))
            .collect()
    }

    fn write_styled_line(&mut self, segments: &[StyledSegment], x: f32, size: f32, line_height: f32) {
        if self.y_position - line_height < MARGIN_BOTTOM {
            self.new_page();
        }

        let y = self.y_position;
        let layer = self
            .doc
            .get_page(self.current_page)
            .get_layer(self.current_layer);

        layer.begin_text_section();
        layer.set_text_cursor(Mm::from(Pt(x)), Mm::from(Pt(y)));
        for segment in segments {
            let font = self.font_for(segment.style);
            layer.set_font(&font, size);
            layer.write_text(&segment.text, &font);
        }
        layer.end_text_section();

        // Underline / strikethrough rules
        let mut cursor_x = x;
        for segment in segments {
            let width = self.segment_width_pt(segment, size);
            if segment.style.underline {
                Self::draw_rule(&layer, cursor_x, y - size * 0.09, width, size * 0.05);
            }
            if segment.style.strike {
                Self::draw_rule(&layer, cursor_x, y + size * 0.27, width, size * 0.05);
            }
            cursor_x += width;
        }

        self.y_position -= line_height;
    }

    fn draw_rule(layer: &PdfLayerReference, x: f32, y: f32, width: f32, thickness: f32) {
        layer.set_outline_thickness(thickness);
        layer.set_outline_color(Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None)));
        layer.add_line(Line {
            points: vec![
                (Point::new(Mm::from(Pt(x)), Mm::from(Pt(y))), false),
                (Point::new(Mm::from(Pt(x + width)), Mm::from(Pt(y))), false),
            ],
            is_closed: false,
        });
    }

    pub fn render_title_page(&mut self, title_page: &TitlePageData) {
        self.has_title_page = true;

        // Title page is vertically centered
        let mut lines_to_render: Vec<(String, bool)> = Vec::new(); // (text, is_title)

        if let Some(title) = &title_page.title {
            lines_to_render.push((title.to_uppercase(), true));
            lines_to_render.push((String::new(), false));
        }

        if let Some(credit) = &title_page.credit {
            lines_to_render.push((credit.clone(), false));
        }

        if let Some(author) = &title_page.author {
            lines_to_render.push((author.clone(), false));
            lines_to_render.push((String::new(), false));
        }

        if let Some(source) = &title_page.source {
            lines_to_render.push((source.clone(), false));
            lines_to_render.push((String::new(), false));
        }

        // Calculate vertical position for centering
        let total_height = lines_to_render.len() as f32 * LINE_HEIGHT;
        self.y_position = (PAGE_HEIGHT + total_height) / 2.0;

        // Center the title block
        let content_width = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

        for (text, _is_title) in &lines_to_render {
            if text.is_empty() {
                self.write_blank_line();
            } else {
                // Center the text
                let text_width = text.len() as f32 * self.char_width;
                let x_offset = (content_width - text_width) / 2.0;
                self.write_line(text, x_offset.max(0.0));
            }
        }

        // Contact info at bottom left
        if let Some(contact) = &title_page.contact {
            self.y_position = MARGIN_BOTTOM + 72.0; // 1 inch above bottom margin
            for line in contact.lines() {
                self.write_line(line, 0.0);
            }
        }

        // Copyright at bottom left (below contact or at same position)
        if let Some(copyright) = &title_page.copyright {
            if title_page.contact.is_none() {
                self.y_position = MARGIN_BOTTOM + 72.0;
            }
            self.write_line(copyright, 0.0);
        }

        // Draft date at bottom right
        if let Some(draft_date) = &title_page.draft_date {
            self.y_position = MARGIN_BOTTOM + 72.0;
            let content_width = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
            let text_width = draft_date.len() as f32 * self.char_width;
            self.write_line(draft_date, content_width - text_width);
        }

        // Start new page for content
        self.new_page();
    }

    pub fn render_content(&mut self, content: &ScreenplayContent, document_mode: &str) {
        if document_mode == "freewrite" {
            self.render_freewrite_content(content);
            return;
        }

        if let Some(nodes) = &content.content {
            for node in nodes {
                self.render_node(node, document_mode);
            }
        }
    }

    fn render_freewrite_content(&mut self, content: &ScreenplayContent) {
        let mut list_number = 0;

        if let Some(nodes) = &content.content {
            for node in nodes {
                // Mirror the editor: any non-numbered block restarts numbering
                if node.node_type != "numberedItem" {
                    list_number = 0;
                }

                let text = Self::get_node_text(node);
                if text.trim().is_empty() {
                    continue;
                }

                if node.node_type == "numberedItem" {
                    list_number += 1;
                }

                self.render_freewrite_node(node, list_number);
            }
        }
    }

    fn ensure_freewrite_space(&mut self, line_height: f32) {
        if self.y_position - line_height < MARGIN_BOTTOM {
            self.new_page();
        }
    }

    fn freewrite_space_before(&mut self, space: f32) {
        // Skip spacing at the top of a page
        if self.y_position < PAGE_HEIGHT - MARGIN_TOP - 0.5 {
            self.y_position -= space;
        }
    }

    fn put_freewrite_text(&self, text: &str, x: f32, size: f32, bold: bool) {
        let font = if bold { &self.bold_font } else { &self.font };
        let layer = self
            .doc
            .get_page(self.current_page)
            .get_layer(self.current_layer);

        layer.use_text(text, size, Mm::from(Pt(x)), Mm::from(Pt(self.y_position)), font);
    }

    fn render_freewrite_node(&mut self, node: &DocumentNode, list_number: i32) {
        let max_width = PAGE_WIDTH - FW_MARGIN_LEFT - FW_MARGIN_RIGHT;
        let max_chars = |size: f32, width: f32| (width / (size * HELVETICA_CHAR_WIDTH_RATIO)) as usize;
        let bold_base = TextStyle {
            bold: true,
            ..TextStyle::default()
        };

        match node.node_type.as_str() {
            "title" => {
                self.freewrite_space_before(FW_TITLE_SPACE_BEFORE);
                let lines =
                    Self::styled_lines(node, bold_base, false, max_chars(FW_TITLE_SIZE, max_width));
                for line in lines {
                    self.write_styled_line(
                        &line,
                        FW_MARGIN_LEFT,
                        FW_TITLE_SIZE,
                        FW_TITLE_LINE_HEIGHT,
                    );
                }
                self.y_position -= FW_TITLE_SPACE_AFTER;
            }
            "heading" => {
                self.freewrite_space_before(FW_HEADING_SPACE_BEFORE);
                let lines = Self::styled_lines(
                    node,
                    bold_base,
                    false,
                    max_chars(FW_HEADING_SIZE, max_width),
                );
                for line in lines {
                    self.write_styled_line(
                        &line,
                        FW_MARGIN_LEFT,
                        FW_HEADING_SIZE,
                        FW_HEADING_LINE_HEIGHT,
                    );
                }
                self.y_position -= FW_HEADING_SPACE_AFTER;
            }
            "bulletItem" | "numberedItem" => {
                let lines = Self::styled_lines(
                    node,
                    TextStyle::default(),
                    false,
                    max_chars(FW_BODY_SIZE, max_width - FW_LIST_INDENT),
                );

                // Keep the marker and the first line together
                self.ensure_freewrite_space(FW_BODY_LINE_HEIGHT);

                let marker = if node.node_type == "bulletItem" {
                    "\u{2022}".to_string()
                } else {
                    format!("{}.", list_number)
                };
                let marker_width = marker.chars().count() as f32 * FW_BODY_SIZE
                    * HELVETICA_CHAR_WIDTH_RATIO;
                let marker_x =
                    (FW_MARGIN_LEFT + FW_LIST_INDENT - 6.0 - marker_width).max(FW_MARGIN_LEFT);
                self.put_freewrite_text(&marker, marker_x, FW_BODY_SIZE, false);

                for line in lines {
                    self.write_styled_line(
                        &line,
                        FW_MARGIN_LEFT + FW_LIST_INDENT,
                        FW_BODY_SIZE,
                        FW_BODY_LINE_HEIGHT,
                    );
                }
                self.y_position -= FW_LIST_SPACING;
            }
            // "body" and anything unexpected render as plain paragraphs
            _ => {
                let lines = Self::styled_lines(
                    node,
                    TextStyle::default(),
                    false,
                    max_chars(FW_BODY_SIZE, max_width),
                );
                for line in lines {
                    self.write_styled_line(
                        &line,
                        FW_MARGIN_LEFT,
                        FW_BODY_SIZE,
                        FW_BODY_LINE_HEIGHT,
                    );
                }
                self.y_position -= FW_BLOCK_SPACING;
            }
        }
    }

    fn render_node(&mut self, node: &DocumentNode, _document_mode: &str) {
        let text = Self::get_node_text(node);
        if text.trim().is_empty() && node.node_type != "pageBreak" {
            return;
        }

        match node.node_type.as_str() {
            "comicPage" => {
                self.check_page_break(2);
                self.write_line(&text.to_uppercase(), 0.0);
                self.write_blank_line();
            }
            "comicPanel" => {
                self.write_blank_line();
                self.check_page_break(2);
                self.write_line(&text.to_uppercase(), 0.0);
                self.write_blank_line();
            }
            "caption" => {
                let max_chars =
                    ((PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT) / self.char_width) as usize;
                let lines = Self::styled_lines(node, TextStyle::default(), false, max_chars);
                self.check_page_break(lines.len() as i32);
                for line in lines {
                    self.write_styled_line(&line, MARGIN_LEFT + 36.0, FONT_SIZE, LINE_HEIGHT);
                }
            }
            "soundEffect" => {
                let max_chars =
                    ((PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT) / self.char_width) as usize;
                let lines = Self::styled_lines(node, TextStyle::default(), true, max_chars);
                self.check_page_break(lines.len() as i32);
                for line in lines {
                    self.write_styled_line(&line, MARGIN_LEFT + 36.0, FONT_SIZE, LINE_HEIGHT);
                }
            }
            "sceneHeading" => {
                self.write_blank_line();
                self.check_page_break(2);
                self.write_bold_line(&text.to_uppercase(), 0.0);
                self.write_blank_line();
            }
            "action" => {
                self.write_blank_line();
                let max_chars =
                    ((PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT) / self.char_width) as usize;
                let lines = Self::styled_lines(node, TextStyle::default(), false, max_chars);
                self.check_page_break(lines.len() as i32);
                for line in lines {
                    self.write_styled_line(&line, MARGIN_LEFT, FONT_SIZE, LINE_HEIGHT);
                }
            }
            "character" => {
                self.write_blank_line();
                let mut char_text = text.to_uppercase();

                // Add extension if present
                if let Some(attrs) = &node.attrs {
                    if let Some(ext) = attrs.get("extension").and_then(|v| v.as_str()) {
                        char_text = format!("{} ({})", char_text, ext);
                    }
                }

                self.check_page_break(1);
                self.write_line(&char_text, CHARACTER_INDENT);
            }
            "dialogue" => {
                let max_chars = (DIALOGUE_WIDTH / self.char_width) as usize;
                let lines = Self::styled_lines(node, TextStyle::default(), false, max_chars);
                self.check_page_break(lines.len() as i32);
                for line in lines {
                    self.write_styled_line(
                        &line,
                        MARGIN_LEFT + DIALOGUE_INDENT,
                        FONT_SIZE,
                        LINE_HEIGHT,
                    );
                }
            }
            "parenthetical" => {
                let paren_text = format!("({})", text);
                let wrapped = self.wrap_text(&paren_text, PARENTHETICAL_WIDTH);
                self.check_page_break(wrapped.len() as i32);
                for line in wrapped {
                    self.write_line(&line, PARENTHETICAL_INDENT);
                }
            }
            "transition" => {
                self.write_blank_line();
                self.check_page_break(2);
                // Right-align transition
                let content_width = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
                let text_upper = text.to_uppercase();
                let text_width = text_upper.len() as f32 * self.char_width;
                self.write_line(&text_upper, content_width - text_width);
                self.write_blank_line();
            }
            "pageBreak" => {
                self.new_page();
            }
            _ => {
                // Unknown node type, render as action
                if !text.is_empty() {
                    self.write_blank_line();
                    let wrapped = self.wrap_text(&text, PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT);
                    for line in wrapped {
                        self.write_line(&line, 0.0);
                    }
                }
            }
        }
    }

    pub fn save(self, path: &str) -> Result<(), String> {
        let file = File::create(path).map_err(|e| format!("Failed to create file: {}", e))?;
        let writer = BufWriter::new(file);

        self.doc
            .save(&mut std::io::BufWriter::new(writer))
            .map_err(|e| format!("Failed to save PDF: {}", e))?;

        Ok(())
    }
}

pub fn generate_pdf(
    content_json: &str,
    title_page_json: Option<&str>,
    output_path: &str,
    document_title: &str,
    document_mode: &str,
) -> Result<(), String> {
    let content: ScreenplayContent = serde_json::from_str(content_json)
        .map_err(|e| format!("Failed to parse content: {}", e))?;

    let title_page: Option<TitlePageData> = if let Some(tp_json) = title_page_json {
        Some(
            serde_json::from_str(tp_json)
                .map_err(|e| format!("Failed to parse title page: {}", e))?,
        )
    } else {
        None
    };

    let mut generator = PdfGenerator::new(document_title, document_mode)?;

    if let Some(tp) = title_page {
        generator.render_title_page(&tp);
    }

    generator.render_content(&content, document_mode);
    generator.save(output_path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_node(node_type: &str, text: &str) -> String {
        format!(
            r#"{{"type":"{}","content":[{{"type":"text","text":"{}"}}]}}"#,
            node_type, text
        )
    }

    fn rich_node(node_type: &str, spans: &[(&str, &[&str])]) -> String {
        let content = spans
            .iter()
            .map(|(text, marks)| {
                let marks_json = marks
                    .iter()
                    .map(|m| format!(r#"{{"type":"{}"}}"#, m))
                    .collect::<Vec<_>>()
                    .join(",");
                format!(
                    r#"{{"type":"text","text":"{}","marks":[{}]}}"#,
                    text, marks_json
                )
            })
            .collect::<Vec<_>>()
            .join(",");

        format!(r#"{{"type":"{}","content":[{}]}}"#, node_type, content)
    }

    fn generate(content_nodes: &[String], mode: &str, filename: &str) -> Vec<u8> {
        let content = format!(r#"{{"type":"doc","content":[{}]}}"#, content_nodes.join(","));
        let path = std::env::temp_dir().join(filename);
        let path_str = path.to_string_lossy().to_string();

        generate_pdf(&content, None, &path_str, "Test", mode).unwrap();

        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
        bytes
    }

    #[test]
    fn generates_freewrite_pdf_with_helvetica() {
        let nodes = vec![
            text_node("title", "Meeting Notes"),
            rich_node("body", &[
                ("A quick summary with ", &[]),
                ("bold", &["bold"]),
                (", ", &[]),
                ("italic", &["italic"]),
                (", ", &[]),
                ("underlined", &["underline"]),
                (" and ", &[]),
                ("struck", &["strike"]),
                (" text that should wrap across multiple lines once it exceeds the available width of the page.", &[]),
            ]),
            text_node("heading", "Action Items"),
            text_node("bulletItem", "Follow up with the design team"),
            text_node("bulletItem", "Review the latest draft"),
            text_node("heading", "Steps"),
            text_node("numberedItem", "First step"),
            text_node("numberedItem", "Second step"),
            text_node("body", "An interlude paragraph."),
            text_node("numberedItem", "Numbering should restart at one here"),
        ];

        let bytes = generate(&nodes, "freewrite", "grainery-freewrite-test.pdf");
        let raw = String::from_utf8_lossy(&bytes);
        assert!(raw.contains("Helvetica"), "free write PDFs should use Helvetica");
        assert!(raw.contains("Helvetica-Bold"), "bold marks should use Helvetica-Bold");
        assert!(raw.contains("Helvetica-Oblique"), "italic marks should use Helvetica-Oblique");
        assert!(!raw.contains("Courier"), "free write PDFs should not use Courier");
    }

    #[test]
    fn renders_inline_marks_in_screenplay_pdf() {
        let nodes = vec![
            text_node("sceneHeading", "INT. OFFICE - DAY"),
            rich_node("action", &[
                ("The room is ", &[]),
                ("very", &["bold"]),
                (" quiet. A phone ", &[]),
                ("buzzes", &["italic"]),
                (" on the ", &[]),
                ("desk", &["underline"]),
                (".", &[]),
            ]),
            text_node("character", "JANE"),
            rich_node("dialogue", &[
                ("I ", &[]),
                ("really", &["bold", "italic"]),
                (" need to take this.", &[]),
            ]),
        ];

        let bytes = generate(&nodes, "screenplay", "grainery-screenplay-marks-test.pdf");
        let raw = String::from_utf8_lossy(&bytes);
        assert!(raw.contains("Courier"), "screenplay PDFs should use Courier");
        assert!(raw.contains("Courier-Bold"), "bold marks should use Courier-Bold");
        assert!(raw.contains("Courier-Oblique"), "italic marks should use Courier-Oblique");
        assert!(
            raw.contains("Courier-BoldOblique"),
            "bold+italic marks should use Courier-BoldOblique"
        );
        assert!(!raw.contains("Helvetica"), "screenplay PDFs should not use Helvetica");
    }
}
