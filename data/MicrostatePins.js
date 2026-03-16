/* ─── Microstate pin coordinates ─────────────────────────────────────────── */
// These tiny countries always render as a clickable dot on the map.
// Even if a country appears in the TopoJSON, its polygon is too small to click
// reliably, so we overlay a dot for all entries in this list.
export const MICROSTATE_PINS=[
  {numeric:"020", lat:42.55, lon: 1.60},  // Andorra
  {numeric:"383", lat:42.60, lon:21.00},  // Kosovo
  {numeric:"438", lat:47.14, lon: 9.55},  // Liechtenstein
  {numeric:"470", lat:35.90, lon:14.51},  // Malta
  {numeric:"492", lat:43.73, lon: 7.40},  // Monaco
  {numeric:"674", lat:43.94, lon:12.47},  // San Marino
  {numeric:"336", lat:41.90, lon:12.45},  // Vatican City
  {numeric:"462", lat: 3.20, lon:73.22},  // Maldives
  {numeric:"520", lat:-0.53, lon:166.93}, // Nauru
  {numeric:"585", lat: 7.51, lon:134.58}, // Palau
  {numeric:"798", lat:-8.52, lon:179.20}, // Tuvalu
];