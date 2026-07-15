'use strict';

/**
 * Offline country reference helpers used by the world layer of the city gazetteer.
 * ISO2 -> country name (via Node's Intl/ICU), ISO2 -> ISO3, ISO2 -> continent.
 * The ISO maps are copied from scripts/geonames-api.js (kept standalone so this module
 * has no DB / network dependency). Pure and side-effect free.
 */

// ISO 3166-1 alpha-2 -> alpha-3 (complete).
const ISO2_TO_ISO3 = {
  AD:'AND',AE:'ARE',AF:'AFG',AG:'ATG',AI:'AIA',AL:'ALB',AM:'ARM',AO:'AGO',AQ:'ATA',AR:'ARG',
  AS:'ASM',AT:'AUT',AU:'AUS',AW:'ABW',AX:'ALA',AZ:'AZE',BA:'BIH',BB:'BRB',BD:'BGD',BE:'BEL',
  BF:'BFA',BG:'BGR',BH:'BHR',BI:'BDI',BJ:'BEN',BL:'BLM',BM:'BMU',BN:'BRN',BO:'BOL',BQ:'BES',
  BR:'BRA',BS:'BHS',BT:'BTN',BV:'BVT',BW:'BWA',BY:'BLR',BZ:'BLZ',CA:'CAN',CC:'CCK',CD:'COD',
  CF:'CAF',CG:'COG',CH:'CHE',CI:'CIV',CK:'COK',CL:'CHL',CM:'CMR',CN:'CHN',CO:'COL',CR:'CRI',
  CU:'CUB',CV:'CPV',CW:'CUW',CX:'CXR',CY:'CYP',CZ:'CZE',DE:'DEU',DJ:'DJI',DK:'DNK',DM:'DMA',
  DO:'DOM',DZ:'DZA',EC:'ECU',EE:'EST',EG:'EGY',EH:'ESH',ER:'ERI',ES:'ESP',ET:'ETH',FI:'FIN',
  FJ:'FJI',FK:'FLK',FM:'FSM',FO:'FRO',FR:'FRA',GA:'GAB',GB:'GBR',GD:'GRD',GE:'GEO',GF:'GUF',
  GG:'GGY',GH:'GHA',GI:'GIB',GL:'GRL',GM:'GMB',GN:'GIN',GP:'GLP',GQ:'GNQ',GR:'GRC',GS:'SGS',
  GT:'GTM',GU:'GUM',GW:'GNB',GY:'GUY',HK:'HKG',HM:'HMD',HN:'HND',HR:'HRV',HT:'HTI',HU:'HUN',
  ID:'IDN',IE:'IRL',IL:'ISR',IM:'IMN',IN:'IND',IO:'IOT',IQ:'IRQ',IR:'IRN',IS:'ISL',IT:'ITA',
  JE:'JEY',JM:'JAM',JO:'JOR',JP:'JPN',KE:'KEN',KG:'KGZ',KH:'KHM',KI:'KIR',KM:'COM',KN:'KNA',
  KP:'PRK',KR:'KOR',KW:'KWT',KY:'CYM',KZ:'KAZ',LA:'LAO',LB:'LBN',LC:'LCA',LI:'LIE',LK:'LKA',
  LR:'LBR',LS:'LSO',LT:'LTU',LU:'LUX',LV:'LVA',LY:'LBY',MA:'MAR',MC:'MCO',MD:'MDA',ME:'MNE',
  MF:'MAF',MG:'MDG',MH:'MHL',MK:'MKD',ML:'MLI',MM:'MMR',MN:'MNG',MO:'MAC',MP:'MNP',MQ:'MTQ',
  MR:'MRT',MS:'MSR',MT:'MLT',MU:'MUS',MV:'MDV',MW:'MWI',MX:'MEX',MY:'MYS',MZ:'MOZ',NA:'NAM',
  NC:'NCL',NE:'NER',NF:'NFK',NG:'NGA',NI:'NIC',NL:'NLD',NO:'NOR',NP:'NPL',NR:'NRU',NU:'NIU',
  NZ:'NZL',OM:'OMN',PA:'PAN',PE:'PER',PF:'PYF',PG:'PNG',PH:'PHL',PK:'PAK',PL:'POL',PM:'SPM',
  PN:'PCN',PR:'PRI',PS:'PSE',PT:'PRT',PW:'PLW',PY:'PRY',QA:'QAT',RE:'REU',RO:'ROU',RS:'SRB',
  RU:'RUS',RW:'RWA',SA:'SAU',SB:'SLB',SC:'SYC',SD:'SDN',SE:'SWE',SG:'SGP',SH:'SHN',SI:'SVN',
  SJ:'SJM',SK:'SVK',SL:'SLE',SM:'SMR',SN:'SEN',SO:'SOM',SR:'SUR',SS:'SSD',ST:'STP',SV:'SLV',
  SX:'SXM',SY:'SYR',SZ:'SWZ',TC:'TCA',TD:'TCD',TF:'ATF',TG:'TGO',TH:'THA',TJ:'TJK',TK:'TKL',
  TL:'TLS',TM:'TKM',TN:'TUN',TO:'TON',TR:'TUR',TT:'TTO',TV:'TUV',TW:'TWN',TZ:'TZA',UA:'UKR',
  UG:'UGA',UM:'UMI',US:'USA',UY:'URY',UZ:'UZB',VA:'VAT',VC:'VCT',VE:'VEN',VG:'VGB',VI:'VIR',
  VN:'VNM',VU:'VUT',WF:'WLF',WS:'WSM',YE:'YEM',YT:'MYT',ZA:'ZAF',ZM:'ZMB',ZW:'ZWE',XK:'XKX',
};

