const test = require('node:test');
const assert = require('node:assert');
const { cityForOwner, cityForLead, cityForCampaign } = require('../lib/cities');
const { buildLeadsResponse, countMeetings, spendByCity } = require('../lib/aggregate');

test('owners map to cities by first name, case-insensitively', () => {
  assert.strictEqual(cityForOwner('Sudipti Sharma'), 'Bangalore');
  assert.strictEqual(cityForOwner({ name: 'naveen K', id: '1' }), 'Bangalore');
  assert.strictEqual(cityForOwner('Madhuri'), 'Hyderabad');
  // names as they appear in Zoho
  assert.strictEqual(cityForOwner('sudeepthi sudeepthi'), 'Bangalore');
  assert.strictEqual(cityForOwner('shreya shreya'), 'Bangalore');
  assert.strictEqual(cityForOwner('Madhuri Nara'), 'Hyderabad');
  assert.strictEqual(cityForOwner('Hosur IS'), 'Hosur');
  assert.strictEqual(cityForOwner('pankaj pankaj'), null);
  assert.strictEqual(cityForOwner('Someone Else'), null);
  assert.strictEqual(cityForOwner(null), null);
});

test('campaigns map to cities by keyword in the name', () => {
  assert.strictEqual(cityForCampaign('BLR | Search | 3BHK'), 'Bangalore');
  assert.strictEqual(cityForCampaign('Leads_Hyderabad_Oct'), 'Hyderabad');
  assert.strictEqual(cityForCampaign('Hosur villas'), 'Hosur');
  assert.strictEqual(cityForCampaign('Hyd_Search_Brand_PM'), 'Hyderabad');
  assert.strictEqual(cityForCampaign("Hosur_Lead_Gen_Statics_Sep'26"), 'Hosur');
  // untagged campaigns are Bangalore spend
  assert.strictEqual(cityForCampaign("Bizbucks_Lead_Gen_Infor Video Nov'25"), 'Bangalore');
  assert.strictEqual(cityForCampaign('Hydrangea project'), 'Bangalore'); // no partial-word match
});

const leads = [
  { date: '2026-10-01', source: 'Meta Ads', mobile: '9876543210', qs: 'Qualified', iss: 'Meeting Done', converted: 'Cold', owner: 'Sudipti S' },
  { date: '2026-10-01', source: 'Meta Ads', mobile: '9876543210', qs: 'Qualified', iss: 'First Call', converted: 'Cold', owner: 'Madhuri R' },
  { date: '2026-10-01', source: 'Google AdWords', mobile: '9876543210', qs: 'Not Valid', iss: 'First Call', converted: 'Cold', owner: 'Naveen' },
];
const facebookSpend = [
  { date: '2026-10-01', campaign: 'BLR Leads', cost: 1000, clicks: 10 },
  { date: '2026-10-01', campaign: 'HYD Leads', cost: 500, clicks: 5 },
  { date: '2026-10-01', campaign: 'Brand', cost: 100, clicks: 1 },
];
const googleSpend = [{ date: '2026-10-01', campaign: 'Bangalore Search', cost: 2000, clicks: 20 }];
const range = { startDate: '2026-10-01', endDate: '2026-10-01' };

test('GST is added to ad spend only', () => {
  const r = buildLeadsResponse({ leads, facebookSpend, googleSpend, ...range, gstRate: 0.18 });
  assert.strictEqual(Math.round(r.facebook_budget), 1888);
  assert.strictEqual(Math.round(r.google_budget), 2360);
  const none = buildLeadsResponse({ leads, facebookSpend, googleSpend, ...range });
  assert.strictEqual(none.facebook_budget, 1600);
});

test('city filter restricts both leads and spend', () => {
  const blr = buildLeadsResponse({ leads, facebookSpend, googleSpend, ...range, city: 'Bangalore' });
  assert.strictEqual(blr.facebook_leads, 1);
  assert.strictEqual(blr.google_leads, 1);
  assert.strictEqual(blr.facebook_budget, 1100); // includes the untagged "Brand" campaign
  assert.strictEqual(blr.google_budget, 2000);
  const hyd = buildLeadsResponse({ leads, facebookSpend, googleSpend, ...range, city: 'Hyderabad' });
  assert.strictEqual(hyd.facebook_leads, 1);
  assert.strictEqual(hyd.google_leads, 0);
  assert.strictEqual(hyd.facebook_budget, 500);
});

