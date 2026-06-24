use owned_ttf_parser::{fonts_in_collection, name_id, Face, Style};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_FONT_SCAN_DEPTH: usize = 6;
const MAX_FONT_FAMILY_NAME_LENGTH: usize = 128;
const MAX_FONT_VARIANT_NAME_LENGTH: usize = 128;

#[derive(Debug, Clone)]
pub struct SystemFontFamily {
    pub name: String,
    pub variants: Vec<SystemFontVariant>,
}

#[derive(Debug, Clone)]
pub struct SystemFontVariant {
    pub name: String,
    pub weight: u16,
    pub style: &'static str,
    pub path: PathBuf,
}

pub fn list_system_font_families() -> Vec<SystemFontFamily> {
    let mut font_files = Vec::new();
    for directory in system_font_directories() {
        collect_font_files(&directory, 0, &mut font_files);
    }
    font_files.sort();
    font_files.dedup();

    let mut families = BTreeMap::new();
    for path in font_files {
        collect_font_faces_from_file(&path, &mut families);
    }

    let mut families = families.into_values().collect::<Vec<_>>();
    families.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name))
    });

    for family in &mut families {
        family.variants.sort_by(|a, b| {
            variant_sort_key(a)
                .cmp(&variant_sort_key(b))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });
    }

    families
}

pub fn resolve_system_font(
    family_name: &str,
    weight: Option<u16>,
    style: Option<&str>,
) -> Option<PathBuf> {
    let normalized_family = normalize_font_family_name(family_name);
    if normalized_family.is_empty() {
        return None;
    }

    let requested_style = style.unwrap_or("normal");
    let requested_weight = weight.unwrap_or(400);
    let families = list_system_font_families();
    let family = families
        .iter()
        .find(|candidate| candidate.name.eq_ignore_ascii_case(&normalized_family))?;

    family
        .variants
        .iter()
        .min_by_key(|variant| {
            let style_penalty = if variant.style == requested_style { 0 } else { 1000 };
            let weight_delta = variant.weight.abs_diff(requested_weight);
            style_penalty + weight_delta
        })
        .map(|variant| variant.path.clone())
}

fn system_font_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();

    #[cfg(target_os = "macos")]
    {
        directories.push(PathBuf::from("/System/Library/Fonts"));
        directories.push(PathBuf::from("/Library/Fonts"));
        directories.push(PathBuf::from("/Network/Library/Fonts"));
        if let Some(home) = home_directory() {
            directories.push(home.join("Library/Fonts"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(windir) = env::var_os("WINDIR") {
            directories.push(PathBuf::from(windir).join("Fonts"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            directories.push(PathBuf::from(local_app_data).join("Microsoft/Windows/Fonts"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        directories.push(PathBuf::from("/usr/share/fonts"));
        directories.push(PathBuf::from("/usr/local/share/fonts"));
        if let Some(home) = home_directory() {
            directories.push(home.join(".fonts"));
            directories.push(home.join(".local/share/fonts"));
        }
    }

    directories
}

fn home_directory() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn collect_font_files(directory: &Path, depth: usize, output: &mut Vec<PathBuf>) {
    if depth > MAX_FONT_SCAN_DEPTH {
        return;
    }

    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        if file_type.is_dir() {
            collect_font_files(&path, depth + 1, output);
            continue;
        }

        if file_type.is_file() && is_font_file(&path) {
            output.push(path);
        }
    }
}

fn is_font_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(
        extension.to_ascii_lowercase().as_str(),
        "ttf" | "otf" | "ttc"
    )
}

fn collect_font_faces_from_file(path: &Path, output: &mut BTreeMap<String, SystemFontFamily>) {
    let data = match fs::read(path) {
        Ok(data) => data,
        Err(_) => return,
    };

    let face_count = fonts_in_collection(&data).unwrap_or(1).min(128);
    for index in 0..face_count {
        let Ok(face) = Face::parse(&data, index) else {
            continue;
        };

        collect_font_face(&face, path, output);
    }
}

fn collect_font_face(
    face: &Face<'_>,
    path: &Path,
    output: &mut BTreeMap<String, SystemFontFamily>,
) {
    let Some(family) = preferred_family_name(face) else {
        return;
    };

    let weight = face.weight().to_number();
    let style = css_font_style(face);
    let variant_name = preferred_variant_name(face)
        .unwrap_or_else(|| fallback_variant_name(weight, style))
        .chars()
        .take(MAX_FONT_VARIANT_NAME_LENGTH)
        .collect::<String>();
    if variant_name.is_empty() {
        return;
    }

    let variant = SystemFontVariant {
        name: variant_name,
        weight,
        style,
        path: path.to_path_buf(),
    };
    let key = family.to_lowercase();
    let entry = output.entry(key).or_insert_with(|| SystemFontFamily {
        name: family,
        variants: Vec::new(),
    });

    if !entry
        .variants
        .iter()
        .any(|existing| existing.name.eq_ignore_ascii_case(&variant.name))
    {
        entry.variants.push(variant);
    }
}

fn preferred_family_name(face: &Face<'_>) -> Option<String> {
    [
        name_id::TYPOGRAPHIC_FAMILY,
        name_id::WWS_FAMILY,
        name_id::FAMILY,
    ]
    .iter()
    .find_map(|name_id| font_name_for_id(face, *name_id))
}

fn preferred_variant_name(face: &Face<'_>) -> Option<String> {
    [
        name_id::TYPOGRAPHIC_SUBFAMILY,
        name_id::WWS_SUBFAMILY,
        name_id::SUBFAMILY,
    ]
    .iter()
    .find_map(|name_id| font_name_for_id(face, *name_id))
}

fn font_name_for_id(face: &Face<'_>, target_name_id: u16) -> Option<String> {
    face.names()
        .into_iter()
        .filter(|name| name.name_id == target_name_id)
        .filter_map(|name| name.to_string())
        .map(|name| normalize_font_family_name(&name))
        .find(|name| !name.is_empty())
}

fn normalize_font_family_name(value: &str) -> String {
    let normalized = value
        .replace('\0', "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    normalized
        .trim_start_matches('.')
        .trim_start()
        .chars()
        .take(MAX_FONT_FAMILY_NAME_LENGTH)
        .collect()
}

fn css_font_style(face: &Face<'_>) -> &'static str {
    match face.style() {
        Style::Italic => "italic",
        Style::Oblique => "oblique",
        Style::Normal if face.is_italic() => "italic",
        Style::Normal => "normal",
    }
}

fn fallback_variant_name(weight: u16, style: &str) -> String {
    let weight_name = match weight {
        100 => "Thin",
        200 => "Extra Light",
        300 => "Light",
        400 => "Regular",
        500 => "Medium",
        600 => "Semibold",
        700 => "Bold",
        800 => "Extra Bold",
        900 => "Black",
        _ => return format!("Weight {}", weight),
    };

    match style {
        "italic" => format!("{} Italic", weight_name),
        "oblique" => format!("{} Oblique", weight_name),
        _ => weight_name.to_string(),
    }
}

fn variant_sort_key(variant: &SystemFontVariant) -> (u8, u16, u8) {
    let is_regular = variant.weight == 400
        && variant.style == "normal"
        && matches!(
            variant.name.to_lowercase().as_str(),
            "regular" | "normal" | "book" | "roman"
        );

    (
        if is_regular { 0 } else { 1 },
        variant.weight,
        match variant.style {
            "normal" => 0,
            "italic" => 1,
            "oblique" => 2,
            _ => 3,
        },
    )
}