// ISO2 -> continent. Derived from a compact ISO2 grouping (covers every alpha-2 above).
const CONTINENTS = {
  'North America': ['US','CA','MX','GT','BZ','SV','HN','NI','CR','PA','CU','JM','HT','DO','BS','BB','AG','DM','GD','KN','LC','VC','TT','PR','VI','VG','AI','MS','MQ','GP','BL','MF','KY','TC','BM','GL','PM','AW','CW','SX','BQ'],
  'South America': ['BR','AR','CL','CO','PE','VE','EC','BO','PY','UY','GY','SR','GF','FK','GS'],
  'Europe': ['GB','FR','DE','IT','ES','NL','BE','CH','AT','DK','SE','NO','FI','PL','CZ','HU','RO','BG','GR','PT','IE','IS','LU','MC','LI','SM','VA','AD','MK','AL','BA','RS','ME','HR','SI','SK','LT','LV','EE','BY','UA','MD','FO','GG','JE','IM','GI','AX','SJ','XK','MT'],
  'Asia': ['CN','JP','KR','KP','IN','ID','TH','VN','PH','MY','SG','MM','KH','LA','BD','PK','AF','IR','IQ','SA','AE','QA','KW','BH','OM','YE','JO','LB','SY','IL','PS','TR','GE','AM','AZ','KZ','KG','TJ','UZ','TM','MN','NP','BT','MV','LK','HK','MO','TW','BN','TL','CY','IO'],
  'Africa': ['EG','LY','TN','DZ','MA','EH','SD','SS','ET','ER','DJ','SO','KE','UG','TZ','RW','BI','CD','CG','CF','TD','CM','NG','NE','BF','ML','SN','GM','GN','GW','SL','LR','CI','GH','TG','BJ','GA','GQ','ST','AO','ZM','ZW','BW','NA','ZA','LS','SZ','MZ','MG','MU','SC','KM','YT','RE','SH','CV','MW'],
  'Oceania': ['AU','NZ','PG','FJ','SB','VU','NC','PF','WS','TO','KI','TV','NR','PW','FM','MH','CK','NU','TK','AS','GU','MP','WF','PN'],
  'Antarctica': ['AQ','TF','BV','HM'],
};
const ISO2_TO_CONTINENT = {};
for (const [cont, codes] of Object.entries(CONTINENTS)) for (const c of codes) ISO2_TO_CONTINENT[c] = cont;

// Country display names via ICU; cached. Small fallbacks for names ICU renders unusually.
let _regionNames = null;
function regionNames() {
  if (!_regionNames) {
    try { _regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); }
    catch { _regionNames = { of: (c) => c }; }
  }
  return _regionNames;
}
const NAME_OVERRIDES = { US: 'United States', GB: 'United Kingdom', KP: 'North Korea', KR: 'South Korea', RU: 'Russia', XK: 'Kosovo' };

function countryName(iso2) {
  if (!iso2) return null;
  const k = String(iso2).toUpperCase();
  if (NAME_OVERRIDES[k]) return NAME_OVERRIDES[k];
  try { return regionNames().of(k) || k; } catch { return k; }
}
function iso2ToIso3(iso2) { return iso2 ? (ISO2_TO_ISO3[String(iso2).toUpperCase()] || null) : null; }
function continentForIso2(iso2) { return iso2 ? (ISO2_TO_CONTINENT[String(iso2).toUpperCase()] || 'Unknown') : 'Unknown'; }

// Reverse lookups for matching a user-supplied country hint (name / ISO2 / ISO3) to an ISO2.
let _iso3ToIso2 = null, _nameToIso2 = null;
function buildReverse() {
  _iso3ToIso2 = {}; _nameToIso2 = {};
  for (const [i2, i3] of Object.entries(ISO2_TO_ISO3)) {
    _iso3ToIso2[i3] = i2;
    const n = countryName(i2);
    if (n) _nameToIso2[n.toLowerCase().replace(/[^a-z]/g, '')] = i2;
  }
}
/** Normalise a country hint (any of "US","USA","United States") to an ISO2 code, or null. */
function toIso2(hint) {
  if (!hint) return null;
  if (!_iso3ToIso2) buildReverse();
  const raw = String(hint).trim();
  const up = raw.toUpperCase();
  if (up.length === 2 && ISO2_TO_ISO3[up]) return up;
  if (up.length === 3 && _iso3ToIso2[up]) return _iso3ToIso2[up];
  return _nameToIso2[raw.toLowerCase().replace(/[^a-z]/g, '')] || null;
}

module.exports = { countryName, iso2ToIso3, continentForIso2, toIso2 };
