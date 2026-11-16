use crate::fonts;
mod font_data;
use owned_ttf_parser::{AsFaceRef, OwnedFace};
use printpdf::*;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;

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
const PARENTHETICAL_INDENT: f32 = 72.0; // 1 inch from margin
const PARENTHETICAL_WIDTH: f32 = 216.0; // 3 inches

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
    pub attrs: Option<serde_json::Value>,
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

#[derive(Debug, Clone, PartialEq, Default)]
struct TextStyle {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    font_family: Option<String>,
    font_weight: Option<u16>,
    font_style: Option<String>,
    size_pt: Option<f32>,
}

#[derive(Debug, Clone)]
struct StyledSegment {
    text: String,
    style: TextStyle,
}

struct PdfFontVariants {
    regular: IndirectFontRef,
    bold: IndirectFontRef,
    italic: IndirectFontRef,
    bold_italic: IndirectFontRef,
}

#[derive(Debug)]
struct ExternalFontMetrics {
    face: OwnedFace,
    fallback_advance_units: f32,
    line_height_units: f32,
}

impl ExternalFontMetrics {
    fn from_bytes(data: Vec<u8>) -> Option<Self> {
        let face = OwnedFace::from_vec(data, 0).ok()?;
        let face_ref = face.as_face_ref();
        let units_per_em = face_ref.units_per_em() as f32;
        let fallback_advance_units = face_ref
            .glyph_index(' ')
            .and_then(|glyph| face_ref.glyph_hor_advance(glyph))
            .map(f32::from)
            .unwrap_or(units_per_em * 0.5);
        let line_height_units = (f32::from(face_ref.height())
            + f32::from(face_ref.line_gap()).max(0.0))
        .max(units_per_em);

        Some(Self {
            face,
            fallback_advance_units,
            line_height_units,
        })
    }

    fn glyph_width_pt(&self, c: char, size: f32) -> f32 {
        let face = self.face.as_face_ref();
        let units_per_em = face.units_per_em() as f32;
        if units_per_em <= 0.0 {
            return self.fallback_advance_units * size / 1000.0;
        }

        let advance_units = face
            .glyph_index(c)
            .and_then(|glyph| face.glyph_hor_advance(glyph))
            .map(f32::from)
            .unwrap_or(self.fallback_advance_units);

        advance_units * size / units_per_em
    }

    fn line_height_pt(&self, size: f32) -> f32 {
        let units_per_em = self.face.as_face_ref().units_per_em() as f32;
        if units_per_em <= 0.0 {
            return size;
        }

        self.line_height_units * size / units_per_em
    }
}

// Helvetica AFM glyph widths (per 1000 units of font size) for ASCII 32..=126
const HELVETICA_WIDTHS: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
    278, // ' '..'/'
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // '0'..'9'
    278, 278, 584, 584, 584, 556, 1015, // ':'..'@'
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, // 'A'..'P'
    778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // 'Q'..'Z'
    278, 278, 278, 469, 556, 333, // '['..'`'
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, // 'a'..'p'
    556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // 'q'..'z'
    334, 260, 334, 584, // '{'..'~'
];

const HELVETICA_BOLD_WIDTHS: [u16; 95] = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
    278, // ' '..'/'
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // '0'..'9'
    333, 333, 584, 584, 584, 611, 975, // ':'..'@'
    722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, // 'A'..'P'
    778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // 'Q'..'Z'
    333, 278, 333, 584, 556, 333, // '['..'`'
    556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, // 'a'..'p'
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

/// Wrap using the same advances used for rendering, keeping inline styles.
fn wrap_styled(
    chars: &[(char, TextStyle)],
    max_width: f32,
    mut measure: impl FnMut(char, &TextStyle) -> f32,
) -> Vec<Vec<(char, TextStyle)>> {
    let mut words: Vec<Vec<(char, TextStyle)>> = Vec::new();
    let mut word = Vec::new();
    for (c, style) in chars {
        if c.is_whitespace() {
            if !word.is_empty() {
                words.push(std::mem::take(&mut word));
            }
        } else {
            word.push((*c, style.clone()));
        }
    }
    if !word.is_empty() {
        words.push(word);
    }
    let mut lines = Vec::new();
    let mut line: Vec<(char, TextStyle)> = Vec::new();
    let mut line_width = 0.0;
    for word in words {
        if let (Some((_, prev)), Some((_, next))) = (line.last(), word.first()) {
            let space_style = TextStyle {
                underline: prev.underline && next.underline,
                strike: prev.strike && next.strike,
                ..prev.clone()
            };
            let space_width = measure(' ', &space_style);
            let word_width: f32 = word.iter().map(|(c, style)| measure(*c, style)).sum();
            if line_width + space_width + word_width <= max_width + 0.001 {
                line.push((' ', space_style));
                line_width += space_width;
            } else {
                lines.push(std::mem::take(&mut line));
                line_width = 0.0;
            }
        }
        for (c, style) in word {
            let width = measure(c, &style);
            if !line.is_empty() && line_width + width > max_width + 0.001 {
                lines.push(std::mem::take(&mut line));
                line_width = 0.0;
            }
            line.push((c, style));
            line_width += width;
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
                style: style.clone(),
            }),
        }
    }

    segments
}

#[derive(Debug, Deserialize)]
pub struct ScreenplayContent {
    #[serde(rename = "type")]
    pub _doc_type: String,
    pub content: Option<Vec<DocumentNode>>,
}

struct ExternalPdfFont {
    font: IndirectFontRef,
    metrics: ExternalFontMetrics,
}

