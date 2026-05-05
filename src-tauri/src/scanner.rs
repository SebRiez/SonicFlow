use lofty::prelude::*;
use lofty::probe::Probe;
use std::path::Path;
use walkdir::WalkDir;

use crate::db::Sound;
use crate::ucs;
use crate::riff_meta;

static AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "aif", "aiff", "mp3", "flac", "ogg", "opus", "m4a", "aac", "wma", "alac", "caf", "bwf",
];

static RIFF_EXTENSIONS: &[&str] = &["wav", "bwf"];

pub struct ScanResult {
    pub sounds: Vec<Sound>,
    pub errors: Vec<String>,
}

pub fn scan_directory(root: &str, library_id: i64, now: &str) -> ScanResult {
    let mut sounds = Vec::new();
    let mut errors = Vec::new();
    let root_path = std::path::Path::new(root);

    for entry in WalkDir::new(root)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e.to_lowercase(),
            None => continue,
        };

        if !AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        // Skip macOS resource-fork files (e.g. ._filename.wav)
        let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if fname.starts_with('.') {
            continue;
        }

        let relative_folder = path
            .parent()
            .and_then(|p| p.strip_prefix(root_path).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        match extract_metadata(path, library_id, &ext, &relative_folder, now) {
            Ok(sound) => sounds.push(sound),
            Err(e) => errors.push(format!("{}: {}", path.display(), e)),
        }
    }

    ScanResult { sounds, errors }
}

fn extract_metadata(
    path: &Path,
    library_id: i64,
    ext: &str,
    relative_folder: &str,
    now: &str,
) -> Result<Sound, String> {
    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let filepath = path.to_string_lossy().to_string();
    let filesize = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);

    let mut duration: Option<f64> = None;
    let mut samplerate: Option<i64> = None;
    let mut bitdepth: Option<i64> = None;
    let mut channels: Option<i64> = None;
    let mut bitrate: Option<i64> = None;
    let mut tag_title: Option<String> = None;
    let mut tag_artist: Option<String> = None;
    let mut tag_album: Option<String> = None;
    let mut tag_comment: Option<String> = None;
    let mut tag_genre: Option<String> = None;
    let mut tag_bpm: Option<String> = None;
    let mut tag_description: Option<String> = None;
    let mut tag_keywords: Option<String> = None;
    let mut tag_tracknumber: Option<String> = None;

    if let Ok(tagged_file) = Probe::open(path)
        .map_err(|e| e.to_string())
        .and_then(|p| p.read().map_err(|e| e.to_string()))
    {
        if let Some(props) = Some(tagged_file.properties()) {
            duration = Some(props.duration().as_secs_f64());
            samplerate = props.sample_rate().map(|v| v as i64);
            bitdepth = props.bit_depth().map(|v| v as i64);
            channels = props.channels().map(|v| v as i64);
            bitrate = props.audio_bitrate().map(|v| v as i64);
        }

        if let Some(tag) = tagged_file.primary_tag() {
            tag_title = tag.title().map(|s| s.to_string());
            tag_artist = tag.artist().map(|s| s.to_string());
            tag_album = tag.album().map(|s| s.to_string());
            tag_comment = tag.comment().map(|s| s.to_string());
            tag_genre = tag.genre().map(|s| s.to_string());
            tag_tracknumber = tag.track().map(|v| v.to_string());

            for item in tag.items() {
                let key_str = format!("{:?}", item.key()).to_lowercase();
                let value_str = match item.value() {
                    lofty::tag::ItemValue::Text(t) => Some(t.clone()),
                    lofty::tag::ItemValue::Locator(l) => Some(l.clone()),
                    _ => None,
                };
                if let Some(val) = value_str {
                    if key_str.contains("bpm") { tag_bpm = Some(val.clone()); }
                    if key_str.contains("description") || key_str.contains("contentdescr") { tag_description = Some(val.clone()); }
                    if key_str.contains("keyword") || key_str.contains("subject") { tag_keywords = Some(val.clone()); }
                }
            }
        }
    }

    // ── UCS Extraction (priority: iXML > bext > filename) ──────────────────────
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");

    // 1. Filename parser (always attempted, lowest priority)
    let from_filename = ucs::parse_ucs_filename(stem);

    // 2. RIFF metadata (bext + iXML) – WAV/BWF only
    let riff = if RIFF_EXTENSIONS.contains(&ext) {
        riff_meta::read_riff_metadata(path)
    } else {
        None
    };

    // Merge fields: iXML > bext > filename
    let ucs_cat_id = riff.as_ref()
        .and_then(|r| r.ixml.as_ref()).and_then(|x| x.ucs_cat_id.clone())
        .or_else(|| from_filename.as_ref().and_then(|f| f.cat_id.clone()));

    let ucs_fx_name = riff.as_ref()
        .and_then(|r| r.ixml.as_ref()).and_then(|x| x.ucs_fx_name.clone())
        .or_else(|| from_filename.as_ref().and_then(|f| f.fx_name.clone()));

    let ucs_creator_id = riff.as_ref()
        .and_then(|r| r.ixml.as_ref()).and_then(|x| x.ucs_creator_id.clone())
        .or_else(|| riff.as_ref().and_then(|r| r.bext.as_ref()).and_then(|b| b.originator.clone()))
        .or_else(|| from_filename.as_ref().and_then(|f| f.creator_id.clone()));

    let ucs_source_id = riff.as_ref()
        .and_then(|r| r.ixml.as_ref()).and_then(|x| x.ucs_source_id.clone())
        .or_else(|| riff.as_ref().and_then(|r| r.bext.as_ref()).and_then(|b| b.originator_ref.clone()))
        .or_else(|| from_filename.as_ref().and_then(|f| f.source_id.clone()));

    Ok(Sound {
        id: 0,
        library_id,
        filename,
        filepath,
        relative_folder: relative_folder.to_string(),
        extension: ext.to_string(),
        filesize,
        duration,
        samplerate,
        bitdepth,
        channels,
        bitrate,
        tag_title,
        tag_artist,
        tag_album,
        tag_comment,
        tag_genre,
        tag_bpm,
        tag_description,
        tag_keywords,
        tag_tracknumber,
        imported_at: now.to_string(),
        ucs_cat_id,
        ucs_fx_name,
        ucs_creator_id,
        ucs_source_id,
        ucs_user_category: None, // never set by scanner
    })
}
