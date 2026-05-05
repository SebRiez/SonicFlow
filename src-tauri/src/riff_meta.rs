// Lightweight RIFF chunk walker for bext (Broadcast Wave) and iXML metadata.
// No external crates required for bext; iXML uses quick-xml.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Default)]
pub struct BextData {
    pub description: Option<String>,
    pub originator: Option<String>,
    pub originator_ref: Option<String>,
}

#[derive(Debug, Default)]
pub struct IxmlData {
    pub ucs_cat_id: Option<String>,
    pub ucs_fx_name: Option<String>,
    pub ucs_creator_id: Option<String>,
    pub ucs_source_id: Option<String>,
}

#[derive(Debug, Default)]
pub struct RiffMeta {
    pub bext: Option<BextData>,
    pub ixml: Option<IxmlData>,
}

/// Walk RIFF/WAVE sub-chunks and extract bext + iXML metadata.
/// Returns `None` if the file is not a valid RIFF/WAVE container.
pub fn read_riff_metadata(path: &Path) -> Option<RiffMeta> {
    let file = File::open(path).ok()?;
    let mut r = BufReader::new(file);

    // RIFF header: "RIFF" (4) + size (4) + "WAVE" (4)
    let mut buf4 = [0u8; 4];
    r.read_exact(&mut buf4).ok()?;
    if &buf4 != b"RIFF" {
        return None;
    }
    r.read_exact(&mut buf4).ok()?; // riff size – skip
    r.read_exact(&mut buf4).ok()?;
    if &buf4 != b"WAVE" {
        return None;
    }

    let mut meta = RiffMeta::default();

    loop {
        let mut chunk_id = [0u8; 4];
        if r.read_exact(&mut chunk_id).is_err() {
            break;
        }
        let mut size_bytes = [0u8; 4];
        if r.read_exact(&mut size_bytes).is_err() {
            break;
        }
        let chunk_size = u32::from_le_bytes(size_bytes) as u64;
        let padded = chunk_size + (chunk_size & 1); // 2-byte alignment

        match &chunk_id {
            b"bext" => {
                let read_len = chunk_size.min(604) as usize;
                let mut data = vec![0u8; read_len];
                if r.read_exact(&mut data).is_err() {
                    break;
                }
                meta.bext = Some(parse_bext(&data));
                // skip remainder (coding history + padding)
                let skip = padded.saturating_sub(read_len as u64);
                if skip > 0 {
                    let _ = r.seek(SeekFrom::Current(skip as i64));
                }
            }
            b"iXML" => {
                let mut data = vec![0u8; chunk_size as usize];
                if r.read_exact(&mut data).is_err() {
                    break;
                }
                meta.ixml = parse_ixml(&data);
                if chunk_size & 1 != 0 {
                    let _ = r.seek(SeekFrom::Current(1));
                }
            }
            _ => {
                // Skip unknown chunk (with padding)
                if r.seek(SeekFrom::Current(padded as i64)).is_err() {
                    break;
                }
            }
        }
    }

    Some(meta)
}

fn null_terminated_str(bytes: &[u8]) -> Option<String> {
    let s: String = bytes
        .iter()
        .take_while(|&&b| b != 0)
        .filter_map(|&b| if b.is_ascii() { Some(b as char) } else { None })
        .collect();
    let trimmed = s.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn parse_bext(data: &[u8]) -> BextData {
    BextData {
        description:    null_terminated_str(data.get(0..256).unwrap_or(&[])),
        originator:     null_terminated_str(data.get(256..288).unwrap_or(&[])),
        originator_ref: null_terminated_str(data.get(288..320).unwrap_or(&[])),
    }
}

fn parse_ixml(data: &[u8]) -> Option<IxmlData> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    // Strip BOM if present
    let xml = std::str::from_utf8(data)
        .ok()?
        .trim_start_matches('\u{FEFF}');

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut result = IxmlData::default();
    let mut current_tag = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                current_tag = std::str::from_utf8(e.name().as_ref())
                    .unwrap_or("")
                    .to_uppercase();
            }
            Ok(Event::Text(e)) => {
                if let Ok(text) = e.unescape() {
                    let t = text.trim().to_string();
                    if !t.is_empty() {
                        match current_tag.as_str() {
                            "UCS_CATEGORYID" | "UCSCATEGORYID" | "UCS_CAT_ID" => {
                                result.ucs_cat_id = Some(t);
                            }
                            "UCS_FXNAME" | "UCSFXNAME" => {
                                result.ucs_fx_name = Some(t);
                            }
                            "UCS_CREATORID" | "UCSCREATORID" => {
                                result.ucs_creator_id = Some(t);
                            }
                            "UCS_SOURCEID" | "UCSSOURCEID" => {
                                result.ucs_source_id = Some(t);
                            }
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    if result.ucs_cat_id.is_some() || result.ucs_fx_name.is_some() {
        Some(result)
    } else {
        None
    }
}
