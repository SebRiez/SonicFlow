use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Library {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub file_count: i64,
    pub created_at: String,
    pub last_scanned: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Sound {
    pub id: i64,
    pub library_id: i64,
    pub filename: String,
    pub filepath: String,
    pub relative_folder: String,
    pub extension: String,
    pub filesize: i64,
    pub duration: Option<f64>,
    pub samplerate: Option<i64>,
    pub bitdepth: Option<i64>,
    pub channels: Option<i64>,
    pub bitrate: Option<i64>,
    pub tag_title: Option<String>,
    pub tag_artist: Option<String>,
    pub tag_album: Option<String>,
    pub tag_comment: Option<String>,
    pub tag_genre: Option<String>,
    pub tag_bpm: Option<String>,
    pub tag_description: Option<String>,
    pub tag_keywords: Option<String>,
    pub tag_tracknumber: Option<String>,
    pub imported_at: String,
    // UCS fields (auto-detected or manually assigned)
    pub ucs_cat_id: Option<String>,
    pub ucs_fx_name: Option<String>,
    pub ucs_creator_id: Option<String>,
    pub ucs_source_id: Option<String>,
    pub ucs_user_category: Option<String>, // manual override – never overwritten by scanner
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchFilters {
    pub library_id: Option<i64>,
    pub folder: Option<String>,
    pub extension: Option<String>,
    pub min_duration: Option<f64>,
    pub max_duration: Option<f64>,
    pub samplerate: Option<i64>,
    pub bitdepth: Option<i64>,
    pub channels: Option<i64>,
    pub ucs_cat_id: Option<String>,
    pub shuffle: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FolderNode {
    pub name: String,      // just the last segment
    pub full_path: String, // relative path from library root
    pub library_id: i64,
    pub file_count: i64,
    pub children: Vec<FolderNode>,
}

pub fn open_db() -> Result<Connection> {
    let app_dir = dirs_path();
    std::fs::create_dir_all(&app_dir).ok();
    let db_path = app_dir.join("audiolookup.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(conn)
}

const APP_DIR_NAME: &str = "com.antigravity.audiolookup";

/// User home directory (`HOME` on Unix, `USERPROFILE` on Windows).
pub fn home_dir() -> std::path::PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|h| !h.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// Per-user application data directory. The macOS location is unchanged so
/// existing databases keep working.
fn dirs_path() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA")
        .filter(|h| !h.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home_dir().join("AppData").join("Roaming"));

    #[cfg(target_os = "macos")]
    let base = home_dir().join("Library").join("Application Support");

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .filter(|h| !h.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".local").join("share"));

    base.join(APP_DIR_NAME)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS libraries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            file_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_scanned TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL UNIQUE,
            relative_folder TEXT NOT NULL DEFAULT '',
            extension TEXT NOT NULL,
            filesize INTEGER NOT NULL DEFAULT 0,
            duration REAL,
            samplerate INTEGER,
            bitdepth INTEGER,
            channels INTEGER,
            bitrate INTEGER,
            tag_title TEXT,
            tag_artist TEXT,
            tag_album TEXT,
            tag_comment TEXT,
            tag_genre TEXT,
            tag_bpm TEXT,
            tag_description TEXT,
            tag_keywords TEXT,
            tag_tracknumber TEXT,
            imported_at TEXT NOT NULL,
            ucs_cat_id TEXT,
            ucs_fx_name TEXT,
            ucs_creator_id TEXT,
            ucs_source_id TEXT,
            ucs_user_category TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sounds_library ON sounds(library_id);
        CREATE INDEX IF NOT EXISTS idx_sounds_filename ON sounds(filename);
        CREATE INDEX IF NOT EXISTS idx_sounds_extension ON sounds(extension);

        CREATE VIRTUAL TABLE IF NOT EXISTS sounds_fts USING fts5(
            sound_id UNINDEXED,
            filename,
            tag_title,
            tag_artist,
            tag_album,
            tag_comment,
            tag_genre,
            tag_description,
            tag_keywords,
            content='sounds',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS sounds_ai AFTER INSERT ON sounds BEGIN
            INSERT INTO sounds_fts(rowid, sound_id, filename, tag_title, tag_artist, tag_album, tag_comment, tag_genre, tag_description, tag_keywords)
            VALUES (new.id, new.id, new.filename, new.tag_title, new.tag_artist, new.tag_album, new.tag_comment, new.tag_genre, new.tag_description, new.tag_keywords);
        END;

        CREATE TRIGGER IF NOT EXISTS sounds_ad AFTER DELETE ON sounds BEGIN
            INSERT INTO sounds_fts(sounds_fts, rowid, sound_id, filename, tag_title, tag_artist, tag_album, tag_comment, tag_genre, tag_description, tag_keywords)
            VALUES('delete', old.id, old.id, old.filename, old.tag_title, old.tag_artist, old.tag_album, old.tag_comment, old.tag_genre, old.tag_description, old.tag_keywords);
        END;

        CREATE TRIGGER IF NOT EXISTS sounds_au AFTER UPDATE ON sounds BEGIN
            INSERT INTO sounds_fts(sounds_fts, rowid, sound_id, filename, tag_title, tag_artist, tag_album, tag_comment, tag_genre, tag_description, tag_keywords)
            VALUES('delete', old.id, old.id, old.filename, old.tag_title, old.tag_artist, old.tag_album, old.tag_comment, old.tag_genre, old.tag_description, old.tag_keywords);
            INSERT INTO sounds_fts(rowid, sound_id, filename, tag_title, tag_artist, tag_album, tag_comment, tag_genre, tag_description, tag_keywords)
            VALUES (new.id, new.id, new.filename, new.tag_title, new.tag_artist, new.tag_album, new.tag_comment, new.tag_genre, new.tag_description, new.tag_keywords);
        END;
    ")?;

    // Migrations: add columns to existing DBs
    let col_check = |name: &str| -> bool {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('sounds') WHERE name='{}'", name),
            [],
            |row| row.get::<_, i64>(0),
        ).unwrap_or(0) > 0
    };

    if !col_check("relative_folder") {
        conn.execute_batch("ALTER TABLE sounds ADD COLUMN relative_folder TEXT NOT NULL DEFAULT ''").ok();
        conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_sounds_folder ON sounds(relative_folder)").ok();
    }
    for col in &["ucs_cat_id", "ucs_fx_name", "ucs_creator_id", "ucs_source_id", "ucs_user_category"] {
        if !col_check(col) {
            conn.execute_batch(&format!("ALTER TABLE sounds ADD COLUMN {} TEXT", col)).ok();
        }
    }

    // Collections tables
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_sounds (
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            sound_id INTEGER NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
            PRIMARY KEY (collection_id, sound_id)
        );
    ")?;

    // Foreign keys used to be unenforced, so memberships of deleted sounds may linger.
    conn.execute(
        "DELETE FROM collection_sounds WHERE sound_id NOT IN (SELECT id FROM sounds)",
        [],
    )?;

    Ok(())
}

pub fn insert_library(conn: &Connection, name: &str, path: &str, now: &str) -> Result<i64> {
    conn.execute(
        "INSERT OR IGNORE INTO libraries (name, path, file_count, created_at, last_scanned) VALUES (?1, ?2, 0, ?3, ?3)",
        params![name, path, now],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM libraries WHERE path = ?1",
        params![path],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn update_library_count(conn: &Connection, library_id: i64, now: &str) -> Result<()> {
    conn.execute(
        "UPDATE libraries SET file_count = (SELECT COUNT(*) FROM sounds WHERE library_id = ?1), last_scanned = ?2 WHERE id = ?1",
        params![library_id, now],
    )?;
    Ok(())
}

/// Inserts a scanned sound, or refreshes the scanner-owned columns of the existing row
/// with the same `filepath`. The row id and `ucs_user_category` are preserved, so manual
/// tags and collection memberships survive a re-scan.
pub fn upsert_sound(conn: &Connection, s: &Sound) -> Result<()> {
    conn.execute(
        "INSERT INTO sounds
        (library_id, filename, filepath, relative_folder, extension, filesize, duration, samplerate, bitdepth, channels, bitrate,
         tag_title, tag_artist, tag_album, tag_comment, tag_genre, tag_bpm, tag_description, tag_keywords, tag_tracknumber,
         imported_at, ucs_cat_id, ucs_fx_name, ucs_creator_id, ucs_source_id)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)
        ON CONFLICT(filepath) DO UPDATE SET
            library_id = excluded.library_id,
            filename = excluded.filename,
            relative_folder = excluded.relative_folder,
            extension = excluded.extension,
            filesize = excluded.filesize,
            duration = excluded.duration,
            samplerate = excluded.samplerate,
            bitdepth = excluded.bitdepth,
            channels = excluded.channels,
            bitrate = excluded.bitrate,
            tag_title = excluded.tag_title,
            tag_artist = excluded.tag_artist,
            tag_album = excluded.tag_album,
            tag_comment = excluded.tag_comment,
            tag_genre = excluded.tag_genre,
            tag_bpm = excluded.tag_bpm,
            tag_description = excluded.tag_description,
            tag_keywords = excluded.tag_keywords,
            tag_tracknumber = excluded.tag_tracknumber,
            imported_at = excluded.imported_at,
            ucs_cat_id = excluded.ucs_cat_id,
            ucs_fx_name = excluded.ucs_fx_name,
            ucs_creator_id = excluded.ucs_creator_id,
            ucs_source_id = excluded.ucs_source_id",
        params![
            s.library_id, s.filename, s.filepath, s.relative_folder, s.extension, s.filesize,
            s.duration, s.samplerate, s.bitdepth, s.channels, s.bitrate,
            s.tag_title, s.tag_artist, s.tag_album, s.tag_comment, s.tag_genre,
            s.tag_bpm, s.tag_description, s.tag_keywords, s.tag_tracknumber, s.imported_at,
            s.ucs_cat_id, s.ucs_fx_name, s.ucs_creator_id, s.ucs_source_id
            // ucs_user_category is never written by scanner – only by save_ucs_tag command
        ],
    )?;
    Ok(())
}

/// Atomically syncs a library with a fresh scan: upserts every scanned sound and removes
/// sounds (and their collection memberships) whose files are no longer present.
/// Any error rolls the whole sync back.
pub fn sync_library_sounds(
    conn: &mut Connection,
    library_id: i64,
    sounds: &[Sound],
    now: &str,
) -> Result<()> {
    let tx = conn.transaction()?;

    for sound in sounds {
        upsert_sound(&tx, sound)?;
    }

    let scanned: std::collections::HashSet<&str> =
        sounds.iter().map(|s| s.filepath.as_str()).collect();
    let stale: Vec<i64> = {
        let mut stmt = tx.prepare("SELECT id, filepath FROM sounds WHERE library_id = ?1")?;
        let rows = stmt.query_map(params![library_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut ids = Vec::new();
        for r in rows {
            let (id, path) = r?;
            if !scanned.contains(path.as_str()) {
                ids.push(id);
            }
        }
        ids
    };
    for id in stale {
        tx.execute("DELETE FROM collection_sounds WHERE sound_id = ?1", params![id])?;
        tx.execute("DELETE FROM sounds WHERE id = ?1", params![id])?;
    }

    update_library_count(&tx, library_id, now)?;
    tx.commit()
}

/// Removes a library together with its sounds and their collection memberships.
pub fn remove_library_cascade(conn: &mut Connection, library_id: i64) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM collection_sounds WHERE sound_id IN (SELECT id FROM sounds WHERE library_id = ?1)",
        params![library_id],
    )?;
    delete_sounds_for_library(&tx, library_id)?;
    delete_library(&tx, library_id)?;
    tx.commit()
}

pub fn fetch_libraries(conn: &Connection) -> Result<Vec<Library>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, file_count, created_at, last_scanned FROM libraries ORDER BY name",
    )?;
    let libs = stmt
        .query_map([], |row| {
            Ok(Library {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                file_count: row.get(3)?,
                created_at: row.get(4)?,
                last_scanned: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(libs)
}

pub fn delete_library(conn: &Connection, library_id: i64) -> Result<()> {
    conn.execute("DELETE FROM libraries WHERE id = ?1", params![library_id])?;
    Ok(())
}

pub fn delete_sounds_for_library(conn: &Connection, library_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM sounds WHERE library_id = ?1",
        params![library_id],
    )?;
    Ok(())
}

/// Returns all distinct folder paths for a library, with file counts.
/// Builds a tree from flat paths.
pub fn fetch_folder_tree(conn: &Connection, library_id: i64) -> Result<Vec<FolderNode>> {
    let mut stmt = conn.prepare(
        "SELECT relative_folder, COUNT(*) as cnt
         FROM sounds
         WHERE library_id = ?1 AND relative_folder != ''
         GROUP BY relative_folder
         ORDER BY relative_folder",
    )?;

    struct FlatFolder {
        path: String,
        count: i64,
    }
    let flat: Vec<FlatFolder> = stmt
        .query_map(params![library_id], |row| {
            Ok(FlatFolder {
                path: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Also count files directly in the root (relative_folder == '')
    let root_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sounds WHERE library_id = ?1 AND relative_folder = ''",
            params![library_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(build_tree(
        flat.iter().map(|f| (f.path.as_str(), f.count)).collect(),
        root_count,
    ))
}

fn build_tree(flat: Vec<(&str, i64)>, root_count: i64) -> Vec<FolderNode> {
    let mut roots: Vec<FolderNode> = Vec::new();

    if root_count > 0 {
        roots.push(FolderNode {
            name: "(Hauptordner)".into(),
            full_path: "".into(),
            library_id: 0,
            file_count: root_count,
            children: vec![],
        });
    }

    for (path, count) in flat {
        let parts: Vec<&str> = path.split('/').collect();
        insert_into_tree(&mut roots, &parts, path, count, 0);
    }
    roots
}

fn insert_into_tree(
    nodes: &mut Vec<FolderNode>,
    parts: &[&str],
    full_path: &str,
    count: i64,
    depth: usize,
) {
    if parts.is_empty() {
        return;
    }
    let name = parts[0];

    // Compute this node's full_path: take the first (depth+1) segments of the original full_path
    let all_parts: Vec<&str> = full_path.split('/').collect();
    let this_full_path = all_parts[..=(depth.min(all_parts.len().saturating_sub(1)))].join("/");

    if let Some(node) = nodes.iter_mut().find(|n| n.name == name) {
        if parts.len() == 1 {
            node.file_count += count;
            node.full_path = full_path.to_string();
        } else {
            insert_into_tree(&mut node.children, &parts[1..], full_path, count, depth + 1);
        }
    } else {
        let mut new_node = FolderNode {
            name: name.to_string(),
            full_path: if parts.len() == 1 {
                full_path.to_string()
            } else {
                this_full_path
            },
            library_id: 0,
            file_count: if parts.len() == 1 { count } else { 0 },
            children: vec![],
        };
        if parts.len() > 1 {
            insert_into_tree(
                &mut new_node.children,
                &parts[1..],
                full_path,
                count,
                depth + 1,
            );
        }
        nodes.push(new_node);
    }
}

/// Escapes `%`, `_` and `\\` so a folder name is matched literally inside a LIKE pattern
/// (used together with `ESCAPE '\\'`).
fn escape_like(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Builds a safe FTS5 MATCH expression: every whitespace-separated word becomes a quoted
/// prefix term (`"word"*`), so FTS operators and punctuation in user input (`-`, `:`, `(`,
/// `AND`, `NEAR`, ...) are treated as plain text instead of causing syntax errors.
/// Returns `None` when the input contains no searchable word.
fn build_fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .split_whitespace()
        .map(|w| w.replace('"', ""))
        .filter(|w| w.chars().any(|c| c.is_alphanumeric()))
        .map(|w| format!("\"{}\"*", w))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

pub fn query_sounds(conn: &Connection, query: &str, filters: &SearchFilters) -> Result<Vec<Sound>> {
    let trimmed = query.trim();
    let mut conditions: Vec<String> = vec![];
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    let fts_query = build_fts_query(trimmed);
    let use_fts = fts_query.is_some();
    let fts_query = fts_query.unwrap_or_default();

    if let Some(lib_id) = filters.library_id {
        conditions.push("s.library_id = ?".to_string());
        params_vec.push(Box::new(lib_id));
    }
    if let Some(ref folder) = filters.folder {
        if !folder.is_empty() {
            // Match exact folder OR any subfolder under it
            let prefix = format!("{}/%", escape_like(folder));
            conditions.push("(s.relative_folder = ? OR s.relative_folder LIKE ? ESCAPE '\\')".to_string());
            params_vec.push(Box::new(folder.clone()));
            params_vec.push(Box::new(prefix));
        } else {
            conditions.push("s.relative_folder = ''".to_string());
        }
    }
    if let Some(ref ext) = filters.extension {
        if !ext.is_empty() {
            conditions.push("LOWER(s.extension) = LOWER(?)".to_string());
            params_vec.push(Box::new(ext.clone()));
        }
    }
    if let Some(min_d) = filters.min_duration {
        conditions.push("s.duration >= ?".to_string());
        params_vec.push(Box::new(min_d));
    }
    if let Some(max_d) = filters.max_duration {
        conditions.push("s.duration <= ?".to_string());
        params_vec.push(Box::new(max_d));
    }
    if let Some(sr) = filters.samplerate {
        conditions.push("s.samplerate = ?".to_string());
        params_vec.push(Box::new(sr));
    }
    if let Some(bd) = filters.bitdepth {
        conditions.push("s.bitdepth = ?".to_string());
        params_vec.push(Box::new(bd));
    }
    if let Some(ch) = filters.channels {
        conditions.push("s.channels = ?".to_string());
        params_vec.push(Box::new(ch));
    }
    if let Some(ref ucs) = filters.ucs_cat_id {
        if !ucs.is_empty() {
            // Match auto-detected OR manually assigned UCS category
            conditions.push("(LOWER(COALESCE(s.ucs_user_category, s.ucs_cat_id, '')) = LOWER(?))".to_string());
            params_vec.push(Box::new(ucs.clone()));
        }
    }

    let sel_cols = "s.id, s.library_id, s.filename, s.filepath, s.relative_folder, s.extension, s.filesize,
             s.duration, s.samplerate, s.bitdepth, s.channels, s.bitrate,
             s.tag_title, s.tag_artist, s.tag_album, s.tag_comment, s.tag_genre,
             s.tag_bpm, s.tag_description, s.tag_keywords, s.tag_tracknumber, s.imported_at,
             s.ucs_cat_id, s.ucs_fx_name, s.ucs_creator_id, s.ucs_source_id, s.ucs_user_category";

    let order_by = if filters.shuffle.unwrap_or(false) {
        "RANDOM()"
    } else {
        "s.filename"
    };

    let sql = if use_fts {
        params_vec.insert(0, Box::new(fts_query));
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("AND {}", conditions.join(" AND "))
        };
        format!(
            "SELECT {} FROM sounds_fts fts JOIN sounds s ON s.id = fts.rowid
             WHERE sounds_fts MATCH ? {} ORDER BY {} LIMIT 2000",
            sel_cols, where_clause, order_by
        )
    } else {
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        format!(
            "SELECT {} FROM sounds s {} ORDER BY {} LIMIT 2000",
            sel_cols, where_clause, order_by
        )
    };

    let refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let sounds = stmt
        .query_map(refs.as_slice(), |row| {
            Ok(Sound {
                id: row.get(0)?,
                library_id: row.get(1)?,
                filename: row.get(2)?,
                filepath: row.get(3)?,
                relative_folder: row.get(4)?,
                extension: row.get(5)?,
                filesize: row.get(6)?,
                duration: row.get(7)?,
                samplerate: row.get(8)?,
                bitdepth: row.get(9)?,
                channels: row.get(10)?,
                bitrate: row.get(11)?,
                tag_title: row.get(12)?,
                tag_artist: row.get(13)?,
                tag_album: row.get(14)?,
                tag_comment: row.get(15)?,
                tag_genre: row.get(16)?,
                tag_bpm: row.get(17)?,
                tag_description: row.get(18)?,
                tag_keywords: row.get(19)?,
                tag_tracknumber: row.get(20)?,
                imported_at: row.get(21)?,
                ucs_cat_id: row.get(22)?,
                ucs_fx_name: row.get(23)?,
                ucs_creator_id: row.get(24)?,
                ucs_source_id: row.get(25)?,
                ucs_user_category: row.get(26)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
    Ok(sounds)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub count: i64,
}

pub fn create_collection(conn: &Connection, name: &str, now: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO collections (name, created_at) VALUES (?1, ?2)",
        params![name, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn fetch_collections(conn: &Connection) -> Result<Vec<Collection>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, c.created_at, COUNT(cs.sound_id)
         FROM collections c
         LEFT JOIN collection_sounds cs ON c.id = cs.collection_id
         GROUP BY c.id
         ORDER BY c.name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Collection {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
            count: row.get(3)?,
        })
    })?;
    let mut collections = Vec::new();
    for r in rows {
        collections.push(r?);
    }
    Ok(collections)
}

pub fn delete_collection(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn add_to_collection(conn: &Connection, collection_id: i64, sound_id: i64) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO collection_sounds (collection_id, sound_id) VALUES (?1, ?2)",
        params![collection_id, sound_id],
    )?;
    Ok(())
}

pub fn remove_from_collection(conn: &Connection, collection_id: i64, sound_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM collection_sounds WHERE collection_id = ?1 AND sound_id = ?2",
        params![collection_id, sound_id],
    )?;
    Ok(())
}

pub fn query_collection_sounds(conn: &Connection, collection_id: i64) -> Result<Vec<Sound>> {
    let sel_cols = "s.id, s.library_id, s.filename, s.filepath, s.relative_folder, s.extension, s.filesize,
             s.duration, s.samplerate, s.bitdepth, s.channels, s.bitrate,
             s.tag_title, s.tag_artist, s.tag_album, s.tag_comment, s.tag_genre,
             s.tag_bpm, s.tag_description, s.tag_keywords, s.tag_tracknumber, s.imported_at,
             s.ucs_cat_id, s.ucs_fx_name, s.ucs_creator_id, s.ucs_source_id, s.ucs_user_category";

    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM sounds s
         JOIN collection_sounds cs ON s.id = cs.sound_id
         WHERE cs.collection_id = ?1
         ORDER BY s.filename",
        sel_cols
    ))?;

    let sounds = stmt.query_map(params![collection_id], |row| {
        Ok(Sound {
            id: row.get(0)?,
            library_id: row.get(1)?,
            filename: row.get(2)?,
            filepath: row.get(3)?,
            relative_folder: row.get(4)?,
            extension: row.get(5)?,
            filesize: row.get(6)?,
            duration: row.get(7)?,
            samplerate: row.get(8)?,
            bitdepth: row.get(9)?,
            channels: row.get(10)?,
            bitrate: row.get(11)?,
            tag_title: row.get(12)?,
            tag_artist: row.get(13)?,
            tag_album: row.get(14)?,
            tag_comment: row.get(15)?,
            tag_genre: row.get(16)?,
            tag_bpm: row.get(17)?,
            tag_description: row.get(18)?,
            tag_keywords: row.get(19)?,
            tag_tracknumber: row.get(20)?,
            imported_at: row.get(21)?,
            ucs_cat_id: row.get(22)?,
            ucs_fx_name: row.get(23)?,
            ucs_creator_id: row.get(24)?,
            ucs_source_id: row.get(25)?,
            ucs_user_category: row.get(26)?,
        })
    })?;

    let mut result = Vec::new();
    for s in sounds {
        result.push(s?);
    }
    Ok(result)
}

/// Persist a manually assigned UCS user category (never overwritten by scanner).
pub fn save_ucs_user_category(conn: &Connection, id: i64, ucs_user_category: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE sounds SET ucs_user_category = ?1 WHERE id = ?2",
        params![ucs_user_category, id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_query_quotes_every_term() {
        assert_eq!(build_fts_query("door slam").as_deref(), Some("\"door\"* \"slam\"*"));
        assert_eq!(build_fts_query("door-slam").as_deref(), Some("\"door-slam\"*"));
        assert_eq!(build_fts_query("a:b AND (x").as_deref(), Some("\"a:b\"* \"AND\"* \"(x\"*"));
        assert_eq!(build_fts_query("\"\" - *"), None);
        assert_eq!(build_fts_query("   "), None);
    }

    #[test]
    fn folder_filter_treats_wildcards_literally() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let lib = insert_library(&conn, "l", "/l", "t").unwrap();
        let mut sounds = Vec::new();
        for (i, folder) in ["My_Folder", "My_Folder/sub", "MyXFolder", "MyXFolder/sub", "100%"].iter().enumerate() {
            let mut snd = test_sound(lib, &format!("/l/{}.wav", i));
            snd.relative_folder = folder.to_string();
            sounds.push(snd);
        }
        sync_library_sounds(&mut conn, lib, &sounds, "t").unwrap();
        let filters = |f: &str| SearchFilters {
            library_id: None, folder: Some(f.into()), extension: None, min_duration: None,
            max_duration: None, samplerate: None, bitdepth: None, channels: None,
            ucs_cat_id: None, shuffle: None,
        };
        assert_eq!(query_sounds(&conn, "", &filters("My_Folder")).unwrap().len(), 2);
        assert_eq!(query_sounds(&conn, "", &filters("100%")).unwrap().len(), 1);
    }

    fn test_sound(library_id: i64, path: &str) -> Sound {
        Sound {
            id: 0, library_id, filename: path.into(), filepath: path.into(),
            relative_folder: String::new(), extension: "wav".into(), filesize: 1,
            duration: None, samplerate: None, bitdepth: None, channels: None, bitrate: None,
            tag_title: None, tag_artist: None, tag_album: None, tag_comment: None,
            tag_genre: None, tag_bpm: None, tag_description: None, tag_keywords: None,
            tag_tracknumber: None, imported_at: "t".into(), ucs_cat_id: None,
            ucs_fx_name: None, ucs_creator_id: None, ucs_source_id: None,
            ucs_user_category: None,
        }
    }

    #[test]
    fn rescan_keeps_manual_tags_and_collections() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        init_schema(&conn).unwrap();
        let lib = insert_library(&conn, "l", "/l", "t").unwrap();

        sync_library_sounds(&mut conn, lib, &[test_sound(lib, "/l/a.wav"), test_sound(lib, "/l/b.wav")], "t").unwrap();
        let a_id: i64 = conn.query_row("SELECT id FROM sounds WHERE filepath='/l/a.wav'", [], |r| r.get(0)).unwrap();
        let b_id: i64 = conn.query_row("SELECT id FROM sounds WHERE filepath='/l/b.wav'", [], |r| r.get(0)).unwrap();
        save_ucs_user_category(&conn, a_id, Some("DOORWood")).unwrap();
        let col = create_collection(&conn, "c", "t").unwrap();
        add_to_collection(&conn, col, a_id).unwrap();
        add_to_collection(&conn, col, b_id).unwrap();

        // b.wav disappeared, a.wav still there
        sync_library_sounds(&mut conn, lib, &[test_sound(lib, "/l/a.wav")], "t2").unwrap();

        let (id, cat): (i64, Option<String>) = conn
            .query_row("SELECT id, ucs_user_category FROM sounds WHERE filepath='/l/a.wav'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(id, a_id);
        assert_eq!(cat.as_deref(), Some("DOORWood"));
        let members = query_collection_sounds(&conn, col).unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(fetch_collections(&conn).unwrap()[0].count, 1);
        assert_eq!(fetch_libraries(&conn).unwrap()[0].file_count, 1);
    }

    #[test]
    fn failed_sync_rolls_back() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let lib = insert_library(&conn, "l", "/l", "t").unwrap();
        sync_library_sounds(&mut conn, lib, &[test_sound(lib, "/l/a.wav")], "t").unwrap();
        // library_id that violates NOT NULL via bad data is hard to craft; use a failing
        // second row (filename NULL is impossible), so simulate by dropping the table.
        conn.execute_batch("DROP TABLE collection_sounds").unwrap();
        let r = sync_library_sounds(&mut conn, lib, &[], "t2");
        assert!(r.is_err());
        // connection must still be usable (no dangling transaction) and data intact
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM sounds", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        assert!(conn.transaction().is_ok());
    }
}
