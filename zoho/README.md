# Zoho function `getData` (source of `ZOHO_API`)

Zoho CRM → Setup → Developer Hub → Functions → **getData** (REST API via API key is enabled).
`getData1` is an older copy with the API key disabled.

Current version: `getData.deluge`. Updated version: `getData.updated.deluge` (adds owner,
drops names/full mobile numbers, removes heavy logging). **Deploy the updated backend first**: the old
backend cannot read the new meeting format or `mobile_len`.

## Change needed for the City filter

The backend matches cities on the lead owner. Two additions to the function's output:

1. **Every item in `leads_data` gets an `owner` field** with the lead owner's name:

   ```deluge
   // where each lead row map is built
   row.put("owner", ifnull(lead.get("Owner"), {}).get("name"));
   ```

2. **Meeting lists carry the owner too.** Change each item in `google_meetings_data`, `facebook_meetings_data`,
   `socials_meetings_data`, `referral_meetings_data` and `cplead_meetings_data` from a plain date string to:

   ```deluge
   m = Map();
   m.put("date", meetingDate);   // same value that is added today
   m.put("owner", ifnull(lead.get("Owner"), {}).get("name"));
   google_meetings_data.add(m);  // likewise for the other lists
   ```

The backend accepts both the old and new formats, so this can be deployed before or after the backend.
Until it's done, the City filter splits spend by campaign but warns that leads/meetings are not split.

## Owner → city mapping (Zoho CRM module "City Mappings")

Admins maintain the mapping in Zoho CRM, module **City Mappings** (API name `City_Mappings`, Administrator
profile only). Each record is one row: **Assignee** (Zoho user), **City** (Bangalore / Hyderabad / Hosur)
and **Effective From** (date). A row means "from this date, this user's leads count for this city":

* A lead takes the city of its assignee's latest row dated on or before the lead's **created date**.
  Pankaj's web-form leads use the "Created By" user as the assignee.
* A meeting follows its lead (the lead's created date decides, not the meeting date).
* When someone moves city, add a new row with the move date; don't edit the old one. Older leads keep the
  old city. One city can have any number of assignees.
* When no row applies (someone with no rows, or a lead created before their first row), the built-in
  mapping in `lib/cities.js` is used; people it doesn't know count only under All Cities. This covers
  inactive users (Naveen, Sudeepthi), who can't be picked in a Zoho user field but whose old leads are
  Bangalore leads.
* The city follows the lead's **current** owner: if old leads are reassigned in Zoho, they move with them.

The Zoho function **getCityMapping** (`getCityMapping.deluge`, Standalone, REST API with API key) returns
the rows. The backend reloads it on every warm-up (~5 min), so an edit shows on the dashboard within
minutes. If it cannot be loaded, the last loaded copy is used (then the built-in mapping), and the response
says so in `meta.errors.cityMapping`. `meta.cityMapping` says which one was used (`zoho` / `default`).

The built-in mapping can be overridden without a code change via the `CITY_OWNERS_JSON` env var:

```json
{"Bangalore":["Sudipti","Naveen","Shreya"],"Hyderabad":["Madhuri"],"Hosur":["<owner first name>"]}
```

Campaign → city uses keywords in the campaign name (`CITY_CAMPAIGNS_JSON`). `meta.spendByCity` in every
`/app/dashboard` response shows spend per city plus `Unassigned`, which is useful for checking the keywords.