pub struct PdfGenerator {
    doc: PdfDocumentReference,
    current_page: PdfPageIndex,
    current_layer: PdfLayerIndex,
    font: IndirectFontRef,
    bold_font: IndirectFontRef,
    italic_font: IndirectFontRef,
    bold_italic_font: IndirectFontRef,
    custom_font_fallback: Option<PdfFontVariants>,
    external_fonts: HashMap<String, Option<ExternalPdfFont>>,
    font_catalog: Option<Vec<fonts::SystemFontFamily>>,
    is_sans: bool,
    char_width: f32,
    y_position: f32,
    page_number: i32,
    page_has_content: bool,
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
            custom_font_fallback: None,
            external_fonts: HashMap::new(),
            font_catalog: None,
            is_sans: is_freewrite,
            char_width,
            y_position: PAGE_HEIGHT - MARGIN_TOP,
            page_number: 1,
            page_has_content: false,
            has_title_page: false,
        })
    }

    fn external_font_request(style: &TextStyle) -> Option<(&str, u16, &str)> {
        let font_family = style.font_family.as_deref()?;
        let requested_weight = style
            .font_weight
            .unwrap_or(if style.bold { 700 } else { 400 });
        let requested_style =
            style
                .font_style
                .as_deref()
                .unwrap_or(if style.italic { "italic" } else { "normal" });

        Some((font_family, requested_weight, requested_style))
    }

    fn external_font_cache_key(
        font_family: &str,
        requested_weight: u16,
        requested_style: &str,
    ) -> String {
        format!(
            "{}:{}:{}",
            font_family.to_lowercase(),
            requested_weight,
            requested_style
        )
    }

    fn external_font_for(&mut self, style: &TextStyle) -> Option<&ExternalPdfFont> {
        let (family, weight, font_style) = Self::external_font_request(style)?;
        let key = Self::external_font_cache_key(family, weight, font_style);
        if !self.external_fonts.contains_key(&key) {
            let loaded = (|| {
                let catalog = self
                    .font_catalog
                    .get_or_insert_with(fonts::list_system_font_families);
                let variant =
                    fonts::resolve_system_font(catalog, family, Some(weight), Some(font_style))?;
                let data = std::fs::read(&variant.path).ok()?;
                let bytes = font_data::standalone_font(&data, variant.face_index).ok()?;
                let metrics = ExternalFontMetrics::from_bytes(bytes.clone())?;
                let font = self.doc.add_external_font(Cursor::new(bytes)).ok()?;
                Some(ExternalPdfFont { font, metrics })
            })();
            self.external_fonts.insert(key.clone(), loaded);
        }
        self.external_fonts.get(&key).and_then(Option::as_ref)
    }

    fn font_for(&mut self, style: &TextStyle) -> IndirectFontRef {
        if style.font_family.is_some() {
            if let Some(loaded) = self.external_font_for(style) {
                return loaded.font.clone();
            }
            if let Some(font) = self.custom_font_fallback_for(style) {
                return font;
            }
        }
        match (style.bold, style.italic) {
            (true, true) => self.bold_italic_font.clone(),
            (true, false) => self.bold_font.clone(),
            (false, true) => self.italic_font.clone(),
            (false, false) => self.font.clone(),
        }
    }

    fn custom_font_fallback_for(&mut self, style: &TextStyle) -> Option<IndirectFontRef> {
        if self.custom_font_fallback.is_none() {
            let regular = self.doc.add_builtin_font(BuiltinFont::Helvetica).ok()?;
            let bold = self.doc.add_builtin_font(BuiltinFont::HelveticaBold).ok()?;
            let italic = self
                .doc
                .add_builtin_font(BuiltinFont::HelveticaOblique)
                .ok()?;
            let bold_italic = self
                .doc
                .add_builtin_font(BuiltinFont::HelveticaBoldOblique)
                .ok()?;
            self.custom_font_fallback = Some(PdfFontVariants {
                regular,
                bold,
                italic,
                bold_italic,
            });
        }

        let fonts = self.custom_font_fallback.as_ref()?;
        Some(match (style.bold, style.italic) {
            (true, true) => fonts.bold_italic.clone(),
            (true, false) => fonts.bold.clone(),
            (false, true) => fonts.italic.clone(),
            (false, false) => fonts.regular.clone(),
        })
    }

    fn external_font_metrics_for(&mut self, style: &TextStyle) -> Option<&ExternalFontMetrics> {
        self.external_font_for(style).map(|loaded| &loaded.metrics)
    }

    fn style_size(style: &TextStyle, fallback: f32) -> f32 {
        style.size_pt.unwrap_or(fallback).clamp(6.0, 72.0)
    }

    fn glyph_width_pt(&mut self, c: char, style: &TextStyle, fallback_size: f32) -> f32 {
        let size = Self::style_size(style, fallback_size);
        if let Some(metrics) = self.external_font_metrics_for(style) {
            metrics.glyph_width_pt(c, size)
        } else if self.is_sans || style.font_family.is_some() {
            helvetica_width_units(c, style.bold) as f32 * size / 1000.0
        } else {
            size * 0.6 // Courier is monospaced at 0.6em
        }
    }

    fn segment_width_pt(&mut self, segment: &StyledSegment, fallback_size: f32) -> f32 {
        segment
            .text
            .chars()
            .map(|c| self.glyph_width_pt(c, &segment.style, fallback_size))
            .sum()
    }

    fn line_width_pt(&mut self, segments: &[StyledSegment], fallback_size: f32) -> f32 {
        segments
            .iter()
            .map(|segment| self.segment_width_pt(segment, fallback_size))
            .sum()
    }

    fn line_max_size(segments: &[StyledSegment], fallback_size: f32) -> f32 {
        segments
            .iter()
            .map(|segment| Self::style_size(&segment.style, fallback_size))
            .fold(fallback_size, f32::max)
    }

    fn generic_styled_segment_advance(
        segment: &StyledSegment,
        fallback_size: f32,
        fallback_line_height: f32,
    ) -> f32 {
        let size = Self::style_size(&segment.style, fallback_size);
        if size <= fallback_size {
            fallback_line_height
        } else {
            fallback_line_height.max(size * 1.2)
        }
    }

    fn styled_segment_advance(
        &mut self,
        segment: &StyledSegment,
        fallback_size: f32,
        fallback_line_height: f32,
    ) -> f32 {
        let generic =
            Self::generic_styled_segment_advance(segment, fallback_size, fallback_line_height);
        let size = Self::style_size(&segment.style, fallback_size);

        if let Some(metrics) = self.external_font_metrics_for(&segment.style) {
            generic.max(metrics.line_height_pt(size))
        } else {
            generic
        }
    }

    fn styled_line_advance(
        &mut self,
        segments: &[StyledSegment],
        fallback_size: f32,
        fallback_line_height: f32,
    ) -> f32 {
        if segments.is_empty() {
            return fallback_line_height;
        }

        segments
            .iter()
            .map(|segment| {
                self.styled_segment_advance(segment, fallback_size, fallback_line_height)
            })
            .fold(fallback_line_height, f32::max)
    }

    fn styled_line_baseline_adjust(
        segments: &[StyledSegment],
        fallback_size: f32,
        fallback_line_height: f32,
        line_advance: f32,
    ) -> f32 {
        let max_size = Self::line_max_size(segments, fallback_size);
        let generic_adjust = (max_size - fallback_size).max(0.0) * 0.75;
        let metric_adjust = (line_advance - fallback_line_height).max(0.0) * 0.5;
        generic_adjust.max(metric_adjust)
    }

    fn styled_lines_height(
        &mut self,
        lines: &[Vec<StyledSegment>],
        fallback_size: f32,
        fallback_line_height: f32,
    ) -> f32 {
        lines
            .iter()
            .map(|line| self.styled_line_advance(line, fallback_size, fallback_line_height))
            .sum()
    }

    fn node_alignment(node: &DocumentNode) -> Option<&str> {
        node.attrs
            .as_ref()
            .and_then(|attrs| attrs.get("textAlign"))
            .and_then(|value| value.as_str())
    }

    fn scene_number(node: &DocumentNode) -> Option<String> {
        let value = node
            .attrs
            .as_ref()
            .and_then(|attrs| attrs.get("sceneNumber"))?;
        let number = if let Some(text) = value.as_str() {
            text.trim().to_string()
        } else if value.is_number() {
            value.to_string()
        } else {
            String::new()
        };

        if number.is_empty() {
            None
        } else {
            Some(number)
        }
    }

    fn write_scene_numbers(&self, number: &str, y: f32) {
        let layer = self
            .doc
            .get_page(self.current_page)
            .get_layer(self.current_layer);
        let estimated_width = number.chars().count() as f32 * self.char_width;
        let left_x = (MARGIN_LEFT - 18.0 - estimated_width).max(12.0);
        let right_x = (PAGE_WIDTH - MARGIN_RIGHT + 18.0).min(PAGE_WIDTH - estimated_width - 12.0);

        layer.use_text(
            number,
            FONT_SIZE,
            Mm::from(Pt(left_x)),
            Mm::from(Pt(y)),
            &self.font,
        );
        layer.use_text(
            number,
            FONT_SIZE,
            Mm::from(Pt(right_x)),
            Mm::from(Pt(y)),
            &self.font,
        );
    }

    fn aligned_x_with_default(
        &self,
        node: &DocumentNode,
        base_x: f32,
        max_width: f32,
        line_width: f32,
        default_alignment: &str,
    ) -> f32 {
        match Self::node_alignment(node).unwrap_or(default_alignment) {
            "center" => base_x + ((max_width - line_width) / 2.0).max(0.0),
            "right" => base_x + (max_width - line_width).max(0.0),
            _ => base_x,
        }
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
        self.page_has_content = false;

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
            FONT_SIZE,
            Mm::from(Pt(PAGE_WIDTH - MARGIN_RIGHT - 20.0)),
            Mm::from(Pt(PAGE_HEIGHT - 36.0)), // 0.5 inch from top
            &self.font,
        );
    }

    fn ensure_space(&mut self, height: f32) {
        if self.y_position - height < MARGIN_BOTTOM {
            if self.page_has_content {
                self.new_page();
            } else {
                self.y_position = PAGE_HEIGHT - MARGIN_TOP;
            }
        }
    }

    fn check_page_break(&mut self, lines_needed: i32) {
        self.ensure_space(lines_needed as f32 * LINE_HEIGHT);
    }

    fn write_line(&mut self, text: &str, x_offset: f32) {
        self.write_line_with_font(text, x_offset, self.font.clone());
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

        self.page_has_content = true;
        self.y_position -= LINE_HEIGHT;
    }

    fn write_blank_line(&mut self) {
        self.y_position -= LINE_HEIGHT;
    }

    fn get_node_text(node: &DocumentNode) -> String {
        if let Some(text) = &node.text {
            return text.clone();
        }
        if let Some(content) = &node.content {
            return content
                .iter()
                .map(Self::get_node_text)
                .collect::<Vec<_>>()
                .join("");
        }
        String::new()
    }

    fn collect_styled_chars(
        node: &DocumentNode,
        base: TextStyle,
        out: &mut Vec<(char, TextStyle)>,
    ) {
        if let Some(text) = &node.text {
            let mut style = base;
            if let Some(marks) = &node.marks {
                for mark in marks {
                    match mark.mark_type.as_str() {
                        "bold" => style.bold = true,
                        "italic" => style.italic = true,
                        "underline" => style.underline = true,
                        "strike" => style.strike = true,
                        "fontFamily" => {
                            if let Some(attrs) = &mark.attrs {
                                if let Some(font_family) =
                                    attrs.get("fontFamily").and_then(|value| value.as_str())
                                {
                                    style.font_family = Some(font_family.to_string());
                                }
                                if let Some(font_weight) =
                                    attrs.get("fontWeight").and_then(|value| value.as_u64())
                                {
                                    style.font_weight = Some(font_weight.min(1000) as u16);
                                    if font_weight >= 600 {
                                        style.bold = true;
                                    }
                                }
                                if let Some(font_style) =
                                    attrs.get("fontStyle").and_then(|value| value.as_str())
                                {
                                    style.font_style = Some(font_style.to_string());
                                    if font_style == "italic" || font_style == "oblique" {
                                        style.italic = true;
                                    }
                                }
                            }
                        }
                        "textSize" => {
                            if let Some(attrs) = &mark.attrs {
                                if let Some(size_pt) =
                                    attrs.get("sizePt").and_then(|value| value.as_f64())
                                {
                                    style.size_pt = Some((size_pt as f32).clamp(6.0, 72.0));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            for c in text.chars() {
                out.push((c, style.clone()));
            }
            return;
        }

        if let Some(content) = &node.content {
            for child in content {
                Self::collect_styled_chars(child, base.clone(), out);
            }
        }
    }

    /// Extracts text with inline marks resolved against a base style,
    /// wrapped into lines of styled segments.
    fn styled_lines(
        &mut self,
        node: &DocumentNode,
        base: TextStyle,
        uppercase: bool,
        max_width: f32,
        fallback_size: f32,
    ) -> Vec<Vec<StyledSegment>> {
        self.styled_lines_with_affixes(node, base, uppercase, max_width, fallback_size, ("", ""))
    }

    fn styled_lines_with_affixes(
        &mut self,
        node: &DocumentNode,
        base: TextStyle,
        uppercase: bool,
        max_width: f32,
        fallback_size: f32,
        affixes: (&str, &str),
    ) -> Vec<Vec<StyledSegment>> {
        let (prefix, suffix) = affixes;
        let mut chars: Vec<(char, TextStyle)> = Vec::new();
        Self::collect_styled_chars(node, base.clone(), &mut chars);

        if uppercase {
            chars = chars
                .into_iter()
                .flat_map(|(c, style)| c.to_uppercase().map(move |upper| (upper, style.clone())))
                .collect();
        }

        if !prefix.is_empty() || !suffix.is_empty() {
            let mut affixed = prefix
                .chars()
                .map(|c| (c, base.clone()))
                .collect::<Vec<_>>();
            affixed.extend(chars);
            affixed.extend(suffix.chars().map(|c| (c, base.clone())));
            chars = affixed;
        }

        wrap_styled(&chars, max_width, |c, style| {
            self.glyph_width_pt(c, style, fallback_size)
        })
        .iter()
        .map(|line| to_segments(line))
        .collect()
    }

    fn write_styled_lines_aligned(
        &mut self,
        node: &DocumentNode,
        lines: &[Vec<StyledSegment>],
        base_x: f32,
        max_width: f32,
        size: f32,
        line_height: f32,
    ) {
        self.write_styled_lines_aligned_with_default(
            node,
            lines,
            base_x,
            max_width,
            (size, line_height),
            "left",
        );
    }

    fn write_styled_lines_aligned_with_default(
        &mut self,
        node: &DocumentNode,
        lines: &[Vec<StyledSegment>],
        base_x: f32,
        max_width: f32,
        typography: (f32, f32),
        default_alignment: &str,
    ) {
        let (size, line_height) = typography;
        self.prepare_styled_block(lines, size, line_height);

        for line in lines {
            let line_width = self.line_width_pt(line, size);
            let x =
                self.aligned_x_with_default(node, base_x, max_width, line_width, default_alignment);
            self.write_styled_line(line, x, size, line_height);
        }
    }

    fn prepare_styled_block(&mut self, lines: &[Vec<StyledSegment>], size: f32, line_height: f32) {
        let total = self.styled_lines_height(lines, size, line_height);
        let first = lines
            .first()
            .map(|line| self.styled_line_advance(line, size, line_height))
            .unwrap_or(line_height);
        let keep = if total <= PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM {
            total
        } else {
            first
        };
        self.ensure_space(keep);
    }

    fn write_styled_line(
        &mut self,
        segments: &[StyledSegment],
        x: f32,
        size: f32,
        line_height: f32,
    ) {
        let line_advance = self.styled_line_advance(segments, size, line_height);
        self.ensure_space(line_advance);

        let y = self.y_position
            - Self::styled_line_baseline_adjust(segments, size, line_height, line_advance);
        let mut runs = Vec::new();
        for segment in segments {
            let font = self.font_for(&segment.style);
            let segment_size = Self::style_size(&segment.style, size);
            let width = self.segment_width_pt(segment, size);
            runs.push((segment, font, segment_size, width));
        }
        let layer = self
            .doc
            .get_page(self.current_page)
            .get_layer(self.current_layer);

        layer.begin_text_section();
        layer.set_text_cursor(Mm::from(Pt(x)), Mm::from(Pt(y)));
        for (segment, font, segment_size, _) in &runs {
            layer.set_font(font, *segment_size);
            layer.write_text(&segment.text, font);
        }
        layer.end_text_section();

        // Underline / strikethrough rules
        let mut cursor_x = x;
        for (segment, _, segment_size, width) in &runs {
            if segment.style.underline {
                Self::draw_rule(
                    &layer,
                    cursor_x,
                    y - segment_size * 0.09,
                    *width,
                    segment_size * 0.05,
                );
            }
            if segment.style.strike {
                Self::draw_rule(
                    &layer,
                    cursor_x,
                    y + segment_size * 0.27,
                    *width,
                    segment_size * 0.05,
                );
            }
            cursor_x += *width;
        }

        self.page_has_content = true;
        self.y_position -= line_advance;
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
            for (index, node) in nodes.iter().enumerate() {
                self.render_node(node, &nodes[index + 1..], document_mode);
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

    fn freewrite_space_before(&mut self, space: f32) {
        // Skip spacing at the top of a page
        if self.y_position < PAGE_HEIGHT - MARGIN_TOP - 0.5 {
            self.y_position -= space;
        }
    }

    fn put_freewrite_text(&self, text: &str, x: f32, y: f32, size: f32, bold: bool) {
        let font = if bold { &self.bold_font } else { &self.font };
        let layer = self
            .doc
            .get_page(self.current_page)
            .get_layer(self.current_layer);

        layer.use_text(text, size, Mm::from(Pt(x)), Mm::from(Pt(y)), font);
    }

    fn render_freewrite_node(&mut self, node: &DocumentNode, list_number: i32) {
        let max_width = PAGE_WIDTH - FW_MARGIN_LEFT - FW_MARGIN_RIGHT;
        let bold_base = TextStyle {
            bold: true,
            ..TextStyle::default()
        };

        match node.node_type.as_str() {
            "title" => {
                self.freewrite_space_before(FW_TITLE_SPACE_BEFORE);
                let lines = self.styled_lines(node, bold_base, false, max_width, FW_TITLE_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    FW_MARGIN_LEFT,
                    max_width,
                    FW_TITLE_SIZE,
                    FW_TITLE_LINE_HEIGHT,
                );
                self.y_position -= FW_TITLE_SPACE_AFTER;
            }
            "heading" => {
                self.freewrite_space_before(FW_HEADING_SPACE_BEFORE);
                let lines = self.styled_lines(node, bold_base, false, max_width, FW_HEADING_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    FW_MARGIN_LEFT,
                    max_width,
                    FW_HEADING_SIZE,
                    FW_HEADING_LINE_HEIGHT,
                );
                self.y_position -= FW_HEADING_SPACE_AFTER;
            }
            "bulletItem" | "numberedItem" => {
                let lines = self.styled_lines(
                    node,
                    TextStyle::default(),
                    false,
                    max_width - FW_LIST_INDENT,
                    FW_BODY_SIZE,
                );

                self.prepare_styled_block(&lines, FW_BODY_SIZE, FW_BODY_LINE_HEIGHT);
                let baseline_adjust = lines
                    .first()
                    .map(|line| {
                        let advance =
                            self.styled_line_advance(line, FW_BODY_SIZE, FW_BODY_LINE_HEIGHT);
                        Self::styled_line_baseline_adjust(
                            line,
                            FW_BODY_SIZE,
                            FW_BODY_LINE_HEIGHT,
                            advance,
                        )
                    })
                    .unwrap_or(0.0);

                let marker = if node.node_type == "bulletItem" {
                    "\u{2022}".to_string()
                } else {
                    format!("{}.", list_number)
                };
                let marker_width =
                    marker.chars().count() as f32 * FW_BODY_SIZE * HELVETICA_CHAR_WIDTH_RATIO;
                let marker_x =
                    (FW_MARGIN_LEFT + FW_LIST_INDENT - 6.0 - marker_width).max(FW_MARGIN_LEFT);
                self.put_freewrite_text(
                    &marker,
                    marker_x,
                    self.y_position - baseline_adjust,
                    FW_BODY_SIZE,
                    false,
                );

                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    FW_MARGIN_LEFT + FW_LIST_INDENT,
                    max_width - FW_LIST_INDENT,
                    FW_BODY_SIZE,
                    FW_BODY_LINE_HEIGHT,
                );
                self.y_position -= FW_LIST_SPACING;
            }
            // "body" and anything unexpected render as plain paragraphs
            _ => {
                let lines =
                    self.styled_lines(node, TextStyle::default(), false, max_width, FW_BODY_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    FW_MARGIN_LEFT,
                    max_width,
                    FW_BODY_SIZE,
                    FW_BODY_LINE_HEIGHT,
                );
                self.y_position -= FW_BLOCK_SPACING;
            }
        }
    }

    fn render_node(
        &mut self,
        node: &DocumentNode,
        following_nodes: &[DocumentNode],
        _document_mode: &str,
    ) {
        let text = Self::get_node_text(node);
        if text.trim().is_empty()
            && node.node_type != "pageBreak"
            && node.node_type != "sceneHeading"
        {
            return;
        }
        let content_width = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

        match node.node_type.as_str() {
            "comicPage" => {
                self.check_page_break(2);
                let lines =
                    self.styled_lines(node, TextStyle::default(), true, content_width, FONT_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT,
                    content_width,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
                self.write_blank_line();
            }
            "comicPanel" => {
                self.write_blank_line();
                self.check_page_break(2);
                let lines =
                    self.styled_lines(node, TextStyle::default(), true, content_width, FONT_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT,
                    content_width,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
                self.write_blank_line();
            }
            "caption" => {
                let max_width = content_width - 36.0;
                let lines =
                    self.styled_lines(node, TextStyle::default(), false, max_width, FONT_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT + 36.0,
                    max_width,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
            }
            "soundEffect" => {
                let max_width = content_width - 36.0;
                let lines =
                    self.styled_lines(node, TextStyle::default(), true, max_width, FONT_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT + 36.0,
                    max_width,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
            }
            "sceneHeading" => {
                self.write_blank_line();
                let lines = self.styled_lines(
                    node,
                    TextStyle {
                        bold: true,
                        ..TextStyle::default()
                    },
                    true,
                    content_width,
                    FONT_SIZE,
                );
                let heading_height = self.styled_lines_height(&lines, FONT_SIZE, LINE_HEIGHT);
                let group_height =
                    heading_height + LINE_HEIGHT + self.next_kept_block_height(following_nodes);
                let space_needed = if group_height <= PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM {
                    group_height
                } else {
                    let first = lines
                        .first()
                        .map(|line| self.styled_line_advance(line, FONT_SIZE, LINE_HEIGHT))
                        .unwrap_or(LINE_HEIGHT);
                    let heading_keep = if heading_height <= PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
                    {
                        heading_height
                    } else {
                        first
                    };
                    (heading_keep + LINE_HEIGHT * 2.0).min(PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM)
                };
                self.ensure_space(space_needed);
                if let Some(number) = Self::scene_number(node) {
                    let baseline_adjust = lines
                        .first()
                        .map(|line| {
                            let line_advance =
                                self.styled_line_advance(line, FONT_SIZE, LINE_HEIGHT);
                            Self::styled_line_baseline_adjust(
                                line,
                                FONT_SIZE,
                                LINE_HEIGHT,
                                line_advance,
                            )
                        })
                        .unwrap_or(0.0);
                    self.write_scene_numbers(&number, self.y_position - baseline_adjust);
                }
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT,
                    content_width,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
                self.write_blank_line();
            }
            "action" => {
                self.write_blank_line();
                let lines =
                    self.styled_lines(node, TextStyle::default(), false, content_width, FONT_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT,
                    content_width,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
            }
            "character" => {
                self.write_blank_line();
                let suffix = node
                    .attrs
                    .as_ref()
                    .and_then(|attrs| attrs.get("extension"))
                    .and_then(|value| value.as_str())
                    .map(|extension| format!(" ({})", extension))
                    .unwrap_or_default();
                let max_width = (content_width - CHARACTER_INDENT).max(self.char_width);
                let lines = self.styled_lines_with_affixes(
                    node,
                    TextStyle::default(),
                    true,
                    max_width,
                    FONT_SIZE,
                    ("", &suffix),
                );
                let own_height = self.styled_lines_height(&lines, FONT_SIZE, LINE_HEIGHT);
                let group_height = own_height + self.character_following_height(following_nodes);
                let keep_height = if group_height <= PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM {
                    group_height
                } else {
                    let first = lines
                        .first()
                        .map(|line| self.styled_line_advance(line, FONT_SIZE, LINE_HEIGHT))
                        .unwrap_or(LINE_HEIGHT);
                    let character_keep = if own_height <= PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM {
                        own_height
                    } else {
                        first
                    };
                    (character_keep + LINE_HEIGHT).min(PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM)
                };
                self.ensure_space(keep_height);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT + CHARACTER_INDENT,
                    max_width,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
            }
            "dialogue" => {
                let lines =
                    self.styled_lines(node, TextStyle::default(), false, DIALOGUE_WIDTH, FONT_SIZE);
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT + DIALOGUE_INDENT,
                    DIALOGUE_WIDTH,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
            }
            "parenthetical" => {
                let lines = self.styled_lines_with_affixes(
                    node,
                    TextStyle::default(),
                    false,
                    PARENTHETICAL_WIDTH,
                    FONT_SIZE,
                    ("(", ")"),
                );
                self.write_styled_lines_aligned(
                    node,
                    &lines,
                    MARGIN_LEFT + PARENTHETICAL_INDENT,
                    PARENTHETICAL_WIDTH,
                    FONT_SIZE,
                    LINE_HEIGHT,
                );
            }
            "transition" => {
                self.write_blank_line();
                let lines =
                    self.styled_lines(node, TextStyle::default(), true, content_width, FONT_SIZE);
                self.write_styled_lines_aligned_with_default(
                    node,
                    &lines,
                    MARGIN_LEFT,
                    content_width,
                    (FONT_SIZE, LINE_HEIGHT),
                    "right",
                );
                self.write_blank_line();
            }
            "pageBreak" => {
                self.new_page();
            }
            _ => {
                // Unknown node type, render as action
                if !text.is_empty() {
                    self.write_blank_line();
                    let lines = self.styled_lines(
                        node,
                        TextStyle::default(),
                        false,
                        content_width,
                        FONT_SIZE,
                    );
                    self.write_styled_lines_aligned(
                        node,
                        &lines,
                        MARGIN_LEFT,
                        content_width,
                        FONT_SIZE,
                        LINE_HEIGHT,
                    );
                }
            }
        }
    }

    fn character_following_height(&mut self, nodes: &[DocumentNode]) -> f32 {
        let mut height = 0.0;
        let mut index = 0;
        while let Some(parenthetical) = nodes
            .get(index)
            .filter(|node| node.node_type == "parenthetical")
        {
            height += self.screenplay_node_height(parenthetical);
            index += 1;
        }

        match nodes.get(index).filter(|node| {
            node.node_type == "dialogue" && !Self::get_node_text(node).trim().is_empty()
        }) {
            Some(dialogue) => height + self.screenplay_node_height(dialogue),
            None => 0.0,
        }
    }

    fn next_kept_block_height(&mut self, nodes: &[DocumentNode]) -> f32 {
        for (index, node) in nodes.iter().enumerate() {
            if node.node_type == "pageBreak" {
                return 0.0;
            }
            let height = self.screenplay_node_height(node);
            if height > 0.0 {
                return height
                    + if node.node_type == "character" {
                        self.character_following_height(&nodes[index + 1..])
                    } else {
                        0.0
                    };
            }
        }
        0.0
    }

    fn screenplay_node_height(&mut self, node: &DocumentNode) -> f32 {
        let text = Self::get_node_text(node);
        if text.trim().is_empty() && node.node_type != "sceneHeading" {
            return 0.0;
        }

        let content_width = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
        let character_suffix = node
            .attrs
            .as_ref()
            .and_then(|attrs| attrs.get("extension"))
            .and_then(|value| value.as_str())
            .map(|extension| format!(" ({})", extension))
            .unwrap_or_default();
        let (width, uppercase, prefix, suffix, before, after) = match node.node_type.as_str() {
            "comicPage" => (content_width, true, "", "", 0.0, LINE_HEIGHT),
            "comicPanel" => (content_width, true, "", "", LINE_HEIGHT, LINE_HEIGHT),
            "caption" => (content_width - 36.0, false, "", "", 0.0, 0.0),
            "soundEffect" => (content_width - 36.0, true, "", "", 0.0, 0.0),
            "sceneHeading" => (content_width, true, "", "", LINE_HEIGHT, LINE_HEIGHT),
            "action" => (content_width, false, "", "", LINE_HEIGHT, 0.0),
            "character" => (
                content_width - CHARACTER_INDENT,
                true,
                "",
                character_suffix.as_str(),
                LINE_HEIGHT,
                0.0,
            ),
            "dialogue" => (DIALOGUE_WIDTH, false, "", "", 0.0, 0.0),
            "parenthetical" => (PARENTHETICAL_WIDTH, false, "(", ")", 0.0, 0.0),
            "transition" => (content_width, true, "", "", LINE_HEIGHT, LINE_HEIGHT),
            "pageBreak" => return 0.0,
            _ => (content_width, false, "", "", LINE_HEIGHT, 0.0),
        };
        let base = TextStyle {
            bold: node.node_type == "sceneHeading",
            ..TextStyle::default()
        };
        let lines = self.styled_lines_with_affixes(
            node,
            base,
            uppercase,
            width,
            FONT_SIZE,
            (prefix, suffix),
        );
        before + self.styled_lines_height(&lines, FONT_SIZE, LINE_HEIGHT) + after
    }

    pub fn save(self, path: &str) -> Result<(), String> {
        let bytes = self
            .doc
            .save_to_bytes()
            .map_err(|e| format!("Failed to serialize PDF: {}", e))?;
        crate::file_io::write_file_atomically(Path::new(path), &bytes)
            .map_err(|e| format!("Failed to save PDF: {}", e))
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

    fn numbered_scene_node(text: &str, number: i32) -> String {
        format!(
            r#"{{"type":"sceneHeading","attrs":{{"sceneNumber":{}}},"content":[{{"type":"text","text":"{}"}}]}}"#,
            number, text
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

    fn custom_font_node(node_type: &str, text: &str, font_family: &str, size_pt: f32) -> String {
        format!(
            r#"{{"type":"{}","content":[{{"type":"text","text":"{}","marks":[{{"type":"fontFamily","attrs":{{"fontFamily":"{}","fontWeight":400,"fontStyle":"normal"}}}},{{"type":"textSize","attrs":{{"sizePt":{}}}}}]}}]}}"#,
            node_type, text, font_family, size_pt
        )
    }

    fn generate(content_nodes: &[String], mode: &str, filename: &str) -> Vec<u8> {
        let content = format!(
            r#"{{"type":"doc","content":[{}]}}"#,
            content_nodes.join(",")
        );
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
        assert!(
            raw.contains("Helvetica"),
            "free write PDFs should use Helvetica"
        );
        assert!(
            raw.contains("Helvetica-Bold"),
            "bold marks should use Helvetica-Bold"
        );
        assert!(
            raw.contains("Helvetica-Oblique"),
            "italic marks should use Helvetica-Oblique"
        );
        assert!(
            !raw.contains("Courier"),
            "free write PDFs should not use Courier"
        );
    }

    #[test]
    fn renders_inline_marks_in_screenplay_pdf() {
        let nodes = vec![
            text_node("sceneHeading", "INT. OFFICE - DAY"),
            rich_node(
                "action",
                &[
                    ("The room is ", &[]),
                    ("very", &["bold"]),
                    (" quiet. A phone ", &[]),
                    ("buzzes", &["italic"]),
                    (" on the ", &[]),
                    ("desk", &["underline"]),
                    (".", &[]),
                ],
            ),
            text_node("character", "JANE"),
            rich_node(
                "dialogue",
                &[
                    ("I ", &[]),
                    ("really", &["bold", "italic"]),
                    (" need to take this.", &[]),
                ],
            ),
        ];

        let bytes = generate(&nodes, "screenplay", "grainery-screenplay-marks-test.pdf");
        let raw = String::from_utf8_lossy(&bytes);
        assert!(
            raw.contains("Courier"),
            "screenplay PDFs should use Courier"
        );
        assert!(
            raw.contains("Courier-Bold"),
            "bold marks should use Courier-Bold"
        );
        assert!(
            raw.contains("Courier-Oblique"),
            "italic marks should use Courier-Oblique"
        );
        assert!(
            raw.contains("Courier-BoldOblique"),
            "bold+italic marks should use Courier-BoldOblique"
        );
        assert!(
            !raw.contains("Helvetica"),
            "screenplay PDFs should not use Helvetica"
        );
    }

    #[test]
    fn keeps_character_parentheticals_and_dialogue_together() {
        let content_json = format!(
            r#"{{"type":"doc","content":[{},{},{},{}]}}"#,
            text_node("character", "JANE"),
            text_node("parenthetical", "quietly"),
            text_node("parenthetical", "to herself"),
            text_node("dialogue", "Hello"),
        );
        let content: ScreenplayContent = serde_json::from_str(&content_json).unwrap();
        let mut generator = PdfGenerator::new("Character Pair", "screenplay").unwrap();
        generator.y_position = MARGIN_BOTTOM + LINE_HEIGHT * 4.0;
        generator.page_has_content = true;

        generator.render_content(&content, "screenplay");

        assert_eq!(generator.page_number, 2);
        assert_eq!(
            generator.y_position,
            PAGE_HEIGHT - MARGIN_TOP - LINE_HEIGHT * 4.0
        );
    }

    #[test]
    fn keeps_scene_heading_with_following_block() {
        let action = vec!["word"; 18].join(" ");
        let content_json = format!(
            r#"{{"type":"doc","content":[{},{}]}}"#,
            text_node("sceneHeading", "INT. OFFICE - DAY"),
            text_node("action", &action),
        );
        let content: ScreenplayContent = serde_json::from_str(&content_json).unwrap();
        let mut generator = PdfGenerator::new("Scene Pair", "screenplay").unwrap();
        generator.y_position = MARGIN_BOTTOM + LINE_HEIGHT * 5.0;
        generator.page_has_content = true;

        generator.render_content(&content, "screenplay");

        assert_eq!(generator.page_number, 2);
        assert_eq!(
            generator.y_position,
            PAGE_HEIGHT - MARGIN_TOP - LINE_HEIGHT * 5.0
        );
    }

    #[test]
    fn keeps_scene_heading_with_following_character_group() {
        let content_json = format!(
            r#"{{"type":"doc","content":[{},{},{},{}]}}"#,
            text_node("sceneHeading", "INT. OFFICE - DAY"),
            text_node("character", "JANE"),
            text_node("parenthetical", "quietly"),
            text_node("dialogue", "Hello"),
        );
        let content: ScreenplayContent = serde_json::from_str(&content_json).unwrap();
        let mut generator = PdfGenerator::new("Scene and Character", "screenplay").unwrap();
        generator.y_position = MARGIN_BOTTOM + LINE_HEIGHT * 6.0;
        generator.page_has_content = true;

        generator.render_content(&content, "screenplay");

        assert_eq!(generator.page_number, 2);
        assert_eq!(
            generator.y_position,
            PAGE_HEIGHT - MARGIN_TOP - LINE_HEIGHT * 6.0
        );
    }

    #[test]
    fn renders_numbered_scene_headings_in_screenplay_pdf() {
        let node_json = numbered_scene_node("INT. OFFICE - DAY", 12);
        let parsed: DocumentNode = serde_json::from_str(&node_json).unwrap();
        assert_eq!(PdfGenerator::scene_number(&parsed), Some("12".to_string()));

        let bytes = generate(
            &[node_json],
            "screenplay",
            "grainery-screenplay-scene-numbers-test.pdf",
        );
        assert!(bytes.starts_with(b"%PDF"));
    }

    #[test]
    fn measured_wrapping_handles_large_text_long_words_and_exact_boundaries() {
        let mut generator = PdfGenerator::new("Wrap", "screenplay").unwrap();
        let node: DocumentNode = serde_json::from_value(serde_json::json!({
            "type":"action", "content":[{"type":"text", "text":"word ".repeat(10), "marks":[{"type":"textSize", "attrs":{"sizePt":72}}]}]
        })).unwrap();
        let lines = generator.styled_lines(&node, TextStyle::default(), false, 432.0, FONT_SIZE);
        assert!(lines.len() > 1);
        for line in &lines {
            assert!(generator.line_width_pt(line, FONT_SIZE) <= 432.001);
        }
        let chars = "aaaaa"
            .chars()
            .map(|c| (c, TextStyle::default()))
            .collect::<Vec<_>>();
        let wrapped = wrap_styled(&chars, 14.4, |_, _| 7.2);
        assert_eq!(
            wrapped.iter().map(Vec::len).collect::<Vec<_>>(),
            vec![2, 2, 1]
        );
        assert_eq!(wrap_styled(&[], 432.0, |_, _| 7.2).len(), 1);
        let plain: DocumentNode =
            serde_json::from_str(&text_node("action", &vec!["word"; 18].join(" "))).unwrap();
        assert_eq!(
            generator
                .styled_lines(&plain, TextStyle::default(), false, 432.0, 12.0)
                .len(),
            2
        );
    }

    #[test]
    fn proportional_wrapping_preserves_styles_and_alignment_bounds() {
        let mut generator = PdfGenerator::new("Wrap", "freewrite").unwrap();
        let node: DocumentNode = serde_json::from_str(&rich_node(
            "body",
            &[("WWW WWW ", &["bold", "underline"]), ("WWW", &["italic"])],
        ))
        .unwrap();
        let lines = generator.styled_lines(&node, TextStyle::default(), false, 70.0, 20.0);
        assert!(lines.len() >= 3);
        assert!(lines
            .iter()
            .flatten()
            .any(|segment| segment.style.bold && segment.style.underline));
        assert!(lines.iter().flatten().any(|segment| segment.style.italic));
        for line in lines {
            let width = generator.line_width_pt(&line, 20.0);
            assert!(width <= 70.001);
            for alignment in ["left", "center", "right"] {
                let x = generator.aligned_x_with_default(&node, 72.0, 70.0, width, alignment);
                assert!(x >= 72.0 && x + width <= 142.001);
            }
        }
    }

    fn page_texts(bytes: &[u8]) -> Vec<Vec<Vec<u8>>> {
        let pdf = lopdf::Document::load_mem(bytes).unwrap();
        pdf.get_pages()
            .values()
            .map(|id| {
                let data = pdf.get_page_content(*id).unwrap();
                let content = lopdf::content::Content::decode(&data).unwrap();
                content
                    .operations
                    .iter()
                    .filter(|operation| operation.operator == "Tj")
                    .filter_map(|operation| {
                        operation
                            .operands
                            .first()?
                            .as_str()
                            .ok()
                            .map(|text| text.to_vec())
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn list_marker_moves_with_its_text_and_oversized_blocks_use_the_first_page() {
        let mut generator = PdfGenerator::new("List", "freewrite").unwrap();
        generator.write_styled_line(
            &[StyledSegment {
                text: "Previous paragraph".into(),
                style: TextStyle::default(),
            }],
            FW_MARGIN_LEFT,
            FW_BODY_SIZE,
            FW_BODY_LINE_HEIGHT,
        );
        generator.y_position = MARGIN_BOTTOM + FW_BODY_LINE_HEIGHT * 2.0;
        let node: DocumentNode =
            serde_json::from_str(&text_node("numberedItem", &vec!["word"; 50].join(" "))).unwrap();
        generator.render_freewrite_node(&node, 1);
        let pages = page_texts(&generator.doc.save_to_bytes().unwrap());
        assert_eq!(pages.len(), 2);
        assert!(pages[0].iter().any(|text| text == b"Previous paragraph"));
        assert!(!pages[0].iter().any(|text| text == b"1."));
        assert!(pages[1].iter().any(|text| text == b"1."));
        assert!(pages[1].iter().any(|text| text.starts_with(b"word")));

        let mut generator = PdfGenerator::new("Long dialogue", "screenplay").unwrap();
        let content: ScreenplayContent = serde_json::from_str(&format!(
            r#"{{"type":"doc","content":[{},{}]}}"#,
            text_node("character", "JANE"),
            text_node("dialogue", &vec!["word"; 1000].join(" "))
        ))
        .unwrap();
        generator.render_content(&content, "screenplay");
        let pages = page_texts(&generator.doc.save_to_bytes().unwrap());
        assert!(pages.len() > 1);
        assert!(pages[0].iter().any(|text| text == b"JANE"));
        assert!(pages[0].iter().any(|text| text.starts_with(b"word")));
    }

    #[test]
    fn page_sized_blocks_do_not_create_empty_pages_and_scene_numbers_stay_attached() {
        let mut generator = PdfGenerator::new("Full page", "screenplay").unwrap();
        let node: DocumentNode =
            serde_json::from_str(&text_node("action", &"a".repeat(60 * 54))).unwrap();
        generator.render_node(&node, &[], "screenplay");
        assert_eq!(generator.page_number, 1);
        assert_eq!(generator.y_position, MARGIN_BOTTOM);

        let mut generator = PdfGenerator::new("Numbered scene", "screenplay").unwrap();
        generator.write_line("Previous scene", 0.0);
        generator.y_position = MARGIN_BOTTOM + LINE_HEIGHT * 8.0;
        let node: DocumentNode =
            serde_json::from_str(&numbered_scene_node(&vec!["word"; 600].join(" "), 12)).unwrap();
        let following: DocumentNode =
            serde_json::from_str(&text_node("action", &vec!["word"; 600].join(" "))).unwrap();
        generator.render_node(&node, &[following], "screenplay");
        let pages = page_texts(&generator.doc.save_to_bytes().unwrap());
        assert_eq!(pages.len(), 2);
        assert!(!pages[0].iter().any(|text| text == b"12"));
        assert_eq!(
            pages[1]
                .iter()
                .filter(|text| text.as_slice() == b"12")
                .count(),
            2
        );
        assert!(pages[1].iter().any(|text| text.starts_with(b"WORD")));
    }

    #[test]
    fn collection_selection_uses_identical_metrics_and_embedded_face() {
        let path = std::env::temp_dir().join(format!(
            "grainery-fixture-{}-{}.ttc",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, font_data::tests::collection()).unwrap();
        let variants = vec![
            fonts::SystemFontVariant {
                name: "Regular".into(),
                weight: 400,
                style: "normal",
                path: path.clone(),
                face_index: 0,
            },
            fonts::SystemFontVariant {
                name: "Bold".into(),
                weight: 700,
                style: "normal",
                path: path.clone(),
                face_index: 1,
            },
        ];
        let mut generator = PdfGenerator::new("Selected face", "screenplay").unwrap();
        generator.font_catalog = Some(vec![fonts::SystemFontFamily {
            name: "Fixture".into(),
            variants,
        }]);
        let style = TextStyle {
            font_family: Some("Fixture".into()),
            bold: true,
            ..TextStyle::default()
        };
        assert!((generator.glyph_width_pt('a', &style, 12.0) - 10.8).abs() < 0.001);
        generator.write_styled_line(
            &[StyledSegment {
                text: "a".into(),
                style,
            }],
            MARGIN_LEFT,
            FONT_SIZE,
            LINE_HEIGHT,
        );
        assert_eq!(generator.external_fonts.len(), 1);
        let bytes = generator.doc.save_to_bytes().unwrap();
        let pdf = lopdf::Document::load_mem(&bytes).unwrap();
        let embedded = pdf
            .objects
            .values()
            .filter_map(|object| object.as_stream().ok())
            .find(|stream| stream.content.starts_with(&0x00010000u32.to_be_bytes()))
            .unwrap();
        let face = owned_ttf_parser::Face::parse(&embedded.content, 0).unwrap();
        assert_eq!(face.weight().to_number(), 700);
        assert_eq!(
            face.glyph_hor_advance(face.glyph_index('a').unwrap()),
            Some(900)
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn malformed_custom_fonts_cache_one_consistent_fallback() {
        let path = std::env::temp_dir().join(format!(
            "grainery-malformed-font-{}.ttf",
            std::process::id()
        ));
        std::fs::write(&path, b"not a font").unwrap();
        let mut generator = PdfGenerator::new("Fallback", "screenplay").unwrap();
        generator.font_catalog = Some(vec![fonts::SystemFontFamily {
            name: "Broken".into(),
            variants: vec![fonts::SystemFontVariant {
                name: "Regular".into(),
                weight: 400,
                style: "normal",
                path: path.clone(),
                face_index: 0,
            }],
        }]);
        let style = TextStyle {
            font_family: Some("Broken".into()),
            ..TextStyle::default()
        };
        for _ in 0..2 {
            generator.font_for(&style);
            assert!(
                (generator.glyph_width_pt('W', &style, 12.0)
                    - helvetica_width_units('W', false) as f32 * 0.012)
                    .abs()
                    < 0.001
            );
        }
        assert_eq!(generator.external_fonts.len(), 1);
        assert!(generator.external_fonts.values().next().unwrap().is_none());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn missing_custom_font_uses_helvetica_for_rendering_and_measurement() {
        let missing_family = "Grainery Definitely Missing Font 7fd8d43b";
        let style = TextStyle {
            font_family: Some(missing_family.to_string()),
            size_pt: Some(20.0),
            ..TextStyle::default()
        };
        let mut generator = PdfGenerator::new("Fallback Metrics", "screenplay").unwrap();
        let measured_width = generator.glyph_width_pt('W', &style, FONT_SIZE);
        let expected_width = helvetica_width_units('W', false) as f32 * 20.0 / 1000.0;
        assert!((measured_width - expected_width).abs() < 0.001);

        let nodes = vec![custom_font_node(
            "action",
            "Missing custom face",
            missing_family,
            20.0,
        )];
        let bytes = generate(
            &nodes,
            "screenplay",
            "grainery-screenplay-missing-font-test.pdf",
        );
        let raw = String::from_utf8_lossy(&bytes);
        assert!(
            raw.contains("Helvetica"),
            "missing custom fonts should render with built-in Helvetica"
        );
    }
}
