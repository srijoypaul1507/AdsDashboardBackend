/* Lead City: the city each lead counts for, with the same rules as the marketing dashboard
   (AdsDashboardBackend/lib/cities.js):
   - assignee = Lead Owner, or "Created By" for Pankaj's web-form leads
   - city = the assignee's latest "City Mappings" row with Effective From on or before the
     lead's created date
   - if no row applies: the built-in list (inactive users Naveen / Sudeepthi etc.)
   - otherwise empty (the lead counts only under All Cities) */
SELECT
		 l."Id" AS "Lead Id",
		 MAX(ua."Full Name") AS "Assignee",
		 COALESCE(MAX(cm."City"), MAX(CASE
				 WHEN LOWER(ua."Full Name")  IN ( 'sudipti'  , 'sudeepthi'  , 'naveen'  , 'shreya'  )
				 OR	LOWER(ua."Full Name")  LIKE 'sudipti %'
				 OR	LOWER(ua."Full Name")  LIKE 'sudeepthi %'
				 OR	LOWER(ua."Full Name")  LIKE 'naveen %'
				 OR	LOWER(ua."Full Name")  LIKE 'shreya %' THEN 'Bangalore'
				 WHEN LOWER(ua."Full Name")  = 'madhuri'
				 OR	LOWER(ua."Full Name")  LIKE 'madhuri %' THEN 'Hyderabad'
				 WHEN LOWER(ua."Full Name")  IN ( 'hosur is'  , 'hosur'  )
				 OR	LOWER(ua."Full Name")  LIKE 'hosur %' THEN 'Hosur'
				 ELSE NULL
			 END)) AS "City"
FROM  "Leads" l
LEFT JOIN "Users" ua ON ua."Id"  = CASE
			 WHEN LOWER(l."Lead Owner Name")  LIKE 'pankaj%' THEN l."Created By"
			 ELSE l."Lead Owner"
		 END
LEFT JOIN(	SELECT
			 l2."Id" AS "LId",
			 MAX(c2."Effective From") AS "From"
	FROM  "Leads" l2
JOIN "City Mappings" c2 ON c2."Assignee"  = CASE
				 WHEN LOWER(l2."Lead Owner Name")  LIKE 'pankaj%' THEN l2."Created By"
				 ELSE l2."Lead Owner"
			 END
	 AND	c2."Effective From"  <= date(l2."Created Time")
	GROUP BY l2."Id"
) m ON m."LId"  = l."Id"
LEFT JOIN "City Mappings" cm ON cm."Assignee"  = ua."Id"
	 AND	cm."Effective From"  = m."From"
GROUP BY l."Id"
