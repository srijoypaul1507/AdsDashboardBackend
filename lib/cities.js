// City mapping for the City filter.
//  - Leads/meetings are assigned to a city by lead owner (the "assignee").
//  - Ad spend is assigned to a city by campaign name.
//
// The assignee → city mapping is maintained by the client in Zoho CRM (module "City Mapping":
// Assignee, City, Effective From), loaded by lib/data.js. Each row means "from this date, this
// user belongs to this city", so a lead takes the city of its assignee's latest row dated on or
// before the lead's created date: when someone moves city, older leads keep the old city.
// Until that mapping is available, the built-in DEFAULT_OWNERS below apply (no dates). They also
// apply to anyone with no rows in Zoho: inactive users (e.g. Naveen, Sudeepthi) can't be picked in
// a Zoho user field, but their old leads must keep counting for their city.
// Both defaults can be overridden without a code change via CITY_OWNERS_JSON / CITY_CAMPAIGNS_JSON,
// e.g. CITY_OWNERS_JSON='{"Bangalore":["Sudipti","Naveen","Shreya"],"Hyderabad":["Madhuri"]}'

// Matched on the owner's full name or first name, case-insensitively. Names as they
// appear in Zoho: "shreya shreya", "naveen naveen", "sudeepthi sudeepthi", "Madhuri Nara",
// "Hosur IS". Owners not listed (e.g. admins) count only under All Cities.
const DEFAULT_OWNERS = {
  Bangalore: ['Sudipti', 'Sudeepthi', 'Naveen', 'Shreya'],
  Hyderabad: ['Madhuri'],
  Hosur: ['Hosur IS', 'Hosur'],
};

// Case-insensitive words looked for in the campaign name. Campaigns that match no city
// (e.g. "Bizbucks_Lead_Gen_...", "Boost Instagram") belong to DEFAULT_SPEND_CITY: checked
// against the client's monthly sheets, untagged spend is Bangalore spend. A city that is
// only in the Zoho mapping is matched on its own name.
const DEFAULT_CAMPAIGNS = {
  Hyderabad: ['hyderabad', 'hyd'],
  Hosur: ['hosur', 'hossur'],
  Bangalore: ['bangalore', 'bengaluru', 'blr'],
};
const DEFAULT_SPEND_CITY = process.env.DEFAULT_SPEND_CITY || 'Bangalore';

// Old spellings still sent by older widget versions.
const CITY_ALIASES = { hossur: 'Hosur' };

// Leads owned by these users are web-form leads; the client attributes them to the
// sales owner shown in the lead's "Created By" field instead (confirmed 21 Oct 2026).
const CREATED_BY_OWNERS = fromEnv('CREATED_BY_OWNERS_JSON', ['Pankaj']);

function fromEnv(name, fallback) {
  if (!process.env[name]) return fallback;
  try {
    return JSON.parse(process.env[name]);
  } catch (err) {
    console.error(`Invalid ${name}, using defaults: ${err.message}`);
    return fallback;
  }
}

const OWNERS = fromEnv('CITY_OWNERS_JSON', DEFAULT_OWNERS);
const CAMPAIGNS = fromEnv('CITY_CAMPAIGNS_JSON', DEFAULT_CAMPAIGNS);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Owner may be a name string or a Zoho lookup object ({name, id, email}).
function ownerName(owner) {
  if (owner && typeof owner === 'object') return owner.name || '';
  return owner || '';
}

/** City for a lead owner in the built-in mapping, matched on the owner's first name (or full name). */
function cityForOwner(owner) {
  const name = norm(ownerName(owner));
  if (!name) return null;
  const first = name.split(' ')[0];
  for (const [city, owners] of Object.entries(OWNERS)) {
    if (owners.some((o) => norm(o) === name || norm(o) === first)) return city;
  }
  return null;
}

