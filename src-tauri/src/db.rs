use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

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
    let db_path = Path::new(&app_dir).join("audiolookup.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    Ok(conn)
}

fn dirs_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    format!(
        "{}/Library/Application Support/com.antigravity.audiolookup",
        home
    )
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

pub fn insert_sound(conn: &Connection, s: &Sound) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO sounds
        (library_id, filename, filepath, relative_folder, extension, filesize, duration, samplerate, bitdepth, channels, bitrate,
         tag_title, tag_artist, tag_album, tag_comment, tag_genre, tag_bpm, tag_description, tag_keywords, tag_tracknumber,
         imported_at, ucs_cat_id, ucs_fx_name, ucs_creator_id, ucs_source_id)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)",
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

pub fn query_sounds(conn: &Connection, query: &str, filters: &SearchFilters) -> Result<Vec<Sound>> {
    let trimmed = query.trim();
    let mut conditions: Vec<String> = vec![];
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    let use_fts = !trimmed.is_empty();

    if let Some(lib_id) = filters.library_id {
        conditions.push("s.library_id = ?".to_string());
        params_vec.push(Box::new(lib_id));
    }
    if let Some(ref folder) = filters.folder {
        if !folder.is_empty() {
            // Match exact folder OR any subfolder under it
            let prefix = format!("{}/%", folder);
            conditions.push("(s.relative_folder = ? OR s.relative_folder LIKE ?)".to_string());
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

    let sql = if use_fts {
        let fts_query = format!("{}*", trimmed.replace('"', "\"\""));
        params_vec.insert(0, Box::new(fts_query));
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("AND {}", conditions.join(" AND "))
        };
        format!(
            "SELECT {} FROM sounds_fts fts JOIN sounds s ON s.id = fts.rowid
             WHERE sounds_fts MATCH ? {} ORDER BY s.filename LIMIT 2000",
            sel_cols, where_clause
        )
    } else {
        let where_clause = if conditions.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conditions.join(" AND "))
        };
        format!(
            "SELECT {} FROM sounds s {} ORDER BY filename LIMIT 2000",
            sel_cols, where_clause
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

/// Persist a manually assigned UCS user category (never overwritten by scanner).
pub fn save_ucs_user_category(conn: &Connection, id: i64, ucs_user_category: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE sounds SET ucs_user_category = ?1 WHERE id = ?2",
        params![ucs_user_category, id],
    )?;
    Ok(())
}
