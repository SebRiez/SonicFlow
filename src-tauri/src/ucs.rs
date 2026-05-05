// Universal Category System v8.2.1 — CatID reference table and filename parser
// Source: universalcategorysystem.com (last updated: January 2024)

/// Parsed UCS metadata block from a filename or metadata chunk.
#[derive(Debug, Default, Clone)]
pub struct UcsMeta {
    pub cat_id: Option<String>,
    pub fx_name: Option<String>,
    pub creator_id: Option<String>,
    pub source_id: Option<String>,
}

/// Official UCS v8.2.1 CatIDs (base portion only, before any `-UserTerm` suffix).
/// Update from https://universalcategorysystem.com when new versions are published.
pub static UCS_CAT_IDS: &[&str] = &[
    // Ambiences
    "AMB", "AMBBUB", "AMBEXT", "AMBINT", "AMBNAT", "AMBSYNTH", "AMBURB",
    // Animals
    "AAERO", "ABIRD", "ABUG", "ADOMEST", "AFARM", "AFISH", "AFROG",
    "AINSECT", "AMAMMAL", "AOTHER", "AREPTILE", "AWILD",
    // Bells / Boing
    "BELL", "BOING",
    // Cloth / Foley
    "CLOTH", "FOLEY", "FTSTEP",
    // Crowds / Human
    "CROWDS", "HUMAN",
    // Devices
    "DEVICE",
    // Doors
    "DOORS",
    // Electricity
    "ELECT", "ELECTRF",
    // Explosions / Guns / Weapons
    "EXPLODE", "GUNGUN", "GUNMECH", "GUNSHOT", "WEAPONS",
    // Fire
    "FIRE",
    // Flying
    "FLY",
    // High Tech / Sci-Fi
    "HITECH", "SCIENCE", "SCICOMP", "SCIWEAP",
    // Hits / Impacts
    "HITS", "IMPACT",
    // Home
    "HOME",
    // Horror
    "HORROR",
    // Industry
    "INDLRGE", "INDSMLL",
    // Interface / UI
    "INTERFACE",
    // Liquid / Water
    "LIQUID", "WATER",
    // Large Mechanical
    "LRGMECH",
    // Magic / Supernatural
    "MAGIC",
    // Military
    "MILITARY",
    // Miscellaneous
    "MISC",
    // Money
    "MONEY",
    // Music
    "MUSIC",
    // Nature
    "NATURE",
    // Noise
    "NOISE",
    // Office
    "OFFICE",
    // Paper
    "PAPER",
    // Sports
    "SPORTS",
    // Tools
    "TOOLS",
    // Toys
    "TOYS",
    // Transport / Vehicles
    "TRANSPORT", "TRAVEL",
    "CARBY", "CARCRSH", "CARDOOR", "CAREXT", "CARINT", "CARMECH", "CARONT", "CARWHL",
    "TRNAIRL", "TRNBOAT", "TRNBUS", "TRNHELI", "TRNJET", "TRNMOTO",
    "TRNTRAM", "TRNTRCK", "TRNTUBE",
    // Weather
    "WEATHER",
    // Whoosh / Swoosh
    "WHOOSH",
    // Wood
    "WOOD", "WOODHNDL",
];

/// Returns the base CatID (strips optional `-UserTerm` suffix, uppercases).
fn base_cat_id(cat_id: &str) -> String {
    cat_id.split('-').next().unwrap_or(cat_id).to_uppercase()
}

/// Returns `true` if the string (or its base) is a known UCS CatID.
pub fn is_known_cat_id(s: &str) -> bool {
    let base = base_cat_id(s);
    UCS_CAT_IDS.iter().any(|&known| known == base.as_str())
}

/// Tries to parse UCS metadata from a file stem (without extension).
/// Expected format: `CatID_FXName_CreatorID[_SourceID]`
pub fn parse_ucs_filename(stem: &str) -> Option<UcsMeta> {
    let parts: Vec<&str> = stem.splitn(5, '_').collect();
    if parts.len() < 3 {
        return None;
    }
    if !is_known_cat_id(parts[0]) {
        return None;
    }
    Some(UcsMeta {
        cat_id:     Some(parts[0].to_string()),
        fx_name:    Some(parts[1].to_string()),
        creator_id: Some(parts[2].to_string()),
        source_id:  parts.get(3).map(|s| s.to_string()),
    })
}

/// Returns a sorted copy of all known CatIDs (used for UI dropdowns).
pub fn all_cat_ids() -> Vec<&'static str> {
    let mut ids = UCS_CAT_IDS.to_vec();
    ids.sort_unstable();
    ids
}
