// Pure aggregation of Zoho leads + daily ad spend into the dashboard payload.
// Keeps the exact response shape (and counting rules) of the original
// /app/leads and /app/leads/meetingfilter handlers so the deployed widget keeps working.

const { DEFAULT_CITY_MAP } = require('./cities');

const PER_REFERRAL_COST = 50000;
const CP_LEAD_COMMISSION = 0.025;

function getAllDatesInRange(start, end) {
  const dates = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function inRange(start, end, date) {
  return start <= date && end >= date;
}

// Meeting_Done_Date as YYYY-MM-DD (Zoho sends a date or a date-time), or null.
function meetingDay(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function newDay() {
  return { budget: 0, meetings_done: 0, qualified: 0, future_qualified: 0, leads_count: 0, converted: 0, clicks: 0 };
}

function newTotals() {
  return { cost: 0, clicks: 0, meetings_done: 0, qualified: 0, future_qualified: 0, leads_count: 0, converted: 0 };
}

// The Zoho function sends mobile_len (newer) or the full mobile number (older).
function hasValidMobile(lead) {
  const len = lead.mobile_len ?? lead.mobile?.length;
  return len > 9 && len < 14;
}

// Which dashboard bucket a lead belongs to. Google means Lead Source "Google AdWords" only
// (confirmed by the client 21 Oct 2026); Direct Call, ERP Lead and leads with no source are
// not part of any source tab.
function bucketFor(source) {
  if (source === 'Google AdWords') return 'google';
  if (source === 'Meta Ads') return 'facebook';
  if (source === 'Referral Lead') return 'referral';
  if (source === 'CP Lead') return 'cplead';
  return null;
}

/**
 * @param {object} p
 * @param {Array}  p.leads        leads_data from the Zoho function
 * @param {Array}  p.googleSpend  [{date:'YYYY-MM-DD', campaign:String, cost:Number, clicks:Number}]
 * @param {Array}  p.facebookSpend same shape as googleSpend
 * @param {string} p.startDate    'YYYY-MM-DD' (lead generation range)
 * @param {string} p.endDate
 * @param {string} [p.meetingStartDate] optional meeting-date filter
 * @param {string} [p.meetingEndDate]
 * @param {number} [p.gstRate]  added on top of Google/Meta spend (APIs report spend without GST)
 * @param {string} [p.city]     only leads owned by this city's owners / spend on this city's campaigns
 * @param {object} [p.cityMap]  city lookup from createCityMap (default: built-in mapping)
 * @param {string} [p.dateBy]   'lead' (default): startDate/endDate are lead created dates.
 *                              'meeting': they are meeting done dates; every lead with a meeting in
 *                              the range counts as one meeting, on its meeting date, whenever the
 *                              lead was created. Spend is for the same range.
 */
function buildLeadsResponse({ leads, googleSpend, facebookSpend, startDate, endDate, meetingStartDate, meetingEndDate, gstRate = 0, city, cityMap = DEFAULT_CITY_MAP, dateBy = 'lead' }) {
  const byMeeting = dateBy === 'meeting';
  const start = new Date(startDate);
  const end = new Date(endDate);

  let rows = Array.isArray(leads) ? leads : [];
  if (meetingStartDate && meetingEndDate) {
    const mstart = new Date(meetingStartDate);
    const mend = new Date(meetingEndDate);
    rows = rows.filter((item) => item.meetingdate && inRange(mstart, mend, new Date(item.meetingdate)));
  }

  // A lead belongs to the city its assignee was mapped to on the lead's created date.
  if (city) rows = rows.filter((item) => cityMap.cityForLead(item.owner, item.created_by, item.date) === city);

  const days = { google: {}, facebook: {}, referral: {}, cplead: {} };
  const totals = { google: newTotals(), facebook: newTotals(), referral: newTotals(), cplead: newTotals() };
  const dayFor = (bucket, dateStr) => (days[bucket][dateStr] ||= newDay());

  for (const x of rows) {
    // The date that places the row in the range: lead created date, or meeting done date.
    const dateStr = byMeeting ? meetingDay(x.meetingdate) : x.date;
    if (!dateStr) continue;
    const rowDate = new Date(dateStr);
    if (!inRange(start, end, rowDate)) continue;
    const bucket = bucketFor(x.source);
    if (!bucket) continue;

    const day = dayFor(bucket, rowDate.toISOString().split('T')[0]);
    const tot = totals[bucket];

    if (byMeeting) {
      // Meeting view: no lead counts; every lead met in the range is one meeting done.
      day.meetings_done++; tot.meetings_done++;
    } else {
      // A lead counts only with a valid mobile number (10-13 characters), for every source.
      if (hasValidMobile(x)) { day.leads_count++; tot.leads_count++; }
      if (x.iss === 'Meeting Done') { day.meetings_done++; tot.meetings_done++; }
    }
    if (x.qs === 'Qualified') { day.qualified++; tot.qualified++; }
    if (x.qs === 'Future Qualified') { day.future_qualified++; tot.future_qualified++; }
    if (x.converted === 'Converted') {
      day.converted++;
      tot.converted++;
      let cost = 0;
      if (bucket === 'referral') cost = PER_REFERRAL_COST;
      if (bucket === 'cplead') cost = x.cpbudget ? Number(x.cpbudget) * CP_LEAD_COMMISSION : 0;
      day.budget += cost;
      tot.cost += cost;
    }
  }

  const gstFactor = 1 + gstRate;
  const addSpend = (bucket, spendRows) => {
    for (const row of spendRows || []) {
      const adDate = new Date(row.date);
      if (!inRange(start, end, adDate)) continue;
      if (city && cityMap.cityForCampaign(row.campaign) !== city) continue;
      const cost = row.cost * gstFactor;
      const day = dayFor(bucket, adDate.toISOString().split('T')[0]);
      day.budget += cost;
      day.clicks += row.clicks;
      totals[bucket].cost += cost;
      totals[bucket].clicks += row.clicks;
    }
  };
  addSpend('google', googleSpend);
  addSpend('facebook', facebookSpend);

  const labels = getAllDatesInRange(start, end);
  const series = (bucket, field) => labels.map((d) => days[bucket][d]?.[field] || 0);
  const ratio = (a, b) => (b ? a / b : 0);
  const sumSeries = (a, b) => a.map((v, i) => v + b[i]);

  const out = { labels };

  for (const bucket of ['google', 'facebook']) {
    const t = totals[bucket];
    Object.assign(out, {
      [`${bucket}_budget`]: t.cost,
      [`${bucket}_clicks`]: t.clicks,
      [`${bucket}_leads`]: t.leads_count,
      [`${bucket}_qualified`]: t.qualified,
      [`${bucket}_future_qualified`]: t.future_qualified,
      [`${bucket}_converted`]: t.converted,
      [`${bucket}_meetings_done`]: t.meetings_done,
      [`cpl_${bucket}`]: ratio(t.cost, t.leads_count),
      [`cpm_${bucket}`]: ratio(t.cost, t.meetings_done),
      [`lpq_${bucket}`]: ratio(t.leads_count, t.qualified),
      [`lpc_${bucket}`]: ratio(t.cost, t.converted),
      [`${bucket}_budgetData`]: series(bucket, 'budget'),
      [`${bucket}_meetingsData`]: series(bucket, 'meetings_done'),
      [`${bucket}_qualifiedData`]: series(bucket, 'qualified'),
      [`${bucket}_leadsData`]: series(bucket, 'leads_count'),
      [`${bucket}_convertedData`]: series(bucket, 'converted'),
    });
  }

  // Socials = Google + Facebook
  const g = totals.google, f = totals.facebook;
  Object.assign(out, {
    socials_budget: g.cost + f.cost,
    socials_leads: g.leads_count + f.leads_count,
    socials_qualified: g.qualified + f.qualified,
    socials_future_qualified: g.future_qualified + f.future_qualified,
    socials_converted: g.converted + f.converted,
    socials_meetings_done: g.meetings_done + f.meetings_done,
    cpl_socials: ratio(g.cost + f.cost, g.leads_count + f.leads_count),
    cpm_socials: ratio(g.cost + f.cost, g.meetings_done + f.meetings_done),
    lpq_socials: ratio(g.leads_count + f.leads_count, g.qualified + f.qualified),
    lpc_socials: ratio(f.cost + g.cost, g.converted + f.converted),
    socials_budgetData: sumSeries(out.google_budgetData, out.facebook_budgetData),
    socials_meetingsData: sumSeries(out.google_meetingsData, out.facebook_meetingsData),
    socials_qualifiedData: sumSeries(out.google_qualifiedData, out.facebook_qualifiedData),
    socials_convertedData: sumSeries(out.google_convertedData, out.facebook_convertedData),
    socials_leadsData: sumSeries(out.google_leadsData, out.facebook_leadsData),
  });

  for (const bucket of ['referral', 'cplead']) {
    const t = totals[bucket];
    Object.assign(out, {
      [`${bucket}_budget`]: t.cost,
      [`${bucket}_leads`]: t.leads_count,
      [`${bucket}_qualified`]: t.qualified,
      [`${bucket}_future_qualified`]: t.future_qualified,
      [`${bucket}_converted`]: t.converted,
      [`${bucket}_meetings_done`]: t.meetings_done,
      [`cpl_${bucket}`]: bucket === 'referral'
        ? (t.converted > 0 ? PER_REFERRAL_COST : 0)
        : ratio(t.cost, t.leads_count),
      [`cpm_${bucket}`]: ratio(t.cost, t.meetings_done),
      [`lpc_${bucket}`]: ratio(t.cost, t.converted),
      [`${bucket}_budgetData`]: series(bucket, 'budget'),
      [`${bucket}_meetingsData`]: series(bucket, 'meetings_done'),
      [`${bucket}_qualifiedData`]: series(bucket, 'qualified'),
      [`${bucket}_leadsData`]: series(bucket, 'leads_count'),
      [`${bucket}_convertedData`]: series(bucket, 'converted'),
    });
  }

  return out;
}

const MEETING_KEYS = {
  google_meeting: 'google_meetings_data',
  facebook_meeting: 'facebook_meetings_data',
  socials_meeting: 'socials_meetings_data',
  referral_meeting: 'referral_meetings_data',
  cplead_meeting: 'cplead_meetings_data',
};

// Count meetings per source within [startDate, endDate]. Items are either a date string
// or {date, owner, created_by, lead_date}; owner is needed for the City filter. A meeting
// counts for the city of its lead (lead_date = the lead's created date; older Zoho output
// without it falls back to the meeting date).
function countMeetings(output, startDate, endDate, city, cityMap = DEFAULT_CITY_MAP) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const counts = {};
  for (const [key, field] of Object.entries(MEETING_KEYS)) {
    const list = Array.isArray(output[field]) ? output[field] : [];
    counts[key] = list.filter((item) => {
      const date = item && typeof item === 'object' ? item.date : item;
      if (!inRange(start, end, new Date(date))) return false;
      return !city || (typeof item === 'object'
        && cityMap.cityForLead(item.owner, item.created_by, item.lead_date || item.date) === city);
    }).length;
  }
  return counts;
}

// Ad spend (incl. GST) per city for the range.
function spendByCity(spendRows, startDate, endDate, gstRate = 0, cityMap = DEFAULT_CITY_MAP) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const out = {};
  for (const row of spendRows) {
    if (!inRange(start, end, new Date(row.date))) continue;
    const city = cityMap.cityForCampaign(row.campaign) || 'Unassigned';
    out[city] = (out[city] || 0) + row.cost * (1 + gstRate);
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

module.exports = { buildLeadsResponse, countMeetings, spendByCity, getAllDatesInRange };
