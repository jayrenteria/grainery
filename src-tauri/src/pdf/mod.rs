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
pub struct DocumentNode {
    #[serde(rename = "type")]
    pub node_type: String,
    pub content: Option<Vec<DocumentNode>>,
    pub text: Option<String>,
    pub attrs: Option<serde_json::Value>,
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
    y_position: f32,
    page_number: i32,
    has_title_page: bool,
}

impl PdfGenerator {
    pub fn new(title: &str) -> Result<Self, String> {
        let (doc, page1, layer1) = PdfDocument::new(
            title,
            Mm::from(Pt(PAGE_WIDTH)),
            Mm::from(Pt(PAGE_HEIGHT)),
            "Layer 1",
        );

        // Use built-in Courier font
        let font = doc
            .add_builtin_font(BuiltinFont::Courier)
            .map_err(|e| format!("Failed to add font: {}", e))?;

        Ok(Self {
            doc,
            current_page: page1,
            current_layer: layer1,
            font,
            y_position: PAGE_HEIGHT - MARGIN_TOP,
            page_number: 1,
            has_title_page: false,
        })
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
            &self.font,
        );

        self.y_position -= LINE_HEIGHT;
    }

    fn write_blank_line(&mut self) {
        self.y_position -= LINE_HEIGHT;
    }

    fn wrap_text(&self, text: &str, max_width: f32) -> Vec<String> {
        let char_width = 7.2; // Approximate width of Courier character at 12pt
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
                let text_width = text.len() as f32 * 7.2;
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
            let text_width = draft_date.len() as f32 * 7.2;
            self.write_line(draft_date, content_width - text_width);
        }

        // Start new page for content
        self.new_page();
    }

    pub fn render_content(&mut self, content: &ScreenplayContent) {
        if let Some(nodes) = &content.content {
            for node in nodes {
                self.render_node(node);
            }
        }
    }

    fn render_node(&mut self, node: &DocumentNode) {
        let text = Self::get_node_text(node);
        if text.trim().is_empty() && node.node_type != "pageBreak" {
            return;
        }

        match node.node_type.as_str() {
            "sceneHeading" => {
                self.write_blank_line();
                self.check_page_break(2);
                self.write_line(&text.to_uppercase(), 0.0);
                self.write_blank_line();
            }
            "action" => {
                self.write_blank_line();
                let wrapped = self.wrap_text(&text, PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT);
                self.check_page_break(wrapped.len() as i32);
                for line in wrapped {
                    self.write_line(&line, 0.0);
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
                let wrapped = self.wrap_text(&text, DIALOGUE_WIDTH);
                self.check_page_break(wrapped.len() as i32);
                for line in wrapped {
                    self.write_line(&line, DIALOGUE_INDENT);
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
                let text_width = text_upper.len() as f32 * 7.2;
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

    let mut generator = PdfGenerator::new(document_title)?;

    if let Some(tp) = title_page {
        generator.render_title_page(&tp);
    }

    generator.render_content(&content);
    generator.save(output_path)?;

    Ok(())
}
