SELECT
		 "Lead Owner Name",
		 lc."City" AS "City",
		 CAST("Created Time" AS DATE) AS "Created Time",
		 date("Meeting Done Date") AS "Meeting Date",
		 SUM(CASE
				 WHEN "Internal Sales Status"  = 'Meeting Fixed' THEN 1
				 ELSE 0
			 END) AS "Meeting_Fixed",
		 SUM(CASE
				 WHEN "Internal Sales Status"  = 'Meeting Done' THEN 1
				 ELSE 0
			 END) AS "Meeting_Done",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'Qualified' THEN 1
				 ELSE 0
			 END) AS "Qualified Leads",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'Future Qualified' THEN 1
				 ELSE 0
			 END) AS "Future Qualified Leads",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'RNR' THEN 1
				 ELSE 0
			 END) AS "RNR Leads",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'Not Valid' THEN 1
				 ELSE 0
			 END) AS "Not Valid"
FROM  "Leads" 
LEFT JOIN "Lead City" lc ON lc."Lead Id"  = "Leads"."Id" 
GROUP BY "Lead Owner Name",
	 CAST("Created Time" AS DATE),
	  date("Meeting Done Date"),
	 lc."City" 
ORDER BY "Lead Owner Name",
	 CAST("Created Time" AS DATE) 

