use owned_ttf_parser::{Face, RawFace, Tag};

const MAX_FONT_BYTES: usize = 128 * 1024 * 1024;

fn checksum(bytes: &[u8]) -> u32 {
    bytes.chunks(4).fold(0u32, |sum, chunk| {
        let mut word = [0; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

pub(super) fn standalone_font(data: &[u8], index: u32) -> Result<Vec<u8>, String> {
    if data.len() > MAX_FONT_BYTES {
        return Err("Font exceeds size limit".into());
    }
    let face = Face::parse(data, index).map_err(|error| error.to_string())?;
    let raw = face.raw_face();
    if raw.table(Tag::from_bytes(b"glyf")).is_none()
        || raw.table(Tag::from_bytes(b"loca")).is_none()
    {
        return Err("PDF embedding requires TrueType outlines".into());
    }
    let mut records: Vec<_> = raw
        .table_records
        .into_iter()
        .filter(|record| record.tag != Tag::from_bytes(b"DSIG"))
        .collect();
    records.sort_by_key(|record| record.tag);
    if records.is_empty()
        || records.len() > 4095
        || records.windows(2).any(|pair| pair[0].tag == pair[1].tag)
    {
        return Err("Invalid font table directory".into());
    }
    let count = records.len() as u16;
    let power = 1u16 << count.ilog2();
    let mut output = vec![0u8; 12 + records.len() * 16];
    output[..4].copy_from_slice(&0x00010000u32.to_be_bytes());
    output[4..6].copy_from_slice(&count.to_be_bytes());
    output[6..8].copy_from_slice(&(power * 16).to_be_bytes());
    output[8..10].copy_from_slice(&(count.ilog2() as u16).to_be_bytes());
    output[10..12].copy_from_slice(&((count - power) * 16).to_be_bytes());
    let mut head_offset = None;
    for (index, record) in records.iter().enumerate() {
        let table = raw.table(record.tag).ok_or("Font table is out of bounds")?;
        let padded_length = table.len().checked_add(3).ok_or("Font size overflow")? & !3;
        let end = output
            .len()
            .checked_add(padded_length)
            .filter(|end| *end <= MAX_FONT_BYTES)
            .ok_or("Font exceeds size limit")?;
        let offset = output.len();
        output.resize(end, 0);
        output[offset..offset + table.len()].copy_from_slice(table);
        if record.tag == Tag::from_bytes(b"head") {
            if table.len() < 54 {
                return Err("Invalid head table".into());
            }
            // The table checksum excludes checkSumAdjustment; the whole-font checksum includes it.
            output[offset + 8..offset + 12].fill(0);
            head_offset = Some(offset);
        }
        let sum = checksum(&output[offset..end]);
        let directory = 12 + index * 16;
        output[directory..directory + 4].copy_from_slice(&record.tag.to_bytes());
        output[directory + 4..directory + 8].copy_from_slice(&sum.to_be_bytes());
        output[directory + 8..directory + 12].copy_from_slice(&(offset as u32).to_be_bytes());
        output[directory + 12..directory + 16].copy_from_slice(&(table.len() as u32).to_be_bytes());
    }
    let head = head_offset.ok_or("Missing head table")?;
    let adjustment = 0xB1B0AFBAu32.wrapping_sub(checksum(&output));
    output[head + 8..head + 12].copy_from_slice(&adjustment.to_be_bytes());
    RawFace::parse(&output, 0).map_err(|error| error.to_string())?;
    Ok(output)
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    // Entirely synthetic fonts: no system font data or third-party fixture license required.
    pub(crate) fn collection() -> Vec<u8> {
        fn font(width: u16, weight: u16) -> Vec<u8> {
            let mut head = vec![0; 54];
            head[..4].copy_from_slice(&0x00010000u32.to_be_bytes());
            head[12..16].copy_from_slice(&0x5F0F3CF5u32.to_be_bytes());
            head[18..20].copy_from_slice(&1000u16.to_be_bytes());
            let mut hhea = vec![0; 36];
            hhea[..4].copy_from_slice(&0x00010000u32.to_be_bytes());
            hhea[4..6].copy_from_slice(&800i16.to_be_bytes());
            hhea[6..8].copy_from_slice(&(-200i16).to_be_bytes());
            hhea[34..36].copy_from_slice(&2u16.to_be_bytes());
            let mut hmtx = vec![0; 8];
            hmtx[4..6].copy_from_slice(&width.to_be_bytes());
            let mut os2 = vec![0; 78];
            os2[4..6].copy_from_slice(&weight.to_be_bytes());
            let mut cmap = vec![0; 12 + 262];
            cmap[2..4].copy_from_slice(&1u16.to_be_bytes());
            cmap[4..6].copy_from_slice(&3u16.to_be_bytes());
            cmap[6..8].copy_from_slice(&1u16.to_be_bytes());
            cmap[8..12].copy_from_slice(&12u32.to_be_bytes());
            cmap[14..16].copy_from_slice(&262u16.to_be_bytes());
            cmap[18 + b'a' as usize] = 1;
            cmap[18 + b' ' as usize] = 1;
            let tables: Vec<(&[u8; 4], Vec<u8>)> = vec![
                (b"DSIG", vec![0; 8]),
                (b"OS/2", os2),
                (b"cmap", cmap),
                (b"glyf", vec![0; 10]),
                (b"head", head),
                (b"hhea", hhea),
                (b"hmtx", hmtx),
                (b"loca", vec![0, 0, 0, 0, 0, 5]),
                (b"maxp", vec![0, 1, 0, 0, 0, 2]),
            ];
            let mut font = vec![0; 12 + tables.len() * 16];
            font[..4].copy_from_slice(&0x00010000u32.to_be_bytes());
            font[4..6].copy_from_slice(&(tables.len() as u16).to_be_bytes());
            for (index, (tag, table)) in tables.iter().enumerate() {
                let offset = font.len();
                font.extend(table);
                while !font.len().is_multiple_of(4) {
                    font.push(0);
                }
                let position = 12 + index * 16;
                font[position..position + 4].copy_from_slice(*tag);
                font[position + 8..position + 12].copy_from_slice(&(offset as u32).to_be_bytes());
                font[position + 12..position + 16]
                    .copy_from_slice(&(table.len() as u32).to_be_bytes());
            }
            font
        }
        let mut collection = vec![
            b't', b't', b'c', b'f', 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        for (index, mut font) in [font(600, 400), font(900, 700)].into_iter().enumerate() {
            let offset = collection.len() as u32;
            collection[12 + index * 4..16 + index * 4].copy_from_slice(&offset.to_be_bytes());
            let count = u16::from_be_bytes([font[4], font[5]]) as usize;
            for table in 0..count {
                let position = 12 + table * 16 + 8;
                let previous = u32::from_be_bytes(font[position..position + 4].try_into().unwrap());
                font[position..position + 4].copy_from_slice(&(previous + offset).to_be_bytes());
            }
            collection.extend(font);
        }
        collection
    }

    #[test]
    fn extracts_the_selected_face_and_valid_checksums() {
        let data = collection();
        for (index, width, weight) in [(0, 600, 400), (1, 900, 700)] {
            let output = standalone_font(&data, index).unwrap();
            assert_eq!(checksum(&output), 0xB1B0AFBA);
            let face = Face::parse(&output, 0).unwrap();
            assert_eq!(face.weight().to_number(), weight);
            assert_eq!(
                face.glyph_hor_advance(face.glyph_index('a').unwrap()),
                Some(width)
            );
            assert!(face.raw_face().table(Tag::from_bytes(b"DSIG")).is_none());
            for record in face.raw_face().table_records {
                assert_eq!(record.offset % 4, 0);
                let mut table = face.raw_face().table(record.tag).unwrap().to_vec();
                if record.tag == Tag::from_bytes(b"head") {
                    table[8..12].fill(0);
                }
                assert_eq!(checksum(&table), record.check_sum);
            }
        }
    }

    #[test]
    fn rejects_invalid_indices_truncation_and_table_bounds() {
        let data = collection();
        assert!(standalone_font(&data, 2).is_err());
        for length in [0, 8, 20, data.len() - 10] {
            assert!(standalone_font(&data[..length], 1).is_err());
        }
        let mut bad = data;
        // First face's OS/2 table is outside the file.
        bad[20 + 12 + 16 + 8..20 + 12 + 16 + 12].fill(255);
        assert!(standalone_font(&bad, 0).is_err());
    }
}