const keywordRe = (k) => new RegExp(`(^|[^a-z])${norm(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);

/** City for an ad campaign, by keyword in its name; untagged campaigns go to DEFAULT_SPEND_CITY. */
function cityForCampaign(campaign, extraCities = []) {
  const name = norm(campaign);
  for (const [city, keywords] of Object.entries(CAMPAIGNS)) {
    if (keywords.some((k) => keywordRe(k).test(name))) return city;
  }
  for (const city of extraCities) {
    if (!CAMPAIGNS[city] && keywordRe(city).test(name)) return city;
  }
  return DEFAULT_SPEND_CITY || null;
}

function isCreatedByOwner(owner) {
  const name = norm(ownerName(owner));
  const first = name.split(' ')[0];
  return CREATED_BY_OWNERS.some((o) => norm(o) === name || norm(o) === first);
}

/**
 * Validates the City Mapping rows from Zoho and indexes them by assignee.
 * Rows: [{assignee:'shreya shreya', city:'Bangalore', from:'2020-01-01'}]. Rows with a
 * missing assignee/city or a bad date are skipped (and reported in `skipped`).
 */
function indexMapping(rows) {
  const byAssignee = new Map();
  let skipped = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const assignee = norm(r && r.assignee);
    const city = String((r && r.city) || '').trim();
    const from = String((r && r.from) || '').slice(0, 10);
    if (!assignee || !city || !DATE_RE.test(from)) { skipped++; continue; }
    if (!byAssignee.has(assignee)) byAssignee.set(assignee, []);
    byAssignee.get(assignee).push({ from, city: CITY_ALIASES[norm(city)] || city });
  }
  for (const list of byAssignee.values()) list.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { byAssignee, skipped };
}

/**
 * The city lookup used for one dashboard request.
 * @param {Array|null} rows City Mapping rows from Zoho; null/empty = built-in mapping (no dates).
 */
function createCityMap(rows) {
  const { byAssignee, skipped } = indexMapping(rows);
  const dated = byAssignee.size > 0;

  const cities = Object.keys(OWNERS);
  if (dated) {
    for (const list of byAssignee.values()) {
      for (const { city } of list) if (!cities.includes(city)) cities.push(city);
    }
  }

  // City of `owner` on `date` (YYYY-MM-DD): their latest row dated on or before it.
  // Someone with no rows keeps the built-in mapping.
  function cityOn(owner, date) {
    const list = dated && byAssignee.get(norm(ownerName(owner)));
    if (!list) return cityForOwner(owner);
    const day = String(date || '').slice(0, 10);
    let city = null;
    for (const row of list) {
      if (row.from > day) break;
      city = row.city;
    }
    return city;
  }

  return {
    source: dated ? 'zoho' : 'default',
    skipped,
    cities,
    /** Canonical city name for a request parameter, or null if unknown. */
    resolve(city) {
      const n = norm(city);
      if (CITY_ALIASES[n] && cities.includes(CITY_ALIASES[n])) return CITY_ALIASES[n];
      return cities.find((c) => norm(c) === n) || null;
    },
    /**
     * City for a lead created on `date`: by lead owner, except for leads owned by
     * CREATED_BY_OWNERS (e.g. Pankaj), which are attributed to the "Created By" user.
     */
    cityForLead(owner, createdBy, date) {
      return cityOn(isCreatedByOwner(owner) ? createdBy : owner, date);
    },
    cityForCampaign(campaign) {
      return cityForCampaign(campaign, cities);
    },
  };
}

const DEFAULT_CITY_MAP = createCityMap(null);
const CITIES = DEFAULT_CITY_MAP.cities;

/** Built-in mapping lookup (no dates), kept for callers without a Zoho mapping. */
function cityForLead(owner, createdBy) {
  return DEFAULT_CITY_MAP.cityForLead(owner, createdBy);
}

function isCity(city) {
  return DEFAULT_CITY_MAP.resolve(city) !== null;
}

module.exports = {
  CITIES, DEFAULT_CITY_MAP, createCityMap, cityForOwner, cityForLead, cityForCampaign, isCity, ownerName,
};
