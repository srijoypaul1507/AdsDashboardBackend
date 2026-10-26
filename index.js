require('dotenv').config()
var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
const { buildLeadsResponse, countMeetings, spendByCity } = require('./lib/aggregate');
const { getZohoOutput, getSpend, getCityMap, warm } = require('./lib/data');

var expressApp = express();
var port = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
// Meta/Google report spend without GST; the business tracks budget including GST.
const GST_RATE = Number(process.env.GST_RATE ?? 0.18);

expressApp.set('port', port);
expressApp.use(morgan('dev'));
expressApp.use(bodyParser.json());
expressApp.use(bodyParser.urlencoded({ extended: false }));

expressApp.use('/', function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  next();
});

expressApp.get('/test', (req, res) => {
  res.send("test ping received!")
})

// Options for the widget's filters. `citySettingsUrl` opens the City Mapping module in Zoho CRM.
expressApp.get('/app/config', async (req, res) => {
  const { map } = await getCityMap();
  res.json({ cities: map.cities, gstRate: GST_RATE, citySettingsUrl: process.env.CITY_SETTINGS_URL || null });
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDates(...dates) {
  return dates.every((d) => DATE_RE.test(d) && !isNaN(new Date(d)));
}

function sendError(res, status, message) {
  res.status(status).json({ error: message });
}

/**
 * Loads leads + spend for a lead-date range and builds the dashboard payload.
 * Ad-platform failures don't fail the request; they are reported in meta.errors
 * so the widget can show a warning instead of silently showing 0 spend.
 */
async function loadDashboard({ startDate, endDate, meetingStartDate, meetingEndDate, city, cityMapping, dateBy }) {
  const started = Date.now();
  const [zoho, fb, google, mapping] = await Promise.all([
    getZohoOutput(),
    getSpend('facebook', startDate, endDate),
    getSpend('google', startDate, endDate),
    cityMapping || getCityMap(),
  ]);
  const cityMap = mapping.map;

  const data = buildLeadsResponse({
    leads: zoho.value.leads_data,
    facebookSpend: fb.rows,
    googleSpend: google.rows,
    startDate,
    endDate,
    meetingStartDate,
    meetingEndDate,
    gstRate: GST_RATE,
    city,
    cityMap,
    dateBy,
  });

  const errors = {};
  if (fb.error) errors.facebook = fb.error;
  if (google.error) errors.google = google.error;
  if (zoho.stale) errors.leads = `Lead data was last refreshed at ${new Date(zoho.fetchedAt).toISOString()}.`;
  if (city && !(zoho.value.leads_data || []).some((l) => l.owner)) {
    errors.city = 'Lead owner is not available yet, so leads cannot be split by city.';
  }
  if (mapping.error) errors.cityMapping = mapping.error;

  const meta = {
    startDate,
    endDate,
    meetingStartDate: meetingStartDate || null,
    meetingEndDate: meetingEndDate || null,
    city: city || null,
    dateBy: dateBy || 'lead',
    gstRate: GST_RATE,
    spendByCity: spendByCity([...fb.rows, ...google.rows], startDate, endDate, GST_RATE, cityMap),
    cityMapping: cityMap.source,
    leadsAsOf: new Date(zoho.fetchedAt).toISOString(),
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    errors,
  };
  return { data, zohoOutput: zoho.value, meta };
}

function handleFailure(res, err) {
  console.error("Error API Call: ", err.message);
  sendError(res, 502, `Could not load dashboard data: ${err.message}`);
}

// Single call used by the widget: lead/spend metrics + meeting counts + meta.
// ?by=meeting: the dates are meeting done dates (the "Check Meetings" view) instead of lead
// created dates. ?mstart=&mend= (older widgets) restricts a lead-date view to leads with a
// meeting in that range.
expressApp.get('/app/dashboard/:startDate/:endDate', async function (req, res) {
  const { startDate, endDate } = req.params;
  const { mstart, mend } = req.query;
  const city = req.query.city || undefined;
  const dateBy = req.query.by === 'meeting' ? 'meeting' : 'lead';
  const meetingFilter = dateBy === 'lead' && Boolean(mstart && mend);
  if (!validDates(startDate, endDate) || (meetingFilter && !validDates(mstart, mend))) {
    return sendError(res, 400, 'Dates must be YYYY-MM-DD');
  }
  const cityMapping = await getCityMap();
  const cityMap = cityMapping.map;
  const cityName = city ? cityMap.resolve(city) : undefined; // also accepts the old "Hossur"
  if (city && !cityName) {
    return sendError(res, 400, `Unknown city. Use one of: ${cityMap.cities.join(', ')}`);
  }
  try {
    const { data, zohoOutput, meta } = await loadDashboard({
      startDate,
      endDate,
      meetingStartDate: meetingFilter ? mstart : undefined,
      meetingEndDate: meetingFilter ? mend : undefined,
      city: cityName,
      cityMapping,
      dateBy,
    });
    const meetings = meetingFilter
      ? countMeetings(zohoOutput, mstart, mend, cityName, cityMap)
      : countMeetings(zohoOutput, startDate, endDate, cityName, cityMap);
    if (city && (zohoOutput.google_meetings_data || []).some((m) => typeof m === 'string')) {
      meta.errors.meetings = 'Meeting counts are not split by city yet (Zoho sends meeting dates without owner).';
    }
    res.set('Cache-Control', 'no-store');
    res.json({ ...data, ...meetings, meta });
  } catch (err) {
    handleFailure(res, err);
  }
});

// ---- Legacy endpoints (kept so the currently deployed widget keeps working) ----

expressApp.get('/app/leads/meetings/:startDate/:endDate', async function (req, res) {
  const { startDate, endDate } = req.params;
  if (!validDates(startDate, endDate)) return sendError(res, 400, 'Dates must be YYYY-MM-DD');
  try {
    const zoho = await getZohoOutput();
    res.json(countMeetings(zoho.value, startDate, endDate));
  } catch (err) {
    handleFailure(res, err);
  }
});

expressApp.get('/app/leads/:startDate/:endDate', async function (req, res) {
  const { startDate, endDate } = req.params;
  if (!validDates(startDate, endDate)) return sendError(res, 400, 'Dates must be YYYY-MM-DD');
  try {
    const { data, meta } = await loadDashboard({ startDate, endDate });
    res.json({ ...data, meta });
  } catch (err) {
    handleFailure(res, err);
  }
});

expressApp.get('/app/leads/meetingfilter/:startDate/:endDate/:mstartDate/:mendDate', async function (req, res) {
  const { startDate, endDate, mstartDate, mendDate } = req.params;
  if (!validDates(startDate, endDate, mstartDate, mendDate)) return sendError(res, 400, 'Dates must be YYYY-MM-DD');
  try {
    const { data, meta } = await loadDashboard({
      startDate,
      endDate,
      meetingStartDate: mstartDate,
      meetingEndDate: mendDate,
    });
    res.json({ ...data, meta });
  } catch (err) {
    handleFailure(res, err);
  }
});

// Pre-loads caches. Called by the scheduled warm-up (see lambda.js / serverless.yml).
expressApp.get('/app/warm', async function (req, res) {
  res.json(await warm());
});

module.exports = { expressApp, warm };

if (require.main === module) {
  expressApp.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
  });
}