test('spendByCity reports unassigned campaigns separately', () => {
  assert.deepStrictEqual(
    spendByCity([...facebookSpend, ...googleSpend], '2026-10-01', '2026-10-01', 0),
    { Bangalore: 3100, Hyderabad: 500 }
  );
});

test('meetings can be filtered by city when items carry an owner', () => {
  const out = {
    google_meetings_data: [{ date: '2026-10-01', owner: 'Shreya' }, { date: '2026-10-01', owner: 'Madhuri' }],
    facebook_meetings_data: ['2026-10-01'],
  };
  assert.strictEqual(countMeetings(out, '2026-10-01', '2026-10-01').google_meeting, 2);
  assert.strictEqual(countMeetings(out, '2026-10-01', '2026-10-01').facebook_meeting, 1);
  assert.strictEqual(countMeetings(out, '2026-10-01', '2026-10-01', 'Bangalore').google_meeting, 1);
  assert.strictEqual(countMeetings(out, '2026-10-01', '2026-10-01', 'Bangalore').facebook_meeting, 0);
});

test("Pankaj's leads are attributed to the Created By user; other leads to the owner", () => {
  assert.strictEqual(cityForLead('Pankaj Verma', 'Madhuri Nara'), 'Hyderabad');
  assert.strictEqual(cityForLead('pankaj pankaj', 'shreya shreya'), 'Bangalore');
  assert.strictEqual(cityForLead('Pankaj Verma', 'Pankaj Verma'), null); // still unassigned
  assert.strictEqual(cityForLead('Pankaj Verma', undefined), null);
  assert.strictEqual(cityForLead('Hosur IS', 'Pankaj Verma'), 'Hosur'); // owner wins for others
  assert.strictEqual(cityForLead('Janardhan N', 'Janardhan N'), null);
});

test('city filter uses Created By for Pankaj-owned leads', () => {
  const r = buildLeadsResponse({
    leads: [
      { date: '2026-10-01', source: 'Meta Ads', mobile_len: 10, owner: 'Pankaj Verma', created_by: 'Madhuri Nara' },
      { date: '2026-10-01', source: 'Meta Ads', mobile_len: 10, owner: 'Pankaj Verma', created_by: 'Pankaj Verma' },
    ],
    googleSpend: [], facebookSpend: [], startDate: '2026-10-01', endDate: '2026-10-01', city: 'Hyderabad',
  });
  assert.strictEqual(r.facebook_leads, 1);
});

// ---------- Dated City Mapping from Zoho ----------
const { createCityMap, DEFAULT_CITY_MAP } = require('../lib/cities');

const mappingRows = [
  { assignee: 'shreya shreya', city: 'Bangalore', from: '2020-01-01' },
  { assignee: 'naveen naveen', city: 'Bangalore', from: '2020-01-01' },
  { assignee: 'Madhuri Nara', city: 'Hyderabad', from: '2020-01-01' },
  { assignee: 'Hosur IS', city: 'Hosur', from: '2020-01-01' },
  { assignee: 'shreya shreya', city: 'Hosur', from: '2026-11-01' }, // Shreya moves on 1 Nov
];

test('dated mapping: a lead takes its assignee\'s city on the lead created date', () => {
  const m = createCityMap(mappingRows);
  assert.strictEqual(m.source, 'zoho');
  assert.strictEqual(m.cityForLead('shreya shreya', null, '2026-10-31'), 'Bangalore');
  assert.strictEqual(m.cityForLead('shreya shreya', null, '2026-11-01'), 'Hosur');
  assert.strictEqual(m.cityForLead('Shreya  Shreya', null, '2026-12-15'), 'Hosur'); // case/spaces
  assert.strictEqual(m.cityForLead('naveen naveen', null, '2026-12-15'), 'Bangalore'); // several per city
  assert.strictEqual(m.cityForLead('madhuri nara', null, '2019-12-31'), null); // before the first row
  assert.strictEqual(m.cityForLead('Someone Else', null, '2026-10-01'), null);
  // no rows in Zoho (inactive users can't be picked there): built-in mapping still applies
  assert.strictEqual(m.cityForLead('sudeepthi sudeepthi', null, '2026-10-01'), 'Bangalore');
  // Pankaj's leads use Created By, on the lead's date
  assert.strictEqual(m.cityForLead('Pankaj Verma', 'shreya shreya', '2026-10-01'), 'Bangalore');
  assert.strictEqual(m.cityForLead('Pankaj Verma', 'shreya shreya', '2026-11-02'), 'Hosur');
  assert.strictEqual(m.cityForLead('Pankaj Verma', 'Pankaj Verma', '2026-11-02'), null);
});

