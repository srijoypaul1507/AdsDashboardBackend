SELECT
		 Count(Id) As "Leads",
		 date("Created Time") As "Created Time",
		 date("Meeting Done Date") AS "Meeting Date",
		 "Lead Owner Name" As "Lead Owner",
		 lc."City" AS "City",
		 
			CASE
				 WHEN "Lead Source"  IN ( 'Google AdWords'  , 'Unknown'  , 'Direct Call'  )
				 OR	"Lead Source"  IS NULL THEN 'Google AdWords'
				 ELSE "Lead Source"
			 END AS "Lead Source",
		 SUM(CASE
				 WHEN "Internal Sales Status"  = 'Meeting Done' THEN 1
				 ELSE 0
			 END) AS "Meeting_Done",
		 SUM(CASE
				 WHEN "Internal Sales Status"  = 'Meeting Fixed' THEN 1
				 ELSE 0
			 END) AS "Meeting_Fixed",
		 TO_NUMBER(SUM(CASE
				 WHEN "Qualification Status"  = 'Qualified' THEN 1
				 ELSE 0
			 END)) AS "Qualified",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'Future Qualified' THEN 1
				 ELSE 0
			 END) AS "Future Qualified",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'RNR' THEN 1
				 ELSE 0
			 END) AS "RNR",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'Update After Discussion' THEN 1
				 ELSE 0
			 END) AS "Update After Discussion",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'Not Valid' THEN 1
				 ELSE 0
			 END) AS "Not Qualified",
		 SUM(CASE
				 WHEN "Qualification Status"  = 'Might Qualified' THEN 1
				 ELSE 0
			 END) AS "Might Qualify",
		 SUM(CASE
				 WHEN "Sales Leads Status"  = 'Converted' THEN 1
				 ELSE 0
			 END) AS "Converted",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'False Enquiry' THEN 1
				 ELSE 0
			 END) AS "False Enquiry",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Budget' THEN 1
				 ELSE 0
			 END) AS "Budget",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Other...' THEN 1
				 ELSE 0
			 END) AS "Other...",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Ready to Move/Plot' THEN 1
				 ELSE 0
			 END) AS "Ready to Move/Plot",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Vendor' THEN 1
				 ELSE 0
			 END) AS "Vendor",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Non serviceable area' THEN 1
				 ELSE 0
			 END) AS "Non serviceable area",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'No Response' THEN 1
				 ELSE 0
			 END) AS "No Response",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Materials' THEN 1
				 ELSE 0
			 END) AS "Materials",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Floor plan/design' THEN 1
				 ELSE 0
			 END) AS "Floor plan/design",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Extension/Renovation' THEN 1
				 ELSE 0
			 END) AS "Extension/Renovation",
		 SUM(CASE
				 WHEN "Reason For Unqualified"  = 'Competitor' THEN 1
				 ELSE 0
			 END) AS "Competitor",
		 "Reason For Unqualified"
FROM  "Leads" 
LEFT JOIN "Lead City" lc ON lc."Lead Id"  = "Leads"."Id" 
GROUP BY "Internal Sales Status",
	 date("Created Time"),
	 date("Meeting Done Date"),
	 "Reason For Unqualified",
	 "Lead Source",
	  "Lead Owner Name",
	 lc."City" 
ORDER BY "Created Time" DESC 

