const test = require('node:test');
const assert = require('node:assert');
const { buildLeadsResponse, countMeetings } = require('../lib/aggregate');

const leads = [
  { date: '2026-10-01', source: 'Google AdWords', mobile: '1', qs: 'Qualified', iss: 'Meeting Done', converted: 'Cold' },
  { date: '2026-10-01', source: null, mobile: '9876543210', qs: 'Future Qualified', iss: 'First Call', converted: 'Dead' },
  { date: '2026-10-02', source: 'Meta Ads', mobile: '9876543210', qs: 'Qualified', iss: 'Meeting Done', converted: 'Converted', meetingdate: '2026-10-05' },
  { date: '2026-10-02', source: 'Meta Ads', mobile: '123', qs: 'Not Valid', iss: 'First Call', converted: 'Dead' },
  { date: '2026-10-02', source: 'Referral Lead', mobile: '9876543210', qs: 'Qualified', iss: 'Meeting Done', converted: 'Converted' },
  { date: '2026-10-03', source: 'CP Lead', mobile: '9876543210', qs: 'Qualified', iss: 'Meeting Done', converted: 'Converted', cpbudget: '1000000' },
  { date: '2026-09-30', source: 'Google AdWords', mobile: '9876543210', qs: 'Qualified', iss: 'Meeting Done', converted: 'Converted' },
  { date: '2026-10-02', source: 'Website', mobile: '9876543210', qs: 'Qualified', iss: 'Meeting Done', converted: 'Converted' },
];
const googleSpend = [
  { date: '2026-10-01', cost: 1000, clicks: 10 },
  { date: '2026-10-03', cost: 500, clicks: 5 },
  { date: '2026-09-30', cost: 9999, clicks: 99 },
];
const facebookSpend = [{ date: '2026-10-02', cost: 2000, clicks: 20 }];

test('aggregates leads and spend per source for the range', () => {
  const r = buildLeadsResponse({ leads, googleSpend, facebookSpend, startDate: '2026-10-01', endDate: '2026-10-03' });

  assert.deepStrictEqual(r.labels, ['2026-10-01', '2026-10-02', '2026-10-03']);
  // Google: only "Google AdWords" leads with a valid mobile count as leads (the no-source
  // lead is not Google); spend outside the range ignored
  assert.strictEqual(r.google_budget, 1500);
  assert.strictEqual(r.google_clicks, 15);
  assert.strictEqual(r.google_leads, 0);
  assert.strictEqual(r.google_qualified, 1);
  assert.strictEqual(r.google_future_qualified, 0);
  assert.strictEqual(r.cpl_google, 0);
  assert.deepStrictEqual(r.google_budgetData, [1000, 0, 500]);
  // Meta: only leads with a 10–13 char mobile are counted
  assert.strictEqual(r.facebook_leads, 1);
  assert.strictEqual(r.facebook_budget, 2000);
  assert.strictEqual(r.facebook_converted, 1);
  // Socials = Google + Meta
  assert.strictEqual(r.socials_budget, 3500);
  assert.deepStrictEqual(r.socials_budgetData, [1000, 2000, 500]);
  // Referral: fixed cost per conversion; CP: 2.5% commission
  assert.strictEqual(r.referral_budget, 50000);
  assert.strictEqual(r.cpl_referral, 50000);
  assert.strictEqual(r.cplead_budget, 25000);
});

test('meeting-date filter restricts leads to meetings in that window', () => {
  const r = buildLeadsResponse({
    leads, googleSpend, facebookSpend,
    startDate: '2026-10-01', endDate: '2026-10-03',
    meetingStartDate: '2026-10-04', meetingEndDate: '2026-10-06',
  });
  assert.strictEqual(r.facebook_leads, 1);
  assert.strictEqual(r.google_leads, 0);
  assert.strictEqual(r.referral_leads, 0);
  // spend is still for the lead range
  assert.strictEqual(r.facebook_budget, 2000);
});

test('countMeetings counts dates per source within the range', () => {
  const out = {
    google_meetings_data: ['2026-10-01', '2026-10-05', '2026-11-01'],
    facebook_meetings_data: ['2026-10-02'],
  };
  assert.deepStrictEqual(countMeetings(out, '2026-10-01', '2026-10-31'), {
    google_meeting: 2, facebook_meeting: 1, socials_meeting: 0, referral_meeting: 0, cplead_meeting: 0,
  });
});

test('mobile_len from the newer Zoho function is used for the mobile check', () => {
  const r = buildLeadsResponse({
    leads: [
      { date: '2026-10-01', source: 'Meta Ads', mobile_len: 10 },
      { date: '2026-10-01', source: 'Meta Ads', mobile_len: 5 },
      { date: '2026-10-01', source: 'Meta Ads', mobile_len: 0 },
    ],
    googleSpend: [], facebookSpend: [], startDate: '2026-10-01', endDate: '2026-10-01',
  });
  assert.strictEqual(r.facebook_leads, 1);
});

