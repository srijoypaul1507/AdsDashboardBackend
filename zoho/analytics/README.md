# Zoho Analytics: City on the sales dashboards

Workspace **Zoho CRM Reports**. The CRM sync (every 2 hours) includes the **City Mappings** module and the
Leads **Created By** field.

* `Lead City.sql`: query table **Lead City** (folder Query Tables). One row per lead: its assignee and
  city, with the same rules as the Marketing Dashboard backend (`lib/cities.js`): Lead Owner, or Created By
  for Pankaj's leads; latest City Mappings row with Effective From on or before the lead's created date;
  else the built-in list (inactive Naveen / Sudeepthi); else empty ("Unknown" in filters).
  Checked on 22 Oct 2026 against the backend: Bangalore 7,821 / Hyderabad 492 / Hosur 77 / none 221 vs
  7,822 / 492 / 77 / 219 (leads created before 22 Oct; the 2-lead gap is data edited after the sync).
* `Internal Sales Insights.sql`, `Outside Sales Insights.sql`, `Outside Sales.sql`: the three sales query
  tables with a `City` column (LEFT JOIN on Lead City; added to GROUP BY where the query groups).
  `original/` holds the versions from before 22 Oct 2026; paste one back to undo.
* The **Internal Sales Insights DashBoard** and **Outside Sales Dashboard** have a **City** user filter.
  All dashboard numbers were compared before and after the change and are identical.

Zoho Analytics allows only one level of sub-query, which is why Lead City is a separate query table.
