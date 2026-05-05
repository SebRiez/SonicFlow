// UCS CatID reference data for frontend dropdowns.
// Mirrors the Rust ucs.rs list (UCS v8.2.1, January 2024).
// Update from https://universalcategorysystem.com when new versions are published.

export const UCS_CAT_IDS = [
  // Ambiences
  { id: 'AMB',       label: 'Ambience' },
  { id: 'AMBBUB',    label: 'Ambience Bubble/Underwater' },
  { id: 'AMBEXT',    label: 'Ambience Exterior' },
  { id: 'AMBINT',    label: 'Ambience Interior' },
  { id: 'AMBNAT',    label: 'Ambience Natural' },
  { id: 'AMBSYNTH',  label: 'Ambience Synthetic' },
  { id: 'AMBURB',    label: 'Ambience Urban' },
  // Animals
  { id: 'AAERO',     label: 'Animal Aerial' },
  { id: 'ABIRD',     label: 'Animal Bird' },
  { id: 'ABUG',      label: 'Animal Bug' },
  { id: 'ADOMEST',   label: 'Animal Domestic' },
  { id: 'AFARM',     label: 'Animal Farm' },
  { id: 'AFISH',     label: 'Animal Fish/Aquatic' },
  { id: 'AFROG',     label: 'Animal Frog/Amphibian' },
  { id: 'AINSECT',   label: 'Animal Insect' },
  { id: 'AMAMMAL',   label: 'Animal Mammal Wild' },
  { id: 'AOTHER',    label: 'Animal Other' },
  { id: 'AREPTILE',  label: 'Animal Reptile' },
  { id: 'AWILD',     label: 'Animal Wildlife General' },
  // Bells / Boing
  { id: 'BELL',      label: 'Bell/Chime' },
  { id: 'BOING',     label: 'Boing/Twang' },
  // Cloth / Foley
  { id: 'CLOTH',     label: 'Cloth/Clothing' },
  { id: 'FOLEY',     label: 'Foley' },
  { id: 'FTSTEP',    label: 'Footsteps' },
  // Crowds / Human
  { id: 'CROWDS',    label: 'Crowd/Mob' },
  { id: 'HUMAN',     label: 'Human Vocalization' },
  // Devices
  { id: 'DEVICE',    label: 'Device/Gadget' },
  // Doors
  { id: 'DOORS',     label: 'Doors/Locks' },
  // Electricity
  { id: 'ELECT',     label: 'Electricity' },
  { id: 'ELECTRF',   label: 'Electricity RF/Interference' },
  // Explosions / Guns / Weapons
  { id: 'EXPLODE',   label: 'Explosion' },
  { id: 'GUNGUN',    label: 'Gunfire General' },
  { id: 'GUNMECH',   label: 'Gunfire Mechanism' },
  { id: 'GUNSHOT',   label: 'Gunfire Shot' },
  { id: 'WEAPONS',   label: 'Weapons General' },
  // Fire
  { id: 'FIRE',      label: 'Fire' },
  // Flying
  { id: 'FLY',       label: 'Flying/Aerial' },
  // High Tech / Sci-Fi
  { id: 'HITECH',    label: 'High Tech/Futuristic' },
  { id: 'SCIENCE',   label: 'Science Fiction' },
  { id: 'SCICOMP',   label: 'Sci-Fi Computer' },
  { id: 'SCIWEAP',   label: 'Sci-Fi Weapon' },
  // Hits / Impacts
  { id: 'HITS',      label: 'Hits/Smack' },
  { id: 'IMPACT',    label: 'Impact' },
  // Home
  { id: 'HOME',      label: 'Home/Household' },
  // Horror
  { id: 'HORROR',    label: 'Horror/Scary' },
  // Industry
  { id: 'INDLRGE',   label: 'Industry Large' },
  { id: 'INDSMLL',   label: 'Industry Small' },
  // Interface / UI
  { id: 'INTERFACE', label: 'Interface/UI' },
  // Liquid / Water
  { id: 'LIQUID',    label: 'Liquid' },
  { id: 'WATER',     label: 'Water' },
  // Large Mechanical
  { id: 'LRGMECH',   label: 'Large Mechanical' },
  // Magic
  { id: 'MAGIC',     label: 'Magic/Supernatural' },
  // Military
  { id: 'MILITARY',  label: 'Military' },
  // Misc
  { id: 'MISC',      label: 'Miscellaneous' },
  { id: 'MONEY',     label: 'Money' },
  { id: 'MUSIC',     label: 'Musical' },
  // Nature
  { id: 'NATURE',    label: 'Nature General' },
  { id: 'NOISE',     label: 'Noise' },
  // Office
  { id: 'OFFICE',    label: 'Office' },
  { id: 'PAPER',     label: 'Paper' },
  // Sports
  { id: 'SPORTS',    label: 'Sports' },
  { id: 'TOOLS',     label: 'Tools' },
  { id: 'TOYS',      label: 'Toys' },
  // Transport
  { id: 'TRANSPORT', label: 'Transport General' },
  { id: 'TRAVEL',    label: 'Travel' },
  { id: 'CARBY',     label: 'Car By' },
  { id: 'CARCRSH',   label: 'Car Crash' },
  { id: 'CARDOOR',   label: 'Car Door' },
  { id: 'CAREXT',    label: 'Car Exterior' },
  { id: 'CARINT',    label: 'Car Interior' },
  { id: 'CARMECH',   label: 'Car Mechanical' },
  { id: 'CARONT',    label: 'Car Onboard' },
  { id: 'CARWHL',    label: 'Car Wheel/Tire' },
  { id: 'TRNAIRL',   label: 'Transport Airline' },
  { id: 'TRNBOAT',   label: 'Transport Boat' },
  { id: 'TRNBUS',    label: 'Transport Bus' },
  { id: 'TRNHELI',   label: 'Transport Helicopter' },
  { id: 'TRNJET',    label: 'Transport Jet' },
  { id: 'TRNMOTO',   label: 'Transport Motorcycle' },
  { id: 'TRNTRAM',   label: 'Transport Tram' },
  { id: 'TRNTRCK',   label: 'Transport Truck' },
  { id: 'TRNTUBE',   label: 'Transport Subway/Tube' },
  // Weather
  { id: 'WEATHER',   label: 'Weather' },
  // Whoosh
  { id: 'WHOOSH',    label: 'Whoosh/Swoosh' },
  // Wood
  { id: 'WOOD',      label: 'Wood' },
  { id: 'WOODHNDL',  label: 'Wood Handle' },
].sort((a, b) => a.id.localeCompare(b.id));

export const UCS_CAT_ID_MAP = Object.fromEntries(UCS_CAT_IDS.map(e => [e.id, e.label]));