test('dated mapping: row order does not matter; bad rows are skipped; new cities are listed', () => {
  const m = createCityMap([
    { assignee: 'a b', city: 'Hyderabad', from: '2026-06-01' },
    { assignee: 'a b', city: 'Bangalore', from: '2026-01-01' },
    { assignee: 'c d', city: 'Chennai', from: '2026-01-01' },
    { assignee: '', city: 'Bangalore', from: '2026-01-01' },
    { assignee: 'e f', city: 'Bangalore', from: 'yesterday' },
    { assignee: 'g h', city: 'Hossur', from: '2026-01-01' }, // old spelling → Hosur
  ]);
  assert.strictEqual(m.skipped, 2);
  assert.strictEqual(m.cityForLead('a b', null, '2026-03-01'), 'Bangalore');
  assert.strictEqual(m.cityForLead('a b', null, '2026-06-01'), 'Hyderabad');
  assert.strictEqual(m.cityForLead('g h', null, '2026-03-01'), 'Hosur');
  assert.deepStrictEqual(m.cities, ['Bangalore', 'Hyderabad', 'Hosur', 'Chennai']);
  assert.strictEqual(m.cityForCampaign('Chennai_Leads_Nov'), 'Chennai');
  assert.strictEqual(m.cityForCampaign('Bizbucks_Lead_Gen'), 'Bangalore');
});

test('no Zoho mapping = built-in mapping, unchanged; old "Hossur" is accepted', () => {
  for (const rows of [null, [], [{ assignee: '', city: '', from: '' }]]) {
    const m = createCityMap(rows);
    assert.strictEqual(m.source, 'default');
    assert.strictEqual(m.cityForLead('shreya shreya', null, '2026-10-01'), 'Bangalore');
    assert.strictEqual(m.cityForLead('Hosur IS', null), 'Hosur');
  }
  assert.strictEqual(DEFAULT_CITY_MAP.resolve('Hossur'), 'Hosur');
  assert.strictEqual(DEFAULT_CITY_MAP.resolve('hosur'), 'Hosur');
  assert.strictEqual(DEFAULT_CITY_MAP.resolve('Delhi'), null);
});

test('dated mapping drives leads and meetings: Shreya\'s move keeps October in Bangalore', () => {
  const cityMap = createCityMap(mappingRows);
  const leadsRows = [
    { date: '2026-10-20', source: 'Meta Ads', mobile_len: 10, owner: 'shreya shreya' },
    { date: '2026-11-05', source: 'Meta Ads', mobile_len: 10, owner: 'shreya shreya' },
  ];
  const args = { leads: leadsRows, googleSpend: [], facebookSpend: [], startDate: '2026-10-01', endDate: '2026-11-30', cityMap };
  assert.strictEqual(buildLeadsResponse({ ...args, city: 'Bangalore' }).facebook_leads, 1);
  assert.strictEqual(buildLeadsResponse({ ...args, city: 'Hosur' }).facebook_leads, 1);
  assert.strictEqual(buildLeadsResponse(args).facebook_leads, 2);

  // A November meeting on an October lead stays with the lead's city.
  const out = {
    facebook_meetings_data: [
      { date: '2026-11-10', owner: 'shreya shreya', lead_date: '2026-10-20' },
      { date: '2026-11-10', owner: 'shreya shreya', lead_date: '2026-11-05' },
      { date: '2026-11-10', owner: 'shreya shreya' }, // older Zoho output: meeting date is used
    ],
  };
  assert.strictEqual(countMeetings(out, '2026-11-01', '2026-11-30', 'Bangalore', cityMap).facebook_meeting, 1);
  assert.strictEqual(countMeetings(out, '2026-11-01', '2026-11-30', 'Hosur', cityMap).facebook_meeting, 2);
});