test('Google = Lead Source "Google AdWords" with a valid mobile; Direct Call / no source / ERP are not counted', () => {
  const r = buildLeadsResponse({
    leads: [
      { date: '2026-10-01', source: 'Google AdWords', mobile_len: 10, iss: 'Meeting Done', qs: 'Qualified' },
      { date: '2026-10-01', source: 'Google AdWords', mobile_len: 4 },
      { date: '2026-10-01', source: 'Direct Call', mobile_len: 10, iss: 'Meeting Done' },
      { date: '2026-10-01', source: null, mobile_len: 10, qs: 'Qualified' },
      { date: '2026-10-01', source: 'ERP Lead', mobile_len: 10 },
    ],
    googleSpend: [], facebookSpend: [], startDate: '2026-10-01', endDate: '2026-10-01',
  });
  assert.strictEqual(r.google_leads, 1);
  assert.strictEqual(r.google_meetings_done, 1);
  assert.strictEqual(r.google_qualified, 1);
  assert.strictEqual(r.socials_leads, 1);
});

test('meeting view: dates are meeting done dates, lead created date does not matter', () => {
  const rows = [
    // created long before the range, meeting inside it -> counts
    { date: '2026-01-05', source: 'Meta Ads', mobile_len: 10, qs: 'Qualified', iss: 'Converted', converted: 'Converted', meetingdate: '2026-10-03' },
    // created inside the range, no meeting -> not shown in the meeting view
    { date: '2026-10-02', source: 'Meta Ads', mobile_len: 10, qs: 'Qualified', iss: 'First Call' },
    // meeting outside the range
    { date: '2026-10-01', source: 'Google AdWords', mobile_len: 10, iss: 'Meeting Done', meetingdate: '2026-11-01' },
    // date-time meeting value from Zoho
    { date: '2026-09-20', source: 'Google AdWords', mobile_len: 0, iss: 'Meeting Done', meetingdate: '2026-10-02T11:30:00+05:30' },
  ];
  const r = buildLeadsResponse({
    leads: rows,
    googleSpend: [{ date: '2026-10-02', cost: 100, clicks: 1 }, { date: '2026-09-30', cost: 999, clicks: 9 }],
    facebookSpend: [{ date: '2026-10-03', cost: 50, clicks: 1 }],
    startDate: '2026-10-01', endDate: '2026-10-03', dateBy: 'meeting',
  });
  assert.strictEqual(r.facebook_meetings_done, 1);
  assert.strictEqual(r.google_meetings_done, 1); // counted even without a valid mobile
  assert.strictEqual(r.facebook_leads, 0);       // no lead counts in the meeting view
  assert.strictEqual(r.google_leads, 0);
  assert.strictEqual(r.facebook_qualified, 1);
  assert.strictEqual(r.facebook_converted, 1);
  assert.deepStrictEqual(r.socials_meetingsData, [0, 1, 1]); // on the meeting dates
  assert.strictEqual(r.socials_budget, 150);   // spend for the meeting range only
  assert.strictEqual(r.cpm_socials, 75);
});

test('lead view is unchanged by default', () => {
  const r = buildLeadsResponse({ leads, googleSpend, facebookSpend, startDate: '2026-10-01', endDate: '2026-10-03' });
  const same = buildLeadsResponse({ leads, googleSpend, facebookSpend, startDate: '2026-10-01', endDate: '2026-10-03', dateBy: 'lead' });
  assert.deepStrictEqual(r, same);
});

test('Others: every source outside the four tabs is counted under other, with no spend', () => {
  const r = buildLeadsResponse({
    leads: [
      { date: '2026-10-01', source: 'Direct Call', mobile_len: 10, iss: 'Meeting Done', qs: 'Qualified', converted: 'Converted' },
      { date: '2026-10-01', source: null, mobile_len: 10, qs: 'Future Qualified' },
      { date: '2026-10-01', source: 'ERP Lead', mobile_len: 10 },
      { date: '2026-10-01', source: 'EXPO', mobile_len: 3 },
      { date: '2026-10-01', source: 'Google AdWords', mobile_len: 10 },
    ],
    googleSpend: [{ date: '2026-10-01', cost: 100, clicks: 1 }], facebookSpend: [],
    startDate: '2026-10-01', endDate: '2026-10-01',
  });
  assert.strictEqual(r.other_leads, 3); // valid mobile only, like every source
  assert.strictEqual(r.other_meetings_done, 1);
  assert.strictEqual(r.other_qualified, 1);
  assert.strictEqual(r.other_future_qualified, 1);
  assert.strictEqual(r.other_converted, 1);
  assert.strictEqual(r.other_budget, 0);
  assert.strictEqual(r.google_leads, 1);       // Google stays AdWords only
  assert.strictEqual(r.socials_leads, 1);      // Socials = Google + Meta, unchanged
});
